import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { buildJobs } from "@/db/schema";
import { serializeJob } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ACTIVE = ["queued", "extracting", "installing", "building", "packaging"];

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [job] = await db.select().from(buildJobs).where(eq(buildJobs.id, id)).limit(1);
  if (!job) return NextResponse.json({ error: "Build job not found." }, { status: 404 });
  if (!ACTIVE.includes(job.status)) return NextResponse.json({ job: serializeJob(job) });
  if (job.pid) {
    try {
      process.kill(-job.pid, "SIGTERM");
    } catch {
      try { process.kill(job.pid, "SIGTERM"); } catch { /* The worker will reconcile its final state. */ }
    }
  }
  const [updated] = await db.update(buildJobs).set({ error: "Cancellation requested; waiting for the worker to stop." }).where(eq(buildJobs.id, id)).returning();
  return NextResponse.json({ job: serializeJob(updated) }, { status: 202 });
}
