/**
 * DKC-057 — protokolfast S3-testdobbelt.
 *
 * Serveren taler S3-REST mod path-style addressing og **verificerer** klientens
 * AWS SigV4-signatur ved at genskabe den kanoniske anmodning. Dermed efterprøves
 * signeringskoden, ikke blot at der sendes en Authorization-header. Den kan
 * simulere credential-, plads- og retention-fejl samt object-lock/versioning.
 */
import { createHash, createHmac } from "node:crypto";
import http from "node:http";
import https from "node:https";

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}
function hmac(key, value) {
  return createHmac("sha256", key).update(value).digest();
}
function encodeRfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQueryFromUrl(search) {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const pairs = [...params.entries()].map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

function verifySigV4(req, body, credentials) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("AWS4-HMAC-SHA256 ")) return { ok: false, reason: "missing_authorization" };
  const parts = Object.fromEntries(
    header
      .slice("AWS4-HMAC-SHA256 ".length)
      .split(",")
      .map((p) => p.trim().split("="))
      .map(([k, ...rest]) => [k, rest.join("=")])
  );
  const credential = parts.Credential ?? "";
  const [accessKeyId, date, region, service] = credential.split("/");
  if (accessKeyId !== credentials.accessKeyId) return { ok: false, reason: "unknown_access_key" };
  const signedHeaders = (parts.SignedHeaders ?? "").split(";").filter(Boolean);
  const providedSignature = parts.Signature ?? "";
  const amzDate = req.headers["x-amz-date"];
  const payloadHash = req.headers["x-amz-content-sha256"];
  if (!amzDate || !payloadHash) return { ok: false, reason: "missing_amz_headers" };
  if (payloadHash !== sha256Hex(body)) return { ok: false, reason: "payload_hash_mismatch" };

  const canonicalHeaders = signedHeaders
    .map((name) => {
      const value = name === "host" ? req.headers.host : (req.headers[name] ?? "");
      return `${name}:${String(value).trim().replace(/\s+/g, " ")}\n`;
    })
    .join("");
  const path = req.url.split("?")[0];
  const canonicalRequest = [req.method, path, canonicalQueryFromUrl(req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""), canonicalHeaders, signedHeaders.join(";"), payloadHash].join("\n");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, date), region), service), "aws4_request");
  const expected = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  if (expected !== providedSignature) return { ok: false, reason: "signature_mismatch" };
  return { ok: true };
}

function xmlEscape(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function createMockS3(options = {}) {
  const credentials = options.credentials ?? { accessKeyId: "TESTKEY", secretAccessKey: "TESTSECRET" };
  const bucket = options.bucket ?? "platform-backups";
  const objectLock = options.objectLock ?? false;
  const objectLockMode = options.objectLockMode ?? "COMPLIANCE";
  const objectLockDays = options.objectLockDays ?? 90;
  const versioning = options.versioning ?? true;
  const store = new Map();
  let failure = null;
  const requests = [];

  const handler = (req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: req.method, url: req.url, signed: Boolean(req.headers.authorization) });
      const send = (status, payload = "", headers = {}) => {
        res.writeHead(status, { "content-type": "application/xml", ...headers });
        res.end(payload);
      };
      if (failure === "credentials") return send(403, "<Error><Code>AccessDenied</Code></Error>");
      const verification = verifySigV4(req, body, credentials);
      if (!verification.ok) return send(403, `<Error><Code>SignatureDoesNotMatch</Code><Message>${verification.reason}</Message></Error>`);
      if (failure === "space" && req.method === "PUT") return send(507, "<Error><Code>InsufficientStorage</Code></Error>");

      const [pathOnly] = req.url.split("?");
      const segments = pathOnly.replace(/^\//, "").split("/");
      const reqBucket = segments.shift();
      const key = segments.join("/");

      if (reqBucket !== bucket) return send(404, "<Error><Code>NoSuchBucket</Code></Error>");

      if (!key) {
        if (req.method === "HEAD") return send(200, "", { "x-amz-bucket-region": options.region ?? "eu-west-1" });
        if (req.url.includes("versioning")) {
          return send(200, `<VersioningConfiguration><Status>${versioning ? "Enabled" : "Suspended"}</Status></VersioningConfiguration>`);
        }
        if (req.url.includes("object-lock")) {
          if (!objectLock) return send(404, "<Error><Code>ObjectLockConfigurationNotFoundError</Code></Error>");
          return send(200, `<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled><Rule><DefaultRetention><Mode>${objectLockMode}</Mode><Days>${objectLockDays}</Days></DefaultRetention></Rule></ObjectLockConfiguration>`);
        }
        if (req.url.includes("list-type=2")) {
          const params = new URLSearchParams(req.url.slice(req.url.indexOf("?") + 1));
          const prefix = params.get("prefix") ?? "";
          const contents = [...store.entries()]
            .filter(([k]) => k.startsWith(prefix))
            .map(([k, v]) => `<Contents><Key>${xmlEscape(k)}</Key><Size>${v.length}</Size></Contents>`)
            .join("");
          return send(200, `<ListBucketResult><Name>${bucket}</Name>${contents}</ListBucketResult>`);
        }
        return send(400, "<Error><Code>BadRequest</Code></Error>");
      }

      if (req.method === "PUT") {
        store.set(key, body);
        return send(200, "", { etag: `"${sha256Hex(body).slice(0, 32)}"` });
      }
      if (req.method === "GET") {
        if (!store.has(key)) return send(404, "<Error><Code>NoSuchKey</Code></Error>");
        res.writeHead(200, { "content-length": String(store.get(key).length) });
        return res.end(store.get(key));
      }
      if (req.method === "HEAD") {
        if (!store.has(key)) return send(404, "");
        return send(200, "", { "content-length": String(store.get(key).length), etag: `"${sha256Hex(store.get(key)).slice(0, 32)}"` });
      }
      if (req.method === "DELETE") {
        if (objectLock) return send(409, "<Error><Code>AccessDenied</Code><Message>object lock</Message></Error>");
        store.delete(key);
        return send(204, "");
      }
      return send(405, "<Error><Code>MethodNotAllowed</Code></Error>");
    });
  };
  const server = options.tls ? https.createServer({ key: options.tls.key, cert: options.tls.cert }, handler) : http.createServer(handler);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    url: `${options.tls ? "https" : "http"}://127.0.0.1:${port}`,
    port,
    bucket,
    store,
    requests,
    setFailure: (mode) => {
      failure = mode;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
