import { getR2Client, listAllObjects, storageLimitBytes, SYSTEM_PREFIX } from "../lib/r2.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const objects = await listAllObjects(getR2Client());
    const usedBytes = objects.reduce((total, object) => total + (object.Size || 0), 0);
    const systemBytes = objects
      .filter((object) => object.Key.startsWith(SYSTEM_PREFIX))
      .reduce((total, object) => total + (object.Size || 0), 0);
    const limitBytes = storageLimitBytes();

    return res.status(200).json({
      usedBytes,
      remainingBytes: Math.max(0, limitBytes - usedBytes),
      limitBytes,
      percentUsed: Math.min(100, (usedBytes / limitBytes) * 100),
      objectCount: objects.length,
      systemBytes,
      overLimit: usedBytes >= limitBytes,
    });
  } catch (error) {
    console.error("Storage usage error:", error);
    return res.status(500).json({ error: error.message });
  }
}
