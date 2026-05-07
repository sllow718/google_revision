import { fetchAllAnalyses } from "../../../lib/storage";

// This route is cached server-side via the "history" tag.
// It will only re-fetch from Apps Script after revalidateTag("history")
// is called — which happens automatically after every saveAnalysis().
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await fetchAllAnalyses();
  return Response.json(data, {
    headers: {
      // Tell the browser not to cache this response itself —
      // caching is handled server-side via Next.js fetch cache.
      "Cache-Control": "no-store",
    },
  });
}
