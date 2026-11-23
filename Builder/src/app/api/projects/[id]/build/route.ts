import { closeSync, openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { buildJobs, builderProjects } from "@/db/schema";
import { projectDirectory } from "@/lib/builder-paths";
import { serializeJob } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
const ACTIVE = ["queued", "extracting", "installing", "building", "packaging"];

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const [project] = await db.select().from(builderProjects).where(eq(builderProjects.id, id)).limit(1);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  let body: { authorization?: boolean };
  try {
    body = (await request.json()) as { authorization?: boolean };
  } catch {
    body = {};
  }
  if (body.authorization !== true) {
    return NextResponse.json({ error: "Explicit build authorization is required." }, { status: 403 });
  }
  const active = await db.select({ id: buildJobs.id }).from(buildJobs).where(and(eq(buildJobs.projectId, id), inArray(buildJobs.status, ACTIVE))).limit(1);
  if (active.length) return NextResponse.json({ error: "A build is already running for this project." }, { status: 409 });
  const [job] = await db.insert(buildJobs).values({ projectId: id, timeoutMinutes: project.timeoutMinutes }).returning();
  await db.update(builderProjects).set({ status: "building", updatedAt: new Date() }).where(eq(builderProjects.id, id));

  try {
    await mkdir(projectDirectory(id), { recursive: true, mode: 0o700 });
    const runnerLog = path.join(projectDirectory(id), `${job.id}-runner.log`);
    const output = openSync(runnerLog, "a", 0o600);
    const child = spawn(
      process.execPath,
      [path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), path.join(process.cwd(), "scripts", "build-runner.ts"), job.id],
      {
        cwd: process.cwd(),
        detached: true,
        stdio: ["ignore", output, output],
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: process.env.DATABASE_URL,
          APP_BUILDER_DATA_DIR: process.env.APP_BUILDER_DATA_DIR,
          NODE_ENV: process.env.NODE_ENV,
        },
      },
    );
    closeSync(output);
    if (!child.pid) throw new Error("The build worker could not be started.");
    await db.update(buildJobs).set({ pid: child.pid }).where(eq(buildJobs.id, job.id));
    child.unref();
    const [updated] = await db.select().from(buildJobs).where(eq(buildJobs.id, job.id)).limit(1);
    return NextResponse.json({ job: serializeJob(updated, project.name) }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The build worker could not be started.";
    await db.update(buildJobs).set({ status: "failed", error: message, finishedAt: new Date() }).where(eq(buildJobs.id, job.id));
    await db.update(builderProjects).set({ status: "failed", updatedAt: new Date() }).where(eq(builderProjects.id, id));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
