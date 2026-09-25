/**
 * DKC-061 — fjernelse af et modul, holdt adskilt fra sletning af data.
 *
 * En almindelig afinstallering fjerner kun modulet og bevarer data og
 * recoverymetadata. En sletning er en separat, eksplicit destruktiv handling.
 * Før en fjernelse laves en reverse-dependency-kontrol: en delt database eller
 * IAM kan ikke fjernes, mens aktive moduler kræver den. En destruktiv sletning
 * kræver desuden eksport eller verificeret backup og to-personers-kontrol.
 */
import { resolveDependencies, analyzeRemoval } from "../../distribution/src/resolver.mjs";

export const REMOVE_API_VERSION = "contracts.platform/v1alpha1";
export const REMOVE_KIND = "LifecycleRemovalPlan";

export function removalClosure({ components, profile, installed = {}, deploymentProfile = null, serviceClasses = [] }) {
  const selection = [...new Set([...(profile?.optionalApplications ?? []), ...Object.keys(installed)])];
  return resolveDependencies({ components, profile, selection, deploymentProfile, serviceClasses, includeDefaults: true });
}

/**
 * Hvilke aktive moduler kræver `removeId`, og er kravet obligatorisk eller
 * valgfrit? Bruges til at afvise fjernelse af en delt afhængighed.
 */
export function reverseDependencies({ components, profile, installed = {}, removeId, deploymentProfile = null, serviceClasses = [] }) {
  const result = removalClosure({ components, profile, installed, deploymentProfile, serviceClasses });
  return analyzeRemoval(result.entries, removeId);
}

export function buildRemovalPlan({
  installationId,
  removeId,
  mode = "remove-only",
  components,
  profile,
  installed = {},
  exportRef = null,
  backupRef = null,
  recoveryMetadataRef = `lifecycle://recovery/${installationId}/${removeId}`,
  approval = null,
  deploymentProfile = null,
  serviceClasses = [],
  now = "2026-03-01T00:00:00Z",
} = {}) {
  const component = components.find((c) => c.metadata?.name === removeId) ?? null;
  const reverse = reverseDependencies({ components, profile, installed, removeId, deploymentProfile, serviceClasses });
  const requiredDependents = reverse.filter((d) => d.optional === false);
  const blocking = requiredDependents.length > 0 || component?.securityCore === true;

  const checks = [];
  const blockingProblems = [];
  const push = (id, title, status, detail) => checks.push({ id, title, status, detail });

  if (!component) {
    blockingProblems.push(`komponenten '${removeId}' findes ikke i kataloget`);
    push("component-known", "Komponenten findes i kataloget", "fail", `ukendt komponent '${removeId}'`);
  } else {
    push("component-known", "Komponenten findes i kataloget", "pass", `${component.componentType} ${component.metadata?.version}`);
  }

  if (blocking) {
    blockingProblems.push(`fjernelse af '${removeId}' afvises: den er en delt afhængighed for ${requiredDependents.map((d) => d.id).join(", ")}`);
    push("reverse-dependency", "Ingen aktive moduler kræver komponenten", "fail", requiredDependents.map((d) => d.id).join(", "));
  } else {
    push("reverse-dependency", "Ingen aktive moduler kræver komponenten", "pass", `${reverse.length} afhængige, ingen obligatoriske`);
  }

  if (component?.securityCore === true) {
    blockingProblems.push(`sikkerhedskernen '${removeId}' kan ikke fjernes separat; den kræver en planlagt udfasning`);
    push("security-core", "Sikkerhedskernen fjernes ikke i en almindelig afinstallering", "fail", "securityCore: true");
  } else {
    push("security-core", "Sikkerhedskernen fjernes ikke i en almindelig afinstallering", "pass", "ikke sikkerhedskerne");
  }

  const destructive = mode === "remove-and-delete-data";
  if (destructive) {
    if (!exportRef && !backupRef) blockingProblems.push("datasletning kræver en eksport eller en verificeret backup");
    push("export-or-backup", "Eksport eller verificeret backup før sletning", exportRef || backupRef ? "pass" : "fail", exportRef ?? backupRef ?? "mangler");
    if (approval?.secondHumanSubject && approval.secondHumanSubject !== approval.humanSubject) {
      push("two-person", "To-personers-kontrol ved datasletning", "pass", approval.secondHumanSubject);
    } else {
      blockingProblems.push("datasletning kræver to forskellige navngivne personer");
      push("two-person", "To-personers-kontrol ved datasletning", "fail", "mangler");
    }
  } else {
    push("preserve-data", "Almindelig afinstallering bevarer data og recoverymetadata", "pass", recoveryMetadataRef);
  }

  const steps = [];
  let order = 1;
  const add = (id, kind, description, mutating, requiresApproval, dependsOn = []) => {
    steps.push({ id, order: order++, kind, description, mutating, requiresApproval, dependsOn, state: "pending" });
  };
  add("preflight", "preflight", "Kør read-only reverse-dependency- og sikkerhedskerne-kontrol", false, false);
  add("reverse-dependency-check", "reverse-dependency-check", "Bekræft at ingen aktive moduler kræver komponenten", false, false, ["preflight"]);
  if (destructive) {
    add("export", "export", "Eksportér komponentens data i et selvbeskrivende format", true, true, ["reverse-dependency-check"]);
    add("backup", "backup", "Tag og verificér en backup før sletning", true, true, ["export"]);
    add("remove", "remove", "Fjern modulet (bevarer intet aktivt modul)", true, true, ["backup"]);
    add("delete-data", "delete-data", "Slet data eksplicit efter destruktiv godkendelse", true, true, ["remove"]);
  } else {
    add("remove", "remove", "Afinstallér modulet og bevar data og recoverymetadata", true, true, ["reverse-dependency-check"]);
  }
  add("verify", "verify", "Verificér at data og recoverymetadata er bevaret (eller slettet som godkendt)", false, false, [destructive ? "delete-data" : "remove"]);

  return {
    apiVersion: REMOVE_API_VERSION,
    kind: REMOVE_KIND,
    metadata: {
      name: `removal-plan-${installationId}-${removeId}`.slice(0, 63),
      version: "1.0.0",
      createdAt: now,
      description: `${destructive ? "Fjernelse og datasletning" : "Almindelig afinstallering"} af '${removeId}' med reverse-dependency-kontrol og eksplicit datadisposition.`,
      installationId,
    },
    component: component ? { id: removeId, version: component.metadata.version, componentType: component.componentType } : { id: removeId, version: "0.0.0", componentType: "unknown" },
    mode,
    reverseDependencies: reverse.map((d) => ({ id: d.id, required: d.optional === false, reason: d.reason ?? "afhængighed" })),
    blocking,
    dataDisposition: {
      preserve: !destructive,
      exportRef: destructive ? exportRef : null,
      backupRef: destructive ? backupRef : null,
      recoveryMetadataRef: recoveryMetadataRef,
      destructiveApproved: destructive ? approval?.destructiveApproved === true : false,
    },
    preflight: { ok: blockingProblems.length === 0, checks, blockingProblems },
    authorization: {
      required: destructive,
      humanSubject: approval?.humanSubject ?? null,
      secondHumanSubject: approval?.secondHumanSubject ?? null,
      approvalRef: approval?.approvalRef ?? null,
    },
    steps,
    restrictions: {
      separateFromDataDeletion: true,
      requiresReverseDependencyCheck: true,
      requiresExportOrBackup: true,
      explicitDestructiveAction: true,
    },
  };
}

