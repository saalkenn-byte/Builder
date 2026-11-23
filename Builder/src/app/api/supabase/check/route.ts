import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { builderProjects } from "@/db/schema";
import { validateKey, validateSupabaseUrl } from "@/lib/config";
import { decryptSecret } from "@/lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { projectId?: string; supabaseUrl?: string; anonKey?: string };
    let supabaseUrl: string;
    let anonKey: string;
    if (body.projectId) {
      const [project] = await db.select().from(builderProjects).where(eq(builderProjects.id, body.projectId)).limit(1);
      if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
      supabaseUrl = body.supabaseUrl ? validateSupabaseUrl(body.supabaseUrl) : project.supabaseUrl;
      anonKey = body.anonKey
        ? validateKey(body.anonKey, "Supabase publishable key")
        : await decryptSecret(project.supabaseAnonKeyEncrypted);
    } else {
      supabaseUrl = validateSupabaseUrl(String(body.supabaseUrl ?? ""));
      anonKey = validateKey(String(body.anonKey ?? ""), "Supabase publishable key");
    }
    const headers: Record<string, string> = { Accept: "application/json" };
    if (anonKey) {
      headers.apikey = anonKey;
    }
    const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    const reachable = response.ok;
    return NextResponse.json({
      reachable,
      httpStatus: response.status,
      message: reachable
        ? `Supabase Auth responded successfully (${response.status}).`
        : response.status === 401 || response.status === 403
          ? `Supabase rejected the credentials (${response.status}). Check the publishable key.`
          : `Supabase Auth responded with HTTP ${response.status}. Review the project URL and Auth service.`,
    });
  } catch (error) {
    const message = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
      ? "The Supabase health check timed out after 7 seconds."
      : error instanceof TypeError
        ? "The Supabase Auth endpoint could not be reached from this build host."
        : error instanceof Error ? error.message : "The Supabase health check failed.";
    return NextResponse.json({ reachable: false, message });
  }
}
