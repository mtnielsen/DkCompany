/**
 * Tynd klient mod Mattermost REST API v4. Adapteren ændrer intet ved upstream;
 * den oversætter platformens verber til de kald, Mattermost faktisk tilbyder.
 */
export function createMattermostClient({ baseUrl, token, fetchImpl = globalThis.fetch }) {
  async function api(path, { method = "GET", body } = {}) {
    const res = await fetchImpl(`${baseUrl}/api/v4${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const err = new Error(`Mattermost ${method} ${path} -> HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
      // Bevar upstream-status og Retry-After, så adapter-SDK'en kan mappe 429
      // og 5xx korrekt i stedet for at svare et generisk 502.
      err.status = res.status;
      const retry = typeof res.headers?.get === "function" ? res.headers.get("retry-after") : null;
      if (retry) err.retryAfterSeconds = Number(retry) || retry;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    ping: () => api("/system/ping"),
    getUserByEmail: (email) => api(`/users/email/${encodeURIComponent(email)}`),
    getPostsForUser: (userId) => api(`/users/${userId}/posts?page=0&per_page=200`),
    deletePost: (postId) => api(`/posts/${postId}`, { method: "DELETE" }),
    getClientConfig: () => api("/config/client"),
  };
}
