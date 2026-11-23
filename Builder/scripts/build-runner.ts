import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { buildJobs, builderProjects, type BuildJob, type BuilderProject } from "../src/db/schema";
import { extractArchive, getBuildCommand, getInstallCommand, type CommandSpec } from "../src/lib/archive";
import { packageBuildArtifact } from "../src/lib/artifact";
import { archivePath, artifactPath, workspacePath } from "../src/lib/builder-paths";
import { decryptSecret } from "../src/lib/secrets";

const ACTIVE_CHILD_KILL_GRACE = 8_000;
const MAX_LOG_CHARS = 900_000;
let activeChild: ChildProcess | null = null;
let cancelled = false;
let secretsToRedact: string[] = [];

class BuildCancelled extends Error {}
class CommandFailed extends Error {
  exitCode: number | null;
  constructor(message: string, exitCode: number | null) {
    super(message);
    this.exitCode = exitCode;
  }
}

function redact(value: string) {
  let output = value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  for (const secret of secretsToRedact) {
    if (secret.length >= 6) output = output.split(secret).join("[redacted]");
  }
  return output;
}

class Reporter {
  private logs = "";
  private dirty = false;
  private queue: Promise<unknown> = Promise.resolve();
  private timer: NodeJS.Timeout;

  constructor(private jobId: string) {
    this.timer = setInterval(() => void this.flush(), 450);
  }

  append(value: string) {
    const cleaned = redact(value);
    this.logs += cleaned;
    if (this.logs.length > MAX_LOG_CHARS) {
      this.logs = `[Earlier output truncated to keep the live log responsive.]\n${this.logs.slice(-MAX_LOG_CHARS)}`;
    }
    this.dirty = true;
  }

  line(message: string) {
    this.append(`\n[forge ${new Date().toISOString()}] ${message}\n`);
  }

  async flush() {
    if (!this.dirty) return this.queue;
    this.dirty = false;
    const snapshot = this.logs;
    this.queue = this.queue.then(() => db.update(buildJobs).set({ logs: snapshot }).where(eq(buildJobs.id, this.jobId)));
    return this.queue;
  }

  async status(status: string, message?: string) {
    if (message) this.line(message);
    await this.flush();
    const snapshot = this.logs;
    this.queue = this.queue.then(() => db.update(buildJobs).set({ status, logs: snapshot }).where(eq(buildJobs.id, this.jobId)));
    await this.queue;
  }

  async finish(values: Partial<typeof buildJobs.$inferInsert>) {
    clearInterval(this.timer);
    await this.flush();
    await this.queue;
    await db.update(buildJobs).set({ ...values, logs: this.logs }).where(eq(buildJobs.id, this.jobId));
  }
}

function killChild(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* Process already exited. */ }
  }
}

