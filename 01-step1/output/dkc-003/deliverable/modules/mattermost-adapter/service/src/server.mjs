import { createServer } from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import { GovernanceUnavailable } from "./pdp-client.mjs";
import { AuthError } from "./auth.mjs";

const MAX_BODY_BYTES = 256 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = "";
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body for stor"));
        req.destroy();
        return;
      }
      raw += c;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`ugyldig JSON: ${err.message}`));
      }
    });
    req.on("error", reject);
  });
}

function emailOf(identifiers = []) {
  return identifiers.find((i) => i.type === "email")?.value ?? null;
}

/**
 * Referenceadapter B. Wrapper Mattermost uændret og erklærer ærligt, hvad der
 * ikke kan lade sig gøre. Nøglepunktet er subject.erase: vi kan slette brugerens
 * opslag gennem API'et, men ikke fra backups, søgeindeks eller revisionsspor.
 * Det er en 'partial' — ikke en fejl og ikke en løgn.
 */
function authContext(req) {
  let peerCertificate = null;
  try {
    const cert = req.socket?.getPeerCertificate?.();
    if (cert && Object.keys(cert).length > 0) peerCertificate = cert;
  } catch {
    peerCertificate = null;
  }
  return { peerCertificate, remoteAddress: req.socket?.remoteAddress ?? null };
}

export function createMattermostAdapter({
  authenticate,
  pdp,
  client,
  serviceName = "mattermost-adapter",
  version = "1.0.0",
  environment = "dev",
  source = "urn:platform:module:mattermost-adapter",
  onAudit = () => {},
  onEvent = () => {},
} = {}) {
  if (!authenticate) throw new Error("kræver authenticate");
  if (!pdp) throw new Error("kræver pdp");
  if (!client) throw new Error("kræver client");
  const authenticateFn = typeof authenticate === "function" ? authenticate : authenticate.authenticate.bind(authenticate);

  function respond(res, code, body) {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }

  function emit(verb, principal, tenantId, decision, dataCategory) {
    const event = {
      specversion: "1.0",
      id: randomUUID(),
      source,
      type: `dk.platform.mattermost-adapter.${verb.replace(/\./g, "-")}.completed`,
      time: new Date().toISOString(),
      datacontenttype: "application/json",
      tenantid: tenantId,
      traceid: randomBytes(16).toString("hex"),
      spanid: randomBytes(8).toString("hex"),
      principal,
      dataclassification: dataCategory,
      data: { verb, decision },
    };
    onEvent(event);
    onAudit({ type: `${verb}.completed`, verb, principal, tenantId, payload: { decision } });
    return event;
  }

  async function guarded(req, res, verb, handler) {
    let principal;
    try {
      principal = await authenticateFn(req.headers.authorization, req.headers, authContext(req));
    } catch (err) {
      return respond(res, 401, { error: err.message });
    }
    let body = {};
    if (req.method !== "GET") {
      try {
        body = await readBody(req);
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
    }
    const tenantId = body.tenantId ?? principal.tenantId ?? null;
    const input = {
      principal: { kind: principal.kind, id: principal.id, ...(principal.spiffeId ? { spiffeId: principal.spiffeId } : {}) },
      action: { verb, target: body.target ?? serviceName, environment: body.environment ?? environment },
      context: { tenantId, evidence: body.evidence ?? [] },
    };

    let decision;
    try {
      decision = await pdp.decide(input);
    } catch (err) {
      if (err instanceof GovernanceUnavailable) {
        onAudit({ type: "governance.unavailable", verb, principal, tenantId, payload: { reason: err.message } });
        return respond(res, 503, { error: "governance unavailable", failMode: "closed", detail: err.message });
      }
      throw err;
    }
    if (decision.decision === "deny") {
      onAudit({ type: "policy.denied", verb, principal, tenantId, payload: { decision } });
      return respond(res, 403, { error: "denied", decision });
    }
    if (decision.decision === "allow-with-approval") {
      const approvals = Array.isArray(body.approvals) ? body.approvals : [];
      if (approvals.length < decision.requiredApprovals) {
        return respond(res, 428, { error: "approval required", requiredApprovals: decision.requiredApprovals });
      }
    }
    const missingEvidence = (decision.requiredEvidence ?? []).filter((e) => e !== "policy-allow" && !(body.evidence ?? []).includes(e));
    if (missingEvidence.length) return respond(res, 428, { error: "missing evidence", missingEvidence });

    try {
      const result = await handler({ body, principal, tenantId });
      const event = emit(verb, { kind: principal.kind, id: principal.id }, tenantId, decision.decision, verb.startsWith("subject.") ? "personal" : "operational");
      return respond(res, 200, { verb, decision: decision.decision, result, traceId: event.traceid });
    } catch (err) {
      return respond(res, 502, { error: "upstream error", detail: err.message });
    }
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const { method, pathname } = { method: req.method, pathname: url.pathname };

    if (method === "GET" && pathname === "/healthz") {
      return client
        .ping()
        .then(() => respond(res, 200, { status: "ok", service: serviceName, version, upstream: "mattermost" }))
        .catch((err) => respond(res, 503, { status: "unavailable", detail: err.message }));
    }

    if (method === "POST" && pathname === "/v1/privacy/locate") {
      return guarded(req, res, "subject.locate", async ({ body, tenantId }) => {
        const email = emailOf(body.identifiers);
        if (!email) return { count: 0, matches: [] };
        const user = await client.getUserByEmail(email);
        const posts = await client.getPostsForUser(user.id);
        return { count: posts.order.length, matches: [{ subjectId: user.id, posts: posts.order.length, tenantId }] };
      });
    }

    if (method === "POST" && pathname === "/v1/privacy/export") {
      return guarded(req, res, "subject.export", async ({ body }) => {
        const email = emailOf(body.identifiers);
        if (!email) return { count: 0, records: [], artifactRef: null };
        const user = await client.getUserByEmail(email);
        const posts = await client.getPostsForUser(user.id);
        const records = posts.order.map((id) => ({ id, message: posts.posts[id]?.message ?? "" }));
        return { count: records.length, records, artifactRef: `s3://evidence/dsar/mattermost/${user.id}.json` };
      });
    }

    if (method === "POST" && pathname === "/v1/privacy/erase") {
      return guarded(req, res, "subject.erase", async ({ body }) => {
        const email = emailOf(body.identifiers);
        if (!email) return { recordsAffected: 0, partial: true };
        const user = await client.getUserByEmail(email);
        const posts = await client.getPostsForUser(user.id);
        let deleted = 0;
        for (const id of posts.order) {
          await client.deletePost(id);
          deleted += 1;
        }
        // Ærlig begrænsning: API'et sletter opslaget, men ikke kopier i backups,
        // søgeindeks eller revisionsspor. Derfor partial, ikke full.
        return {
          recordsAffected: deleted,
          partial: true,
          note: "Opslag slettet via Mattermost API. Kopier i backups, søgeindeks og revisionsspor er ikke fjernet og skal håndteres af upstream-drift.",
        };
      });
    }

    return respond(res, 404, { error: "not found" });
  });

  return {
    server,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
