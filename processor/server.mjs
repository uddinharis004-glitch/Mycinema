import { createServer } from "node:http";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createHash } from "node:crypto";

loadEnvironment(resolve(".env.processor"));

const required = ["CF_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing values in .env.processor: ${missing.join(", ")}`);
  process.exit(1);
}

const bucket = process.env.R2_BUCKET_NAME;
const port = positiveNumber(process.env.PROCESSOR_PORT, 4782);
const pollMilliseconds = positiveNumber(process.env.POLL_SECONDS, 15) * 1000;
const storageLimit = positiveNumber(process.env.R2_STORAGE_LIMIT_GB, 10) * 1_000_000_000;
const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobePath = process.env.FFPROBE_PATH || "ffprobe";
const encoderPreference = (process.env.VIDEO_ENCODER || "auto").toLowerCase();
const dataDirectory = resolve("processor-data");
mkdirSync(dataDirectory, { recursive: true });

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const jobPrefix = "_cinevault/jobs/";
const processorStatusKey = "_cinevault/processor-status.json";
let state = "off";
let currentJob = null;
let activeChild = null;
let activeUpload = null;
let working = false;
let stopRequested = false;
let lastError = null;
let cachedJobs = [];
const logs = [];

function loadEnvironment(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[name]) process.env[name] = value;
  }
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function log(message) {
  const entry = `${new Date().toLocaleTimeString()}  ${message}`;
  logs.unshift(entry);
  logs.splice(120);
  console.log(entry);
}

function jobObjectKey(sourceKey) {
  const id = createHash("sha256").update(sourceKey).digest("hex").slice(0, 32);
  return `${jobPrefix}${id}.json`;
}

async function writeJson(key, value) {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(value),
    ContentType: "application/json",
    CacheControl: "no-store",
  }));
}

async function readJson(key) {
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return JSON.parse(await result.Body.transformToString());
}

async function listObjects(prefix) {
  const objects = [];
  let continuationToken;
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    objects.push(...(page.Contents || []));
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects;
}

async function getJobs() {
  const objects = await listObjects(jobPrefix);
  const jobs = await Promise.all(objects.map((object) => readJson(object.Key)));
  cachedJobs = jobs.sort((a, b) => new Date(a.queuedAt || a.createdAt) - new Date(b.queuedAt || b.createdAt));
  return cachedJobs;
}

async function publishStatus() {
  try {
    await writeJson(processorStatusKey, {
      state,
      heartbeatAt: new Date().toISOString(),
      currentJob: currentJob ? {
        id: currentJob.id,
        sourceKey: currentJob.sourceKey,
        progress: currentJob.progress || 0,
      } : null,
      lastError,
    });
  } catch (error) {
    const message = error.message || error.name || "Could not connect to R2";
    log(`Could not publish heartbeat: ${message}`);
  }
}

async function updateJob(job, patch) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  cachedJobs = [job, ...cachedJobs.filter((item) => item.id !== job.id)];
  await writeJson(jobObjectKey(job.sourceKey), job);
}

async function downloadSource(job, localPath) {
  log(`Downloading ${job.sourceKey}`);
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: job.sourceKey }));
  await pipeline(result.Body, createWriteStream(localPath));
}

function runProcess(executable, args, onStdout) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, { windowsHide: true });
    activeChild = child;
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      onStdout?.(text);
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      activeChild = null;
      if (code === 0) resolvePromise({ stdout, stderr });
      else rejectPromise(new Error(stderr.trim().slice(-1800) || `${basename(executable)} exited with code ${code}`));
    });
  });
}

async function inspectMedia(inputPath) {
  const result = await runProcess(ffprobePath, ["-v", "error", "-show_streams", "-show_format", "-of", "json", inputPath]);
  return JSON.parse(result.stdout);
}

async function chooseEncoder() {
  if (encoderPreference !== "auto") return encoderPreference;
  try {
    const result = await runProcess(ffmpegPath, ["-hide_banner", "-encoders"]);
    return /\bh264_amf\b/.test(result.stdout) ? "h264_amf" : "libx264";
  } catch {
    return "libx264";
  }
}

