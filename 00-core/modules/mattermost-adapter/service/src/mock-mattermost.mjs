import { createServer } from "node:http";

/**
 * Testdobbel for Mattermost REST API v4. Bevidst minimal: kun de kald
 * adapteren bruger. Gør det muligt at bevise adapterens adfærd uden en rigtig
 * Mattermost-installation.
 */
export function createMockMattermost({ users = [{ id: "u1", email: "kunde@example.org", username: "kunde" }], posts = [] } = {}) {
  const store = new Map(users.map((u) => [u.email, { ...u }]));
  const wall = posts.length
    ? posts
    : [
        { id: "p1", userId: "u1", message: "hej fra kunden" },
        { id: "p2", userId: "u1", message: "farvel" },
      ];

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const json = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== "Bearer test-token") return json(401, { message: "unauthorized" });

    if (req.method === "GET" && url.pathname === "/api/v4/system/ping") return json(200, { status: "OK" });
    const emailMatch = url.pathname.match(/^\/api\/v4\/users\/email\/(.+)$/);
    if (req.method === "GET" && emailMatch) {
      const user = store.get(decodeURIComponent(emailMatch[1]));
      return user ? json(200, user) : json(404, { message: "user not found" });
    }
    const postsMatch = url.pathname.match(/^\/api\/v4\/users\/([^/]+)\/posts$/);
    if (req.method === "GET" && postsMatch) {
      const mine = wall.filter((p) => p.userId === postsMatch[1]);
      return json(200, { order: mine.map((p) => p.id), posts: Object.fromEntries(mine.map((p) => [p.id, p])) });
    }
    const deleteMatch = url.pathname.match(/^\/api\/v4\/posts\/([^/]+)$/);
    if (req.method === "DELETE" && deleteMatch) {
      const index = wall.findIndex((p) => p.id === deleteMatch[1]);
      if (index === -1) return json(404, { message: "post not found" });
      wall.splice(index, 1);
      return json(200, { status: "OK" });
    }
    return json(404, { message: "not found" });
  });

  return {
    server,
    posts: wall,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
