import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { builderProjects } from "@/db/schema";
import { archivePath } from "@/lib/builder-paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project] = await db.select().from(builderProjects).where(eq(builderProjects.id, id)).limit(1);
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
  try {
    const details = await stat(archivePath(id));
    return new Response(Readable.toWeb(createReadStream(archivePath(id))) as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(details.size),
        "Content-Disposition": `attachment; filename="${project.archiveName.replace(/[^a-zA-Z0-9._-]/g, "-")}"`,
      },
    });
  } catch {
    return Response.json({ error: "The source archive is no longer available." }, { status: 404 });
  }
}
