import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl, { type Entry, type ZipFile } from "yauzl";

export const MAX_ARCHIVE_FILES = 12_000;
export const MAX_UNCOMPRESSED_BYTES = 300 * 1024 * 1024;
export const MAX_SINGLE_FILE_BYTES = 80 * 1024 * 1024;
const MAX_METADATA_FILE_BYTES = 2 * 1024 * 1024;
const GENERATED_DIRECTORIES = ["node_modules", ".git", ".next", ".turbo", ".vercel"];

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveError";
  }
}

type PackageManifest = {
  name?: string;
  version?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export type CommandSpec = { executable: string; args: string[]; display: string };

export type ArchiveInspection = {
  projectRoot: string;
  packageName: string;
  packageVersion: string | null;
  packageManager: string;
  installCommand: string;
  buildCommand: string;
  scripts: Record<string, string>;
  envKeys: string[];
  files: { path: string; size: number }[];
  fileCount: number;
  uncompressedSize: number;
  warnings: string[];
  nextVersion: string;
  router: string;
};

function normalizedEntryName(entry: Entry) {
  const name = entry.fileName;
  if (!name || name.includes("\0") || name.includes("\\") || name.startsWith("/") || /^[a-zA-Z]:/.test(name)) {
    throw new ArchiveError(`Unsafe archive entry path: ${name || "(empty)"}`);
  }
  const normalized = path.posix.normalize(name).replace(/^\.\//, "");
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new ArchiveError(`Archive path traversal was blocked: ${name}`);
  }
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const fileType = unixMode & 0o170000;
  if (fileType === 0o120000) throw new ArchiveError(`Symbolic links are not allowed: ${name}`);
  if (fileType && fileType !== 0o100000 && fileType !== 0o040000) {
    throw new ArchiveError(`Special filesystem entries are not allowed: ${name}`);
  }
  if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
    throw new ArchiveError(`Encrypted ZIP entries are not supported: ${name}`);
  }
  if (entry.uncompressedSize > MAX_SINGLE_FILE_BYTES) {
    throw new ArchiveError(`${name} exceeds the 80 MB per-file limit.`);
  }
  if (
    entry.uncompressedSize > 10 * 1024 * 1024 &&
    entry.compressedSize > 0 &&
    entry.uncompressedSize / entry.compressedSize > 500
  ) {
    throw new ArchiveError(`${name} has a suspicious compression ratio.`);
  }
  return normalized;
}

function isGeneratedPath(name: string) {
  return name.split("/").some((segment) => GENERATED_DIRECTORIES.includes(segment));
}

function openArchive(filePath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      filePath,
      { lazyEntries: true, autoClose: true, validateEntrySizes: true, decodeStrings: true },
      (error, zip) => {
        if (error || !zip) reject(new ArchiveError(error?.message ?? "The ZIP archive could not be opened."));
        else resolve(zip);
      },
    );
  });
}

function entryStream(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(new ArchiveError(error?.message ?? `Could not read ${entry.fileName}.`));
      else resolve(stream);
    });
  });
}

async function entryText(zip: ZipFile, entry: Entry) {
  if (entry.uncompressedSize > MAX_METADATA_FILE_BYTES) {
    throw new ArchiveError(`${entry.fileName} is too large to inspect.`);
  }
  const stream = await entryStream(zip, entry);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_METADATA_FILE_BYTES) throw new ArchiveError(`${entry.fileName} is too large to inspect.`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function walkArchive(
  filePath: string,
  onEntry: (entry: Entry, name: string, zip: ZipFile) => Promise<void>,
) {
  const zip = await openArchive(filePath);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let busy = false;
    let ended = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      zip.close();
      reject(error instanceof Error ? error : new ArchiveError("Archive processing failed."));
    };
    zip.on("error", fail);
    zip.on("entry", (entry: Entry) => {
      busy = true;
      let name = "";
      void (async () => {
        name = normalizedEntryName(entry);
        await onEntry(entry, name, zip);
      })()
        .then(() => {
          if (settled) return;
          busy = false;
          if (ended) {
            settled = true;
            resolve();
          } else {
            zip.readEntry();
          }
        })
        .catch(fail);
    });
    zip.on("end", () => {
      ended = true;
      if (!busy && !settled) {
        settled = true;
        resolve();
      }
    });
    zip.readEntry();
  });
}

