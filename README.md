# Google Docs Revision Analyser

A Next.js web app that analyses revision history in Google Docs — showing who edited what, when, and how much. Built for academic integrity monitoring at Temasek Polytechnic.

All heavy computation runs in **Google Apps Script** (up to 6 minutes), so it works on Vercel's free hobby plan without hitting the 10-second function timeout.

---

## How it works

```
Browser uploads File ID + service account JSON
    ↓
Next.js /api/analyze  (< 1s — just a proxy)
    ↓
Google Apps Script  (does all the work — up to 6 min)
    ├── Fetches revision list from Drive API
    ├── Exports each revision as plain text
    ├── Computes word-level diffs (added / removed per revision)
    ├── Builds per-user contribution summary
    └── Saves results to Google Sheets
    ↓
Browser polls /api/job/status every 3s
    ↓
Dashboard shows user summary + revision timeline with diff viewer
    ↓
Results cached in history page (auto-refreshes every 60s)
```

---

## Prerequisites

- Node.js 18+
- A Google Cloud project with Drive API and Docs API enabled
- A Google service account with a JSON key
- A Google account to host the Apps Script and Sheets

---

## Part 1 — Google Cloud Setup

### 1.1 Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click **New Project** → give it a name → **Create**

### 1.2 Enable APIs

In your project, go to **APIs & Services → Library** and enable:

- **Google Drive API**
- **Google Docs API**

### 1.3 Create a service account

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → Service Account**
3. Give it a name (e.g. `revision-analyser`) → **Create and Continue** → **Done**
4. Click the service account → **Keys** tab → **Add Key → Create new key → JSON**
5. Download the JSON file — this is your `service-account.json`

### 1.4 Share your Google Docs with the service account

For each Google Doc you want to analyse:

1. Open the Doc → **Share**
2. Add the service account email (found in `service-account.json` as `client_email`)
3. Set permission to **Viewer** → **Share**

> The service account email looks like: `revision-analyser@your-project.iam.gserviceaccount.com`

---

## Part 2 — Google Apps Script Setup

The Apps Script is the compute and storage engine. It runs the full analysis and stores results in a Google Sheet.

### 2.1 Create the Apps Script project

