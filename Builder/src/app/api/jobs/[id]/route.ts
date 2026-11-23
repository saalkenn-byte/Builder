import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { buildJobs, builderProjects } from "@/db/schema";

const ACTIVE = ["queued", "extracting", "installing", "building", "packaging"];
import { serializeJob } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row] = await db.select({ job: buildJobs, projectName: builderProjects.name }).from(buildJobs).innerJoin(builderProjects, eq(builderProjects.id, buildJobs.projectId)).where(eq(buildJobs.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "Build job not found." }, { status: 404 });
  let current = row.job;
  if (ACTIVE.includes(current.status) && current.pid) {
    let alive = true;
    try { process.kill(current.pid, 0); } catch { alive = false; }
    if (!alive) {
      const message = "The build worker exited without reporting a final state. Inspect the job log and retry.";
      const [updated] = await db.update(buildJobs).set({
        status: "failed",
        error: message,
        finishedAt: new Date(),
        durationMs: Date.now() - current.startedAt.getTime(),
      }).where(eq(buildJobs.id, id)).returning();
      await db.update(builderProjects).set({ status: "failed", updatedAt: new Date() }).where(eq(builderProjects.id, current.projectId));
      current = updated;
    }
  }
  return NextResponse.json({ job: serializeJob(current, row.projectName) });
}