export function parseEnvKeys(source: string) {
  const keys = new Set<string>();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match) keys.add(match[1]);
  }
  return [...keys];
}

export function getInstallCommand(packageManager: string, hasLockfile: boolean): CommandSpec {
  if (packageManager === "pnpm") {
    return {
      executable: "pnpm",
      args: ["install", ...(hasLockfile ? ["--frozen-lockfile"] : [])],
      display: `pnpm install${hasLockfile ? " --frozen-lockfile" : ""}`,
    };
  }
  if (packageManager === "yarn") {
    return {
      executable: "yarn",
      args: ["install", ...(hasLockfile ? ["--frozen-lockfile"] : []), "--non-interactive"],
      display: `yarn install${hasLockfile ? " --frozen-lockfile" : ""} --non-interactive`,
    };
  }
  if (packageManager === "bun") {
    return {
      executable: "bun",
      args: ["install", ...(hasLockfile ? ["--frozen-lockfile"] : [])],
      display: `bun install${hasLockfile ? " --frozen-lockfile" : ""}`,
    };
  }
  return {
    executable: "npm",
    args: hasLockfile
      ? ["ci", "--no-audit", "--no-fund"]
      : ["install", "--no-audit", "--no-fund"],
    display: hasLockfile ? "npm ci --no-audit --no-fund" : "npm install --no-audit --no-fund",
  };
}

export function getBuildCommand(packageManager: string): CommandSpec {
  const args = packageManager === "npm" ? ["run", "build"] : ["run", "build"];
  const executable = packageManager === "bun" ? "bun" : packageManager;
  return { executable, args, display: `${executable} run build` };
}

function detectPackageManager(manifest: PackageManifest, paths: Set<string>, root: string) {
  const prefix = root === "." ? "" : `${root}/`;
  const declared = manifest.packageManager?.split("@")[0];
  if (declared && ["npm", "pnpm", "yarn", "bun"].includes(declared)) return declared;
  if (paths.has(`${prefix}pnpm-lock.yaml`)) return "pnpm";
  if (paths.has(`${prefix}yarn.lock`)) return "yarn";
  if (paths.has(`${prefix}bun.lock`) || paths.has(`${prefix}bun.lockb`)) return "bun";
  return "npm";
}

function hasRootLockfile(paths: Set<string>, root: string, packageManager: string) {
  const prefix = root === "." ? "" : `${root}/`;
  const lockfiles: Record<string, string[]> = {
    npm: ["package-lock.json", "npm-shrinkwrap.json"],
    pnpm: ["pnpm-lock.yaml"],
    yarn: ["yarn.lock"],
    bun: ["bun.lock", "bun.lockb"],
  };
  return (lockfiles[packageManager] ?? lockfiles.npm).some((file) => paths.has(`${prefix}${file}`));
}

