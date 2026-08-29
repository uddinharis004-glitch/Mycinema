import {
  conversionJobKey,
  getR2Client,
  JOB_PREFIX,
  listAllObjects,
  objectExists,
  PROCESSOR_STATUS_KEY,
  readJsonObject,
  requirePasscode,
  writeJsonObject,
} from "../lib/r2.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CineVault-Passcode");
  if (req.method === "OPTIONS") return res.status(200).end();

  const client = getR2Client();

  try {
    if (req.method === "GET") {
      const jobObjects = await listAllObjects(client, JOB_PREFIX);
      const jobs = (await Promise.all(jobObjects.map((object) => readJsonObject(client, object.Key))))
        .filter(Boolean)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const processor = await readJsonObject(client, PROCESSOR_STATUS_KEY);
      const heartbeatAge = processor?.heartbeatAt ? Date.now() - new Date(processor.heartbeatAt).getTime() : Infinity;

      return res.status(200).json({
        jobs,
        processor: processor ? { ...processor, online: heartbeatAge < 60000 } : { state: "offline", online: false },
      });
    }

    if (req.method === "POST") {
      if (!requirePasscode(req)) return res.status(401).json({ error: "Wrong passcode" });
      const { sourceKey } = req.body || {};
      if (!sourceKey || !/\.mkv$/i.test(sourceKey)) {
        return res.status(400).json({ error: "An MKV sourceKey is required" });
      }
      if (!(await objectExists(client, sourceKey))) return res.status(404).json({ error: "MKV file was not found" });

      const outputKey = sourceKey.replace(/\.mkv$/i, ".mp4");
      if (await objectExists(client, outputKey)) {
        return res.status(409).json({ error: "An MP4 version already exists", outputKey });
      }

      const key = conversionJobKey(sourceKey);
      const existing = await readJsonObject(client, key);
      if (existing && ["queued", "processing"].includes(existing.status)) {
        return res.status(200).json({ job: existing, alreadyQueued: true });
      }

      const now = new Date().toISOString();
      const job = {
        id: key.slice(JOB_PREFIX.length, -5),
        sourceKey,
        outputKey,
        status: "queued",
        progress: 0,
        createdAt: existing?.createdAt || now,
        queuedAt: now,
        updatedAt: now,
        error: null,
        warnings: [],
      };
      await writeJsonObject(client, key, job);
      return res.status(202).json({ job });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("Conversions error:", error);
    return res.status(500).json({ error: error.message });
  }
}
