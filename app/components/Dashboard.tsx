"use client";
import { useState } from "react";
import { AnalysisResult, RevisionEntry, UserSummary } from "../types";
import config from "../../config";

const COLORS = [...config.ui.userColors];

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-gray-50 rounded-xl p-4">
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function UserCard({ user, color, index }: { user: UserSummary; color: string; index: number }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0" style={{ background: color }}>
          {initials(user.name)}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{user.name}</p>
          <p className="text-xs text-gray-400 truncate">{user.email || "—"}</p>
        </div>
        <span className="ml-auto text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full flex-shrink-0">#{index + 1}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[
          ["Revisions", user.revisionsCount],
          ["Words Added", user.totalWordsAdded],
          ["Words Removed", user.totalWordsRemoved],
          ["Net Words", user.totalWordsAdded - user.totalWordsRemoved],
        ].map(([l, v]) => (
          <div key={l as string} className="bg-gray-50 rounded-lg p-2.5">
            <p className="text-xs text-gray-400 mb-0.5">{l}</p>
            <p className="text-sm font-semibold text-gray-900">{(v as number).toLocaleString()}</p>
          </div>
        ))}
      </div>
      <div className="mt-2 pt-2 border-t border-gray-100 grid grid-cols-2 gap-1">
        <p className="text-xs text-gray-400">First: <span className="text-gray-600">{user.firstEditSGT?.replace(" SGT","") || "—"}</span></p>
        <p className="text-xs text-gray-400 text-right">Last: <span className="text-gray-600">{user.lastEditSGT?.replace(" SGT","") || "—"}</span></p>
      </div>
    </div>
  );
}

