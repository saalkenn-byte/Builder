import path from "node:path";

export const BUILDER_ROOT = path.resolve(
  process.env.APP_BUILDER_DATA_DIR ?? path.join(process.cwd(), ".data", "app-builder"),
);

export function projectDirectory(projectId: string) {
  return path.join(BUILDER_ROOT, "projects", projectId);
}

export function archivePath(projectId: string) {
  return path.join(projectDirectory(projectId), "source.zip");
}

export function workspacePath(projectId: string) {
  return path.join(projectDirectory(projectId), "workspace");
}

export function artifactPath(projectId: string, jobId: string) {
  return path.join(projectDirectory(projectId), `${jobId}-build.zip`);
}
