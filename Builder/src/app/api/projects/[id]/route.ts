import { rm } from "node:fs/promises";
import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { buildJobs, builderProjects } from "@/db/schema";
import { projectDirectory } from "@/lib/builder-paths";
import { parseExtraEnv, parseTimeout, validateKey, validateSupabaseUrl } from "@/lib/config";
import { encryptSecret } from "@/lib/secrets";
import { serializeJob, serializeProject } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

async function findProject(id: string) {
  const [project] = await db.select().from(builderProjects).where(eq(builderProjects.id, id)).limit(1);
  return project;
}

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const project = await findProject(id);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const jobs = await db.select().from(buildJobs).where(eq(buildJobs.projectId, id)).orderBy(desc(buildJobs.createdAt)).limit(20);
  return NextResponse.json({
    project: serializeProject(project),
    jobs: jobs.map((job, index) => ({ ...serializeJob(job), logs: index === 0 ? job.logs : "" })),
  });
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const project = await findProject(id);
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    const body = (await request.json()) as Record<string, unknown>;
    const anonKey = validateKey(String(body.anonKey ?? ""), "Supabase publishable key");
    const serviceRoleKey = validateKey(String(body.serviceRoleKey ?? ""), "Supabase service-role key");
    const extraEnv = parseExtraEnv(String(body.extraEnv ?? ""));
    const update: Partial<typeof builderProjects.$inferInsert> = {
      supabaseUrl: validateSupabaseUrl(String(body.supabaseUrl ?? project.supabaseUrl)),
      timeoutMinutes: parseTimeout(body.timeoutMinutes ?? project.timeoutMinutes),
      updatedAt: new Date(),
    };
    if (anonKey) update.supabaseAnonKeyEncrypted = await encryptSecret(anonKey);
    if (serviceRoleKey) update.supabaseServiceKeyEncrypted = await encryptSecret(serviceRoleKey);
    if (Object.keys(extraEnv).length) update.extraEnvEncrypted = await encryptSecret(JSON.stringify(extraEnv));
    if (body.clearAnonKey === true) update.supabaseAnonKeyEncrypted = null;
    if (body.clearServiceRoleKey === true) update.supabaseServiceKeyEncrypted = null;
    if (body.clearExtraEnv === true) update.extraEnvEncrypted = null;
    const [updated] = await db.update(builderProjects).set(update).where(eq(builderProjects.id, id)).returning();
    return NextResponse.json({ project: serializeProject(updated) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Settings could not be saved." }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params;
  const project = await findProject(id);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const active = await db
    .select({ id: buildJobs.id })
    .from(buildJobs)
    .where(and(eq(buildJobs.projectId, id), inArray(buildJobs.status, ["queued", "extracting", "installing", "building", "packaging"])))
    .limit(1);
  if (active.length) return NextResponse.json({ error: "Cancel the active build before deleting this project." }, { status: 409 });
  await db.delete(builderProjects).where(eq(builderProjects.id, id));
  await rm(projectDirectory(id), { recursive: true, force: true });
  return NextResponse.json({ ok: true });
}
