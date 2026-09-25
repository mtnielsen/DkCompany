/**
 * Tynd klient mod GLPI's REST-API.
 *
 * Adapteren ændrer intet ved upstream; den oversætter platformens serviceproces
 * til GLPI's API. De normaliserede sagsrecords læses/skrives gennem den lille
 * GLPI-plugin-itemtype `PluginItsmAdapterItsmRecord`, som adapter-pakken
 * registrerer. Dermed bevares GLPI's egne felter og arbejdsgange for mennesker,
 * mens platformen får en stabil kontrakt.
 *
 * Klienten bevarer upstream-status og Retry-After, så adapter-SDK'en kan mappe
 * 429/5xx korrekt i stedet for et generisk 502.
 */
import { RECORD_KINDS } from "./constants.mjs";

const ITEM_TYPE = "PluginItsmAdapterItsmRecord";

export function createGlpiClient({ baseUrl, appToken, userToken, fetchImpl = globalThis.fetch } = {}) {
  if (!baseUrl) throw new Error("createGlpiClient kræver baseUrl");
  if (!appToken) throw new Error("createGlpiClient kræver appToken");
  let sessionToken = null;

  async function raw(path, { method = "GET", body, headers = {}, withSession = true } = {}) {
    const init = {
      method,
      headers: {
        "App-Token": appToken,
        ...(withSession && sessionToken ? { "Session-Token": sessionToken } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetchImpl(`${baseUrl}${path}`, init);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const err = new Error(`GLPI ${method} ${path} -> HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
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

  async function ensureSession() {
    if (sessionToken) return sessionToken;
    const result = await raw("/apirest.php/initSession", {
      method: "POST",
      withSession: false,
      headers: { Authorization: `user_token ${userToken}` },
    });
    sessionToken = result?.session_token ?? result?.session ?? null;
    if (!sessionToken) throw new Error("GLPI svarede uden session_token");
    return sessionToken;
  }

  async function listRecords({ kind = null, tenantId = null } = {}) {
    await ensureSession();
    const q = [];
    if (kind) q.push(`kind=${encodeURIComponent(kind)}`);
    if (tenantId) q.push(`tenantId=${encodeURIComponent(tenantId)}`);
    const suffix = q.length ? `?${q.join("&")}` : "";
    const result = await raw(`/apirest.php/${ITEM_TYPE}${suffix}`);
    const data = result?.data ?? result ?? [];
    return Array.isArray(data) ? data : [];
  }

  return {
    itemType: ITEM_TYPE,
    ping: () => raw("/apirest.php/", { withSession: false }),
    serverInfo: async () => {
      await ensureSession();
      return raw("/apirest.php/getGlpiConfig");
    },
    ensureSession,
    listRecords,
    getRecord: async (id) => {
      await ensureSession();
      try {
        const result = await raw(`/apirest.php/${ITEM_TYPE}/${encodeURIComponent(id)}`);
        return result?.data ?? result ?? null;
      } catch (err) {
        if (err.status === 404) return null;
        throw err;
      }
    },
    createRecord: async (record) => {
      await ensureSession();
      if (!RECORD_KINDS.includes(record.recordKind)) throw new Error(`ukendt recordKind '${record.recordKind}'`);
      const result = await raw(`/apirest.php/${ITEM_TYPE}`, { method: "POST", body: { input: record } });
      return result?.id ? { ...record, id: String(result.id) } : record;
    },
    updateRecord: async (id, record) => {
      await ensureSession();
      const result = await raw(`/apirest.php/${ITEM_TYPE}/${encodeURIComponent(id)}`, { method: "PUT", body: { input: record } });
      return result ?? record;
    },
    listKnowledgeArticles: async (serviceId) => {
      await ensureSession();
      const suffix = serviceId ? `?serviceId=${encodeURIComponent(serviceId)}` : "";
      const result = await raw(`/apirest.php/KnowbaseItem${suffix}`);
      return result?.data ?? result ?? [];
    },
  };
}
