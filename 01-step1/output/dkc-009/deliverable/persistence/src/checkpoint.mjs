/**
 * DKC-009 — eksternt forankret checkpoint for audit-loggen.
 *
 * En hash-kæde alene opdager ændringer, men ikke hvis nogen sletter eller
 * trunkerer hele loggen og genopbygger en ny, konsistent kæde. Derfor skrives
 * et checkpoint til et **andet medie** end databasen: en mappe (i produktion en
 * append-only/WORM-lagring eller en ekstern transparency-log) som den
 * audit-skrivende identitet ikke selv kan omskrive ubemærket.
 *
 * Checkpointet indeholder tenantens kædehoved, antallet af begivenheder og en
 * HMAC-signatur med en nøgle der ikke ligger i databasen. `verify` opdager:
 *
 *   - `truncated`  — der er færre begivenheder nu end da checkpointet blev sat,
 *   - `deleted`    — en begivenhed mangler/er skiftet, så kædeleddet brister,
 *   - `changed`    — en begivenheds indhold er ændret, så dens hash ikke passer,
 *   - `forged`     — selve checkpoint-filen er ændret (HMAC matcher ikke).
 *
 * Den lokale database indeholder bevidst ikke checkpointet; det er hele pointen.
 */
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeChainHash } from "./adapters/audit.mjs";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

