import { getR2Client, listAllObjects, publicObjectUrl, SYSTEM_PREFIX } from "../lib/r2.js";

const VIDEO_PATTERN = /\.(mp4|mkv|webm|avi|mov|wmv|m4v|flv)$/i;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const objects = await listAllObjects(getR2Client());
    const visibleObjects = objects.filter((object) => !object.Key.startsWith(SYSTEM_PREFIX));
    const keys = new Set(visibleObjects.map((object) => object.Key));

    const videos = visibleObjects.filter((object) => VIDEO_PATTERN.test(object.Key)).map((obj) => {
      const key = obj.Key;
      const extension = key.split(".").pop().toLowerCase();
      const title = key
        .replace(/^\d+-/, "")
        .replace(/\.[^.]+$/, "")
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
      const thumbKey = key.replace(/\.[^.]+$/, ".jpg");
      const outputKey = extension === "mkv" ? key.replace(/\.mkv$/i, ".mp4") : null;

      return {
        id: key,
        key,
        title,
        extension,
        url: publicObjectUrl(key),
        thumbnail: keys.has(thumbKey) ? publicObjectUrl(thumbKey) : null,
        size: obj.Size || 0,
        uploadedAt: obj.LastModified,
        canConvert: extension === "mkv" && !keys.has(outputKey),
        convertedKey: extension === "mkv" && keys.has(outputKey) ? outputKey : null,
      };
    });

    videos.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    return res.status(200).json({ videos });
  } catch (err) {
    console.error("List videos error:", err);
    return res.status(500).json({ error: err.message });
  }
}
