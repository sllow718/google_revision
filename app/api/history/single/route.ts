import { NextRequest } from "next/server";
import { fetchSingleAnalysis } from "../../../../lib/storage";

export async function GET(req: NextRequest) {
  const fileId = req.nextUrl.searchParams.get("fileId");
  if (!fileId) return Response.json({ error: "fileId required" }, { status: 400 });
  const data = await fetchSingleAnalysis(fileId);
  // Cache in the browser for 60 s so repeat opens are instant.
  // The existence check in page.tsx uses cache:'no-store' to bypass this.
  return Response.json(data, {
    headers: { "Cache-Control": "private, max-age=1800" },
  });
}
