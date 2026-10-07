import { createServer } from "node:http";

/**
 * Testdobbel for Keycloak Admin REST API. Bevidst minimal: kun de kald
 * adapteren bruger. Sletter en bruger, men lader event-loggen stå — det er
 * netop den ærlige partial-grænse i subject.erase.
 */
export function createMockKeycloak({
  realm = "platform",
  users = [{ id: "u1", email: "kunde@example.org", username: "kunde", firstName: "Kunde", lastName: "Kunde" }],
  sessions = [{ id: "s1", userId: "u1", ipAddress: "203.0.113.7" }],
  events = [{ id: "e1", userId: "u1", type: "LOGIN" }],
} = {}) {
  const userStore = new Map(users.map((u) => [u.id, { ...u }]));
  const eventLog = events.map((e) => ({ ...e }));
  const sessionStore = sessions.map((s) => ({ ...s }));

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const json = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    // Offentlig realm-info (ping) kræver ingen token.
    if (req.method === "GET" && url.pathname === `/realms/${realm}`) return json(200, { realm, public_key: "test" });
    if (req.headers.authorization !== "Bearer test-token") return json(401, { error: "unauthorized" });

    if (req.method === "GET" && url.pathname === `/admin/realms/${realm}/users`) {
      const email = url.searchParams.get("email");
      const matches = [...userStore.values()].filter((u) => (email ? u.email === email : true));
      return json(200, matches);
    }
    const sessionsMatch = url.pathname.match(new RegExp(`^/admin/realms/${realm}/users/([^/]+)/sessions$`));
    if (req.method === "GET" && sessionsMatch) {
      return json(200, sessionStore.filter((s) => s.userId === sessionsMatch[1]));
    }
    if (req.method === "GET" && url.pathname === `/admin/realms/${realm}/events`) {
      const user = url.searchParams.get("user");
      return json(200, eventLog.filter((e) => !user || e.userId === user));
    }
    const deleteMatch = url.pathname.match(new RegExp(`^/admin/realms/${realm}/users/([^/]+)$`));
    if (req.method === "DELETE" && deleteMatch) {
      if (!userStore.delete(deleteMatch[1])) return json(404, { error: "user not found" });
      return json(204, {});
    }
    return json(404, { error: "not found" });
  });

  return {
    server,
    users: userStore,
    events: eventLog,
    sessions: sessionStore,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
