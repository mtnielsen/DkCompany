/**
 * DKC-028 — testdobbel for BookStacks read-only API.
 *
 * Den holder rigtig tilstand (sider og deres permissions), så en
 * rettighedsændring og en sletning kan efterprøves uden en levende
 * BookStack-installation. Den er ikke en sikkerhedsmodel: autentificering sker
 * med én service-token pr. tenant, og adgangskontrollen ligger i søgelaget.
 */
import { createServer } from "node:http";

export function createMockBookstack({ corpus } = {}) {
  if (!corpus?.tenants) throw new Error("createMockBookstack kræver et corpus");
  const tokenToTenant = new Map();
  const pages = new Map();
  for (const [tenant, block] of Object.entries(corpus.tenants)) {
    tokenToTenant.set(block.token, tenant);
    for (const page of block.pages) pages.set(`${tenant}:${page.id}`, JSON.parse(JSON.stringify(page)));
  }

  const key = (tenant, id) => `${tenant}:${id}`;
  const listFor = (tenant) => [...pages.entries()].filter(([k]) => k.startsWith(`${tenant}:`)).map(([, v]) => v);

  const server = createServer((req, res) => {
    const token = (req.headers.authorization ?? "").replace(/^Token\s+/, "");
    const tenant = tokenToTenant.get(token);
    const json = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (!tenant) return json(401, { error: "ugyldig token" });
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/docs") return json(200, { docs: true });
    if (url.pathname === "/api/pages" && req.method === "GET") {
      return json(200, { data: listFor(tenant), total: listFor(tenant).length });
    }
    const permMatch = url.pathname.match(/^\/api\/pages\/([^/]+)\/permissions$/);
    if (permMatch && req.method === "GET") {
      const page = pages.get(key(tenant, decodeURIComponent(permMatch[1])));
      if (!page) return json(404, { error: "side findes ikke" });
      return json(200, { permissions: page.permissions, restricted: page.restricted });
    }
    const pageMatch = url.pathname.match(/^\/api\/pages\/([^/]+)$/);
    if (pageMatch && req.method === "GET") {
      const page = pages.get(key(tenant, decodeURIComponent(pageMatch[1])));
      if (!page) return json(404, { error: "side findes ikke" });
      return json(200, page);
    }
    return json(404, { error: "ukendt rute" });
  });

  return {
    server,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
    /** Simulér en upstream-rettighedsændring. */
    setPermissions(tenant, pageId, permissions) {
      const page = pages.get(key(tenant, pageId));
      if (!page) throw new Error(`ukendt side ${tenant}:${pageId}`);
      page.permissions = JSON.parse(JSON.stringify(permissions));
      page.restricted = (permissions.readGroups ?? []).length > 0 || (permissions.readSubjects ?? []).length > 0;
    },
    /** Simulér en upstream-sletning. */
    deletePage(tenant, pageId) {
      const page = pages.get(key(tenant, pageId));
      if (!page) throw new Error(`ukendt side ${tenant}:${pageId}`);
      page.deletedAt = new Date().toISOString();
    },
    getPage(tenant, pageId) {
      return pages.get(key(tenant, pageId)) ?? null;
    },
  };
}
