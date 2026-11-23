import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { buildJobs } from "@/db/schema";
import { artifactPath } from "@/lib/builder-paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [job] = await db.select().from(buildJobs).where(eq(buildJobs.id, id)).limit(1);
  if (!job || job.status !== "succeeded" || !job.artifactName) {
    return Response.json({ error: "No packaged artifact is available for this build." }, { status: 404 });
  }
  const filePath = artifactPath(job.projectId, job.id);
  try {
    const details = await stat(filePath);
    return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(details.size),
        "Content-Disposition": `attachment; filename="${job.artifactName.replace(/[^a-zA-Z0-9._-]/g, "-")}"`,
      },
    });
  } catch {
    return Response.json({ error: "The build artifact is no longer available." }, { status: 404 });
  }
}
