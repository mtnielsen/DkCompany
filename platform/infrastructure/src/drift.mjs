/**
 * DKC-015 — rigtig driftdetektion.
 *
 * Den ægte kontrol kræver en levende klynge: `kubectl` med en kubeconfig mod
 * staging. Uden den returneres NOT RUN med en begrundelse — et simuleret
 * JSON-objekt tæller ikke. Funktionen kan injiceres med en observeret tilstand
 * i tests, men den vej er tydeligt markeret.
 */
import { spawnSync } from "node:child_process";
import { loadPlan } from "./plan.mjs";
import { loadManifests } from "../../gitops/src/verify.mjs";
import { reconcile } from "../../gitops/src/reconcile.mjs";

const KINDS = ["Deployment", "Service", "ServiceAccount", "ConfigMap", "PersistentVolumeClaim", "Ingress", "NetworkPolicy", "ResourceQuota", "LimitRange", "CronJob"];

export function kubectlAvailable() {
  try {
    const result = spawnSync("kubectl", ["version", "--client=true", "--output=json"], { encoding: "utf8", timeout: 15_000 });
    return { available: result.status === 0, detail: (result.stderr || result.stdout || "").trim().slice(0, 200) };
  } catch (err) {
    return { available: false, detail: err.message };
  }
}

/** Hent den observerede tilstand fra klyngen for ét miljø. */
export function fetchObserved(root, env) {
  const resources = [];
  for (const kind of KINDS) {
    const result = spawnSync("kubectl", ["get", kind, "-n", env.namespace, "-o", "json"], { encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) continue; // fx en slukket klynge
    resources.push(...(JSON.parse(result.stdout).items ?? []));
  }
  return resources;
}

export function detectDrift(root, envId, { observed } = {}) {
  const plan = loadPlan(root);
  const env = (plan.environments ?? []).find((e) => e.id === envId);
  if (!env) return { status: "error", reason: `ukendt miljø '${envId}'` };
  const desired = loadManifests(root, envId).map((m) => m.data);

  if (observed) {
    const result = reconcile(desired, observed);
    return { status: result.inSync ? "in-sync" : "drift", source: "injected-observed-state", ...result };
  }

  const kubectl = kubectlAvailable();
  if (!kubectl.available) {
    return { status: "not-run", reason: `kubectl er ikke tilgængeligt (${kubectl.detail || "ikke fundet"}); rigtig drift kan ikke måles her.`, desiredCount: desired.length };
  }
  if (!process.env.KUBECONFIG) {
    return { status: "not-run", reason: "KUBECONFIG er ikke sat; rigtig drift kan ikke måles her.", desiredCount: desired.length };
  }
  const result = reconcile(desired, fetchObserved(root, env));
  return { status: result.inSync ? "in-sync" : "drift", source: "live-cluster", ...result };
}
