import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

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
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const result = await s3.send(new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
    }));

    const objects = result.Contents || [];
    const publicUrl = process.env.R2_PUBLIC_URL.replace(/\/$/, "");

    // Find all video files
    const videoFiles = objects.filter(o =>
      /\.(mp4|mkv|webm|avi|mov|wmv|m4v|flv)$/i.test(o.Key)
    );

    const videos = videoFiles.map(obj => {
      const key = obj.Key;
      // Clean up the filename to make a readable title
      const title = key
        .replace(/^\d+-/, "")           // remove timestamp prefix
        .replace(/\.[^.]+$/, "")        // remove extension
        .replace(/[-_]/g, " ")          // dashes/underscores to spaces
        .replace(/\b\w/g, c => c.toUpperCase()); // title case

      // Check if a matching thumbnail exists
      const thumbKey = key.replace(/\.[^.]+$/, ".jpg");
      const hasThumbnail = objects.some(o => o.Key === thumbKey);

      return {
        id: key,
        key,
        title,
        url: `${publicUrl}/${key}`,
        thumbnail: hasThumbnail ? `${publicUrl}/${thumbKey}` : null,
        size: obj.Size,
        uploadedAt: obj.LastModified,
      };
    });

    // Newest first
    videos.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    res.status(200).json({ videos });
  } catch (err) {
    console.error("List videos error:", err);
    res.status(500).json({ error: err.message });
  }
}
