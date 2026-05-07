/**
 * /api/analyze
 *
 * Thin proxy — forwards the job to Apps Script and returns the jobId.
 * All heavy work (revision export, diff, saving) runs in Apps Script
 * which has a 6-minute execution limit vs Vercel's 10s free tier limit.
 */
import { NextRequest } from "next/server";

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL ?? "";

function buildServiceAccountJson(): string | null {
  const privateKey = process.env.SA_PRIVATE_KEY;
  const clientEmail = process.env.SA_CLIENT_EMAIL;
  if (!privateKey || !clientEmail) return null;
  return JSON.stringify({
    type:                        process.env.SA_TYPE ?? "service_account",
    project_id:                  process.env.SA_PROJECT_ID ?? "",
    private_key_id:              process.env.SA_PRIVATE_KEY_ID ?? "",
    private_key:                 privateKey.replace(/\\n/g, "\n"),
    client_email:                clientEmail,
    client_id:                   process.env.SA_CLIENT_ID ?? "",
    auth_uri:                    process.env.SA_AUTH_URI ?? "https://accounts.google.com/o/oauth2/auth",
    token_uri:                   process.env.SA_TOKEN_URI ?? "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: process.env.SA_AUTH_PROVIDER_CERT_URL ?? "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url:        process.env.SA_CLIENT_CERT_URL ?? "",
    universe_domain:             process.env.SA_UNIVERSE_DOMAIN ?? "googleapis.com",
  });
}

export async function POST(req: NextRequest) {
  if (!APPS_SCRIPT_URL) {
    return Response.json({ error: "APPS_SCRIPT_URL not configured" }, { status: 500 });
  }

  const serviceAccountJson = buildServiceAccountJson();
  if (!serviceAccountJson) {
    return Response.json({ error: "Service account not configured (SA_PRIVATE_KEY / SA_CLIENT_EMAIL missing)" }, { status: 500 });
  }

  try {
    const { fileId: rawFileId, sinceRevisionId, sinceRevisionIndex } = await req.json();
    const fileId = (rawFileId as string)?.trim();

    if (!fileId) return Response.json({ error: "No file ID provided" }, { status: 400 });

    const scriptBody: Record<string, unknown> = { action: "start", fileId, serviceAccountJson };
    if (sinceRevisionId)          scriptBody.sinceRevisionId    = sinceRevisionId;
    if (sinceRevisionIndex != null) scriptBody.sinceRevisionIndex = sinceRevisionIndex;

    const resp = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scriptBody),
    });

    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const text = await resp.text();
      // Extract visible error text from the HTML for a readable log
      const stripped = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 800);
      console.error(`[/api/analyze] Apps Script error (${resp.status}):\n${stripped}`);
      return Response.json(
        { error: `Apps Script error: ${stripped.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const data = await resp.json();
    return Response.json(data);

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