function slug(tenantId) {
  return String(tenantId ?? "__global__").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function analyzeChain(events, genesis) {
  let prev = genesis;
  for (const event of events) {
    if (event.prevHash !== prev) return { ok: false, brokenAt: event.seq, reason: "deleted" };
    if (computeChainHash(prev, event) !== event.hash) return { ok: false, brokenAt: event.seq, reason: "changed" };
    prev = event.hash;
  }
  return { ok: true, chainHash: prev };
}

export function createCheckpointStore({ audit, anchorDir, secret, clock = () => Date.now(), kind = "external-checkpoint-store" } = {}) {
  if (!audit) throw new Error("createCheckpointStore kræver en audit-log");
  if (!anchorDir) throw new Error("createCheckpointStore kræver en anchorDir uden for databasen");
  if (!secret) throw new Error("createCheckpointStore kræver en hemmelighed til HMAC-signering");

  const sign = (digest) => createHmac("sha256", secret).update(digest).digest("hex");
  mkdirSync(anchorDir, { recursive: true });

  function anchorPath(tenantId, count) {
    return join(anchorDir, `checkpoint-${slug(tenantId)}-${String(count).padStart(8, "0")}.json`);
  }
  function latestPath(tenantId) {
    return join(anchorDir, `latest-${slug(tenantId)}.json`);
  }

  function writeAnchorFile(path, anchor) {
    const tmp = `${path}.tmp-${process.pid}-${clock()}`;
    writeFileSync(tmp, JSON.stringify(anchor, null, 2));
    renameSync(tmp, path);
  }

  function buildAnchor(tenantId) {
    const events = audit.events(tenantId ?? null);
    const last = events[events.length - 1] ?? null;
    const body = {
      version: 1,
      tenantId: tenantId ?? null,
      eventCount: events.length,
      chainHash: last?.hash ?? audit.genesis,
      lastEventId: last?.id ?? null,
      anchoredAt: new Date(clock()).toISOString(),
    };
    const digest = `${canonical(body)}`;
    const anchor = { ...body, digest: sign(digest), algorithm: "HMAC-SHA256" };
    return anchor;
  }

  function verifySignature(anchor) {
    if (!anchor || typeof anchor !== "object") return false;
    const { digest, algorithm, ...body } = anchor;
    return algorithm === "HMAC-SHA256" && sign(canonical(body)) === digest;
  }

  /** Returnér `{ ok, problems, currentCount, anchoredCount }` for et checkpoint. */
  function verifyAnchor(tenantId, anchor) {
    const problems = [];
    const events = audit.events(tenantId ?? null);
    if (!verifySignature(anchor)) {
      problems.push({ type: "forged", detail: "checkpointets HMAC-signatur matcher ikke" });
      return { ok: false, problems, anchoredCount: anchor?.eventCount ?? null, currentCount: events.length };
    }
    if (events.length < anchor.eventCount) {
      problems.push({ type: "truncated", detail: `loggen har ${events.length} begivenheder, checkpointet kræver ${anchor.eventCount}` });
    }
    // Verificér den forankrede præfiks med præcis samme kædefunktion. Et
    // checkpoint dækker de første `eventCount` begivenheder; senere tilføjelser
    // er tilladte og må ikke i sig selv give et brud.
    const prefix = events.slice(0, anchor.eventCount);
    const prefixChain = analyzeChain(prefix, audit.genesis);
    if (!prefixChain.ok) {
      problems.push({ type: prefixChain.reason, brokenAt: prefixChain.brokenAt, detail: prefixChain.reason === "deleted" ? "et kædeled i den forankrede præfiks mangler" : "en forankret begivenheds hash matcher ikke indholdet" });
    } else if (anchor.eventCount <= events.length && prefixChain.chainHash !== anchor.chainHash) {
      problems.push({ type: "changed", detail: "kædehovedet ved checkpointet matcher ikke" });
    }
    // Også indhold EFTER checkpointet skal være en intakt kæde.
    const chain = analyzeChain(events, audit.genesis);
    if (!chain.ok && prefixChain.ok) {
      problems.push({ type: chain.reason, brokenAt: chain.brokenAt, detail: chain.reason === "deleted" ? "et kædeled efter checkpointet mangler" : "en begivenhed efter checkpointet matcher ikke" });
    }
    if (anchor.eventCount > 0) {
      const atAnchor = events[anchor.eventCount - 1];
      if (!atAnchor) {
        if (!problems.some((p) => p.type === "truncated")) problems.push({ type: "deleted", brokenAt: anchor.eventCount, detail: "begivenheden ved checkpointets position findes ikke" });
      } else if (atAnchor.id !== anchor.lastEventId || atAnchor.hash !== anchor.chainHash) {
        if (!problems.some((p) => p.type === "changed")) problems.push({ type: "changed", brokenAt: atAnchor.seq, detail: "begivenheden ved checkpointets position matcher ikke" });
      }
    }
    return { ok: problems.length === 0, problems, anchoredCount: anchor.eventCount, currentCount: events.length, chain, prefixChain };
  }

  return {
    kind,
    anchorDir,
    genesis: audit.genesis,
    /** Skriv et nyt, uforanderligt checkpoint for tenanten. */
    anchor({ tenantId = null } = {}) {
      const anchor = buildAnchor(tenantId);
      writeAnchorFile(anchorPath(tenantId, anchor.eventCount), anchor);
      writeAnchorFile(latestPath(tenantId), anchor);
      return anchor;
    },
    readLatest(tenantId = null) {
      const path = latestPath(tenantId);
      if (!existsSync(path)) return null;
      return JSON.parse(readFileSync(path, "utf8"));
    },
    listAnchors(tenantId = null) {
      const prefix = `checkpoint-${slug(tenantId)}-`;
      return readdirSync(anchorDir)
        .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
        .sort()
        .map((f) => JSON.parse(readFileSync(join(anchorDir, f), "utf8")));
    },
    verify({ tenantId = null, anchor = null } = {}) {
      const target = anchor ?? this.readLatest(tenantId);
      if (!target) return { ok: false, problems: [{ type: "no-anchor", detail: "der findes intet checkpoint at verificere imod" }], anchoredCount: null, currentCount: audit.events(tenantId ?? null).length };
      return verifyAnchor(tenantId, target);
    },
    /** Sandt hvis intet checkpoint findes, eller hvis loggen ikke matcher det. */
    isCompromised(tenantId = null) {
      const result = this.verify({ tenantId });
      return !result.ok;
    },
    _analyzeChain: analyzeChain,
  };
}