async function execute(
  spec: CommandSpec,
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeoutMinutes: number,
  reporter: Reporter,
) {
  if (cancelled) throw new BuildCancelled();
  reporter.line(`$ ${spec.display}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(spec.executable, spec.args, {
      cwd,
      env: environment,
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChild = child;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      reporter.line(`Command exceeded ${timeoutMinutes} minutes; terminating its process group.`);
      killChild(child, "SIGTERM");
      setTimeout(() => killChild(child, "SIGKILL"), ACTIVE_CHILD_KILL_GRACE).unref();
    }, timeoutMinutes * 60_000);
    child.stdout?.on("data", (chunk: Buffer) => reporter.append(chunk.toString("utf8")));
    child.stderr?.on("data", (chunk: Buffer) => reporter.append(chunk.toString("utf8")));
    child.on("error", (error) => {
      clearTimeout(timeout);
      activeChild = null;
      reject(new CommandFailed(`Could not start ${spec.executable}: ${error.message}`, null));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      activeChild = null;
      if (cancelled) reject(new BuildCancelled());
      else if (timedOut) reject(new CommandFailed(`Command timed out after ${timeoutMinutes} minutes.`, code));
      else if (code !== 0) reject(new CommandFailed(`${spec.display} exited with ${code === null ? `signal ${signal}` : `code ${code}`}.`, code));
      else resolve();
    });
  });
}

function shellEnvironment(workspace: string) {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: path.join(workspace, ".home"),
    COREPACK_HOME: path.join(workspace, ".home", ".cache", "node", "corepack"),
    npm_config_cache: path.join(workspace, ".npm-cache"),
    npm_config_audit: "false",
    npm_config_fund: "false",
    CI: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    FORCE_COLOR: "0",
    NODE_ENV: "development",
  } as NodeJS.ProcessEnv;
}

async function projectEnvironment(project: BuilderProject, workspace: string) {
  const [anonKey, serviceRoleKey, extraSource] = await Promise.all([
    decryptSecret(project.supabaseAnonKeyEncrypted),
    decryptSecret(project.supabaseServiceKeyEncrypted),
    decryptSecret(project.extraEnvEncrypted),
  ]);
  secretsToRedact = [anonKey, serviceRoleKey].filter(Boolean);
  let extra: Record<string, string> = {};
  if (extraSource) {
    const parsed = JSON.parse(extraSource) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) extra = parsed as Record<string, string>;
    for (const value of Object.values(extra)) if (value.length >= 6) secretsToRedact.push(value);
  }
  const environment = shellEnvironment(workspace);
  Object.assign(environment, extra, {
    NEXT_PUBLIC_SUPABASE_URL: project.supabaseUrl,
    SUPABASE_URL: project.supabaseUrl,
  });
  if (anonKey) Object.assign(environment, {
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_ANON_KEY: anonKey,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonKey,
    SUPABASE_PUBLISHABLE_KEY: anonKey,
  });
  if (serviceRoleKey) environment.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;
  return { environment, injectedKeys: Object.keys(environment).filter((key) => !["PATH", "HOME", "COREPACK_HOME", "npm_config_cache", "npm_config_audit", "npm_config_fund", "CI", "NEXT_TELEMETRY_DISABLED", "FORCE_COLOR", "NODE_ENV"].includes(key)) };
}

async function hasLockfile(cwd: string, packageManager: string) {
  const names: Record<string, string[]> = {
    npm: ["package-lock.json", "npm-shrinkwrap.json"],
    pnpm: ["pnpm-lock.yaml"],
    yarn: ["yarn.lock"],
    bun: ["bun.lock", "bun.lockb"],
  };
  for (const name of names[packageManager] ?? names.npm) {
    try { await stat(path.join(cwd, name)); return true; } catch { /* Try the next lockfile. */ }
  }
  return false;
}

async function run(job: BuildJob, project: BuilderProject) {
  const reporter = new Reporter(job.id);
  const started = Date.now();
  let outputArtifact: string | null = null;
  const stop = () => {
    cancelled = true;
    reporter.line("Cancellation received; stopping the active process group.");
    if (activeChild) killChild(activeChild, "SIGTERM");
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  try {
    await reporter.status("extracting", `Authorized build ${job.id} started in a fresh workspace.`);
    const workspace = workspacePath(project.id);
    await rm(workspace, { recursive: true, force: true });
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    await extractArchive(archivePath(project.id), workspace);
    if (cancelled) throw new BuildCancelled();
    const cwd = path.resolve(workspace, project.projectRoot);
    if (cwd !== workspace && !cwd.startsWith(`${workspace}${path.sep}`)) throw new Error("Invalid project root.");
    const manifest = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    if (!manifest.scripts?.build) throw new Error("The extracted package no longer contains a build script.");
    const { environment, injectedKeys } = await projectEnvironment(project, workspace);
    reporter.line(`Supabase URL configured. Injected variables: ${injectedKeys.sort().join(", ")}`);
    await mkdir(path.join(workspace, ".home"), { recursive: true, mode: 0o700 });

    const install = getInstallCommand(project.packageManager, await hasLockfile(cwd, project.packageManager));
    await reporter.status("installing", "Installing dependencies from the uploaded manifest.");
    await execute(install, cwd, { ...environment, NODE_ENV: "development" }, job.timeoutMinutes, reporter);

    const build = getBuildCommand(project.packageManager);
    await reporter.status("building", "Dependency installation completed. Running the project build script.");
    await execute(build, cwd, { ...environment, NODE_ENV: "production" }, job.timeoutMinutes, reporter);
    await stat(path.join(cwd, ".next"));
    if (cancelled) throw new BuildCancelled();

    outputArtifact = artifactPath(project.id, job.id);
    await reporter.status("packaging", "Build output verified at .next. Packaging source and build artifacts without secrets.");
    try {
      const result = await packageBuildArtifact(cwd, outputArtifact, {
        project: project.packageName,
        jobId: job.id,
        builtAt: new Date().toISOString(),
        nextVersion: project.nextVersion,
        packageManager: project.packageManager,
        buildCommand: build.display,
        injectedEnvironmentKeys: injectedKeys.sort(),
      });
      const durationMs = Date.now() - started;
      await reporter.finish({
        status: "succeeded",
        artifactName: `${project.packageName.replace(/[^a-zA-Z0-9._-]/g, "-")}-${job.id.slice(0, 8)}-build.zip`,
        artifactSize: result.size,
        durationMs,
        finishedAt: new Date(),
        error: null,
      });
      await db.update(builderProjects).set({ status: "ready", updatedAt: new Date() }).where(eq(builderProjects.id, project.id));
      reporter.line(`Build verified and packaged ${result.fileCount} files in ${(durationMs / 1000).toFixed(1)} seconds.`);
      await reporter.flush();
    } catch (artifactError) {
      await rm(outputArtifact, { force: true }).catch(() => undefined);
      if (cancelled || artifactError instanceof BuildCancelled) throw new BuildCancelled();
      const durationMs = Date.now() - started;
      reporter.line(`Build succeeded, but artifact packaging was skipped: ${artifactError instanceof Error ? artifactError.message : "unknown error"}`);
      await reporter.finish({ status: "succeeded", durationMs, finishedAt: new Date(), error: null });
      await db.update(builderProjects).set({ status: "ready", updatedAt: new Date() }).where(eq(builderProjects.id, project.id));
    }
  } catch (error) {
    if (outputArtifact) await rm(outputArtifact, { force: true }).catch(() => undefined);
    const wasCancelled = cancelled || error instanceof BuildCancelled;
    const message = wasCancelled ? "Build cancelled by user." : error instanceof Error ? error.message : "Build worker failed.";
    reporter.line(message);
    await reporter.finish({
      status: wasCancelled ? "cancelled" : "failed",
      error: message,
      exitCode: error instanceof CommandFailed ? error.exitCode : null,
      durationMs: Date.now() - started,
      finishedAt: new Date(),
    });
    await db.update(builderProjects).set({ status: wasCancelled ? "inspected" : "failed", updatedAt: new Date() }).where(eq(builderProjects.id, project.id));
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}

async function main() {
  const jobId = process.argv[2];
  if (!jobId) throw new Error("A build job ID is required.");
  const [job] = await db.select().from(buildJobs).where(eq(buildJobs.id, jobId)).limit(1);
  if (!job) throw new Error("Build job not found.");
  const [project] = await db.select().from(builderProjects).where(eq(builderProjects.id, job.projectId)).limit(1);
  if (!project) throw new Error("Build project not found.");
  await run(job, project);
}

main()
  .catch(async (error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
