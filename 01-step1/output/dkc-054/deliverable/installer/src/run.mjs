/**
 * DKC-054 — resumable, idempotent installationseksekvering.
 *
 * Eksekveringen følger den signerede plan. Hvert trin har en idempotency-key,
 * markeres holdbart før og efter kørsel, og et allerede fuldført trin springes
 * over. En executor må ikke ændre planen, policyen, pakkekilden eller payloaden:
 * den får kun det ene trin og dets idempotency-key. Uden en gyldig signatur
 * kører intet.
 */
import { planDigest, verifyPlanSignature } from "./plan.mjs";

export function createStepExecutors(handlers = {}) {
  return {
    run(step, context) {
      const handler = handlers[step.id];
      if (typeof handler !== "function") {
        const error = new Error(`ingen executor for trinnet '${step.id}'`);
        error.code = "NO_EXECUTOR";
        throw error;
      }
      return handler(step, context);
    },
    has(stepId) {
      return typeof handlers[stepId] === "function";
    },
  };
}

export async function runInstaller({
  plan,
  store,
  executors,
  keyring = null,
  authorization = null,
  clock = () => Date.now(),
  verifySignature = true,
  requireApprovalForMutating = true,
} = {}) {
  if (!plan) throw new Error("runInstaller kræver en plan");
  if (!store) throw new Error("runInstaller kræver en tilstandsstore");

  if (verifySignature) {
    if (!keyring) return { ok: false, error: "ingen nøglesæt til signaturverifikation", code: "NO_KEYRING" };
    const verified = verifyPlanSignature(plan, keyring);
    if (!verified.ok) return { ok: false, error: verified.reason, code: "BAD_SIGNATURE" };
  }

  const digest = planDigest(plan);
  let state;
  try {
    state = store.ensure({ installationId: plan.installationId, planDigest: digest });
  } catch (err) {
    return { ok: false, error: err.message, code: err.code ?? "STATE_ERROR" };
  }
  store.save({ ...state, status: "running" });

  const steps = [...plan.steps].sort((a, b) => a.order - b.order);
  for (const step of steps) {
    if (store.isDone(store.load(), step.id)) continue;

    if (requireApprovalForMutating && step.mutating === true && step.requiresApproval === true) {
      const covered = authorization?.stepIds?.includes(step.id) && /^[a-z][a-z0-9-]*\|/.test(authorization?.humanSubject ?? "");
      if (!covered) {
        store.markStep(step.id, { state: "failed", error: "manglende menneskelig godkendelse" });
        store.save({ ...store.load(), status: "failed" });
        return { ok: false, error: `trinnet '${step.id}' mangler menneskelig godkendelse`, code: "APPROVAL_REQUIRED", state: store.load() };
      }
    }

    for (const dep of step.dependsOn ?? []) {
      if (!store.isDone(store.load(), dep)) {
        store.markStep(step.id, { state: "failed", error: `afhængigheden '${dep}' er ikke fuldført` });
        store.save({ ...store.load(), status: "failed" });
        return { ok: false, error: `trinnet '${step.id}' kan ikke køre før '${dep}'`, code: "DEPENDENCY_NOT_DONE", state: store.load() };
      }
    }

    store.markStep(step.id, { state: "running", attempts: (store.load()?.steps?.[step.id]?.attempts ?? 0) + 1 });
    try {
      const result = await executors.run(step, { plan, digest, idempotencyKey: step.idempotencyKey, clock });
      store.markStep(step.id, { state: "done", result: result ?? null, error: null });
    } catch (err) {
      store.markStep(step.id, { state: "failed", error: err.message });
      store.save({ ...store.load(), status: "failed" });
      return { ok: false, error: `trinnet '${step.id}' fejlede: ${err.message}`, code: err.code ?? "STEP_FAILED", state: store.load() };
    }
  }

  const finalState = { ...store.load(), status: "done" };
  store.save(finalState);
  return { ok: true, digest, state: finalState, status: store.status(finalState, plan) };
}

/** Genoptag en afbrudt installation; identisk med runInstaller (idempotent). */
export async function resumeInstaller(opts = {}) {
  return runInstaller(opts);
}