function ContribBar({ userSummary, colors }: { userSummary: UserSummary[]; colors: string[] }) {
  const total = userSummary.reduce((s, u) => s + u.totalWordsAdded, 0);
  if (total === 0) return null;
  return (
    <div className="mb-6">
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Word contribution breakdown</p>
      <div className="h-5 rounded-full overflow-hidden flex">
        {userSummary.map((u, i) => (
          <div key={u.email || u.name} className="h-full transition-all" title={`${u.name}: ${u.totalWordsAdded} words`}
            style={{ width: `${(u.totalWordsAdded / total) * 100}%`, background: colors[i % colors.length] }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {userSummary.map((u, i) => (
          <span key={u.email || u.name} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: colors[i % colors.length] }} />
            {u.name} ({Math.round((u.totalWordsAdded / total) * 100)}%)
          </span>
        ))}
      </div>
    </div>
  );
}

function RevisionDetail({ rev, colors, userSummary }: { rev: RevisionEntry; colors: string[]; userSummary: UserSummary[] }) {
  const userIdx = userSummary.findIndex((u) => u.name === rev.modifiedBy.name);
  const color = colors[userIdx % colors.length] || "#6b7280";
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0" style={{ background: color }}>
          {initials(rev.modifiedBy.name)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">{rev.modifiedBy.name}</p>
          <p className="text-xs text-gray-400">{rev.modifiedTimeSGT}</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {rev.diff && (
            <>
              <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">+{rev.diff.stats.wordsAdded}w</span>
              <span className="text-xs bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded-full">−{rev.diff.stats.wordsRemoved}w</span>
            </>
          )}
          {rev.error && <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">Export failed</span>}
        </div>
      </div>

      {rev.error && (
        <div className="px-5 py-4 bg-amber-50">
          <p className="text-xs text-amber-700 font-mono">{rev.error}</p>
        </div>
      )}

      {rev.diffTruncated && (
        <div className="px-5 py-4 bg-amber-50">
          <p className="text-xs text-amber-700">
            This revision contains too much text to display the full diff.
            Word counts above are accurate.
          </p>
        </div>
      )}
      {rev.diff && !rev.error && !rev.diffTruncated && (
        <div className="divide-y divide-gray-50">
          {rev.diff.added.length > 0 && (
            <div className="px-5 py-4">
              <p className="text-xs font-medium text-green-700 uppercase tracking-wider mb-3">Added</p>
              <div className="space-y-2">
                {rev.diff.added.map((text, i) => (
                  <div key={i} className="bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-sm text-green-900 leading-relaxed">
                    {text}
                  </div>
                ))}
              </div>
            </div>
          )}
          {rev.diff.removed.length > 0 && (
            <div className="px-5 py-4">
              <p className="text-xs font-medium text-red-700 uppercase tracking-wider mb-3">Removed</p>
              <div className="space-y-2">
                {rev.diff.removed.map((text, i) => (
                  <div key={i} className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-sm text-red-900 leading-relaxed line-through decoration-red-300">
                    {text}
                  </div>
                ))}
              </div>
            </div>
          )}
          {!rev.hasChanges && (
            <div className="px-5 py-4 text-sm text-gray-400 italic">No text changes detected in this revision.</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Dashboard({
  result,
  onReset,
  onReanalyse,
  pendingUpdate = false,
}: {
  result: AnalysisResult;
  onReset: () => void;
  onReanalyse?: (fileId: string) => void;
  pendingUpdate?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"summary" | "revisions">(config.ui.defaultTab);
  const [selectedRev, setSelectedRev] = useState<RevisionEntry | null>(null);
  const [reanalysing, setReanalysing] = useState(false);
  const colors = COLORS;

  const handleReanalyse = () => {
    if (reanalysing || !result.revisions.length) return;
    const lastRev = result.revisions[result.revisions.length - 1];
    setReanalysing(true);

    // Fire the API call without awaiting — navigate immediately
    fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileId:             result.fileId,
        sinceRevisionId:    lastRev.revisionId,
        sinceRevisionIndex: lastRev.revisionIndex,
      }),
    }).catch(() => {});

    if (onReanalyse) onReanalyse(result.fileId);
    else onReset();
  };

  const totalWords = result.userSummary.reduce((s, u) => s + u.totalWordsAdded, 0);
  const totalRevs = result.totalRevisions;
  const successRevs = result.revisions.filter((r) => !r.error).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-4">
          <button onClick={onReset} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            New analysis
          </button>
          <div className="h-4 w-px bg-gray-200" />
          <button onClick={handleReanalyse} disabled={reanalysing || pendingUpdate} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 disabled:opacity-50 transition-colors">
            <svg className={`w-4 h-4 ${reanalysing || pendingUpdate ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {pendingUpdate ? "Update in progress..." : reanalysing ? "Queuing..." : "Re-analyse"}
          </button>
          <div className="h-4 w-px bg-gray-200" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-400 truncate font-mono">{result.fileId}</p>
          </div>
          <p className="text-xs text-gray-400 flex-shrink-0">{result.generatedAt}</p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <StatCard label="Total Revisions" value={totalRevs} />
          <StatCard label="Contributors" value={result.userSummary.length} />
          <StatCard label="Words Added" value={totalWords.toLocaleString()} />
          {result.exportErrors > 0
            ? <StatCard label="Export Errors" value={result.exportErrors} sub="Some revisions unavailable" />
            : <StatCard label="Exported" value={`${successRevs}/${totalRevs}`} sub="All successful" />}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
          {(["summary", "revisions"] as const).map((tab) => (
            <button key={tab} onClick={() => { setActiveTab(tab); setSelectedRev(null); }}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${activeTab === tab ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              {tab === "summary" ? "User Summary" : "Revisions"}
            </button>
          ))}
        </div>

        {/* Summary tab */}
        {activeTab === "summary" && (
          <div>
            <ContribBar userSummary={result.userSummary} colors={colors} />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {result.userSummary.map((u, i) => (
                <UserCard key={u.email || u.name} user={u} color={colors[i % colors.length]} index={i} />
              ))}
            </div>
          </div>
        )}

        {/* Revisions tab */}
        {activeTab === "revisions" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Timeline list */}
            <div className="lg:col-span-1">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">{result.revisions.length} revisions</p>
              <div className="space-y-1.5 max-h-[70vh] overflow-y-auto pr-1">
                {result.revisions.map((rev) => {
                  const userIdx = result.userSummary.findIndex((u) => u.name === rev.modifiedBy.name);
                  const color = colors[userIdx % colors.length] || "#6b7280";
                  const isSelected = selectedRev?.revisionId === rev.revisionId;
                  return (
                    <button key={rev.revisionIndex} onClick={() => setSelectedRev(rev)}
                      className={`w-full text-left px-3 py-3 rounded-lg border transition-all ${isSelected ? "bg-white border-gray-400 shadow-sm" : "bg-white border-gray-200 hover:border-gray-300"}`}>
                      <div className="flex items-center gap-2.5">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0" style={{ background: color }}>
                          {initials(rev.modifiedBy.name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-800 truncate">{rev.modifiedBy.name}</p>
                          <p className="text-xs text-gray-400">{rev.modifiedTimeSGT?.slice(0, 16)}</p>
                        </div>
                        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                          <span className="text-xs text-gray-400">#{rev.revisionIndex}</span>
                          {rev.diff && rev.diff.stats.wordsAdded > 0 && (
                            <span className="text-xs text-green-600">+{rev.diff.stats.wordsAdded}</span>
                          )}
                          {rev.error && <span className="text-xs text-amber-500">!</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Detail panel */}
            <div className="lg:col-span-2">
              {selectedRev ? (
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Revision #{selectedRev.revisionIndex} detail</p>
                  <RevisionDetail rev={selectedRev} colors={colors} userSummary={result.userSummary} />
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center border-2 border-dashed border-gray-200 rounded-xl">
                  <p className="text-sm text-gray-400">Select a revision to see changes</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