export async function executeRemoval({ plan, store, executors, authorization = null, at = "2026-03-01T00:00:00Z" } = {}) {
  if (!plan) throw new Error("executeRemoval kræver en plan");
  if (!store) throw new Error("executeRemoval kræver en butik");
  const requiredDependents = (plan.reverseDependencies ?? []).filter((d) => d.required === true);
  if (requiredDependents.length > 0) {
    return { ok: false, code: "SHARED_DEPENDENCY", error: `fjernelse afvises: '${plan.component.id}' kræves af ${requiredDependents.map((d) => d.id).join(", ")}` };
  }
  if (plan.mode === "remove-and-delete-data") {
    if (!plan.dataDisposition.exportRef && !plan.dataDisposition.backupRef) return { ok: false, code: "NO_EXPORT_OR_BACKUP", error: "datasletning kræver eksport eller backup" };
    const twoPerson = authorization?.humanSubject && authorization?.secondHumanSubject && authorization.humanSubject !== authorization.secondHumanSubject;
    if (!twoPerson) return { ok: false, code: "TWO_PERSON_REQUIRED", error: "datasletning kræver to forskellige navngivne personer" };
  }
  const id = plan.metadata.name;
  let record = store.getRemoval(id) ?? { id, mode: plan.mode, component: plan.component.id, status: "pending", steps: {}, at };
  for (const step of [...plan.steps].sort((a, b) => a.order - b.order)) {
    if (record.steps[step.id]?.state === "done") continue;
    record = { ...record, steps: { ...record.steps, [step.id]: { state: "done", result: executors ? await executors.run(step, { plan, at }) : null } } };
    store.upsertRemoval(record);
  }
  record = { ...record, status: "done", at };
  store.upsertRemoval(record);
  return { ok: true, record };
}
