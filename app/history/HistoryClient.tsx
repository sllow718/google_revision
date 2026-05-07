"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AnalysisSummary, PendingJob } from "../../lib/storage";
import { AnalysisResult } from "../types";
import Dashboard from "../components/Dashboard";
import config from "../../config";

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function formatDate(str: string) {
  if (!str) return "—";
  return str.replace(` ${config.timezone.label}`, "").trim();
}

// ── Live progress card ─────────────────────────────────────────────
// Polls /api/job/status every 5s and updates its own state in real-time.

const STALL_MS = 8 * 60 * 1000; // 8 min — past the 6-min Apps Script limit

type LiveJob = PendingJob & { errorMessage?: string };

function LivePendingCard({ initialJob }: { initialJob: PendingJob }) {
  const router  = useRouter();
  const [job, setJob]         = useState<LiveJob>(initialJob);
  const [elapsed, setElapsed] = useState(0);
  const [requeueing, setRequeueing] = useState(false);
  // Track when `current` last moved to detect a stalled export
  const lastMoveRef = useRef<{ current: number; time: number }>({
    current: initialJob.current,
    time:    Date.now(),
  });
  const pollingRef = useRef(false);

  // Elapsed-time ticker (updates every second for the UI)
  useEffect(() => {
    if (job.status === "done" || job.status === "error") return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [job.status]);

  // Poll job status
  useEffect(() => {
    if (job.status === "done" || job.status === "error") return;

    const poll = async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        const res  = await fetch(`/api/job/status?jobId=${encodeURIComponent(job.jobId)}`);
        const data = await res.json();

        if (data.status === "done") {
          router.refresh();
          return;
        }

        setJob((prev) => {
          // Update the "last moved" tracker when current increases
          if ((data.current ?? 0) > lastMoveRef.current.current) {
            lastMoveRef.current = { current: data.current, time: Date.now() };
          }
          return {
            ...prev,
            status:       data.status   ?? prev.status,
            progress:     data.progress ?? prev.progress,
            current:      data.current  ?? prev.current,
            total:        data.total    ?? prev.total,
            errorMessage: data.status === "error" ? (data.progress || "Unknown error") : undefined,
          };
        });
      } catch {
        // network blip — keep polling
      } finally {
        pollingRef.current = false;
      }
    };

    poll();
    const id = setInterval(poll, 10000);
    return () => clearInterval(id);
  }, [job.jobId, job.status, router]);

  const requeue = async () => {
    setRequeueing(true);
    try {
      await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: job.fileId }),
      });
      router.refresh();
    } finally {
      setRequeueing(false);
    }
  };

  const pct      = job.total > 0 ? Math.round((job.current / job.total) * 100) : 0;
  const isError  = job.status === "error";
  // Stalled = actively exporting but no revision progress for >8 min
  const isStalled = job.status === "exporting"
    && job.current > 0
    && Date.now() - lastMoveRef.current.time > STALL_MS;

  // ── Stalled card ────────────────────────────────────────────────
  if (isStalled) {
    return (
      <div className="bg-white border border-orange-200 rounded-xl p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1 flex-wrap">
              <p className="text-sm font-mono text-gray-700 truncate">{job.fileId}</p>
              <span className="text-xs bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full flex-shrink-0">
                Stalled
              </span>
            </div>
            <p className="text-xs text-gray-400 mb-2">
              Stopped at revision {job.current}/{job.total} — no progress for over 8 minutes.
            </p>
            <p className="text-xs text-gray-500 mb-3">
              The Apps Script trigger was likely killed mid-execution. Re-queuing will resume from revision {job.current} — already-exported revisions are preserved.
            </p>
            <button
              onClick={requeue}
              disabled={requeueing}
              className="text-xs bg-orange-600 text-white px-3 py-1.5 rounded-lg hover:bg-orange-700 disabled:opacity-50 transition-colors"
            >
              {requeueing ? "Re-queuing…" : "Resume analysis"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Error card ───────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1 flex-wrap">
              <p className="text-sm font-mono text-gray-700 truncate">{job.fileId}</p>
              <span className="text-xs bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded-full flex-shrink-0">
                Analysis failed
              </span>
            </div>
            <p className="text-xs text-gray-400 mb-2">Queued: {formatDate(job.createdAt)}</p>
            <p className="text-xs text-red-600 font-mono bg-red-50 rounded-lg px-3 py-2 break-words">
              {job.errorMessage || job.progress || "An unknown error occurred."}
            </p>
            <p className="text-xs text-gray-400 mt-2">
              Fix the issue above and re-submit the File ID from the home page.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Progress card ────────────────────────────────────────────────
  const statusLabel: Record<string, string> = {
    pending:   "Waiting to start…",
    exporting: "Exporting revisions",
    running:   "Building summary",
  };

  const elapsedStr = elapsed < 60
    ? `${elapsed}s`
    : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

  return (
    <div className="bg-white border border-amber-200 rounded-xl p-5">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-amber-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <p className="text-sm font-mono text-gray-700 truncate">{job.fileId}</p>
            <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full flex-shrink-0">
              {statusLabel[job.status] ?? job.status}
            </span>
          </div>

          <p className="text-xs text-gray-400 mb-3">
            Queued: {formatDate(job.createdAt)}
            {elapsed > 0 && <span className="ml-2">· {elapsedStr} elapsed</span>}
          </p>

          {/* Progress bar */}
          <div className="mb-2">
            <div className="flex justify-between items-center mb-1">
              <p className="text-xs text-gray-500 truncate pr-2">
                {job.progress || statusLabel[job.status] || "Working…"}
              </p>
              {job.total > 0 && (
                <p className="text-xs text-gray-400 flex-shrink-0 font-mono">
                  {job.current}/{job.total} · {pct}%
                </p>
              )}
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              {job.total > 0 ? (
                <div
                  className="h-full bg-amber-400 rounded-full transition-all duration-700"
                  style={{ width: `${pct}%` }}
                />
              ) : (
                <div
                  className="h-full bg-amber-300 rounded-full"
                  style={{ width: "30%", animation: "pulse 1.5s ease-in-out infinite" }}
                />
              )}
            </div>
          </div>

          {job.status === "pending" && (
            <p className="text-xs text-gray-400">
              Analysis will start within ~1 minute via Apps Script trigger.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main history client ────────────────────────────────────────────

export default function HistoryClient({
  analyses,
  pendingJobs,
  fetchError,
}: {
  analyses: AnalysisSummary[];
  pendingJobs: PendingJob[];
  fetchError?: string;
}) {
  const router    = useRouter();
  const [selected, setSelected]   = useState<AnalysisResult | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [detailError, setDetailError] = useState("");

  const activePending = pendingJobs.filter((j) => j.status !== "error");
  const sorted = [...analyses].reverse();

  const openAnalysis = async (fileId: string) => {
    setLoadingId(fileId);
    setDetailError("");
    try {
      const res  = await fetch(`/api/history/single?fileId=${encodeURIComponent(fileId)}`);
      const data = await res.json();
      if (data.error) { setDetailError(data.error); return; }
      if (data.analysis) {
        const a = data.analysis;
        if (typeof a.userSummaryJson === "string") a.userSummary = JSON.parse(a.userSummaryJson);
        else if (a.userSummaryJson) a.userSummary = a.userSummaryJson;
        if (typeof a.revisionsJson === "string") a.revisions = JSON.parse(a.revisionsJson);
        else if (a.revisionsJson) a.revisions = a.revisionsJson;
        setSelected(a);
      }
    } catch {
      setDetailError("Failed to load analysis detail");
    } finally {
      setLoadingId(null);
    }
  };

  if (selected) return <Dashboard result={selected} onReset={() => setSelected(null)} />;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-4">
          <button onClick={() => router.push("/")}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            New analysis
          </button>
          <div className="h-4 w-px bg-gray-200" />
          <h1 className="text-sm font-medium text-gray-900">Past Analyses</h1>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-gray-400">{sorted.length} saved</span>
            {activePending.length > 0 && (
              <span className="text-xs text-amber-600 font-medium">{activePending.length} running</span>
            )}
            <button
              onClick={async () => {
                setRefreshing(true);
                await fetch("/api/revalidate", { method: "POST" });
                router.refresh();
                setRefreshing(false);
              }}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 transition-colors border border-gray-200 rounded-lg px-3 py-1.5"
            >
              <svg className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">

        {/* Errors */}
        {(fetchError || detailError) && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-700">
            {fetchError  && <p><strong>Load error:</strong> {fetchError}</p>}
            {detailError && <p><strong>Detail error:</strong> {detailError}</p>}
          </div>
        )}

        {/* Live pending / error cards */}
        {pendingJobs.length > 0 && (
          <div className="space-y-3 mb-6">
            {pendingJobs.map((job) => (
              <LivePendingCard key={job.jobId} initialJob={job} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!fetchError && sorted.length === 0 && pendingJobs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-700 mb-1">No analyses saved yet</p>
            <p className="text-xs text-gray-400 mb-6">Run your first analysis and it will appear here automatically.</p>
            <button onClick={() => router.push("/")}
              className="text-sm bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors">
              Start analysis
            </button>
          </div>
        )}

        {/* Completed analysis cards */}
        {sorted.length > 0 && (
          <div className="space-y-3">
            {sorted.map((a) => (
              <div key={a.fileId} onClick={() => !loadingId && openAnalysis(a.fileId)}
                className="bg-white border border-gray-200 rounded-xl p-5 cursor-pointer hover:border-gray-400 hover:shadow-sm transition-all group">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-gray-200 transition-colors">
                    <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <p className="text-sm font-mono text-gray-700 truncate">{a.fileId}</p>
                      {a.exportErrors > 0 && (
                        <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full flex-shrink-0">
                          {a.exportErrors} export error{a.exportErrors > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mb-3">Analysed: {formatDate(a.analysedAt)}</p>
                    <div className="flex flex-wrap gap-4 mb-3">
                      {([
                        ["Revisions", a.totalRevisions],
                        ["Contributors", a.contributors],
                        ["Words Added", a.totalWordsAdded?.toLocaleString()],
                        ["Words Removed", a.totalWordsRemoved?.toLocaleString()],
                      ] as [string, string | number][]).map(([l, v]) => (
                        <div key={l}>
                          <p className="text-xs text-gray-400">{l}</p>
                          <p className="text-sm font-semibold text-gray-800">{v}</p>
                        </div>
                      ))}
                    </div>
                    {a.userSummaryJson?.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {a.userSummaryJson.map((u, i) => (
                          <div key={u.email || u.name}
                            title={`${u.name} · ${u.totalWordsAdded}w added`}
                            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0"
                            style={{ background: config.ui.userColors[i % config.ui.userColors.length] }}>
                            {initials(u.name)}
                          </div>
                        ))}
                        <span className="text-xs text-gray-400 ml-1">
                          {a.userSummaryJson.map((u) => u.name).join(", ")}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {loadingId === a.fileId && (
                      <svg className="w-4 h-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                    )}
                    <svg className="w-4 h-4 text-gray-300 group-hover:text-gray-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
