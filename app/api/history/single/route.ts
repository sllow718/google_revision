import { NextRequest } from "next/server";
import { fetchSingleAnalysis } from "../../../../lib/storage";

export async function GET(req: NextRequest) {
  const fileId = req.nextUrl.searchParams.get("fileId");
  if (!fileId) return Response.json({ error: "fileId required" }, { status: 400 });
  const data = await fetchSingleAnalysis(fileId);
  return Response.json(data);
}