function encoderArguments(encoder) {
  if (encoder === "h264_amf") return ["-c:v", "h264_amf", "-quality", "quality", "-rc", "cqp", "-qp_i", "20", "-qp_p", "22"];
  return ["-c:v", "libx264", "-preset", "medium", "-crf", "21"];
}

async function convertMedia(job, inputPath, outputPath) {
  const metadata = await inspectMedia(inputPath);
  const duration = Number(metadata.format?.duration || 0);
  const textSubtitleCodecs = new Set(["subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"]);
  const subtitleStreams = (metadata.streams || []).filter((stream) => stream.codec_type === "subtitle");
  const supportedSubtitles = subtitleStreams.filter((stream) => textSubtitleCodecs.has(stream.codec_name));
  const skippedSubtitles = subtitleStreams.filter((stream) => !textSubtitleCodecs.has(stream.codec_name));
  const warnings = skippedSubtitles.length
    ? [`Skipped ${skippedSubtitles.length} image-based subtitle track(s) because MP4 cannot contain them. The original MKV is unchanged.`]
    : [];
  let encoder = await chooseEncoder();

  const attempt = async () => {
    const args = ["-y", "-hide_banner", "-i", inputPath, "-map", "0:v:0?", "-map", "0:a?"];
    for (const stream of supportedSubtitles) args.push("-map", `0:${stream.index}`);
    args.push(
      ...encoderArguments(encoder),
      "-c:a", "aac", "-b:a", "192k",
      "-c:s", "mov_text",
      "-map_metadata", "0",
      "-movflags", "+faststart",
      "-progress", "pipe:1",
      "-nostats",
      outputPath,
    );

    let buffer = "";
    let lastPublished = 0;
    await runProcess(ffmpegPath, args, (text) => {
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        const [name, value] = line.split("=");
        if (name !== "out_time_us" || !duration) continue;
        const progress = Math.min(99, Math.max(0, (Number(value) / 1_000_000 / duration) * 100));
        job.progress = progress;
        if (Date.now() - lastPublished > 5000) {
          lastPublished = Date.now();
          updateJob(job, { progress }).catch((error) => log(`Progress update failed: ${error.message}`));
          publishStatus();
        }
      }
    });
  };

  try {
    await attempt();
  } catch (error) {
    if (encoder === "h264_amf" && !stopRequested) {
      log("AMD hardware encoding was unavailable; retrying with the CPU encoder.");
      if (existsSync(outputPath)) rmSync(outputPath, { force: true });
      encoder = "libx264";
      await attempt();
    } else {
      throw error;
    }
  }

  return { warnings, encoder };
}

async function ensureUploadFits(outputBytes) {
  const objects = await listObjects();
  const usedBytes = objects.reduce((total, object) => total + (object.Size || 0), 0);
  if (usedBytes + outputBytes > storageLimit) {
    throw new Error("Converted MP4 would exceed the configured R2 storage allowance. Delete files or increase R2_STORAGE_LIMIT_GB.");
  }
}

async function uploadOutput(job, localPath) {
  const size = statSync(localPath).size;
  await ensureUploadFits(size);
  log(`Uploading ${job.outputKey}`);
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: job.outputKey,
      Body: createReadStream(localPath),
      ContentLength: size,
      ContentType: "video/mp4",
    },
    queueSize: 3,
    partSize: 16 * 1024 * 1024,
    leavePartsOnError: false,
  });
  activeUpload = upload;
  try {
    await upload.done();
  } finally {
    activeUpload = null;
  }
}

