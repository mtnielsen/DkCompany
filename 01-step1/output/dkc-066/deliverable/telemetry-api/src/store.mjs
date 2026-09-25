/**
 * DKC-066 — afgrænset telemetrilager med retention og kardinalitetsgrænse.
 *
 * Drifts-telemetri er best-effort: lageret har en hård kapacitet, en retention
 * og en kardinalitetsgrænse pr. tenant/metrik. Når en grænse nås, droppes
 * hændelsen og tælles — den fortrænger ikke audit, som har sin egen holdbare
 * vej gennem persistence-laget (DKC-009).
 *
 * Lageret kan persistere til en NDJSON-fil, så seneste vindue overlever et
 * collectornedbrud. `query` er tenant-scopet, pagineret og læser kun inden for
 * det aktuelle vindue.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

function cardinalityKey(record) {
  const labels = record.labels ?? record.otel?.attributes ?? {};
  const keys = Object.keys(labels).sort();
  const metric = record.otel?.metric?.name ?? record.payload?.metric ?? record.signal;
  return createHash("sha256").update(`${record.scope?.tenantId}|${record.signal}|${metric}|${keys.join(",")}`).digest("hex").slice(0, 16);
}

function sortKey(record) {
  return `${record.occurredAt}|${record.id}`;
}

function encodeCursor(record) {
  return Buffer.from(sortKey(record), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  return Buffer.from(String(cursor), "base64url").toString("utf8");
}

export function createBoundedStore({ capacity = 10000, retentionSeconds = 86400, maxCardinality = 2000, persistPath = null, clock = () => Date.now() } = {}) {
  const records = [];
  const cardinality = new Map(); // cardinalityKey → Map(metricKey → Set(labelKey))
  let dropped = 0;
  let cardinalityDropped = 0;
  let expired = 0;
  let persistedLines = 0;

  if (persistPath && existsSync(persistPath)) {
    try {
      const lines = readFileSync(persistPath, "utf8").split("\n").filter(Boolean);
      for (const line of lines.slice(-capacity)) {
        try {
          records.push(JSON.parse(line));
        } catch {
          /* spring korrupte linjer over */
        }
      }
      persistedLines = lines.length;
    } catch {
      /* en korrupt spilfil er ikke fatal */
    }
  }

  function persist(record) {
    if (!persistPath) return;
    mkdirSync(dirname(persistPath), { recursive: true });
    appendFileSync(persistPath, JSON.stringify(record) + "\n");
    persistedLines += 1;
    if (persistedLines > capacity * 2) {
      const tmp = `${persistPath}.tmp`;
      writeFileSync(tmp, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""));
      renameSync(tmp, persistPath);
      persistedLines = records.length;
    }
  }

  function trim() {
    const cutoff = clock() - retentionSeconds * 1000;
    while (records.length && Date.parse(records[0].occurredAt) < cutoff) {
      records.shift();
      expired += 1;
    }
    while (records.length > capacity) {
      records.shift();
      dropped += 1;
    }
  }

  function tooManyLabels(record) {
    const key = cardinalityKey(record);
    const labels = record.labels ?? record.otel?.attributes ?? {};
    const labelKey = JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));
    const metric = record.otel?.metric?.name ?? record.payload?.metric ?? record.signal;
    if (!cardinality.has(key)) cardinality.set(key, new Map());
    const byMetric = cardinality.get(key);
    if (!byMetric.has(metric)) byMetric.set(metric, new Set());
    const set = byMetric.get(metric);
    if (set.has(labelKey)) return false;
    if (set.size >= maxCardinality) return true;
    set.add(labelKey);
    return false;
  }

  return {
    /**
     * Tilføj en allerede valideret og scope-udledt envelope.
     * @returns {{stored: boolean, reason: string|null}}
     */
    append(record) {
      if (record?.occurredAt && Number.isFinite(Date.parse(record.occurredAt))) {
        const cutoff = clock() - retentionSeconds * 1000;
        if (Date.parse(record.occurredAt) < cutoff) {
          expired += 1;
          return { stored: false, reason: "expired" };
        }
      }
      if (tooManyLabels(record)) {
        cardinalityDropped += 1;
        return { stored: false, reason: "cardinality" };
      }
      records.push(record);
      records.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
      trim();
      persist(record);
      return { stored: true, reason: null };
    },

    has(id) {
      return records.some((r) => r.id === id);
    },

    get(id) {
      return records.find((r) => r.id === id) ?? null;
    },

    /** Tenant-scopet, pagineret forespørgsel. */
    query({ tenantId, signal = null, from = null, to = null, limit = 100, cursor = null } = {}) {
      if (!tenantId) throw new Error("query kræver en tenant");
      const fromMs = from ? Date.parse(from) : -Infinity;
      const toMs = to ? Date.parse(to) : Infinity;
      const after = cursor ? decodeCursor(cursor) : null;
      let rows = records.filter((r) => {
        if (r.scope?.tenantId !== tenantId) return false;
        if (signal && r.signal !== signal) return false;
        const t = Date.parse(r.occurredAt);
        return t >= fromMs && t <= toMs && (after === null || sortKey(r) > after);
      });
      rows = rows.slice(0, limit);
      const last = rows[rows.length - 1];
      return { items: rows, nextCursor: last ? encodeCursor(last) : null, count: rows.length };
    },

    stats() {
      return {
        size: records.length,
        capacity,
        retentionSeconds,
        maxCardinality,
        dropped,
        cardinalityDropped,
        expired,
        oldest: records[0]?.occurredAt ?? null,
        newest: records[records.length - 1]?.occurredAt ?? null,
      };
    },

    /** Ryd spilfilen (til test). */
    reset() {
      records.length = 0;
      cardinality.clear();
      dropped = 0;
      cardinalityDropped = 0;
      expired = 0;
      persistedLines = 0;
      if (persistPath && existsSync(persistPath)) rmSync(persistPath, { force: true });
    },

    _persistPath: persistPath,
    _fileSize() {
      return persistPath && existsSync(persistPath) ? statSync(persistPath).size : 0;
    },
  };
}
