import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { buildJobs, builderProjects } from "@/db/schema";
import { ArchiveError, inspectArchive } from "@/lib/archive";
import { archivePath, projectDirectory } from "@/lib/builder-paths";
import { MAX_UPLOAD_BYTES, parseExtraEnv, parseTimeout, validateKey, validateSupabaseUrl } from "@/lib/config";
import { encryptSecret } from "@/lib/secrets";
import { serializeJob, serializeProject } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const projects = await db.select().from(builderProjects).orderBy(desc(builderProjects.createdAt)).limit(24);
  const jobs = await db.select().from(buildJobs).orderBy(desc(buildJobs.createdAt)).limit(80);
  return NextResponse.json({
    projects: projects.map((project) => ({
      project: serializeProject(project),
      jobs: jobs
        .filter((job) => job.projectId === project.id)
        .slice(0, 1)
        .map((job) => ({ ...serializeJob(job), logs: "" })),
    })),
  });
}

export async function POST(request: Request) {
  let id: string | null = null;
  try {
    const form = await request.formData();
    const file = form.get("archive");
    if (!(file instanceof File)) throw new Error("Choose a Next.js project ZIP to upload.");
    if (file.size === 0) throw new Error("The uploaded ZIP is empty.");
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("The ZIP exceeds the 50 MB upload limit.");
    if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("The uploaded file must have a .zip extension.");
    const supabaseUrl = validateSupabaseUrl(String(form.get("supabaseUrl") ?? ""));
    const anonKey = validateKey(String(form.get("anonKey") ?? ""), "Supabase publishable key");
    const serviceRoleKey = validateKey(String(form.get("serviceRoleKey") ?? ""), "Supabase service-role key");
    const extraEnv = parseExtraEnv(String(form.get("extraEnv") ?? ""));
    const timeoutMinutes = parseTimeout(form.get("timeoutMinutes"));

    id = randomUUID();
    await mkdir(projectDirectory(id), { recursive: true, mode: 0o700 });
    await writeFile(archivePath(id), Buffer.from(await file.arrayBuffer()), { mode: 0o600, flag: "wx" });
    const inspection = await inspectArchive(archivePath(id));
    const [anonEncrypted, serviceEncrypted, extraEncrypted] = await Promise.all([
      encryptSecret(anonKey),
      encryptSecret(serviceRoleKey),
      encryptSecret(Object.keys(extraEnv).length ? JSON.stringify(extraEnv) : ""),
    ]);
    const [project] = await db
      .insert(builderProjects)
      .values({
        id,
        name: inspection.packageName,
        supabaseUrl,
        supabaseAnonKeyEncrypted: anonEncrypted,
        supabaseServiceKeyEncrypted: serviceEncrypted,
        extraEnvEncrypted: extraEncrypted,
        archiveName: file.name,
        archiveSize: file.size,
        ...inspection,
        timeoutMinutes,
      })
      .returning();
    return NextResponse.json({ project: serializeProject(project), jobs: [] }, { status: 201 });
  } catch (error) {
    if (id) await rm(projectDirectory(id), { recursive: true, force: true }).catch(() => undefined);
    const message = error instanceof Error ? error.message : "The project could not be imported.";
    return NextResponse.json(
      { error: message },
      { status: error instanceof ArchiveError ? 422 : 400 },
    );
  }
}
