import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

/**
 * Testdobbel for GLPI's REST-API og den lille `PluginItsmAdapterItsmRecord`-
 * itemtype.
 *
 * Den er bevidst minimal og implementerer kun de kald adapteren bruger. Den
 * holder rigtig tilstand (sager, vidensartikler og konfiguration), så et
 * incident-/problem-/change-forløb kan efterprøves uden en rigtig
 * GLPI-installation. Den er ikke en sikkerhedsmodel: autentificering sker med
 * app-/user-token, og adgangskontrollen ligger i adapterens domænelag.
 */
export function createMockItsm({
  appToken = "test-app-token",
  userToken = "test-user-token",
  version = "10.0.16",
  edition = "Network",
  records = [],
  knowledge = [
    { id: "kb-restart-checkout", title: "Genstart checkout-API", serviceId: "checkout", content: "Rul checkout ud igen og verificér healthcheck." },
    { id: "kb-db-failover", title: "Databasefailover", serviceId: "database", content: "Følg runbook for kontrolleret failover." },
  ],
} = {}) {
  const recordStore = new Map(records.map((r) => [r.id, { ...r }]));
  const sessionStore = new Set();
  let counter = 1000;

  function nextId(recordKind) {
    const prefix = recordKind === "change" ? "CHG" : recordKind === "problem" ? "PRB" : recordKind === "known_error" ? "KNE" : recordKind === "request" ? "REQ" : "INC";
    return `${prefix}-${String(counter++).padStart(6, "0")}`;
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const json = (code, body, headers = {}) => {
      res.writeHead(code, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body = {};
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      handle(url, body);
    });

    function handle(url, body) {
      const { pathname } = url;

      if (req.headers["app-token"] !== appToken) return json(401, { message: "invalid app token" });

      if (req.method === "GET" && pathname === "/apirest.php/") {
        return json(200, {
          installed: true,
          version,
          edition,
          productname: "GLPI",
          session: { mode: "api" },
        });
      }

      if (req.method === "POST" && pathname === "/apirest.php/initSession") {
        if (req.headers.authorization !== `user_token ${userToken}`) return json(401, { message: "invalid user token" });
        const token = randomUUID();
        sessionStore.add(token);
        return json(200, { session_token: token });
      }

      // Alle øvrige kald kræver en gyldig session.
      if (!sessionStore.has(req.headers["session-token"])) return json(401, { message: "session expired" });

      if (req.method === "GET" && pathname === "/apirest.php/getGlpiConfig") {
        return json(200, { name: "GLPI", version, edition, api: "v2.1", itemtype: "PluginItsmAdapterItsmRecord" });
      }

      const itemRoot = pathname === "/apirest.php/PluginItsmAdapterItsmRecord";
      if (itemRoot) {
        if (req.method === "GET") {
          const kind = url.searchParams.get("kind");
          const tenantId = url.searchParams.get("tenantId");
          let data = [...recordStore.values()];
          if (kind) data = data.filter((r) => r.recordKind === kind || (kind === "incident" && r.recordKind === "incident"));
          if (tenantId) data = data.filter((r) => r.tenantId === tenantId);
          return json(200, { data });
        }
        if (req.method === "POST") {
          const record = body?.input;
          if (!record || !record.recordKind) return json(400, { message: "input mangler" });
          const id = record.id ?? nextId(record.recordKind);
          recordStore.set(id, { ...record, id });
          return json(201, { id });
        }
      }
      const itemById = pathname.match(/^\/apirest\.php\/PluginItsmAdapterItsmRecord\/([^/]+)$/);
      if (itemById) {
        const id = decodeURIComponent(itemById[1]);
        const record = recordStore.get(id);
        if (req.method === "GET") return record ? json(200, record) : json(404, { message: "not found" });
        if (req.method === "PUT") {
          const patch = body?.input ?? {};
          const merged = { ...(record ?? {}), ...patch, id };
          recordStore.set(id, merged);
          return json(200, merged);
        }
        if (req.method === "DELETE") {
          recordStore.delete(id);
          return json(200, {});
        }
      }

      if (req.method === "GET" && pathname === "/apirest.php/KnowbaseItem") {
        const serviceId = url.searchParams.get("serviceId");
        const data = serviceId ? knowledge.filter((k) => k.serviceId === serviceId) : knowledge;
        return json(200, { data });
      }

      return json(404, { message: "not found" });
    }
  });

  return {
    server,
    records: recordStore,
    knowledge,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
