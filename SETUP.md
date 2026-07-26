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

In Vercel → your project → **Settings → Environment Variables** → add all 5:

| Name | Value |
|------|-------|
| `CF_ACCOUNT_ID` | your Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | from Step 2 |
| `R2_SECRET_ACCESS_KEY` | from Step 2 |
| `R2_BUCKET_NAME` | `cinevault` |
| `R2_PUBLIC_URL` | `https://pub-abc123.r2.dev` (from Step 1) |

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

## Free tier limits (R2)

- 10 GB storage
- 1 million writes/month  
- 10 million reads/month

More than enough for a personal streaming site.
