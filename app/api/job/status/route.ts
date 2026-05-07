/**
 * /api/job/status?jobId=xxx
 *
 * Polls Apps Script for the current job status.
 * Returns progress updates while running, full result when done.
 */
import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL ?? "";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) return Response.json({ error: "jobId required" }, { status: 400 });
  if (!APPS_SCRIPT_URL) return Response.json({ error: "APPS_SCRIPT_URL not configured" }, { status: 500 });

  try {
    const resp = await fetch(
      `${APPS_SCRIPT_URL}?action=status&jobId=${encodeURIComponent(jobId)}`,
      { cache: "no-store" }
    );

    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const text = await resp.text();
      console.error(`[/api/job/status] Apps Script returned non-JSON (${resp.status}):`, text.slice(0, 300));
      return Response.json(
        { error: `Apps Script returned unexpected response (HTTP ${resp.status}). Check server logs.` },
        { status: 502 }
      );
    }

    const data = await resp.json();

    // When job completes successfully, bust the history cache
    if (data.status === "done") {
      revalidatePath("/history");
    }

    return Response.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
