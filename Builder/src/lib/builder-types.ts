export type ProjectStatus = "inspected" | "building" | "ready" | "failed";
export type BuildStatus =
  | "queued"
  | "extracting"
  | "installing"
  | "building"
  | "packaging"
  | "succeeded"
  | "failed"
  | "cancelled";

export type ArchiveFileDTO = { path: string; size: number };

export type ProjectDTO = {
  id: string;
  name: string;
  supabaseUrl: string;
  archiveName: string;
  archiveSize: number;
  projectRoot: string;
  packageName: string;
  packageVersion: string | null;
  packageManager: string;
  installCommand: string;
  buildCommand: string;
  scripts: Record<string, string>;
  envKeys: string[];
  files: ArchiveFileDTO[];
  fileCount: number;
  uncompressedSize: number;
  warnings: string[];
  nextVersion: string | null;
  router: string;
  status: ProjectStatus;
  timeoutMinutes: number;
  hasAnonKey: boolean;
  hasServiceKey: boolean;
  hasExtraEnv: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BuildJobDTO = {
  id: string;
  projectId: string;
  projectName?: string;
  status: BuildStatus;
  logs: string;
  exitCode: number | null;
  error: string | null;
  artifactName: string | null;
  artifactSize: number | null;
  durationMs: number | null;
  timeoutMinutes: number;
  createdAt: string;
  startedAt: string;
  finishedAt: string | null;
};

export type ProjectWithJobsDTO = {
  project: ProjectDTO;
  jobs: BuildJobDTO[];
};
