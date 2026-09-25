/**
 * DKC-060 — offboarding.
 *
 * Når en identitet afvikles, skal alle fem rettighedsklasser lukkes inden for
 * den aftalte frist: sessioner, API-tokens, delinger, planlagte workflows og
 * AI-værktøjsbevillinger. En skjult UI-side er ikke en kontrol. Planen er
 * idempotent, så en gentaget kørsel ikke fejler og ikke genåbner noget.
 *
 * Lageret findes i to udgaver: en in-memory til enhedstests og en filbaseret,
 * der skriver atomisk (temp + rename), så tilstanden overlever genstart.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OFFBOARDING_TARGETS } from "./constants.mjs";

function err(path, message) {
  return { path, message };
}

const isDisable = (target) => target === "scheduled-workflows" || target === "ai-tool-grants";
const actionFor = (target) => (isDisable(target) ? "disable" : "revoke");

export function createMemoryOffboardingStore() {
  const state = new Map(OFFBOARDING_TARGETS.map((target) => [target, new Map()]));
  return {
    kind: "memory",
    all(target) {
      return [...(state.get(target)?.values() ?? [])].map((r) => ({ ...r }));
    },
    list(target, subject) {
      return this.all(target).filter((r) => r.subject === subject);
    },
    put(target, item) {
      state.get(target).set(item.id, { revokedAt: null, status: "active", ...item });
      return item;
    },
    revoke(target, id, at) {
      const item = state.get(target).get(id);
      if (!item || item.revokedAt) return false;
      item.revokedAt = at;
      item.status = "revoked";
      return true;
    },
  };
}

function blankState() {
  return Object.fromEntries(OFFBOARDING_TARGETS.map((target) => [target, {}]));
}

export function createFileOffboardingStore({ dir } = {}) {
  if (!dir) throw new Error("createFileOffboardingStore kræver en mappe (dir)");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "offboarding-state.json");
  const read = () => (existsSync(path) ? { ...blankState(), ...JSON.parse(readFileSync(path, "utf8")) } : blankState());
  const write = (state) => {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
    renameSync(tmp, path);
  };
  return {
    kind: "file",
    dir,
    all(target) {
      return Object.values(read()[target] ?? {}).map((r) => ({ ...r }));
    },
    list(target, subject) {
      return this.all(target).filter((r) => r.subject === subject);
    },
    put(target, item) {
      const state = read();
      state[target] = state[target] ?? {};
      state[target][item.id] = { revokedAt: null, status: "active", ...item };
      write(state);
      return item;
    },
    revoke(target, id, at) {
      const state = read();
      const item = state[target]?.[id];
      if (!item || item.revokedAt) return false;
      item.revokedAt = at;
      item.status = "revoked";
      write(state);
      return true;
    },
  };
}

/** Læg syntetiske rettigheder ind for et subject (test/dev). */
export function seedRights(store, subject, rights = {}) {
  for (const target of OFFBOARDING_TARGETS) {
    for (const item of rights[target] ?? []) store.put(target, { subject, ...item });
  }
  return store;
}

export function planOffboarding({ subject, deadlineSeconds = 3600, now = Date.now(), targets = OFFBOARDING_TARGETS } = {}) {
  if (!subject || typeof subject !== "string") throw new Error("planOffboarding kræver et subject");
  if (!Number.isFinite(deadlineSeconds) || deadlineSeconds <= 0) throw new Error("deadlineSeconds skal være et positivt tal");
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "OffboardingPlan",
    id: `offboard-${subject.replace(/[^a-z0-9|]+/gi, "-")}`,
    subject,
    requestedAt: new Date(now).toISOString(),
    deadlineAt: new Date(now + deadlineSeconds * 1000).toISOString(),
    deadlineSeconds,
    targets: [...targets],
    actions: [],
    outstanding: [],
    status: "partial",
  };
}

/**
 * Udfører planen. Idempotent: allerede tilbagekaldte rettigheder springes over.
 * En handling der ville ligge efter fristen udføres ikke og markeres `failed`.
 */
export function executeOffboarding({ plan, store, now = Date.now() } = {}) {
  if (!plan || !store) throw new Error("executeOffboarding kræver plan og store");
  const actions = [];
  for (const target of plan.targets) {
    for (const right of store.list(target, plan.subject)) {
      if (right.revokedAt) {
        actions.push({ target, rightId: right.id, action: actionFor(target), at: right.revokedAt, status: "already-revoked" });
        continue;
      }
      const at = now();
      if (at > Date.parse(plan.deadlineAt)) {
        actions.push({ target, rightId: right.id, action: actionFor(target), at: new Date(at).toISOString(), status: "failed", reason: "fristen for afvikling er overskredet" });
        continue;
      }
      store.revoke(target, right.id, new Date(at).toISOString());
      actions.push({ target, rightId: right.id, action: actionFor(target), at: new Date(at).toISOString(), status: "done" });
    }
  }
  const outstanding = [];
  for (const target of plan.targets) {
    for (const right of store.list(target, plan.subject)) if (!right.revokedAt) outstanding.push(`${target}:${right.id}`);
  }
  const failed = actions.some((a) => a.status === "failed");
  const status = outstanding.length === 0 && !failed ? "complete" : actions.some((a) => a.status === "done") ? "partial" : "failed";
  const completeByDeadline = status === "complete" && actions.every((a) => Date.parse(a.at) <= Date.parse(plan.deadlineAt));
  return { ...plan, actions, outstanding, status, completeByDeadline, auditRef: `audit://offboarding/${plan.subject}` };
}

/** Semantik ud over skemaet for en offboardingplan/-resultat. */
export function offboardingPlanProblems(report) {
  const problems = [];
  if (!report || typeof report !== "object") return [err("/", "offboardingplanen er ikke et objekt")];
  const targets = new Set(report.targets ?? []);
  for (const target of OFFBOARDING_TARGETS) {
    if (!targets.has(target)) problems.push(err("/targets", `offboardingplanen mangler rettighedsklassen '${target}'`));
  }
  const deadline = Date.parse(report.deadlineAt);
  const requested = Date.parse(report.requestedAt);
  if (!Number.isFinite(deadline) || !Number.isFinite(requested)) {
    problems.push(err("/deadlineAt", "planen mangler gyldige tidsstempler"));
  } else {
    const expected = requested + Number(report.deadlineSeconds) * 1000;
    if (Math.abs(expected - deadline) > 1000) problems.push(err("/deadlineAt", "deadlineAt svarer ikke til requestedAt + deadlineSeconds"));
  }
  for (const [i, action] of (report.actions ?? []).entries()) {
    if (!targets.has(action.target)) problems.push(err(`/actions/${i}/target`, `handlingen peger på den ukendte rettighedsklasse '${action.target}'`));
    if (action.status === "done" && Number.isFinite(deadline) && Date.parse(action.at) > deadline) {
      problems.push(err(`/actions/${i}/at`, "en udført handling ligger efter fristen"));
    }
  }
  if (report.status === "complete") {
    if ((report.outstanding ?? []).length) problems.push(err("/status", "en 'complete'-plan må ikke have udestående rettigheder"));
    if ((report.actions ?? []).some((a) => a.status === "failed")) problems.push(err("/status", "en 'complete'-plan må ikke indeholde fejlede handlinger"));
    if (report.completeByDeadline === false) problems.push(err("/status", "en 'complete'-plan skal være gennemført inden fristen"));
  }
  return problems;
}
