/**
 * DKC-029 — testdobbel for Zammads API.
 *
 * Den holder rigtig tilstand (sager, artikler og kunder) pr. tenant, så
 * indgående mail/webformular, kø-routing, AI-udkast, godkendt afsendelse,
 * lukning og retention kan efterprøves uden en levende Zammad-installation.
 * Autentificering sker med én service-token pr. tenant; adgangskontrollen
 * ligger i platformens permissionslag.
 */
import { createServer } from "node:http";

export function createMockZammad({ corpus } = {}) {
  if (!corpus?.tenants) throw new Error("createMockZammad kræver et corpus");
  const tokenToTenant = new Map();
  const tickets = new Map();
  const articles = new Map();
  const idempotency = new Map();
  const counters = new Map();
  for (const [tenant, block] of Object.entries(corpus.tenants)) {
    tokenToTenant.set(block.token, tenant);
    counters.set(tenant, 1000);
  }

  const key = (tenant, id) => `${tenant}:${id}`;
  const listFor = (tenant) => [...tickets.entries()].filter(([k]) => k.startsWith(`${tenant}:`)).map(([, v]) => v);
  const articlesFor = (tenant, ticketId) => [...articles.values()].filter((a) => a.tenant === tenant && String(a.ticket_id) === String(ticketId));

  const server = createServer((req, res) => {
    const token = (req.headers.authorization ?? "").replace(/^Token\s+token=/, "");
    const tenant = tokenToTenant.get(token);
    const json = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const readBody = () =>
      new Promise((resolve) => {
        let raw = "";
        req.on("data", (c) => {
          raw += c;
        });
        req.on("end", () => {
          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch {
            resolve({});
          }
        });
      });

    if (!tenant) return json(401, { error: "ugyldig token" });
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/api/v1/version") return json(200, { version: "6.3.0", edition: "community" });

    if (url.pathname === "/api/v1/tickets" && req.method === "GET") return json(200, listFor(tenant).map((t) => ({ ...t, articles: undefined })));
    if (url.pathname === "/api/v1/tickets" && req.method === "POST") {
      readBody().then((body) => {
        const idem = req.headers["idempotency-key"] ?? null;
        if (idem) {
          const existing = idempotency.get(key(tenant, idem));
          if (existing) return json(200, tickets.get(key(tenant, existing)));
        }
        const next = (counters.get(tenant) ?? 1000) + 1;
        counters.set(tenant, next);
        const id = String(next);
        const now = new Date().toISOString();
        const ticket = {
          id,
          number: `${tenant}-${id}`,
          tenant,
          title: body.title ?? "Sag",
          group: body.group ?? "support",
          state: body.state ?? "new",
          priority: body.priority ?? "2 normal",
          channel: body.channel ?? "email",
          customer: body.customer ?? {},
          created_at: now,
          updated_at: now,
          closed_at: null,
        };
        tickets.set(key(tenant, id), ticket);
        if (idem) idempotency.set(key(tenant, idem), id);
        json(201, ticket);
      });
      return undefined;
    }
    const ticketMatch = url.pathname.match(/^\/api\/v1\/tickets\/([^/]+)$/);
    if (ticketMatch) {
      const id = decodeURIComponent(ticketMatch[1]);
      const ticket = tickets.get(key(tenant, id));
      if (!ticket) return json(404, { error: "sag findes ikke" });
      if (req.method === "GET") return json(200, { ...ticket, articles: articlesFor(tenant, id) });
      if (req.method === "PUT") {
        readBody().then((patch) => {
          Object.assign(ticket, patch);
          ticket.updated_at = new Date().toISOString();
          if ((patch.state ?? ticket.state) === "closed") ticket.closed_at = ticket.updated_at;
          json(200, ticket);
        });
        return undefined;
      }
    }
    if (url.pathname === "/api/v1/ticket_articles" && req.method === "POST") {
      readBody().then((body) => {
        const id = String(articles.size + 1);
        const article = {
          id,
          tenant,
          ticket_id: String(body.ticket_id),
          body: body.body ?? "",
          type: body.type ?? "note",
          to: body.to ?? null,
          subject: body.subject ?? null,
          internal: body.internal === true,
          sender: body.internal ? "agent" : "system",
          created_at: new Date().toISOString(),
        };
        articles.set(key(tenant, id), article);
        json(201, article);
      });
      return undefined;
    }
    if (url.pathname === "/api/v1/ticket_articles" && req.method === "GET") {
      const ticketId = url.searchParams.get("ticket_id");
      return json(200, articlesFor(tenant, ticketId));
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
    getTicket(tenant, id) {
      return tickets.get(key(tenant, id)) ?? null;
    },
    listTenantTickets(tenant) {
      return listFor(tenant);
    },
    articlesFor(tenant, ticketId) {
      return articlesFor(tenant, ticketId);
    },
    setState(tenant, id, state) {
      const ticket = tickets.get(key(tenant, id));
      if (!ticket) throw new Error(`ukendt sag ${tenant}:${id}`);
      ticket.state = state;
      ticket.updated_at = new Date().toISOString();
      if (state === "closed") ticket.closed_at = ticket.updated_at;
    },
  };
}
