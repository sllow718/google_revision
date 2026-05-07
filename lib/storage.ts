/**
 * Storage helpers — thin wrappers around Apps Script GET endpoints.
 * All write operations (saving results) now happen inside Apps Script itself.
 */
import { revalidatePath } from "next/cache";
import config from "../config";

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL ?? "";

export async function fetchAllAnalyses(): Promise<{
  analyses: AnalysisSummary[];
  pendingJobs: PendingJob[];
  error?: string;
}> {
  if (!APPS_SCRIPT_URL) return { analyses: [], pendingJobs: [], error: "APPS_SCRIPT_URL not configured" };
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=history`, {
      next: { revalidate: config.cache.historyRevalidateSeconds },
    });
    const data = await res.json();
    return {
      analyses:    data.analyses    ?? [],
      pendingJobs: data.pendingJobs ?? [],
      error:       data.error,
    };
  } catch (err) {
    return { analyses: [], pendingJobs: [], error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function fetchSingleAnalysis(fileId: string): Promise<{
  analysis?: import("../app/types").AnalysisResult;
  error?: string;
}> {
  if (!APPS_SCRIPT_URL) return { error: "APPS_SCRIPT_URL not configured" };
  try {
    const res = await fetch(
      `${APPS_SCRIPT_URL}?action=single&fileId=${encodeURIComponent(fileId)}`,
      { cache: "no-store" }
    );
    return await res.json();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export function bustHistoryCache() {
  revalidatePath("/history");
}

export interface AnalysisSummary {
  fileId: string;
  analysedAt: string;
  timezone: string;
  totalRevisions: number;
  exportErrors: number;
  contributors: number;
  totalWordsAdded: number;
  totalWordsRemoved: number;
  userSummaryJson: import("../app/types").UserSummary[];
}

export interface PendingJob {
  jobId: string;
  fileId: string;
  status: "pending" | "exporting" | "running" | "error";
  progress: string;
  current: number;
  total: number;
  createdAt: string;
  updatedAt: string;
}
