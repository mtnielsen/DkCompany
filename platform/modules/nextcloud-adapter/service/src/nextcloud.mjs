/**
 * Tynd klient mod Nextclouds API'er. Adapteren ændrer intet ved upstream; den
 * oversætter platformens arbejdspladsoperationer til de kald, Nextcloud
 * faktisk tilbyder.
 *
 * Klienten bevarer upstream-status og Retry-After, så adapter-SDK'en kan mappe
 * 429/5xx korrekt i stedet for at svare et generisk 502.
 */
export function createNextcloudClient({ baseUrl, token, fetchImpl = globalThis.fetch } = {}) {
  if (!baseUrl) throw new Error("createNextcloudClient kræver baseUrl");

  async function raw(path, { method = "GET", body, headers = {}, contentType = "application/json", rawBody = false } = {}) {
    const init = {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "OCS-APIRequest": "true",
        ...(rawBody ? {} : { "content-type": contentType }),
        ...headers,
      },
    };
    if (body !== undefined) init.body = rawBody ? body : JSON.stringify(body);
    const res = await fetchImpl(`${baseUrl}${path}`, init);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const err = new Error(`Nextcloud ${method} ${path} -> HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
      err.status = res.status;
      const retry = typeof res.headers?.get === "function" ? res.headers.get("retry-after") : null;
      if (retry) err.retryAfterSeconds = Number(retry) || retry;
      throw err;
    }
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  const ocs = (path, options) => raw(`/ocs/v2.php${path}${path.includes("?") ? "&" : "?"}format=json`, options).then((r) => r?.ocs?.data ?? r?.ocs ?? r);
  const dav = (path, options) => raw(`/remote.php/dav${path}`, options);

  return {
    // Sundhed og version
    ping: () => raw("/status.php"),
    serverInfo: () => ocs("/apps/serverinfo/api/v1/info"),
    capabilities: () => ocs("/cloud/capabilities"),

    // Brugere og gæster
    getUser: (userId) => ocs(`/cloud/users/${encodeURIComponent(userId)}`),
    createUser: (body) => ocs("/cloud/users", { method: "POST", body }),
    disableUser: (userId) => ocs(`/cloud/users/${encodeURIComponent(userId)}/disable`, { method: "PUT" }),
    enableUser: (userId) => ocs(`/cloud/users/${encodeURIComponent(userId)}/enable`, { method: "PUT" }),
    deleteUser: (userId) => ocs(`/cloud/users/${encodeURIComponent(userId)}`, { method: "DELETE" }),
    addToGroup: (userId, group) => ocs(`/cloud/users/${encodeURIComponent(userId)}/groups`, { method: "POST", body: { groupid: group } }),

    // Sessioner og app-passwords
    listSessions: (userId) => ocs(`/cloud/users/${encodeURIComponent(userId)}/sessions`),
    killSessions: (userId) => ocs(`/cloud/users/${encodeURIComponent(userId)}/sessions`, { method: "DELETE" }),

    // Filer (WebDAV, JSON-svar fra mock/upstream-adapter)
    listFiles: (userId) => dav(`/files/${encodeURIComponent(userId)}/`),
    readFile: (userId, path) =>
      dav(`/files/${encodeURIComponent(userId)}/${path.replace(/^\//, "")}`, {
        headers: { accept: "application/octet-stream" },
        rawBody: true,
      }),
    writeFile: (userId, path, content) =>
      dav(`/files/${encodeURIComponent(userId)}/${path.replace(/^\//, "")}`, {
        method: "PUT",
        body: content,
        contentType: "application/octet-stream",
        rawBody: true,
      }),
    deleteFile: (userId, path) =>
      dav(`/files/${encodeURIComponent(userId)}/${path.replace(/^\//, "")}`, { method: "DELETE" }),

    // Deling (OCS files_sharing)
    listShares: ({ path = null, reshares = false, subfiles = false } = {}) => {
      const q = [];
      if (path) q.push(`path=${encodeURIComponent(path)}`);
      if (reshares) q.push("reshares=true");
      if (subfiles) q.push("subfiles=true");
      return ocs(`/apps/files_sharing/api/v1/shares${q.length ? `?${q.join("&")}` : ""}`);
    },
    getShare: (id) => ocs(`/apps/files_sharing/api/v1/shares/${encodeURIComponent(id)}`),
    createShare: (body) => ocs("/apps/files_sharing/api/v1/shares", { method: "POST", body }),
    updateShare: (id, body) => ocs(`/apps/files_sharing/api/v1/shares/${encodeURIComponent(id)}`, { method: "PUT", body }),
    deleteShare: (id) => ocs(`/apps/files_sharing/api/v1/shares/${encodeURIComponent(id)}`, { method: "DELETE" }),

    // Kalender (CalDAV)
    listCalendars: (userId) => dav(`/calendars/${encodeURIComponent(userId)}/`),
    listEvents: (userId, calendar) => dav(`/calendars/${encodeURIComponent(userId)}/${encodeURIComponent(calendar)}/`),
    createEvent: (userId, calendar, event) =>
      dav(`/calendars/${encodeURIComponent(userId)}/${encodeURIComponent(calendar)}/`, {
        method: "POST",
        body: event,
      }),
  };
}
