/**
 * DKC-055 — handoff mellem roller.
 *
 * En overdragelse bærer:
 *   - en change-ID (samme ændring gennem hele lineage),
 *   - et inputdigest (det artefakt der modtages),
 *   - den rollebundne producent og den tilladte modtager,
 *   - et digest over selve overdragelsen.
 *
 * Den menneskelige godkendelse binder den **endelige** plan/diff/runbook. Ændres
 * ét af dem, ændrer bindingen sig, og godkendelsen kan ikke genbruges.
 */
import { digestOf } from "../../policy/pdp/src/crypto.mjs";
import { handoffRule, roleMayConsume, roleMayProduce } from "./roles.mjs";

export class HandoffError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "HandoffError";
    this.code = code;
  }
}

function asAgent(value, registry, label) {
  const agent = typeof value === "string" ? registry?.get(value) : value;
  if (!agent) throw new HandoffError(`${label} skal være en registreret agent`, "unknown_agent");
  return agent;
}

/**
 * Opret en rollebundet overdragelse. Producentens rolle skal måtte producere
 * artefaktet, og modtagerens rolle skal være blandt de tilladte modtagere.
 */
export function createHandoff({
  changeId,
  artifactKind,
  artifactDigest = null,
  inputDigest = null,
  producer,
  receiver,
  registry,
  planDigest = null,
  runbookDigest = null,
  diffDigest = null,
  clock = () => Date.now(),
} = {}) {
  if (!changeId) throw new HandoffError("changeId mangler", "change_id_required");
  const rule = handoffRule(artifactKind);
  if (!rule) throw new HandoffError(`ukendt artefakttype '${artifactKind}'`, "unknown_artifact");
  const p = asAgent(producer, registry, "producenten");
  const r = asAgent(receiver, registry, "modtageren");
  if (p.spiffeId === r.spiffeId) throw new HandoffError("en agent kan ikke overdrage til sig selv", "self_handoff");
  if (!rule.producer.includes(p.role)) throw new HandoffError(`rollen '${p.role}' må ikke producere '${artifactKind}'`, "producer_role");
  if (!rule.receiver.includes(r.role)) throw new HandoffError(`rollen '${r.role}' må ikke modtage '${artifactKind}'`, "receiver_role");
  if (!roleMayProduce(p.role, artifactKind)) throw new HandoffError(`rollen '${p.role}' producerer ikke '${artifactKind}'`, "producer_role");
  if (!roleMayConsume(r.role, artifactKind)) throw new HandoffError(`rollen '${r.role}' modtager ikke '${artifactKind}'`, "receiver_role");

  const payload = {
    changeId,
    artifactKind,
    artifactDigest,
    inputDigest,
    producer: p.spiffeId,
    producerRole: p.role,
    producerModel: p.modelRef ?? null,
    receiver: r.spiffeId,
    receiverRole: r.role,
    planDigest,
    runbookDigest,
    diffDigest,
    at: new Date(clock()).toISOString(),
  };
  return { ...payload, digest: digestOf(payload) };
}

/**
 * Verificér en overdragelse ved modtageren: digesten skal være intakt, og
 * modtageren skal være den tiltænkte.
 */
export function verifyHandoff(handoff, { receiver, registry } = {}) {
  const errors = [];
  if (!handoff?.digest) {
    return { ok: false, errors: [{ path: "/digest", message: "overdragelsen mangler et digest" }] };
  }
  const { digest, ...payload } = handoff;
  if (digestOf(payload) !== digest) errors.push({ path: "/digest", message: "overdragelsens digest matcher ikke indholdet" });
  if (receiver) {
    const r = asAgent(receiver, registry, "modtageren");
    if (handoff.receiver !== r.spiffeId) errors.push({ path: "/receiver", message: `overdragelsen er adresseret til '${handoff.receiver}', ikke '${r.spiffeId}'` });
  }
  const rule = handoffRule(handoff.artifactKind);
  if (!rule) errors.push({ path: "/artifactKind", message: `ukendt artefakttype '${handoff.artifactKind}'` });
  else if (!rule.receiver.includes(handoff.receiverRole)) errors.push({ path: "/receiverRole", message: `rollen '${handoff.receiverRole}' modtager ikke '${handoff.artifactKind}'` });
  return { ok: errors.length === 0, errors };
}

/**
 * Uafhængig verifikation: verifieren må hverken være samme identitet, samme
 * rolle eller forlade sig på samme model som producenten. Samme model i to
 * isolerede identiteter er ikke uafhængig modelkvalitet.
 */
export function assertIndependentVerification({ producer, verifier } = {}) {
  if (!producer || !verifier) throw new HandoffError("producent og verifier kræves", "verifier_required");
  if (producer.spiffeId === verifier.spiffeId) throw new HandoffError("verifieren er samme identitet som producenten", "same_identity");
  if (producer.role === verifier.role) throw new HandoffError("verifieren har samme rolle som producenten", "same_role");
  if (producer.modelRef && verifier.modelRef && producer.modelRef === verifier.modelRef) {
    throw new HandoffError("samme model i to identiteter tæller ikke som uafhængig modelkvalitet", "same_model");
  }
  return true;
}

/**
 * Bind den menneskelige godkendelse til den endelige plan/diff/runbook. Er et
 * af artefakterne ændret efter godkendelsen, matcher digesten ikke.
 */
export function createChangeApprovalBinding({ changeId, handoff, plan = null, diff = null, runbook = null, approvedBy = null, clock = () => Date.now() } = {}) {
  if (!changeId) throw new HandoffError("changeId mangler", "change_id_required");
  const payload = {
    changeId,
    handoffDigest: handoff?.digest ?? null,
    planSha256: plan?.sha256 ?? plan ?? null,
    diffSha256: diff?.sha256 ?? diff ?? null,
    runbookSha256: runbook?.sha256 ?? runbook ?? null,
    approvedBy,
    at: new Date(clock()).toISOString(),
  };
  return { ...payload, digest: digestOf(payload) };
}

export function verifyChangeApprovalBinding(binding, { changeId, handoff, plan = null, diff = null, runbook = null } = {}) {
  const errors = [];
  if (!binding?.digest) return { ok: false, errors: [{ path: "/digest", message: "bindingen mangler et digest" }] };
  if (changeId && binding.changeId !== changeId) errors.push({ path: "/changeId", message: "bindingen gælder en anden change-ID" });
  if (handoff && binding.handoffDigest !== handoff.digest) errors.push({ path: "/handoffDigest", message: "bindingen gælder en anden overdragelse" });
  const expected = {
    planSha256: plan?.sha256 ?? plan ?? null,
    diffSha256: diff?.sha256 ?? diff ?? null,
    runbookSha256: runbook?.sha256 ?? runbook ?? null,
  };
  if (binding.planSha256 !== expected.planSha256) errors.push({ path: "/planSha256", message: "planen er ændret efter godkendelsen" });
  if (binding.diffSha256 !== expected.diffSha256) errors.push({ path: "/diffSha256", message: "diffen er ændret efter godkendelsen" });
  if (binding.runbookSha256 !== expected.runbookSha256) errors.push({ path: "/runbookSha256", message: "runbooken er ændret efter godkendelsen" });
  return { ok: errors.length === 0, errors };
}