1. Go to [script.google.com](https://script.google.com) → **New Project**
2. Rename the project (e.g. `Revision Analyser Backend`)
3. Delete any existing code in `Code.gs`
4. Copy the full contents of `apps-script/Code.gs` from this project and paste it in
5. Click **Save** (Ctrl+S)

### 2.2 Enable the Drive API in Apps Script

1. In the Apps Script editor, click **Services** (+ icon in the left sidebar)
2. Find **Drive API** → select **v3** → click **Add**

### 2.3 Deploy as a Web App

1. Click **Deploy → New Deployment**
2. Click the gear icon next to **Type** → select **Web App**
3. Set the following:
   - **Description**: `Revision Analyser v1`
   - **Execute as**: `Me`
   - **Who has access**: `Anyone`
4. Click **Deploy**
5. Authorise the app when prompted (click through the Google permissions screens)
6. **Copy the Web App URL** — it looks like:
   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```
   You will need this in the next steps.

> **Important:** Every time you update `Code.gs`, you must create a **New Deployment** (not just save). Go to Deploy → Manage Deployments → New Deployment.

### 2.4 Verify the Sheet was created

After your first analysis runs, a Google Sheet named **RevisionAnalyses** will appear in your Google Drive. It has two tabs:
- `RevisionAnalyses` — one row per analysed document
- `Jobs` — job tracking (status, progress, results)

---

## Part 3 — Local Development

### 3.1 Install dependencies

```bash
cd gdocs-dashboard
npm install
```

### 3.2 Configure environment variables

Copy `.env.local` (already included) and fill in your Apps Script URL:

```bash
# .env.local
APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec

TIMEZONE_LABEL=SGT
TIMEZONE_OFFSET_HOURS=8
TIMEZONE_DISPLAY_NAME=Asia/Singapore (UTC+8)

DELAY_BETWEEN_REVISIONS_MS=1500
MAX_RETRIES=5
RETRY_BACKOFF_BASE_MS=1500

DIFF_MODE=words
DIFF_MIN_CHUNK_LENGTH=2

HISTORY_REVALIDATE_SECONDS=60

# Set to "true" ONLY on TP network (corporate SSL proxy)
# Set to "false" on Vercel
DISABLE_SSL_VERIFICATION=true
```

### 3.3 Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 3.4 Test the setup

1. Paste a Google Doc File ID into the form
   - Get it from the URL: `docs.google.com/document/d/**FILE_ID**/edit`
2. Upload your `service-account.json`
3. Click **Analyse Revisions**
4. Watch the progress bar — the analysis runs in Apps Script (may take 1–3 minutes)
5. The dashboard will load automatically when done

---

## Part 4 — Deploy to Vercel

### 4.1 Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create gdocs-revision-analyser --private --push
```

### 4.2 Import to Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import your GitHub repository
3. Framework preset: **Next.js** (auto-detected)
4. Click **Deploy** (it will fail on first deploy — env vars not set yet)

### 4.3 Set environment variables

In your Vercel project → **Settings → Environment Variables**, add:

| Variable | Value | Notes |
|---|---|---|
| `APPS_SCRIPT_URL` | `https://script.google.com/macros/s/.../exec` | **Required** — your Apps Script Web App URL |
| `TIMEZONE_LABEL` | `SGT` | Label shown on timestamps |
| `TIMEZONE_OFFSET_HOURS` | `8` | UTC+8 for Singapore |
| `TIMEZONE_DISPLAY_NAME` | `Asia/Singapore (UTC+8)` | Full timezone description |
| `DELAY_BETWEEN_REVISIONS_MS` | `1500` | ms between revision exports — increase if getting 429 errors |
| `MAX_RETRIES` | `5` | Retry attempts per revision export |
| `RETRY_BACKOFF_BASE_MS` | `1500` | Exponential backoff base in ms |
| `DIFF_MODE` | `words` | `words` / `chars` / `sentences` |
| `DIFF_MIN_CHUNK_LENGTH` | `2` | Minimum chars for a diff chunk to be included |
| `HISTORY_REVALIDATE_SECONDS` | `60` | How often history page re-fetches from Apps Script |
| `DISABLE_SSL_VERIFICATION` | `false` | **Must be `false` on Vercel** |

### 4.4 Redeploy

After setting env vars:
1. Go to **Deployments** → click the three dots on the latest → **Redeploy**
2. Your app will be live at `https://your-project.vercel.app`

---

## Part 5 — Configuration Reference

All settings are in `config.ts` at the project root. Environment variables override defaults.

### Timezone

| Setting | Env Var | Default | Description |
|---|---|---|---|
| `timezone.label` | `TIMEZONE_LABEL` | `SGT` | Label shown on all timestamps |
| `timezone.offsetHours` | `TIMEZONE_OFFSET_HOURS` | `8` | Hours offset from UTC |
| `timezone.displayName` | `TIMEZONE_DISPLAY_NAME` | `Asia/Singapore (UTC+8)` | Full display name |

### Rate limiting

| Setting | Env Var | Default | Description |
|---|---|---|---|
| `rateLimit.delayBetweenRevisionMs` | `DELAY_BETWEEN_REVISIONS_MS` | `1500` | Delay between revision exports in ms |
| `rateLimit.maxRetries` | `MAX_RETRIES` | `5` | Max retries per failed export |
| `rateLimit.retryBackoffBaseMs` | `RETRY_BACKOFF_BASE_MS` | `1500` | Backoff base — actual wait = 2^attempt × base |

### Diff

| Setting | Env Var | Default | Description |
|---|---|---|---|
| `diff.mode` | `DIFF_MODE` | `words` | `words` / `chars` / `sentences` |
| `diff.minChunkLength` | `DIFF_MIN_CHUNK_LENGTH` | `2` | Minimum chars to include a diff chunk |

### Cache

| Setting | Env Var | Default | Description |
|---|---|---|---|
| `cache.historyRevalidateSeconds` | `HISTORY_REVALIDATE_SECONDS` | `60` | How often history re-fetches from Apps Script |

### Network

| Setting | Env Var | Default | Description |
|---|---|---|---|
| `network.disableSslVerification` | `DISABLE_SSL_VERIFICATION` | `false` | Set `true` on TP network only |

### UI (edit `config.ts` directly — no env var needed)

| Setting | Default | Description |
|---|---|---|
| `ui.appTitle` | `Google Docs Revision Analyser` | Browser tab and header title |
| `ui.appSubtitle` | `Word-level diff · Singapore Time` | Subtitle under the title |
| `ui.userColors` | 8 colours | Hex colours cycled per contributor |
| `ui.defaultTab` | `summary` | Default dashboard tab: `summary` or `revisions` |

---

## Project Structure

```
gdocs-dashboard/
├── app/
│   ├── api/
│   │   ├── analyze/route.ts       # Proxy — forwards job to Apps Script
│   │   ├── job/status/route.ts    # Polls Apps Script for job progress
│   │   ├── history/route.ts       # Returns cached history list
│   │   ├── history/single/route.ts # Returns single analysis detail
│   │   └── revalidate/route.ts    # Manual cache bust endpoint
│   ├── components/
│   │   └── Dashboard.tsx          # Main dashboard UI
│   ├── history/
│   │   ├── page.tsx               # Server component — reads from cache
│   │   └── HistoryClient.tsx      # Client interactivity
│   ├── page.tsx                   # Home — file ID + service account form
│   └── types.ts                   # Shared TypeScript types
├── apps-script/
│   └── Code.gs                    # Full compute + storage engine
├── lib/
│   └── storage.ts                 # Apps Script fetch wrappers
├── config.ts                      # All tuneable settings
├── .env.local                     # Local dev environment variables
└── README.md                      # This file
```

---

## Troubleshooting

### "Could not fetch revisions: HTTP 403"
The Google Doc has not been shared with the service account email. Share the Doc with the `client_email` from your `service-account.json` as Viewer.

### "Auth failed" on Apps Script
The service account JSON was malformed or the private key is invalid. Re-download it from Google Cloud Console.

### Analysis hangs and never completes
Check the **Jobs** tab in your RevisionAnalyses Google Sheet — the `status` and `progress` columns show exactly where it stopped.

### "Export failed: HTTP 429" on many revisions
Google is rate-limiting the revision exports. Increase `DELAY_BETWEEN_REVISIONS_MS` to `3000` in your env vars.

### History page not updating after new analysis
The history page caches for `HISTORY_REVALIDATE_SECONDS` (default 60s). Wait 60 seconds and refresh, or click the **Refresh** button on the history page.

### `DISABLE_SSL_VERIFICATION` errors locally
If on the TP network, set `DISABLE_SSL_VERIFICATION=true` in `.env.local`. Never set this to `true` on Vercel.

### Apps Script "Script timeout" error
A single analysis is hitting the 6-minute Apps Script limit. This can happen with docs that have hundreds of revisions. Increase `DELAY_BETWEEN_REVISIONS_MS` to reduce throttling retries, or contact the document owner to reduce revision count.

---

## Security notes

- Service account JSON is sent to Apps Script and used only for that request — it is never written to disk or stored anywhere
- The Apps Script Web App runs as your Google account — treat the Web App URL as a secret
- `DISABLE_SSL_VERIFICATION=true` disables SSL certificate checks — only use on trusted corporate networks, never in production
- The history page is publicly accessible — anyone with the Vercel URL can view past analyses. Add authentication if this is sensitive.
