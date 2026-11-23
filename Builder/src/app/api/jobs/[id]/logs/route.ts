import { eq } from "drizzle-orm";
import { db } from "@/db";
import { buildJobs } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [job] = await db.select().from(buildJobs).where(eq(buildJobs.id, id)).limit(1);
  if (!job) return Response.json({ error: "Build job not found." }, { status: 404 });
  return new Response(job.logs, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="forge-build-${id.slice(0, 8)}.log"`,
    },
  });
}
