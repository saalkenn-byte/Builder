import type { BuildJob, BuilderProject } from "@/db/schema";
import type { BuildJobDTO, BuildStatus, ProjectDTO, ProjectStatus } from "./builder-types";

export function serializeProject(project: BuilderProject): ProjectDTO {
  return {
    id: project.id,
    name: project.name,
    supabaseUrl: project.supabaseUrl,
    archiveName: project.archiveName,
    archiveSize: project.archiveSize,
    projectRoot: project.projectRoot,
    packageName: project.packageName,
    packageVersion: project.packageVersion,
    packageManager: project.packageManager,
    installCommand: project.installCommand,
    buildCommand: project.buildCommand,
    scripts: project.scripts,
    envKeys: project.envKeys,
    files: project.files,
    fileCount: project.fileCount,
    uncompressedSize: project.uncompressedSize,
    warnings: project.warnings,
    nextVersion: project.nextVersion,
    router: project.router,
    status: project.status as ProjectStatus,
    timeoutMinutes: project.timeoutMinutes,
    hasAnonKey: Boolean(project.supabaseAnonKeyEncrypted),
    hasServiceKey: Boolean(project.supabaseServiceKeyEncrypted),
    hasExtraEnv: Boolean(project.extraEnvEncrypted),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export function serializeJob(job: BuildJob, projectName?: string): BuildJobDTO {
  return {
    id: job.id,
    projectId: job.projectId,
    projectName,
    status: job.status as BuildStatus,
    logs: job.logs,
    exitCode: job.exitCode,
    error: job.error,
    artifactName: job.artifactName,
    artifactSize: job.artifactSize,
    durationMs: job.durationMs,
    timeoutMinutes: job.timeoutMinutes,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}
