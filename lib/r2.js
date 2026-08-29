import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";

export const SYSTEM_PREFIX = "_cinevault/";
export const JOB_PREFIX = `${SYSTEM_PREFIX}jobs/`;
export const PROCESSOR_STATUS_KEY = `${SYSTEM_PREFIX}processor-status.json`;

export function getR2Client() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

export function getBucket() {
  return process.env.R2_BUCKET_NAME;
}

export async function listAllObjects(client, prefix) {
  const objects = [];
  let continuationToken;

  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: getBucket(),
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    objects.push(...(page.Contents || []));
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

export function storageLimitBytes() {
  const configured = Number(process.env.R2_STORAGE_LIMIT_GB || 10);
  const gigabytes = Number.isFinite(configured) && configured > 0 ? configured : 10;
  return Math.round(gigabytes * 1_000_000_000);
}

export function publicObjectUrl(key) {
  const base = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${base}/${encodedKey}`;
}

export function conversionId(sourceKey) {
  return createHash("sha256").update(sourceKey).digest("hex").slice(0, 32);
}

export function conversionJobKey(sourceKey) {
  return `${JOB_PREFIX}${conversionId(sourceKey)}.json`;
}

export async function readJsonObject(client, key) {
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
    return JSON.parse(await result.Body.transformToString());
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NoSuchKey" || error?.name === "NotFound") {
      return null;
    }
    throw error;
  }
}

export async function writeJsonObject(client, key, value) {
  await client.send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    Body: JSON.stringify(value),
    ContentType: "application/json",
    CacheControl: "no-store",
  }));
}

export async function objectExists(client, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }));
    return true;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") return false;
    throw error;
  }
}

export function requirePasscode(req) {
  const expected = process.env.APP_PASSCODE;
  const supplied = req.headers["x-cinevault-passcode"] || req.body?.passcode;
  return typeof expected === "string" && expected.length > 0 && typeof supplied === "string" && supplied === expected;
}
