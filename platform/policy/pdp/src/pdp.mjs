import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { verifyBundleSignature, digestOf } from "./crypto.mjs";
import { evaluate } from "./evaluate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..", "..");
export const defaultBundleDir = join(repoRoot, "policy", "bundles", "platform", "1.0.0");
export const defaultTrustedKeys = join(repoRoot, "policy", "keys", "trusted.json");

export function loadTrustedKeys(path = defaultTrustedKeys) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Indlæs og verificér en bundle. En uverificeret bundle nægtes indlæst. */
export function loadBundle(bundleDir = defaultBundleDir, trustedKeys = loadTrustedKeys()) {
  const bundle = JSON.parse(readFileSync(join(bundleDir, "bundle.json"), "utf8"));
  const sig = JSON.parse(readFileSync(join(bundleDir, "bundle.sig.json"), "utf8"));
  const { ok, digest, errors } = verifyBundleSignature(bundle, sig, trustedKeys);
  if (!ok) {
    throw new Error(`Bundle-signatur ugyldig for ${bundleDir}:\n  - ${errors.join("\n  - ")}`);
  }
  return { bundle, sig, digest };
}

const REQUIRED = {
  "principal.kind": (v) => ["human", "agent", "service"].includes(v),
  "principal.id": (v) => typeof v === "string" && v.length > 0,
  "action.verb": (v) => typeof v === "string" && v.length > 0,
  "action.target": (v) => typeof v === "string" && v.length > 0,
  "action.environment": (v) => ["dev", "staging", "prod"].includes(v),
};

function validateInput(input) {
  const violations = [];
  for (const [path, check] of Object.entries(REQUIRED)) {
    const value = path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), input);
    if (value === undefined) violations.push(`${path} mangler`);
    else if (!check(value)) violations.push(`${path} har ugyldig værdi`);
  }
  if (!input?.context?.evidence?.includes?.("policy-allow")) {
    // policy-allow er ikke et formelt krav for at spørge, men en beslutning
    // skal kunne spores. Vi afviser ikke her; det håndhæves af modulet.
  }
  return violations;
}

/**
 * Opret en kørende PDP. Bundlen verificeres ved load — ikke ved hvert kald —
 * og dens digest følger med hver beslutning.
 */
export function createPdp({ bundleDir = defaultBundleDir, trustedKeysPath = defaultTrustedKeys, pdpName = "platform-pdp", pdpVersion = "1.0.0" } = {}) {
  const trustedKeys = loadTrustedKeys(trustedKeysPath);
  const { bundle, digest } = loadBundle(bundleDir, trustedKeys);

  const decide = (input) => {
    const violations = validateInput(input);
    if (violations.length) {
      const err = new Error("ugyldigt policy-input");
      err.violations = violations;
      throw err;
    }
    return evaluate(input, bundle, { pdpName, pdpVersion });
  };

  const server = createServer((req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/healthz") {
      return send(200, { status: "ok", bundle: { name: bundle.metadata.name, version: bundle.metadata.version, sha256: digest } });
    }
    if (req.method === "GET" && req.url === "/v1/bundle") {
      return send(200, { name: bundle.metadata.name, version: bundle.metadata.version, sha256: digest, policies: bundle.policies.length });
    }
    if (req.method === "POST" && req.url === "/v1/data/platform/ops/decision") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let payload;
        try {
          payload = JSON.parse(body);
        } catch (err) {
          return send(400, { error: `ugyldig JSON: ${err.message}` });
        }
        const input = payload?.input ?? payload;
        try {
          return send(200, { result: decide(input) });
        } catch (err) {
          return send(err.violations ? 422 : 500, { error: err.message, violations: err.violations ?? [] });
        }
      });
      return;
    }
    send(404, { error: "not found" });
  });

  return {
    bundle,
    digest,
    decide,
    server,
    listen(port = 0) {
      return new Promise((resolveListen) => server.listen(port, "127.0.0.1", () => resolveListen(server.address().port)));
    },
    close() {
      return new Promise((resolveClose) => server.close(resolveClose));
    },
  };
}
