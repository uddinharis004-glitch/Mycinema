import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { filename, contentType } = req.body;
    if (!filename) return res.status(400).json({ error: "filename is required" });

    // Build the key: timestamp + sanitized filename
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
    const key = `${Date.now()}-${safe}`;

    // Generate a signed URL valid for 1 hour
    const signedUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        ContentType: contentType || "application/octet-stream",
      }),
      { expiresIn: 3600 }
    );

    res.status(200).json({ url: signedUrl, key });
  } catch (err) {
    console.error("Upload URL error:", err);
    res.status(500).json({ error: err.message });
  }
}