export async function inspectArchive(filePath: string): Promise<ArchiveInspection> {
  const paths = new Set<string>();
  const files: { path: string; size: number }[] = [];
  const manifests = new Map<string, PackageManifest>();
  const envSources = new Map<string, string>();
  let uncompressedSize = 0;
  let entryCount = 0;

  await walkArchive(filePath, async (entry, name, zip) => {
    entryCount += 1;
    if (entryCount > MAX_ARCHIVE_FILES) throw new ArchiveError("The archive contains more than 12,000 entries.");
    uncompressedSize += entry.uncompressedSize;
    if (uncompressedSize > MAX_UNCOMPRESSED_BYTES) {
      throw new ArchiveError("The uncompressed archive exceeds the 300 MB safety limit.");
    }
    if (!name || name.endsWith("/") || isGeneratedPath(name)) return;
    paths.add(name);
    files.push({ path: name, size: entry.uncompressedSize });
    if (name.split("/").length <= 5 && name.endsWith("package.json") && entry.uncompressedSize <= MAX_METADATA_FILE_BYTES) {
      try {
        manifests.set(name, JSON.parse(await entryText(zip, entry)) as PackageManifest);
      } catch {
        // A non-root package.json may be an example fixture; it is not executed.
      }
    }
    const basename = path.posix.basename(name);
    if ([".env.example", ".env.sample", ".env.local.example"].includes(basename)) {
      envSources.set(name, await entryText(zip, entry));
    }
  });

  const candidates = [...manifests.entries()]
    .filter(([, manifest]) => Boolean(manifest.dependencies?.next || manifest.devDependencies?.next))
    .sort(([a], [b]) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  if (candidates.length === 0) {
    throw new ArchiveError(
      "No Next.js project was found. Include a package.json with Next.js in dependencies or devDependencies.",
    );
  }

  const [manifestPath, manifest] = candidates[0];
  const projectRoot = path.posix.dirname(manifestPath);
  const scripts = manifest.scripts ?? {};
  if (!scripts.build) throw new ArchiveError(`${manifestPath} does not define a build script.`);
  const packageManager = detectPackageManager(manifest, paths, projectRoot);
  const locked = hasRootLockfile(paths, projectRoot, packageManager);
  const install = getInstallCommand(packageManager, locked);
  const build = getBuildCommand(packageManager);
  const prefix = projectRoot === "." ? "" : `${projectRoot}/`;
  const router = [...paths].some((file) => file.startsWith(`${prefix}app/`) || file.startsWith(`${prefix}src/app/`))
    ? "App Router"
    : [...paths].some((file) => file.startsWith(`${prefix}pages/`) || file.startsWith(`${prefix}src/pages/`))
      ? "Pages Router"
      : "Router not detected";
  const envKeys = [...new Set([...envSources.values()].flatMap(parseEnvKeys))].sort();
  const warnings: string[] = [];
  if (!locked) warnings.push(`No ${packageManager} lockfile was found; dependency versions may resolve differently.`);
  if (router === "Router not detected") warnings.push("No app/ or pages/ directory was detected at the project root.");
  if (envKeys.length === 0) warnings.push("No .env.example was included; required environment variables cannot be verified.");
  if (envKeys.some((key) => key.startsWith("NEXT_PUBLIC_") && /SERVICE|SECRET|PRIVATE/.test(key))) {
    warnings.push("A public environment variable appears to contain a secret. Review it before deploying.");
  }
  if (["preinstall", "install", "postinstall"].some((script) => scripts[script])) {
    warnings.push("Dependency lifecycle scripts are present and will run only after build authorization.");
  }
  if (candidates.length > 1) warnings.push(`${candidates.length} Next.js packages were found; the shallowest root was selected.`);

  return {
    projectRoot,
    packageName: manifest.name ?? (projectRoot === "." ? "next-app" : path.posix.basename(projectRoot)),
    packageVersion: manifest.version ?? null,
    packageManager,
    installCommand: install.display,
    buildCommand: build.display,
    scripts,
    envKeys,
    files: files.sort((a, b) => a.path.localeCompare(b.path)).slice(0, 180),
    fileCount: files.length,
    uncompressedSize,
    warnings,
    nextVersion: manifest.dependencies?.next ?? manifest.devDependencies?.next ?? "unknown",
    router,
  };
}

export async function extractArchive(filePath: string, destination: string) {
  const destinationRoot = path.resolve(destination);
  await mkdir(destinationRoot, { recursive: true, mode: 0o700 });
  let uncompressedSize = 0;
  let entryCount = 0;
  await walkArchive(filePath, async (entry, name, zip) => {
    entryCount += 1;
    if (entryCount > MAX_ARCHIVE_FILES) throw new ArchiveError("The archive contains more than 12,000 entries.");
    uncompressedSize += entry.uncompressedSize;
    if (uncompressedSize > MAX_UNCOMPRESSED_BYTES) throw new ArchiveError("The uncompressed archive exceeds 300 MB.");
    if (!name || isGeneratedPath(name)) return;
    const target = path.resolve(destinationRoot, ...name.split("/"));
    if (target !== destinationRoot && !target.startsWith(`${destinationRoot}${path.sep}`)) {
      throw new ArchiveError(`Archive extraction left its workspace: ${name}`);
    }
    if (name.endsWith("/")) {
      await mkdir(target, { recursive: true, mode: 0o700 });
      return;
    }
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const source = await entryStream(zip, entry);
    await pipeline(source, createWriteStream(target, { mode: 0o600, flags: "w" }));
  });
}
