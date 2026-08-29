import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getBucket, getR2Client, listAllObjects, requirePasscode, storageLimitBytes } from "../lib/r2.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CineVault-Passcode");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!requirePasscode(req)) return res.status(401).json({ error: "Wrong passcode" });
    const { filename, contentType, size = 0 } = req.body;
    if (!filename) return res.status(400).json({ error: "filename is required" });
    if (!Number.isFinite(Number(size)) || Number(size) < 0) {
      return res.status(400).json({ error: "A valid file size is required" });
    }

    const s3 = getR2Client();
    const objects = await listAllObjects(s3);
    const usedBytes = objects.reduce((total, object) => total + (object.Size || 0), 0);
    const limitBytes = storageLimitBytes();
    if (usedBytes + Number(size) > limitBytes) {
      return res.status(413).json({
        error: "This upload would exceed your configured R2 storage allowance",
        usedBytes,
        limitBytes,
      });
    }

    // Build the key: timestamp + sanitized filename
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
    const key = `${Date.now()}-${safe}`;

    // Generate a signed URL valid for 1 hour
    const signedUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: key,
        ContentType: contentType || "application/octet-stream",
      }),
      { expiresIn: 3600 }
    );

    return res.status(200).json({ url: signedUrl, key, usedBytes, limitBytes });
  } catch (err) {
    console.error("Upload URL error:", err);
    return res.status(500).json({ error: err.message });
  }
}
