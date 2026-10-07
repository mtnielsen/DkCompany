/**
 * DKC-057 — S3-kompatibel objektlager-backend.
 *
 * Backenden taler den rigtige S3-REST-protokol med AWS Signature Version 4
 * (udført med `node:crypto`), path-style addressing og understøttelse af
 * TLS-verifikation, CA-reference, certifikat-pinning og minimum TLS-version.
 *
 * Den bruges af preflight (read-only), canary (skriv/læs/slet en lille fil) og
 * synkronisering af en krypteret backupbeholder. En rigtig S3/MinIO-instans
 * kræver ekstern infrastruktur og er derfor en `integration`-check; koden
 * efterprøves mod en protokolfast test-dobbelt.
 */
import { createHash, createHmac } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { checkServerIdentity as tlsCheckServerIdentity } from "node:tls";
import { BackupTargetError, classifyTargetError } from "../errors.mjs";

const ALGORITHM = "AWS4-HMAC-SHA256";

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value).digest();
}

function encodeRfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalUri(path) {
  return path
    .split("/")
    .map((segment) => encodeRfc3986(decodeURIComponent(segment)))
    .join("/");
}

function canonicalQuery(query = {}) {
  const pairs = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return pairs.map(([key, value]) => `${key}=${value}`).join("&");
}

