"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const SA_EMAIL = "test-241@gemma-platform.iam.gserviceaccount.com";

function InstructionCard() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(SA_EMAIL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl p-4">
      <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-3">Before you begin</p>
      <ol className="space-y-2 text-sm text-blue-900">
        <li className="flex gap-2"><span className="font-semibold flex-shrink-0">1.</span><span>Open your Google Doc and click <strong>Share</strong></span></li>
        <li className="flex gap-2"><span className="font-semibold flex-shrink-0">2.</span><span>Add the following email as <strong>Viewer</strong>:</span></li>
      </ol>
      <div className="mt-2 ml-5 flex items-center gap-2 bg-white border border-blue-200 rounded-lg px-3 py-2">
        <span className="flex-1 text-xs font-mono text-gray-700 break-all">{SA_EMAIL}</span>
        <button onClick={copy} className="flex-shrink-0 text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors">
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <p className="mt-2 ml-5 text-xs text-blue-600">Then enter the File ID below and click Analyse.</p>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [fileId, setFileId]     = useState("");
  const [loading, setLoading]   = useState(false);
  const [queued, setQueued]     = useState(false);
  const [alreadyDone, setAlreadyDone] = useState(false);
  const [error, setError]       = useState("");

  const handleAnalyze = async () => {
    if (!fileId.trim()) return;
    setLoading(true);
    setError("");
    setQueued(false);
    setAlreadyDone(false);

    try {
      // Check if this file has already been analysed
      const existing = await fetch(`/api/history/single?fileId=${encodeURIComponent(fileId.trim())}`);
      const existingData = await existing.json();
      if (existingData.analysis) {
        setLoading(false);
        setAlreadyDone(true);
        setTimeout(() => router.push("/history"), 1500);
        return;
      }

      const res  = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: fileId.trim() }),
      });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
        setLoading(false);
        return;
      }

      // Analysis queued — navigate to history so user can track progress
      setQueued(true);
      setLoading(false);
      setTimeout(() => router.push("/history"), 1500);

    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full max-w-md p-8">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 bg-gray-900 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Docs Revision Analyser</h1>
              <p className="text-xs text-gray-400">Google Docs contribution tracker</p>
            </div>
          </div>
        </div>

        <InstructionCard />

        {/* Form */}
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
              Google Doc File ID
            </label>
            <input
              type="text" value={fileId} onChange={(e) => setFileId(e.target.value)}
              placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUq..."
              disabled={loading || queued || alreadyDone}
              className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-gray-400 bg-gray-50 text-gray-900 disabled:opacity-50"
            />
            <p className="text-xs text-gray-400 mt-1.5">
              From docs.google.com/document/d/<span className="font-mono">FILE_ID</span>/edit
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              <strong>Error:</strong> {error}
            </div>
          )}

          {alreadyDone && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800">
              <p className="font-medium">Already analysed!</p>
              <p className="text-xs text-blue-600 mt-0.5">Redirecting to Past Analyses to view the result.</p>
            </div>
          )}

          {queued && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
              <p className="font-medium">Analysis queued!</p>
              <p className="text-xs text-green-600 mt-0.5">Redirecting to Past Analyses — check there for progress.</p>
            </div>
          )}

          <button
            onClick={handleAnalyze}
            disabled={!fileId.trim() || loading || queued || alreadyDone}
            className="w-full h-11 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {loading && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            )}
            {loading ? "Queuing analysis..." : "Analyse Revisions"}
          </button>
        </div>

        <button
          onClick={() => router.push("/history")}
          disabled={loading}
          className="w-full mt-3 h-9 border border-gray-200 rounded-lg text-sm text-gray-500 hover:text-gray-900 hover:border-gray-400 transition-colors flex items-center justify-center gap-2 disabled:opacity-40"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          View past analyses
        </button>

        <p className="text-xs text-gray-400 text-center mt-4">
          Credentials are stored server-side — never transmitted to the browser
        </p>
      </div>
    </main>
  );
}
