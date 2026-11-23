import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export type ArchiveFileRecord = { path: string; size: number };

export const builderProjects = pgTable("builder_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  supabaseUrl: text("supabase_url").notNull(),
  supabaseAnonKeyEncrypted: text("supabase_anon_key_encrypted"),
  supabaseServiceKeyEncrypted: text("supabase_service_key_encrypted"),
  extraEnvEncrypted: text("extra_env_encrypted"),
  archiveName: text("archive_name").notNull(),
  archiveSize: integer("archive_size").notNull(),
  projectRoot: text("project_root").notNull(),
  packageName: text("package_name").notNull(),
  packageVersion: text("package_version"),
  packageManager: text("package_manager").notNull(),
  installCommand: text("install_command").notNull(),
  buildCommand: text("build_command").notNull(),
  scripts: jsonb("scripts").$type<Record<string, string>>().notNull(),
  envKeys: jsonb("env_keys").$type<string[]>().notNull(),
  files: jsonb("files").$type<ArchiveFileRecord[]>().notNull(),
  fileCount: integer("file_count").notNull(),
  uncompressedSize: integer("uncompressed_size").notNull(),
  warnings: jsonb("warnings").$type<string[]>().notNull(),
  nextVersion: text("next_version"),
  router: text("router").notNull(),
  status: text("status").notNull().default("inspected"),
  timeoutMinutes: integer("timeout_minutes").notNull().default(10),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const buildJobs = pgTable("builder_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => builderProjects.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("queued"),
  logs: text("logs").notNull().default(""),
  exitCode: integer("exit_code"),
  error: text("error"),
  artifactName: text("artifact_name"),
  artifactSize: integer("artifact_size"),
  durationMs: integer("duration_ms"),
  timeoutMinutes: integer("timeout_minutes").notNull(),
  pid: integer("pid"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export type BuilderProject = typeof builderProjects.$inferSelect;
export type BuildJob = typeof buildJobs.$inferSelect;
