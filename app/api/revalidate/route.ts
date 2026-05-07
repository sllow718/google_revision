import { revalidatePath } from "next/cache";

// Called by the Refresh button in HistoryClient.
// Tells this Vercel instance to bust its /history cache.
// Note: only affects the instance that receives this request —
// other instances expire naturally via revalidate interval.
export async function POST() {
  revalidatePath("/history");
  return Response.json({ revalidated: true });
}
