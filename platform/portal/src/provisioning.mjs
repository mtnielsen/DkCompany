/**
 * DKC-025 — genoptagelig og idempotent provisionering.
 *
 * En ordre provisioneres i deterministiske trin. Hvert trin har en
 * **idempotency-key** udledt af (kunde, pakke, version, modul) og en
 * deterministisk ressource-ID. Kører man et trin igen — fordi et senere trin
 * fejlede — genbruges den allerede oprettede ressource i stedet for at oprette
 * en ny. Dermed kan et delvist fejlet forløb genoptages uden dobbeltressourcer.
 *
 * Trinene gemmes i lageret, så genoptagelsen virker efter en genstart, og
 * revisionssporet følger ordren.
 */
import { createHash } from "node:crypto";
import { stableStringify } from "../../approvals/src/binding.mjs";

function keyOf(tenantId, packageId, version, moduleId) {
  return createHash("sha256").update(stableStringify({ tenantId, packageId, version, moduleId })).digest("hex");
}

function resourceRefOf(tenantId, packageId, moduleId) {
  return `res://${tenantId}/module/${packageId}-${moduleId}`;
}

function nowIso(clock) {
  return new Date(clock()).toISOString();
}

function toActor(principal) {
  if (!principal) return null;
  return { subject: principal.id, name: principal.name ?? principal.id, role: principal.role ?? null };
}

/**
 * Deterministisk executor til tests og den lokale demo. Den husker hvilke
 * idempotency-keys der allerede er oprettet og rapporterer `created: false`
 * anden gang. Det er præcis den adfærd en rigtig provisioneringsadapter skal
 * have.
 */
export function createMemoryExecutor({ failKeys = new Set(), failAfterKeys = new Set() } = {}) {
  const created = new Map();
  return {
    created,
    async execute({ step }) {
      if (failKeys.has(step.stepId)) {
        failKeys.delete(step.stepId);
        const error = new Error(`simuleret fejl i trinnet '${step.stepId}'`);
        error.stepId = step.stepId;
        throw error;
      }
      const existing = created.get(step.idempotencyKey);
      if (failAfterKeys.has(step.stepId)) {
        // Ressourcen oprettes, men trinnet registreres ikke som gennemført —
        // som et nedbrud mellem skrivning og registrering. Fejlen sker kun én gang.
        failAfterKeys.delete(step.stepId);
        if (!existing) created.set(step.idempotencyKey, step.resourceRef);
        const error = new Error(`simuleret nedbrud efter oprettelse i trinnet '${step.stepId}'`);
        error.stepId = step.stepId;
        throw error;
      }
      if (existing) return { resourceRef: existing, created: false };
      created.set(step.idempotencyKey, step.resourceRef);
      return { resourceRef: step.resourceRef, created: true };
    },
  };
}

export function planSteps(pkg, { tenantId, orderId } = {}) {
  return (pkg.modules ?? [])
    .map((mod, ordinal) => ({
      stepId: mod.id,
      orderId,
      tenantId,
      packageId: pkg.metadata.name,
      packageVersion: pkg.metadata.version,
      moduleId: mod.id,
      ordinal,
      action: "provision-module",
      idempotencyKey: keyOf(tenantId, pkg.metadata.name, pkg.metadata.version, mod.id),
      resourceRef: resourceRefOf(tenantId, pkg.metadata.name, mod.id),
      state: "pending",
      attempts: 0,
      createdAt: null,
      updatedAt: null,
      error: null,
      resource: null,
    }))
    .sort((a, b) => a.ordinal - b.ordinal);
}

