import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { SHARE_TYPES, PERMISSIONS } from "./constants.mjs";

/**
 * Testdobbel for Nextclouds fil-, delings-, kalender- og bruger-API'er.
 *
 * Den er bevidst minimal og implementerer kun de kald adapteren bruger. Den
 * holder rigtig tilstand (brugere, grupper, filer, delinger, sessioner og
 * kalendere), så et delings-/offboarding-forløb kan efterprøves uden en rigtig
 * Nextcloud-installation. Den er ikke en sikkerhedsmodel: autentificering sker
 * med én service-token, og adgangskontrollen ligger i adapterens domænelag.
 */
export function createMockNextcloud({
  token = "test-token",
  users = [
    { id: "anna", email: "anna@acme.example", displayName: "Anna Andersen", groups: ["acme"] },
    { id: "bo", email: "bo@acme.example", displayName: "Bo Bertelsen", groups: ["acme"] },
    { id: "carla", email: "carla@acme.example", displayName: "Carla Christensen", groups: ["acme"] },
    { id: "gus", email: "gus@partner.example", displayName: "Gus Gæst", groups: [], guest: true },
  ],
  files = [
    { owner: "anna", path: "/projekt/plan.docx", content: "version-1" },
    { owner: "anna", path: "/projekt/budget.xlsx", content: "tal-1" },
    { owner: "bo", path: "/noter.txt", content: "hemmeligt" },
  ],
  version = "30.0.0",
  edition = "Enterprise",
  office = { product: "ONLYOFFICE", version: "8.1.0", formats: ["docx", "xlsx", "pptx", "odt", "ods", "odp", "pdf", "txt", "csv"] },
} = {}) {
  const userStore = new Map(users.map((u) => [u.id, { enabled: true, guest: false, guestState: u.guest ? "active" : null, ...u, groups: [...(u.groups ?? [])] }]));
  const groupStore = new Map();
  for (const u of userStore.values()) {
    for (const g of u.groups) {
      if (!groupStore.has(g)) groupStore.set(g, new Set());
      groupStore.get(g).add(u.id);
    }
  }
  const fileStore = new Map(files.map((f) => [`${f.owner}:${f.path}`, { ...f, mtime: 1, versions: [{ content: f.content, at: 1 }] }]));
  const shareStore = new Map();
  const sessionStore = new Map();
  for (const u of userStore.keys()) sessionStore.set(u, [{ id: `sess-${u}-1`, createdAt: 1 }]);
  const calendarStore = new Map();
  for (const u of userStore.keys()) calendarStore.set(`${u}:personal`, { displayName: "Personal", events: [] });
  let shareCounter = 100;

  const key = (owner, path) => `${owner}:${path.startsWith("/") ? path : `/${path}`}`;
  const now = () => Math.floor(Date.now() / 1000);
  const day = 86400;

  function ocsEnvelope(data) {
    return { ocs: { meta: { status: "ok", statuscode: 200, message: "OK" }, data } };
  }

  function shareRecord({ id, shareType, shareWith, owner, path, permissions, token: linkToken, password, expiration }) {
    return {
      id,
      share_type: shareType,
      share_with: shareWith ?? null,
      uid_owner: owner,
      uid_file_owner: owner,
      displayname_owner: userStore.get(owner)?.displayName ?? owner,
      path,
      item_source: key(owner, path),
      item_type: "file",
      permissions,
      token: linkToken ?? null,
      password: password ?? null,
      expiration: expiration ?? null,
      stime: now(),
    };
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const json = (code, body, headers = {}) => {
      res.writeHead(code, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    const ok = (data) => json(200, ocsEnvelope(data));

    if (req.headers.authorization !== `Bearer ${token}`) return json(401, { message: "unauthorized" });

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

      if (req.method === "GET" && pathname === "/status.php") {
        return json(200, {
          installed: true,
          maintenance: false,
          needsDbUpgrade: false,
          version: version,
          versionstring: `${version} (${edition})`,
          edition,
          productname: "Nextcloud",
        });
      }

      if (req.method === "GET" && pathname === "/ocs/v2.php/cloud/capabilities") {
        return ok({
          version: { major: Number(version.split(".")[0]), minor: Number(version.split(".")[1]), micro: Number(version.split(".")[2]), string: version, edition },
          capabilities: {
            files_sharing: { api_enabled: true, public: { enabled: true, password: { enforced: false } }, resharing: true },
            richdocuments: { product: office.product, version: office.version, formats: office.formats },
            theming: { name: "Acme" },
          },
        });
      }

      if (req.method === "GET" && pathname === "/ocs/v2.php/apps/serverinfo/api/v1/info") {
        return ok({ nextcloud: { system: { version, edition }, storage: { num_files: fileStore.size } } });
      }

      // --- Brugere ---------------------------------------------------------
      const userSessions = pathname.match(/^\/ocs\/v2\.php\/cloud\/users\/([^/]+)\/sessions$/);
      if (userSessions) {
        const id = decodeURIComponent(userSessions[1]);
        if (req.method === "GET") return ok({ sessions: sessionStore.get(id) ?? [] });
        if (req.method === "DELETE") {
          const count = (sessionStore.get(id) ?? []).length;
          sessionStore.set(id, []);
          return ok({ closed: count });
        }
      }
      const userGroups = pathname.match(/^\/ocs\/v2\.php\/cloud\/users\/([^/]+)\/groups$/);
      if (req.method === "POST" && userGroups) {
        const id = decodeURIComponent(userGroups[1]);
        const group = body.groupid;
        userStore.get(id).groups.push(group);
        if (!groupStore.has(group)) groupStore.set(group, new Set());
        groupStore.get(group).add(id);
        return ok({});
      }
      const userAction = pathname.match(/^\/ocs\/v2\.php\/cloud\/users\/([^/]+)(?:\/(disable|enable))?$/);
      if (userAction && pathname.startsWith("/ocs/v2.php/cloud/users/")) {
        const id = decodeURIComponent(userAction[1]);
        const action = userAction[2];
        if (req.method === "GET") {
          const u = userStore.get(id) ?? [...userStore.values()].find((x) => x.email === id);
          return u ? ok({ id: u.id, email: u.email, displayName: u.displayName, enabled: u.enabled, groups: u.groups, isGuest: u.guest, guestState: u.guestState }) : json(404, { message: "user not found" });
        }
        if (req.method === "PUT" && action) {
          const u = userStore.get(id);
          if (!u) return json(404, { message: "user not found" });
          u.enabled = action === "enable";
          if (u.guest && !u.enabled) u.guestState = "suspended";
          return ok({});
        }
        if (req.method === "DELETE") {
          if (!userStore.has(id)) return json(404, { message: "user not found" });
          userStore.delete(id);
          sessionStore.delete(id);
          for (const [k, f] of fileStore) if (f.owner === id) fileStore.delete(k);
          for (const [sid, s] of shareStore) if (s.uid_owner === id || s.share_with === id) shareStore.delete(sid);
          return ok({});
        }
      }
      if (req.method === "POST" && pathname === "/ocs/v2.php/cloud/users") {
        const id = body.userid;
        if (!id) return json(400, { message: "userid mangler" });
        if (userStore.has(id)) return json(409, { message: "user findes" });
        userStore.set(id, { id, email: body.email ?? null, displayName: body.displayName ?? id, enabled: true, groups: body.groups ?? [], guest: Boolean(body.isGuest), guestState: body.isGuest ? "active" : null });
        sessionStore.set(id, [{ id: `sess-${id}-1`, createdAt: now() }]);
        for (const g of body.groups ?? []) {
          if (!groupStore.has(g)) groupStore.set(g, new Set());
          groupStore.get(g).add(id);
        }
        return ok({ id });
      }

      // --- Delinger --------------------------------------------------------
      if (pathname === "/ocs/v2.php/apps/files_sharing/api/v1/shares") {
        if (req.method === "GET") {
          const filterPath = url.searchParams.get("path");
          const all = [...shareStore.values()];
          const selected = filterPath ? all.filter((s) => s.path === filterPath) : all;
          return ok(selected);
        }
        if (req.method === "POST") {
          const owner = body.owner;
          const path = body.path;
          if (!owner || !path) return json(400, { message: "owner/path mangler" });
          if (!fileStore.has(key(owner, path))) return json(404, { message: "fil findes ikke" });
          const shareType = Number(body.shareType ?? SHARE_TYPES.USER);
          const permissions = Number(body.permissions ?? PERMISSIONS.READ);
          if ((shareType === SHARE_TYPES.USER || shareType === SHARE_TYPES.EXTERNAL_GUEST) && !userStore.has(body.shareWith)) {
            return json(404, { message: `modtager '${body.shareWith}' findes ikke` });
          }
          if (shareType === SHARE_TYPES.GROUP && !groupStore.has(body.shareWith)) {
            return json(404, { message: `gruppe '${body.shareWith}' findes ikke` });
          }
          const id = String(shareCounter++);
          const record = shareRecord({
            id,
            shareType,
            shareWith: body.shareWith,
            owner,
            path,
            permissions,
            token: shareType === SHARE_TYPES.PUBLIC_LINK ? randomUUID().replace(/-/g, "") : null,
            password: body.password,
            expiration: body.expireDate,
          });
          shareStore.set(id, record);
          return ok(record);
        }
      }
      const shareById = pathname.match(/^\/ocs\/v2\.php\/apps\/files_sharing\/api\/v1\/shares\/([^/]+)$/);
      if (shareById) {
        const id = decodeURIComponent(shareById[1]);
        const share = shareStore.get(id);
        if (!share) return json(404, { message: "deling findes ikke" });
        if (req.method === "GET") return ok(share);
        if (req.method === "PUT") {
          Object.assign(share, {
            ...(body.permissions !== undefined ? { permissions: Number(body.permissions) } : {}),
            ...(body.expireDate !== undefined ? { expiration: body.expireDate } : {}),
            ...(body.password !== undefined ? { password: body.password } : {}),
          });
          return ok(share);
        }
        if (req.method === "DELETE") {
          shareStore.delete(id);
          return ok({});
        }
      }

      // --- Filer (WebDAV, JSON) -------------------------------------------
      const fileRoot = pathname.match(/^\/remote\.php\/dav\/files\/([^/]+)\/?$/);
      if (req.method === "GET" && fileRoot) {
        const user = decodeURIComponent(fileRoot[1]);
        const own = [...fileStore.values()].filter((f) => f.owner === user);
        return json(200, { files: own.map((f) => ({ path: f.path, content: f.content, mtime: f.mtime, versions: f.versions.length })) });
      }
      const filePath = pathname.match(/^\/remote\.php\/dav\/files\/([^/]+)\/(.+)$/);
      if (filePath) {
        const user = decodeURIComponent(filePath[1]);
        const path = `/${filePath[2]}`;
        const file = fileStore.get(key(user, path));
        if (req.method === "GET") {
          if (!file) return json(404, { message: "fil findes ikke" });
          return json(200, { path: file.path, content: file.content, mtime: file.mtime, versions: file.versions.length });
        }
        if (req.method === "PUT") {
          const existing = fileStore.get(key(user, path));
          const content = typeof body === "string" ? body : JSON.stringify(body);
          if (existing) {
            existing.content = content;
            existing.mtime = now();
            existing.versions.push({ content, at: now() });
          } else {
            fileStore.set(key(user, path), { owner: user, path, content, mtime: now(), versions: [{ content, at: now() }] });
          }
          return json(200, { path, mtime: now(), versions: fileStore.get(key(user, path)).versions.length });
        }
        if (req.method === "DELETE") {
          const existing = fileStore.get(key(user, path));
          if (!existing) return json(404, { message: "fil findes ikke" });
          fileStore.delete(key(user, path));
          for (const [sid, s] of shareStore) if (s.uid_owner === user && s.path === path) shareStore.delete(sid);
          return json(200, { deleted: true });
        }
      }

      // --- Kalender (CalDAV, JSON) ----------------------------------------
      const calRoot = pathname.match(/^\/remote\.php\/dav\/calendars\/([^/]+)\/?$/);
      if (req.method === "GET" && calRoot) {
        const user = decodeURIComponent(calRoot[1]);
        const cals = [...calendarStore.entries()].filter(([k]) => k.startsWith(`${user}:`)).map(([k, v]) => ({ name: k.split(":")[1], displayName: v.displayName, events: v.events.length }));
        return json(200, { calendars: cals });
      }
      const calEvents = pathname.match(/^\/remote\.php\/dav\/calendars\/([^/]+)\/([^/]+)\/?$/);
      if (calEvents) {
        const user = decodeURIComponent(calEvents[1]);
        const cal = decodeURIComponent(calEvents[2]);
        const entry = calendarStore.get(`${user}:${cal}`);
        if (!entry) return json(404, { message: "kalender findes ikke" });
        if (req.method === "GET") return json(200, { calendar: cal, events: entry.events });
        if (req.method === "POST") {
          const event = body && typeof body === "object" ? body : { summary: String(body) };
          const record = { id: `evt-${entry.events.length + 1}`, ...event, createdAt: now() };
          entry.events.push(record);
          return json(201, record);
        }
      }

      return json(404, { message: "not found" });
    }
  });

  return {
    server,
    users: userStore,
    groups: groupStore,
    files: fileStore,
    shares: shareStore,
    sessions: sessionStore,
    calendars: calendarStore,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
