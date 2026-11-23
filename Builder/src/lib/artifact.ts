import { createWriteStream } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";

const MAX_ARTIFACT_INPUT = 600 * 1024 * 1024;
const MAX_ARTIFACT_FILES = 25_000;

function excluded(name: string, relativePath: string) {
  if (["node_modules", ".git", ".turbo", ".vercel", ".home", ".npm-cache"].includes(name)) return true;
  if (relativePath === ".next/cache" || relativePath.startsWith(".next/cache/")) return true;
  if (/^\.env(\..+)?$/.test(name) && !/example|sample|template/.test(name)) return true;
  return false;
}

export async function packageBuildArtifact(
  sourceRoot: string,
  outputPath: string,
  metadata: Record<string, unknown>,
) {
  const zip = new yazl.ZipFile();
  let totalBytes = 0;
  let fileCount = 0;
  const output = pipeline(zip.outputStream, createWriteStream(outputPath, { mode: 0o600 }));

  async function addDirectory(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(sourceRoot, absolute).split(path.sep).join("/");
      if (excluded(entry.name, relative) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await addDirectory(absolute);
      } else if (entry.isFile()) {
        const details = await stat(absolute);
        totalBytes += details.size;
        fileCount += 1;
        if (totalBytes > MAX_ARTIFACT_INPUT || fileCount > MAX_ARTIFACT_FILES) {
          throw new Error("Build output is too large to package (600 MB / 25,000-file limit).");
        }
        zip.addFile(absolute, relative);
      }
    }
  }

  try {
    await addDirectory(sourceRoot);
    zip.addBuffer(
      Buffer.from(JSON.stringify({ ...metadata, packagedFiles: fileCount, packagedBytes: totalBytes }, null, 2)),
      "BUILD-INFO.json",
    );
    zip.addBuffer(
      Buffer.from(
        "This archive contains the uploaded project source and its verified .next build output.\n" +
          "Dependencies and secret environment files are intentionally excluded.\n" +
          "Restore dependencies with the project lockfile, provide your environment variables, then run the package start script.\n",
      ),
      "BUILD-README.txt",
    );
    zip.end();
    await output;
    const details = await stat(outputPath);
    return { size: details.size, fileCount };
  } catch (error) {
    (zip.outputStream as unknown as { destroy: () => void }).destroy();
    await output.catch(() => undefined);
    await rm(outputPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