async function processJob(job) {
  const safeId = job.id || createHash("sha256").update(job.sourceKey).digest("hex").slice(0, 16);
  const inputPath = join(dataDirectory, `${safeId}.mkv`);
  const outputPath = join(dataDirectory, `${safeId}.mp4`);
  currentJob = job;
  stopRequested = false;
  lastError = null;

  try {
    await updateJob(job, { status: "processing", progress: 0, startedAt: new Date().toISOString(), error: null });
    await publishStatus();
    await downloadSource(job, inputPath);
    if (stopRequested) throw new Error("Stopped by user");
    log(`Converting ${job.sourceKey}`);
    const result = await convertMedia(job, inputPath, outputPath);
    if (stopRequested) throw new Error("Stopped by user");
    await uploadOutput(job, outputPath);
    await updateJob(job, {
      status: "completed",
      progress: 100,
      completedAt: new Date().toISOString(),
      encoder: result.encoder,
      warnings: result.warnings,
      error: null,
    });
    log(`Completed ${job.outputKey}`);
  } catch (error) {
    const stopped = stopRequested;
    lastError = stopped ? null : error.message;
    await updateJob(job, {
      status: stopped ? "queued" : "failed",
      progress: stopped ? 0 : (job.progress || 0),
      error: stopped ? null : error.message,
      queuedAt: stopped ? new Date().toISOString() : job.queuedAt,
    }).catch((writeError) => log(`Could not update failed job: ${writeError.message}`));
    log(stopped ? `Stopped; returned ${job.sourceKey} to the queue` : `Failed: ${error.message}`);
  } finally {
    if (existsSync(inputPath)) rmSync(inputPath, { force: true });
    if (existsSync(outputPath)) rmSync(outputPath, { force: true });
    currentJob = null;
    activeChild = null;
    stopRequested = false;
    await publishStatus();
  }
}

async function processQueue() {
  if (state !== "running" || working) return;
  working = true;
  let processedJob = false;
  try {
    const jobs = await getJobs();
    lastError = null;
    const next = jobs.find((job) => job.status === "queued");
    if (next && state === "running") {
      processedJob = true;
      await processJob(next);
    }
  } catch (error) {
    lastError = error.message || error.name || "Could not connect to R2";
    log(`Queue check failed: ${lastError}`);
  } finally {
    working = false;
  }
  if (state === "running") setTimeout(processQueue, processedJob ? 1000 : pollMilliseconds);
}

function sendJson(res, value, statusCode = 200) {
  res.writeHead(statusCode, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

function localStatus() {
  return { state, currentJob, jobs: cachedJobs, logs, lastError };
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(controlPage);
    }
    if (req.method === "GET" && req.url === "/status") return sendJson(res, localStatus());
    if (req.method === "POST" && req.url === "/start") {
      state = "running";
      stopRequested = false;
      log("Processor started");
      publishStatus();
      processQueue();
      return sendJson(res, { ok: true, state });
    }
    if (req.method === "POST" && req.url === "/pause") {
      state = "paused";
      log(currentJob ? "Paused after the current conversion" : "Processor paused");
      publishStatus();
      return sendJson(res, { ok: true, state });
    }
    if (req.method === "POST" && req.url === "/stop") {
      state = "off";
      stopRequested = Boolean(currentJob);
      if (activeChild) activeChild.kill("SIGTERM");
      if (activeUpload) activeUpload.abort();
      log(currentJob ? "Stopping the current conversion" : "Processor turned off");
      publishStatus();
      return sendJson(res, { ok: true, state });
    }
    sendJson(res, { error: "Not found" }, 404);
  } catch (error) {
    sendJson(res, { error: error.message }, 500);
  }
});

