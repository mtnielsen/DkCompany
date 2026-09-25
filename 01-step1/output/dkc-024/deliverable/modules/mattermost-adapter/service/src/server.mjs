import { createServer } from "node:http";
import { createAdapterSdk } from "../../../../adapter-sdk/src/sdk.mjs";

/**
 * Referenceadapter B — nu bygget på den fælles adapter-SDK (DKC-023).
 *
 * Adapteren wrapper Mattermost uændret og erklærer ærligt, hvad der ikke kan
 * lade sig gøre. SDK'en ejer auth, tenant-udledning, fail-closed PDP, audit,
 * idempotens, health og versionsforhandling, så denne fil alene beskriver
 * oversættelsen fra platformens verber til Mattermosts API.
 *
 * Nøglepunktet er subject.erase: vi kan slette brugerens opslag gennem API'et,
 * men ikke fra backups, søgeindeks eller revisionsspor. Det er en 'partial' —
 * ikke en fejl og ikke en løgn.
 */
function emailOf(identifiers = []) {
  return identifiers.find((i) => i.type === "email")?.value ?? null;
}

export function createMattermostAdapter({
  authenticate,
  pdp,
  client,
  idempotency = null,
  upstream = null,
  serviceName = "mattermost-adapter",
  version = "1.0.0",
  environment = "dev",
  profile = "production",
  source = "urn:platform:module:mattermost-adapter",
  onAudit = () => {},
  onEvent = () => {},
} = {}) {
  if (!client) throw new Error("kræver client");

  const sdk = createAdapterSdk({
    serviceName,
    version,
    environment,
    profile,
    source,
    authenticate,
    pdp,
    idempotency,
    upstream: upstream ?? { name: "mattermost", ping: () => client.ping() },
    onAudit,
    onEvent,
    replayable: (verb) => verb !== "subject.erase",
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const { method, pathname } = { method: req.method, pathname: url.pathname };

    if (method === "GET" && pathname === "/healthz") {
      return sdk.health().then(({ code, body }) => sdk.respond(res, code, body));
    }

    if (method === "POST" && pathname === "/v1/privacy/locate") {
      return sdk.guard(req, res, "subject.locate", async ({ body, tenantId }) => {
        const email = emailOf(body.identifiers);
        if (!email) return { count: 0, matches: [] };
        const user = await client.getUserByEmail(email);
        const posts = await client.getPostsForUser(user.id);
        return { count: posts.order.length, matches: [{ subjectId: user.id, posts: posts.order.length, tenantId }] };
      });
    }

    if (method === "POST" && pathname === "/v1/privacy/export") {
      return sdk.guard(req, res, "subject.export", async ({ body }) => {
        const email = emailOf(body.identifiers);
        if (!email) return { count: 0, records: [], artifactRef: null };
        const user = await client.getUserByEmail(email);
        const posts = await client.getPostsForUser(user.id);
        const records = posts.order.map((id) => ({ id, message: posts.posts[id]?.message ?? "" }));
        return { count: records.length, records, artifactRef: `s3://evidence/dsar/mattermost/${user.id}.json` };
      });
    }

    if (method === "POST" && pathname === "/v1/privacy/erase") {
      return sdk.guard(req, res, "subject.erase", async ({ body }) => {
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

    return sdk.respond(res, 404, { error: "not found" });
  });

  return {
    server,
    sdk,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
