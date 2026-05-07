/**
 * ─────────────────────────────────────────────
 *  Google Docs Revision Analyser — Config
 * ─────────────────────────────────────────────
 *
 *  LOCAL DEV:  edit the values below directly, or create a .env.local file
 *  VERCEL:     set these as Environment Variables in your Vercel project dashboard
 *              Project → Settings → Environment Variables
 *
 *  All process.env values fall back to the defaults below if not set.
 * ─────────────────────────────────────────────
 */

const config = {

  // ── Timezone ─────────────────────────────────
  // VERCEL ENV: TIMEZONE_LABEL, TIMEZONE_OFFSET_HOURS
  timezone: {
    label:        process.env.TIMEZONE_LABEL        ?? "SGT",
    offsetHours:  Number(process.env.TIMEZONE_OFFSET_HOURS ?? 8),
    displayName:  process.env.TIMEZONE_DISPLAY_NAME ?? "Asia/Singapore (UTC+8)",
  },

  // ── Rate Limiting & Retries ───────────────────
  // VERCEL ENV: DELAY_BETWEEN_REVISIONS_MS, MAX_RETRIES, RETRY_BACKOFF_BASE_MS
  rateLimit: {
    delayBetweenRevisionMs: Number(process.env.DELAY_BETWEEN_REVISIONS_MS ?? 1500),
    maxRetries:             Number(process.env.MAX_RETRIES              ?? 5),
    retryBackoffBaseMs:     Number(process.env.RETRY_BACKOFF_BASE_MS    ?? 1500),
  },

  // ── Diff Settings ─────────────────────────────
  // VERCEL ENV: DIFF_MODE, DIFF_MIN_CHUNK_LENGTH
  diff: {
    mode:           (process.env.DIFF_MODE ?? "words") as "words" | "chars" | "sentences",
    minChunkLength: Number(process.env.DIFF_MIN_CHUNK_LENGTH ?? 2),
  },

  // ── UI / Dashboard ────────────────────────────
  // These are display-only and don't need env vars —
  // edit them directly here and redeploy.
  ui: {
    appTitle:    "Google Docs Revision Analyser",
    appSubtitle: "Word-level diff · Singapore Time",
    userColors: [
      "#374151",
      "#6366f1",
      "#10b981",
      "#f59e0b",
      "#ef4444",
      "#8b5cf6",
      "#06b6d4",
      "#ec4899",
    ],
    defaultTab: "summary" as "summary" | "revisions",
  },

  cache: {
    historyRevalidateSeconds: Number(process.env.HISTORY_REVALIDATE_SECONDS ?? 60),
  },

  // ── Network ───────────────────────────────────
  // VERCEL ENV: DISABLE_SSL_VERIFICATION (set to "true" only for TP network / local dev)
  // On Vercel this should always be "false" — Vercel has valid SSL certs.
  network: {
    disableSslVerification: process.env.DISABLE_SSL_VERIFICATION === "true",
  },

  // ── Google API ────────────────────────────────
  // Scopes are fixed — only change if you need extra Google API access.
  google: {
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/documents.readonly",
    ],
    exportFormat: "txt" as "txt" | "html" | "odt",
  },

} as const;

export default config;

// ── Derived helpers ───────────────────────────────
export function toTimezone(isoString: string | null | undefined): string | null {
  if (!isoString) return null;
  const offsetMs = config.timezone.offsetHours * 60 * 60 * 1000;
  const shifted = new Date(new Date(isoString).getTime() + offsetMs);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())} ${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())} ${config.timezone.label}`;
}

export function nowFormatted(): string {
  return toTimezone(new Date().toISOString()) ?? "";
}