const controlPage = String.raw`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CineVault Processor</title>
<style>*{box-sizing:border-box}body{margin:0;background:#09090e;color:#e8eaf2;font-family:Inter,system-ui,sans-serif}.wrap{max-width:880px;margin:auto;padding:28px 18px}.head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:22px}h1{font-size:24px;margin:0}.badge{padding:7px 11px;border-radius:20px;background:#252936;font-size:12px;font-weight:700}.card{background:#12141b;border:1px solid #282b36;border-radius:15px;padding:18px;margin-bottom:16px}.controls{display:flex;gap:10px;flex-wrap:wrap}button{border:0;border-radius:9px;padding:11px 22px;font:700 14px inherit;cursor:pointer}.start{background:#10b981;color:#04150f}.pause{background:#f59e0b;color:#1b1100}.stop{background:#ef4444;color:white}.muted{color:#7d8493;font-size:13px}.bar{height:8px;background:#292c37;border-radius:8px;overflow:hidden;margin-top:12px}.fill{height:100%;background:linear-gradient(90deg,#f59e0b,#ef4444)}table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:9px 6px;border-bottom:1px solid #252833}pre{white-space:pre-wrap;max-height:280px;overflow:auto;color:#9ca3af;font:12px Consolas,monospace;margin:0}@media(max-width:600px){h1{font-size:20px}.head{align-items:flex-start;flex-direction:column}table{font-size:11px}}</style></head>
<body><div class="wrap"><div class="head"><div><h1>🎬 CineVault Processor</h1><div class="muted" style="margin-top:6px">This page works only on this mini PC. It always opens in OFF mode.</div></div><div id="state" class="badge">OFF</div></div>
<div class="card"><div class="controls"><button class="start" onclick="action('start')">▶ Start</button><button class="pause" onclick="action('pause')">Ⅱ Pause</button><button class="stop" onclick="action('stop')">■ Stop</button></div><div id="current" class="muted" style="margin-top:16px">No active conversion</div><div class="bar"><div id="progress" class="fill" style="width:0%"></div></div></div>
<div class="card"><b>Conversion queue</b><div style="overflow:auto;margin-top:10px"><table><thead><tr><th>File</th><th>Status</th><th>Progress</th></tr></thead><tbody id="jobs"></tbody></table></div></div>
<div class="card"><b>Activity</b><pre id="logs" style="margin-top:12px">Loading…</pre></div></div>
<script>async function action(name){const badge=document.getElementById('state');badge.textContent=name==='start'?'RUNNING':name==='pause'?'PAUSED':'OFF';try{const response=await fetch('/'+name,{method:'POST'});if(!response.ok)throw new Error((await response.json()).error||'Control request failed');await refresh()}catch(error){document.getElementById('logs').textContent='Control error: '+error.message}}function esc(v){return String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}async function refresh(){try{const s=await fetch('/status').then(r=>r.json());document.getElementById('state').textContent=s.state.toUpperCase();const c=s.currentJob;document.getElementById('current').textContent=c?'Converting: '+c.sourceKey+' — '+Math.round(c.progress||0)+'%':(s.lastError?'Last error: '+s.lastError:'No active conversion');document.getElementById('progress').style.width=(c?.progress||0)+'%';document.getElementById('jobs').innerHTML=(s.jobs||[]).map(j=>'<tr><td>'+esc(j.sourceKey)+'</td><td>'+esc(j.status)+'</td><td>'+Math.round(j.progress||0)+'%</td></tr>').join('')||'<tr><td colspan="3" class="muted">No conversion jobs yet</td></tr>';document.getElementById('logs').textContent=(s.logs||[]).join('\n')||'No activity yet'}catch(e){document.getElementById('logs').textContent=e.message}}refresh();setInterval(refresh,3000)</script></body></html>`;

server.listen(port, "127.0.0.1", () => {
  log(`Control page: http://127.0.0.1:${port}`);
  log("Processor is OFF. Click Start in the control page when you want to use this PC.");
  publishStatus();
  getJobs().catch((error) => { lastError = error.message || "Could not connect to R2"; log(`Initial R2 connection failed: ${lastError}`); });
  setInterval(publishStatus, 15000);
  if (process.platform === "win32") spawn("cmd", ["/c", "start", "", `http://127.0.0.1:${port}`], { windowsHide: true, detached: true });
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    state = "off";
    stopRequested = true;
    if (activeChild) activeChild.kill("SIGTERM");
    if (activeUpload) activeUpload.abort();
    await publishStatus();
    server.close(() => process.exit(0));
  });
}
