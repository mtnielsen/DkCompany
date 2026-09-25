/**
 * DKC-035 — fail-closed gates for forretningsmodulfamilierne.
 *
 * 'Danmarksklar' kræver, at hvert blokerende lokaliseringskrav er bekræftet af
 * et navngivet menneske, at en eventuel betalingstjeneste er godkendt med
 * begrænsede scopes, og at den valgte kandidat er menneskeligt godkendt. En
 * manglende afgørelse giver 'pending' — aldrig en falsk grøn.
 */
import { deriveFamilyStatus } from "./model.mjs";

export function evaluatePaymentGate(interfaces) {
  const iface = (interfaces?.interfaces ?? []).find((i) => i.id === "payment-bank");
  if (!iface) return { ok: false, approved: false, gate: "missing", allowedScopes: [], deniedScopes: [], problems: ["payment-bank-grænsefladen mangler"] };
  const problems = [];
  if (iface.externalServiceRequired !== true) problems.push("betaling skal kræve en ekstern tjeneste");
  const approved = Boolean(iface.approvedExternalServiceRef);
  if (!approved) problems.push("ingen godkendt ekstern betalingstjeneste");
  if ((iface.scopes ?? []).some((s) => /bank:full-access|cards:|accounts:full-access/.test(s.id))) {
    problems.push("grænsefladen erklærer et forbudt scope");
  }
  if (!(iface.deniedScopes ?? []).includes("bank:full-access")) problems.push("fuld bankadgang er ikke eksplicit forbudt");
  return {
    ok: problems.length === 0,
    approved,
    externalServiceRequired: iface.externalServiceRequired === true,
    gate: approved ? "approved" : "pending",
    allowedScopes: (iface.scopes ?? []).map((s) => s.id),
    deniedScopes: iface.deniedScopes ?? [],
    problems,
  };
}

export function evaluateFamilyGate(family, requirements, interfaces, candidate) {
  const reqs = (family.localeRequirements ?? []).map((id) => (requirements?.requirements ?? []).find((r) => r.id === id)).filter(Boolean);
  const blocking = reqs.filter((r) => r.gate?.blocksDanishReady === true);
  const pendingGates = blocking.filter((r) => r.status !== "confirmed").map((r) => ({ id: r.id, status: r.status }));
  const advisoryGates = reqs.filter((r) => r.gate?.blocksDanishReady !== true && r.status !== "confirmed").map((r) => ({ id: r.id, status: r.status }));
  const payment = evaluatePaymentGate(interfaces);
  const usesPayment = (family.localeRequirements ?? []).includes("payment");
  const paymentOk = !usesPayment || payment.approved;
  const candidateApproved = candidate?.selectedGateStatus === "approved";
  const danishReady = pendingGates.length === 0 && paymentOk && candidateApproved;
  return {
    family: family.id,
    familyStatus: deriveFamilyStatus(family, requirements?.requirements ?? [], interfaces?.interfaces ?? []),
    danishReady,
    pendingGates,
    advisoryGates,
    payment: usesPayment ? { gate: payment.gate, approved: payment.approved, allowedScopes: payment.allowedScopes, deniedScopes: payment.deniedScopes } : null,
    candidateGate: candidate?.selectedGateStatus ?? "blocked",
  };
}