function amzDate(now) {
  return new Date(now).toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/**
 * Signér en S3-anmodning med SigV4. Returnerer de headers der skal sendes,
 * inkl. `Authorization`, `x-amz-date` og `x-amz-content-sha256`.
 */
export function signS3Request({ method, host, path, query = {}, headers = {}, payload = Buffer.alloc(0), region, accessKeyId, secretAccessKey, now = Date.now() }) {
  const payloadHash = sha256Hex(payload);
  const stamp = amzDate(now);
  const date = stamp.slice(0, 8);
  const all = { ...headers, host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp };

  const normalized = {};
  for (const [key, value] of Object.entries(all)) normalized[key.toLowerCase().trim()] = String(value).trim().replace(/\s+/g, " ");
  const signedHeaderNames = Object.keys(normalized).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${normalized[name]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [method.toUpperCase(), canonicalUri(path), canonicalQuery(query), canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${region}/s3/aws4_request`;
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return {
    ...normalized,
    Authorization: `${ALGORITHM} Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function xmlTag(body, tag) {
  const match = body.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? match[1] : null;
}

function xmlAll(body, tag) {
  const out = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  let match;
  while ((match = re.exec(body))) out.push(match[1]);
  return out;
}

function rawRequest({ method, url, headers, body = null, tls = {}, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(new BackupTargetError(`ugyldig endpoint-URL '${url}'`, "target_error", { cause: err }));
      return;
    }
    const secure = parsed.protocol === "https:";
    const lib = secure ? https : http;
    const options = {
      method,
      hostname: parsed.hostname,
      port: parsed.port || (secure ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      headers,
    };
    if (secure) {
      options.rejectUnauthorized = tls.verify !== false;
      if (tls.ca) options.ca = tls.ca;
      if (tls.minVersion) options.minVersion = /^TLSv/.test(tls.minVersion) ? tls.minVersion : `TLSv${tls.minVersion}`;
      if (tls.certSha256) {
        const pin = String(tls.certSha256).toLowerCase();
        options.checkServerIdentity = (host, cert) => {
          const base = tlsCheckServerIdentity(host, cert);
          if (base) return base;
          const fingerprint = createHash("sha256").update(cert.raw).digest("hex");
          return fingerprint === pin ? undefined : new Error(`certifikat-pinning matcher ikke (${fingerprint.slice(0, 12)}…)`);
        };
      }
    }
    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    if (timeoutMs > 0) req.setTimeout(timeoutMs, () => req.destroy(new BackupTargetError("backupmålet svarede ikke inden for tidsgrænsen", "network_error")));
    if (body) req.write(body);
    req.end();
  });
}

export function createS3Backend({ endpoint, region, bucket, pathPrefix = "", credentials, tls = {}, timeoutMs = 30000, now = () => Date.now(), requestFn = rawRequest } = {}) {
  if (!endpoint || !bucket) throw new BackupTargetError("createS3Backend kræver endpoint og bucket", "target_error");
  if (!credentials?.accessKeyId || !credentials?.secretAccessKey) {
    throw new BackupTargetError("createS3Backend kræver accessKeyId og secretAccessKey", "credentials_error");
  }
  const base = endpoint.replace(/\/$/, "");
  const host = new URL(base).host;
  const pathFor = (key) => {
    const cleanKey = key === null || key === undefined ? "" : String(key).replace(/^\/+/, "");
    if (!cleanKey) return `/${bucket}`;
    if (cleanKey.split("/").some((part) => part === "..")) throw new BackupTargetError(`ugyldig objektnøgle '${key}'`, "target_error");
    const prefix = pathPrefix ? `${pathPrefix.replace(/^\/|\/$/g, "")}/` : "";
    return `/${bucket}/${prefix}${cleanKey}`.replace(/\/{2,}/g, "/");
  };

  let cached = null;

  async function call(method, { key = null, query = {}, body = null, headers = {}, objectLock = null } = {}) {
    const path = pathFor(key);
    const payload = body ?? Buffer.alloc(0);
    const extra = { ...headers };
    if (objectLock?.mode) extra["x-amz-object-lock-mode"] = objectLock.mode;
    if (objectLock?.retainUntil) extra["x-amz-object-lock-retain-until-date"] = new Date(objectLock.retainUntil).toISOString();
    const signed = signS3Request({ method, host, path, query, headers: extra, payload, region, accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey, now: now() });
    const search = canonicalQuery(query) ? `?${canonicalQuery(query)}` : "";
    let response;
    try {
      response = await requestFn({ method, url: `${base}${path}${search}`, headers: signed, body, tls, timeoutMs });
    } catch (err) {
      throw classifyTargetError(err);
    }
    if (response.status >= 400) {
      const text = response.body?.toString("utf8") ?? "";
      if (response.status === 507 || /quota|insufficient|space/i.test(text)) throw classifyTargetError(new Error(text), 507);
      if (response.status === 409) throw classifyTargetError(new Error(text || "conflict"), 409);
      if (response.status === 404 && method !== "HEAD") throw new BackupTargetError("objektet findes ikke", "not_found", { status: 404 });
      throw classifyTargetError(new Error(text || `HTTP ${response.status}`), response.status);
    }
    return response;
  }

  const backend = {
    kind: "s3-backend",
    endpoint: base,
    region,
    bucket,
    pathPrefix,
    storeContainsKey: false,

    capabilities() {
      return cached ?? { read: true, write: true, list: true, versioning: false, objectLock: false, objectLockMode: null, minRetentionDays: null };
    },

    async headBucket() {
      const res = await call("HEAD");
      return { region: res.headers["x-amz-bucket-region"] ?? region, bucket };
    },

    async getBucketVersioning() {
      const res = await call("GET", { query: { versioning: "" } });
      const status = xmlTag(res.body.toString("utf8"), "Status");
      return { enabled: status === "Enabled", status: status ?? "Suspended" };
    },

    async getObjectLockConfiguration() {
      let res;
      try {
        res = await call("GET", { query: { "object-lock": "" } });
      } catch (err) {
        if (err.code === "not_found" || err.code === "bucket_not_found" || err.status === 404) return { enabled: false, mode: null, days: null };
        throw err;
      }
      const body = res.body.toString("utf8");
      const enabled = xmlTag(body, "ObjectLockEnabled") === "Enabled";
      const retention = xmlTag(body, "DefaultRetention") ?? "";
      return { enabled, mode: xmlTag(retention, "Mode"), days: xmlTag(retention, "Days") ? Number(xmlTag(retention, "Days")) : null };
    },

    async listObjects(prefix = "") {
      const physicalPrefix = [pathPrefix.replace(/^\/|\/$/g, ""), String(prefix ?? "").replace(/^\//, "")].filter(Boolean).join("/");
      const res = await call("GET", { query: { "list-type": "2", prefix: physicalPrefix } });
      const body = res.body.toString("utf8");
      const keys = xmlAll(body, "Key");
      const sizes = xmlAll(body, "Size");
      const logicalPrefix = pathPrefix ? `${pathPrefix.replace(/^\/|\/$/g, "")}/` : "";
      return keys.map((key, i) => ({
        key: logicalPrefix && key.startsWith(logicalPrefix) ? key.slice(logicalPrefix.length) : key,
        bytes: Number(sizes[i] ?? 0),
      }));
    },

    async putObject(key, buffer, { objectLock = null } = {}) {
      const res = await call("PUT", { key, body: buffer, headers: { "content-length": String(buffer.length) }, objectLock });
      return { key, bytes: buffer.length, etag: res.headers.etag ?? sha256Hex(buffer).slice(0, 32) };
    },

    async getObject(key) {
      const res = await call("GET", { key });
      return res.body;
    },

    async headObject(key) {
      let res;
      try {
        res = await call("HEAD", { key });
      } catch (err) {
        if (err.status === 404 || err.code === "not_found" || err.code === "bucket_not_found") return null;
        throw err;
      }
      return { key, bytes: Number(res.headers["content-length"] ?? 0), etag: res.headers.etag ?? null };
    },

    async deleteObject(key) {
      await call("DELETE", { key });
      return true;
    },

    /** Read-only preflight mod det rigtige objektlager. */
    async preflight() {
      const checks = [];
      const errors = [];
      const push = (name, status, detail) => checks.push({ name, status, detail });
      try {
        await backend.headBucket();
        push("bucket", "pass", "backupmålet er tilgængeligt");
      } catch (err) {
        push("bucket", "fail", err.message);
        errors.push(err);
        return { ok: false, checks, errors, capabilities: backend.capabilities() };
      }
      let versioning = { enabled: false };
      try {
        versioning = await backend.getBucketVersioning();
        push("versioning", versioning.enabled ? "pass" : "warn", versioning.enabled ? "versionsstyring er slået til" : "versionsstyring er ikke slået til");
      } catch (err) {
        push("versioning", "warn", `kunne ikke læse versionsstyring: ${err.message}`);
      }
      let objectLock = { enabled: false, mode: null, days: null };
      try {
        objectLock = await backend.getObjectLockConfiguration();
        push("object-lock", objectLock.enabled ? "pass" : "warn", objectLock.enabled ? `object-lock er slået til (${objectLock.mode ?? "ukendt"})` : "object-lock er ikke slået til");
      } catch (err) {
        push("object-lock", "warn", `kunne ikke læse object-lock: ${err.message}`);
      }
      try {
        await backend.listObjects("");
        push("read-only-list", "pass", "kan liste målet (read-only)");
      } catch (err) {
        push("read-only-list", "fail", err.message);
        errors.push(err);
      }
      cached = { read: true, write: true, list: true, versioning: versioning.enabled, objectLock: objectLock.enabled, objectLockMode: objectLock.mode, minRetentionDays: objectLock.days };
      return { ok: errors.length === 0, checks, errors, capabilities: cached };
    },
  };

  return backend;
}

export { rawRequest as s3RawRequest };
