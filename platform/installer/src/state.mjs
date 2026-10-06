/**
 * DKC-054 — holdbar, resumable installationstilstand.
 *
 * Tilstanden skrives atomisk (tmp + rename) efter hvert trin, så en afbrudt
 * installation kan genoptages idempotent. Hvis planens digest ikke matcher den
 * tilstand, der ligger på disken, nægtes genoptagelse — en ændret plan må ikke
 * køre oven på et gammelt forløb.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export function createInstallStateStore({ path, clock = () => Date.now() } = {}) {
  if (!path) throw new Error("createInstallStateStore kræver en sti");

  function load() {
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return null;
    }
  }

  function save(state) {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
    writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, path);
    return state;
  }

  function init({ installationId, planDigest }) {
    return save({ installationId, planDigest, status: "pending", updatedAt: new Date(clock()).toISOString(), steps: {} });
  }

  function ensure({ installationId, planDigest }) {
    const existing = load();
    if (!existing) return init({ installationId, planDigest });
    if (existing.planDigest !== planDigest) {
      const error = new Error("den gemte installationstilstand hører til en anden plan");
      error.code = "PLAN_MISMATCH";
      throw error;
    }
    return existing;
  }

  function markStep(stepId, patch) {
    const state = load() ?? { steps: {} };
    state.steps = state.steps ?? {};
    state.steps[stepId] = { ...(state.steps[stepId] ?? {}), ...patch, updatedAt: new Date(clock()).toISOString() };
    state.updatedAt = new Date(clock()).toISOString();
    return save(state);
  }

  function isDone(state, stepId) {
    return state?.steps?.[stepId]?.state === "done";
  }

  function status(state, plan) {
    const steps = plan?.steps ?? [];
    const done = steps.filter((s) => isDone(state, s.id)).length;
    const failed = steps.filter((s) => state?.steps?.[s.id]?.state === "failed");
    const remaining = steps.filter((s) => !isDone(state, s.id)).map((s) => s.id);
    const lastDone = [...steps].reverse().find((s) => isDone(state, s.id))?.id ?? null;
    const complete = steps.length > 0 && remaining.length === 0;
    return {
      installationId: plan?.installationId ?? state?.installationId ?? null,
      status: complete ? "done" : failed.length ? "failed" : done > 0 ? "resumable" : "not-started",
      completed: done,
      total: steps.length,
      failed: failed.map((s) => ({ id: s.id, error: state.steps[s.id].error ?? null })),
      remaining,
      lastCompletedStep: lastDone,
      resumable: true,
    };
  }

  return { load, save, init, ensure, markStep, isDone, status, path };
}