export function createProvisioner({ store, packages, clock = () => Date.now(), executor = createMemoryExecutor() } = {}) {
  if (!store) throw new Error("createProvisioner kræver et lager");

  function packageForOrder(order) {
    const pkg = (packages ?? []).find(
      (p) => p.metadata?.name === order.packageId && p.metadata?.version === order.packageVersion
    );
    if (!pkg) throw new Error(`servicepakken '${order.packageId}@${order.packageVersion}' findes ikke`);
    return pkg;
  }

  function ensureSteps(order) {
    let steps = store.listSteps(order.orderId);
    if (steps.length === 0) {
      const pkg = packageForOrder(order);
      for (const step of planSteps(pkg, { tenantId: order.tenantId, orderId: order.orderId })) {
        const at = nowIso(clock);
        store.saveStep(order.orderId, { ...step, createdAt: at, updatedAt: at });
      }
      steps = store.listSteps(order.orderId);
    }
    return steps;
  }

  function updateOrder(orderId, patch) {
    const order = store.getOrder(orderId);
    const next = { ...order, ...patch, updatedAt: nowIso(clock) };
    store.saveOrder(next);
    return next;
  }

  /**
   * Kør (eller genoptag) provisioneringen af en godkendt ordre.
   * `failStepId` lader en test fremtvinge en fejl i et bestemt trin.
   */
  async function runOrder({ orderId, principal = null, failStepId = null, recordEvent = () => {} } = {}) {
    let order = store.getOrder(orderId);
    if (!order) throw new Error(`ordren '${orderId}' findes ikke`);
    if (["active", "suspended"].includes(order.state)) {
      return { status: order.state, order, steps: store.listSteps(orderId), failedStepId: null };
    }
    if (!["approved", "provisioning", "partial"].includes(order.state)) {
      throw new Error(`ordren '${orderId}' kan ikke provisioneres fra tilstanden '${order.state}'`);
    }

    const steps = ensureSteps(order);

    if (order.state !== "provisioning") {
      order = updateOrder(orderId, { state: "provisioning" });
      recordEvent(order.tenantId, { type: "order.provisioning", actor: toActor(principal), from: "approved", to: "provisioning", detail: { orderId } });
    }

    for (const step of steps) {
      if (step.state === "succeeded" || step.state === "reused" || step.state === "skipped") continue;

      const attempt = (step.attempts ?? 0) + 1;
      const running = { ...step, attempts: attempt, updatedAt: nowIso(clock) };

      const simulateFail = failStepId && step.stepId === failStepId && step.state !== "failed";
      if (simulateFail) {
        const error = new Error(`simuleret fejl i trinnet '${step.stepId}'`);
        store.saveStep(orderId, { ...running, state: "failed", error: error.message });
        const failed = updateOrder(orderId, { state: "partial", failedStepId: step.stepId });
        recordEvent(failed.tenantId, {
          type: "order.provisioning-failed",
          actor: toActor(principal),
          from: "provisioning",
          to: "partial",
          detail: { orderId, stepId: step.stepId, attempts: attempt, reason: error.message },
        });
        return { status: "partial", order: failed, steps: store.listSteps(orderId), failedStepId: step.stepId };
      }

      let result;
      try {
        result = await executor.execute({ step: running, order });
      } catch (err) {
        store.saveStep(orderId, { ...running, state: "failed", error: err.message });
        const failed = updateOrder(orderId, { state: "partial", failedStepId: step.stepId });
        recordEvent(failed.tenantId, {
          type: "order.provisioning-failed",
          actor: toActor(principal),
          from: "provisioning",
          to: "partial",
          detail: { orderId, stepId: step.stepId, attempts: attempt, reason: err.message },
        });
        return { status: "partial", order: failed, steps: store.listSteps(orderId), failedStepId: step.stepId };
      }

      const reused = result.created === false;
      store.saveStep(orderId, {
        ...running,
        state: reused ? "reused" : "succeeded",
        error: null,
        resource: { ref: result.resourceRef, created: result.created === true, reused },
        updatedAt: nowIso(clock),
      });
      recordEvent(order.tenantId, {
        type: reused ? "order.step-reused" : "order.step-succeeded",
        actor: toActor(principal),
        detail: { orderId, stepId: step.stepId, resourceRef: result.resourceRef },
      });
    }

    const active = updateOrder(orderId, { state: "active", failedStepId: null });
    recordEvent(active.tenantId, { type: "order.active", actor: toActor(principal), from: "provisioning", to: "active", detail: { orderId } });

    // Når ordren er aktiv, bliver en ny kunde aktiv.
    const customer = store.getCustomer(active.tenantId);
    if (customer && customer.state === "created") {
      store.saveCustomer({ ...customer, state: "active", packageId: active.packageId, packageVersion: active.packageVersion, updatedAt: nowIso(clock) });
      recordEvent(active.tenantId, { type: "customer.activated", actor: toActor(principal), from: "created", to: "active", detail: { orderId } });
    }

    return { status: "active", order: store.getOrder(orderId), steps: store.listSteps(orderId), failedStepId: null };
  }

  /** Tjek at en ordre ikke har to succesfulde trin med samme ressource. */
  function duplicateResources(orderId) {
    const seen = new Map();
    const duplicates = [];
    for (const step of store.listSteps(orderId)) {
      if (step.state !== "succeeded" && step.state !== "reused") continue;
      const ref = step.resource?.ref ?? step.resourceRef;
      if (seen.has(ref)) duplicates.push({ ref, steps: [seen.get(ref), step.stepId] });
      else seen.set(ref, step.stepId);
    }
    return duplicates;
  }

  return { runOrder, ensureSteps, duplicateResources };
}
