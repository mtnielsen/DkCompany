/**
 * Tynd klient mod Keycloak Admin REST API. Adapteren ændrer intet ved upstream;
 * den oversætter platformens privacy-verber til de kald, Keycloak faktisk
 * tilbyder. Authentik har et tilsvarende admin-API; klienten er det eneste,
 * der skal udskiftes.
 */
export function createKeycloakClient({ baseUrl, realm, token, fetchImpl = globalThis.fetch }) {
  async function api(path, { method = "GET" } = {}) {
    const res = await fetchImpl(`${baseUrl}/admin/realms/${realm}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const err = new Error(`Keycloak ${method} ${path} -> HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
      err.status = res.status;
      const retry = typeof res.headers?.get === "function" ? res.headers.get("retry-after") : null;
      if (retry) err.retryAfterSeconds = Number(retry) || retry;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    // Offentlig realm-info. Bruges som ping, så health ikke kræver admin-rettigheder.
    ping: () => fetchImpl(`${baseUrl}/realms/${realm}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
    getUserByEmail: async (email) => {
      const users = await api(`/users?email=${encodeURIComponent(email)}&exact=true`);
      return users[0] ?? null;
    },
    getUserSessions: (userId) => api(`/users/${userId}/sessions`),
    getUserEvents: (userId) => api(`/events?user=${encodeURIComponent(userId)}`),
    deleteUser: (userId) => api(`/users/${userId}`, { method: "DELETE" }),
    getServerInfo: () => api("/../serverinfo").catch(() => ({ systemInfo: { version: "unknown" } })),
  };
}
