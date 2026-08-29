import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getBucket, getR2Client, requirePasscode } from "../lib/r2.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CineVault-Passcode");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!requirePasscode(req)) return res.status(401).json({ error: "Wrong passcode" });
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: "key is required" });

    await getR2Client().send(new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }));

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Delete error:", err);
    return res.status(500).json({ error: err.message });
  }
}
