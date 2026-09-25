/**
 * DKC-039 — replikeret commitlog med quorum-bekræftelse og fencing.
 *
 * Modulet er en deterministisk model af den synkrone replikeringskontrakt som
 * database-HA-planen kræver. Hver instans har sin egen database med en
 * `replication_log` og et `commit_receipts`-spor. En kritisk write:
 *
 *   1. skrives til primary'ens log,
 *   2. replikeres til de nåbare replikaer, og
 *   3. bekræftes **kun** hvis mindst `minSyncReplicasForWrites` sync-replikaer
 *      har kvitteret. Er der ikke nok, rulles den tentativt skrevne række
 *      tilbage på alle noder, og writen afvises — der er ingen tavs
 *      async-overgang og ingen falsk succes.
 *
 * Før en ny primary må promoveres, skal den gamle være fenced. En promoveret
 * node skal have alle bekræftede receipts, så en commitkvittering altid findes
 * efter failover. Netværkspartitioner vurderes med quorum, så der højst kan
 * være én autoritativ skriver.
 *
 * Modellen bruger SQLite som lager, men protokollen (sync-quorum, receipts,
 * fencing, rejoin) er den samme som planen beskriver for en rigtig motor.
 */
import { createHash } from "node:crypto";
import { normalizeTenantId } from "../../identity/src/tenant.mjs";

export const ROLE_PRIMARY = "primary";
export const ROLE_SYNC = "sync-replica";
export const ROLE_ASYNC = "async-replica";

