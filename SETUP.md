# CineVault v2 — Setup Guide

## Step 1 — Cloudflare R2 Bucket (free, 5 min)

1. Go to https://dash.cloudflare.com → **R2 Object Storage**
2. Click **Create bucket** → name it `cinevault` → Create
3. In the bucket → **Settings** → scroll to **R2.dev subdomain** → click **Allow Access**
   - This gives you a public URL like: `https://pub-abc123.r2.dev`
   - Copy this URL — you'll need it for `R2_PUBLIC_URL`

### Configure CORS (required for browser uploads)
Still in bucket Settings → scroll to **CORS policy** → Edit → paste this:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```
Save.

---

## Step 2 — R2 API Token

1. In Cloudflare dashboard → **R2** → **Manage R2 API tokens**
2. Click **Create API token**
3. Give it a name (e.g. "cinevault")
4. Permissions: **Object Read & Write**
5. Scope: **Specific bucket** → select `cinevault`
6. Click **Create API token**
7. **Save both values shown:**
   - Access Key ID
   - Secret Access Key (only shown once!)

---

## Step 3 — Your Account ID

Top-right of any Cloudflare page → your account → copy the **Account ID**
(also shown in R2 dashboard sidebar)

---

## Step 4 — Add to Vercel Environment Variables

In Vercel → your project → **Settings → Environment Variables** → add these values:

| Name | Value |
|------|-------|
| `CF_ACCOUNT_ID` | your Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | from Step 2 |
| `R2_SECRET_ACCESS_KEY` | from Step 2 |
| `R2_BUCKET_NAME` | `cinevault` |
| `R2_PUBLIC_URL` | `https://pub-abc123.r2.dev` (from Step 1) |
| `R2_STORAGE_LIMIT_GB` | `10` (the allowance the app should enforce) |
| `APP_PASSCODE` | your private app passcode |
| `VITE_PASSCODE` | the same app passcode |

After saving → **Deployments → Redeploy**

---

## Step 5 — Replace files in GitHub

Replace all files in your existing `cinevault` repo with the files in this zip.
The folder structure is the same — just updated files.

---

## How uploads work

Browser → `/api/upload-url` (Vercel) → gets a signed URL → uploads directly to R2

The video **never passes through Vercel**, so there's no file size limit.
Uploads go straight from your browser to Cloudflare R2.

## Storage allowance shown by CineVault

CineVault totals every object in your R2 bucket and compares it with `R2_STORAGE_LIMIT_GB`.
The default is 10 GB. This is an app-enforced allowance, not a hard Cloudflare bucket limit.
If you intentionally want to use paid storage, increase this environment variable and redeploy.

---

## Mini-PC MKV processor

The processor uses an outbound connection to R2, so you do not need to open a router port or expose your PC to the internet.

1. Install Node.js and FFmpeg on the mini PC. In Command Prompt, `ffmpeg -version` and `ffprobe -version` should both work.
2. Copy `.env.processor.example` to a new file named `.env.processor`.
3. Add the same four R2 account, access-key, secret-key, and bucket values used in Vercel.
4. Run `npm install` once, or let the launcher install dependencies if needed.
5. Double-click `Start CineVault Processor.cmd`.
6. The local control page opens at `http://127.0.0.1:4782`. It starts in **OFF** mode every time.
7. Queue any existing MKV from the CineVault website, then click **Start** locally when you want the mini PC to process jobs.

**Pause** finishes the current conversion and does not start another one. **Stop** cancels the current conversion and returns it to the queue. The original MKV is never deleted automatically.

The MP4 keeps all audio tracks and supported text subtitle tracks. Image-based subtitles such as PGS cannot be stored inside MP4, so those are skipped and remain available in the original MKV.

More than enough for a personal streaming site.
