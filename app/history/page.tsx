import { fetchAllAnalyses } from "../../lib/storage";
import HistoryClient from "./HistoryClient";

// Server component — reads from Next.js fetch cache.
// No API call on every page load; data is served from cache
// and only re-fetched from Apps Script after a new analysis is saved.
export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const { analyses, pendingJobs, error } = await fetchAllAnalyses();
  return <HistoryClient analyses={analyses ?? []} pendingJobs={pendingJobs ?? []} fetchError={error} />;
}