function iso(ms) {
  return new Date(ms).toISOString();
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

export function digestOf(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS replication_log (
    seq          INTEGER PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    op           TEXT NOT NULL,
    payload      TEXT NOT NULL,
    digest       TEXT NOT NULL,
    committed_at TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS commit_receipts (
    receipt_id TEXT PRIMARY KEY,
    tenant_id  TEXT NOT NULL,
    seq        INTEGER NOT NULL,
    digest     TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS fenced_nodes (
    id        TEXT PRIMARY KEY,
    fenced_at TEXT NOT NULL,
    reason    TEXT
  )`);
}

export function createReplicaCluster({ instances, quorum, minSyncReplicasForWrites = 1, voterIds = null, clock = () => Date.now() } = {}) {
  if (!Array.isArray(instances) || instances.length < 3) throw new Error("en replikaklynge kræver mindst tre instanser");
  if (!Number.isInteger(quorum) || quorum < 1) throw new Error("quorum skal være et positivt heltal");

  const byId = new Map(instances.map((i) => [i.id, i]));
  if (byId.size !== instances.length) throw new Error("instans-id'er skal være unikke");
  const voterSet = new Set(voterIds ?? instances.filter((i) => i.role !== ROLE_ASYNC).map((i) => i.id));
  for (const id of voterSet) {
    if (!byId.has(id)) throw new Error(`ukendt stemmeberettiget instans '${id}'`);
  }
  for (const instance of instances) {
    if (!instance.db) throw new Error(`instansen '${instance.id}' mangler en database`);
    ensureSchema(instance.db);
  }

  let primaryId = instances.find((i) => i.role === ROLE_PRIMARY)?.id;
  if (!primaryId) throw new Error("klyngen mangler en primary");
  let fenceEpoch = 0;
  const fenced = new Set();
  const reachable = new Set(instances.map((i) => i.id));
  let partitions = null;

  function dbOf(id) {
    const node = byId.get(id);
    if (!node) throw new Error(`ukendt instans '${id}'`);
    return node.db;
  }

  function isReachable(id) {
    return reachable.has(id);
  }

  function isFenced(id) {
    return fenced.has(id);
  }

  function maxSeq(id) {
    return dbOf(id).get("SELECT COALESCE(MAX(seq), 0) AS seq FROM replication_log")?.seq ?? 0;
  }

  function logRow(id, seq) {
    const row = dbOf(id).get("SELECT * FROM replication_log WHERE seq = ?", seq);
    if (!row) return null;
    return { seq: row.seq, tenantId: row.tenant_id, op: row.op, payload: JSON.parse(row.payload), digest: row.digest, committedAt: row.committed_at };
  }

  function receiptsFrom(id) {
    return dbOf(id).all("SELECT * FROM commit_receipts ORDER BY seq").map((r) => ({
      receiptId: r.receipt_id,
      tenantId: r.tenant_id,
      seq: r.seq,
      digest: r.digest,
      createdAt: r.created_at,
    }));
  }

  const cluster = {
    kind: "replica-cluster",
    quorum,
    minSyncReplicasForWrites,

    instances() {
      return [...byId.values()].map((i) => ({ id: i.id, failureDomain: i.failureDomain, role: i.role }));
    },

    primaryId() {
      return primaryId;
    },

    fenceEpoch() {
      return fenceEpoch;
    },

    isReachable,
    isFenced,
    maxSeq,

    /**
     * Bekræft en kritisk write. Returnerer en receipt ved succes; ellers
     * `{committed:false}` uden at efterlade den tentativt skrevne række.
     */
    commit(tenantIdRaw, { op, payload = null, now = clock() } = {}) {
      const tenantId = normalizeTenantId(tenantIdRaw);
      if (!op) throw new Error("commit kræver en op");
      if (!isReachable(primaryId)) return { committed: false, reason: "primary-unreachable" };
      if (isFenced(primaryId)) return { committed: false, reason: "primary-fenced" };
      const seq = maxSeq(primaryId) + 1;
      const payloadText = JSON.stringify(payload ?? null);
      const digest = digestOf({ seq, tenantId, op, payload: payloadText });
      const record = { seq, tenant_id: tenantId, op, payload: payloadText, digest, committed_at: iso(now) };

      const insert = (id) => dbOf(id).prepare("INSERT INTO replication_log(seq, tenant_id, op, payload, digest, committed_at) VALUES (?, ?, ?, ?, ?, ?)").run(record.seq, record.tenant_id, record.op, record.payload, record.digest, record.committed_at);
      const remove = (id) => dbOf(id).prepare("DELETE FROM replication_log WHERE seq = ?").run(seq);

      // 1) Tentativ skrivning til primary og replication til nåbare replikaer.
      insert(primaryId);
      const replicated = [];
      for (const instance of byId.values()) {
        if (instance.id === primaryId) continue;
        if (!isReachable(instance.id)) continue;
        if (isFenced(instance.id)) continue;
        try {
          insert(instance.id);
          replicated.push(instance.id);
        } catch {
          /* en replika der ikke kan skrive tæller ikke som ack */
        }
      }

      // 2) Quorum-ack: kun sync-replikaer tæller, og async-replikaer er ikke ack.
      const syncAcks = replicated.filter((id) => byId.get(id).role === ROLE_SYNC);
      if (syncAcks.length < minSyncReplicasForWrites) {
        remove(primaryId);
        for (const id of replicated) remove(id);
        return { committed: false, reason: "sync-replica-loss", syncAcks: syncAcks.length, required: minSyncReplicasForWrites };
      }

      // 3) Receipt skrives kun når quorum er opnået.
      const receiptId = `${tenantId}:${seq}:${digest.slice(0, 12)}`;
      const insertReceipt = (id) => dbOf(id).prepare("INSERT OR IGNORE INTO commit_receipts(receipt_id, tenant_id, seq, digest, created_at) VALUES (?, ?, ?, ?, ?)").run(receiptId, tenantId, seq, digest, iso(now));
      insertReceipt(primaryId);
      for (const id of replicated) insertReceipt(id);

      return { committed: true, receipt: { receiptId, tenantId, seq, digest, createdAt: iso(now), op }, syncAcks: syncAcks.length };
    },

    receipts({ node = primaryId } = {}) {
      return receiptsFrom(node);
    },

    /** Har noden alle bekræftede receipts fra primary'en? */
    hasAllReceipts(nodeId) {
      if (!byId.has(nodeId)) throw new Error(`ukendt instans '${nodeId}'`);
      const nodeSeqs = new Map(dbOf(nodeId).all("SELECT seq, digest FROM replication_log").map((r) => [r.seq, r.digest]));
      return receiptsFrom(primaryId).every((r) => nodeSeqs.get(r.seq) === r.digest);
    },

    /** Fence en node. Fencing-tokenet er monotont stigende. */
    fence(nodeId, { reason = "operator-fence", now = clock() } = {}) {
      if (!byId.has(nodeId)) throw new Error(`ukendt instans '${nodeId}'`);
      fenceEpoch += 1;
      fenced.add(nodeId);
      const at = iso(now);
      for (const instance of byId.values()) {
        if (!isReachable(instance.id)) continue;
        try {
          instance.db.prepare("INSERT OR REPLACE INTO fenced_nodes(id, fenced_at, reason) VALUES (?, ?, ?)").run(nodeId, at, reason);
        } catch {
          /* en isoleret node kan ikke nås */
        }
      }
      return { fenced: nodeId, reason, fenceEpoch, at };
    },

    unfence(nodeId) {
      fenced.delete(nodeId);
      for (const instance of byId.values()) {
        try {
          instance.db.prepare("DELETE FROM fenced_nodes WHERE id = ?").run(nodeId);
        } catch {
          /* ignore */
        }
      }
      return { unfenced: nodeId };
    },

    /**
     * Promovér en sync-replika til primary. Den gamle primary skal være fenced
     * (medmindre klyngen eksplicit tillader usikker promotion), og kandidaten
     * skal have alle bekræftede receipts.
     */
    promote(nodeId, { allowUnsafePromotion = false, now = clock() } = {}) {
      if (!byId.has(nodeId)) throw new Error(`ukendt instans '${nodeId}'`);
      const candidate = byId.get(nodeId);
      if (candidate.role !== ROLE_SYNC) return { promoted: false, reason: "kandidaten er ikke en sync-replika" };
      if (!isReachable(nodeId)) return { promoted: false, reason: "kandidaten er ikke nåbar" };
      if (isFenced(nodeId)) return { promoted: false, reason: "kandidaten er fenced" };
      const oldPrimary = primaryId;
      if (oldPrimary !== nodeId && !isFenced(oldPrimary) && !allowUnsafePromotion) {
        return { promoted: false, reason: "den tidligere primary er ikke fenced" };
      }
      if (!cluster.hasAllReceipts(nodeId)) return { promoted: false, reason: "kandidaten mangler bekræftede receipts" };
      primaryId = nodeId;
      fenceEpoch += 1;
      return { promoted: true, primary: nodeId, previous: oldPrimary, fenceEpoch, at: iso(now) };
    },

    /** Sæt nåbarheden til de givne grupper; noder uden for grupperne isoleres. */
    partitionInto(groups) {
      reachable.clear();
      partitions = [];
      for (const group of groups) {
        partitions.push([...group]);
        for (const id of group) {
          if (!byId.has(id)) throw new Error(`ukendt instans '${id}' i partition`);
          reachable.add(id);
        }
      }
      return cluster.assessPartitions();
    },

    restoreReachability() {
      reachable.clear();
      for (const id of byId.keys()) reachable.add(id);
      partitions = null;
    },

    /**
     * Vurdér partitionerne: kun en gruppe med quorum kan have en autoritativ
     * skriver, og den gamle primary må ikke skrive hvis den er fenced eller
     * isoleret uden quorum.
     */
    assessPartitions() {
      const groups = partitions ?? [[...reachable]];
      const writers = [];
      for (const group of groups) {
        const voters = group.filter((id) => voterSet.has(id));
        const hasQuorum = voters.length >= quorum;
        const containsPrimary = group.includes(primaryId);
        const fenced = group.includes(primaryId) && isFenced(primaryId);
        const authoritative = hasQuorum && containsPrimary && !fenced;
        if (authoritative) writers.push({ primary: primaryId, group: [...group], size: group.length });
      }
      return {
        groups: groups.map((g) => ({ nodes: [...g], size: g.length, voters: g.filter((id) => voterSet.has(id)).length, hasQuorum: g.filter((id) => voterSet.has(id)).length >= quorum })),
        authoritativeWriters: writers,
        atMostOne: writers.length <= 1,
        writeAllowed: writers.length === 1,
      };
    },

    /**
     * Rejoin: kopiér manglende log-rækker fra en kilde, verificér digester og
     * ophæv fencing. Returnerer antallet af kopierede rækker.
     */
    rejoin(nodeId, { from = primaryId, now = clock() } = {}) {
      if (!byId.has(nodeId)) throw new Error(`ukendt instans '${nodeId}'`);
      if (!byId.has(from)) throw new Error(`ukendt kilde '${from}'`);
      const source = dbOf(from).all("SELECT * FROM replication_log ORDER BY seq");
      let copied = 0;
      const verify = [];
      for (const row of source) {
        const existing = dbOf(nodeId).get("SELECT digest FROM replication_log WHERE seq = ?", row.seq);
        if (existing) {
          verify.push(existing.digest === row.digest);
          continue;
        }
        dbOf(nodeId).prepare("INSERT INTO replication_log(seq, tenant_id, op, payload, digest, committed_at) VALUES (?, ?, ?, ?, ?, ?)").run(row.seq, row.tenant_id, row.op, row.payload, row.digest, row.committed_at);
        copied += 1;
      }
      // Kopiér også receipts, så noden kan promoveres uden at mangle kvitteringer.
      const sourceReceipts = receiptsFrom(from);
      for (const r of sourceReceipts) {
        dbOf(nodeId).prepare("INSERT OR IGNORE INTO commit_receipts(receipt_id, tenant_id, seq, digest, created_at) VALUES (?, ?, ?, ?, ?)").run(r.receiptId, r.tenantId, r.seq, r.digest, r.createdAt);
      }
      cluster.unfence(nodeId);
      return { rejoined: nodeId, copied, receiptsCopied: sourceReceipts.length, digestVerificationOk: verify.every(Boolean), at: iso(now) };
    },

    /** Verificér at primary og sync-replikaer har identiske log-digester. */
    verifyIntegrity() {
      const reference = new Map(dbOf(primaryId).all("SELECT seq, digest FROM replication_log").map((r) => [r.seq, r.digest]));
      const problems = [];
      for (const instance of byId.values()) {
        if (instance.role === ROLE_ASYNC) continue;
        if (!isReachable(instance.id)) continue;
        const local = new Map(dbOf(instance.id).all("SELECT seq, digest FROM replication_log").map((r) => [r.seq, r.digest]));
        for (const [seq, digest] of reference) {
          const found = local.get(seq);
          if (found !== digest) problems.push(`${instance.id}: seq ${seq} matcher ikke primary (${found ?? "mangler"})`);
        }
      }
      return { ok: problems.length === 0, problems };
    },

    snapshot() {
      return {
        primary: primaryId,
        quorum,
        minSyncReplicasForWrites,
        fenceEpoch,
        reachable: [...reachable],
        partitions: partitions ? partitions.map((p) => [...p]) : null,
      };
    },
  };

  return cluster;
}
