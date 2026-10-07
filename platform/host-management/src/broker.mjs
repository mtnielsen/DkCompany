/**
 * DKC-058 — den begrænsede, deterministiske privilegerede host-broker.
 *
 * Brokeren er den eneste komponent, der må anmode om et host-credential. Den:
 *
 *   - accepterer kun en signeret operation med en menneskelig godkendelse,
 *   - afviser enhver ændring af broker/policy/pakkekilde/payload,
 *   - afviser arbitrær shell, uploadede scripts og usignerede pakker,
 *   - udsteder kun et kortlivet, scope-bundet operationsticket til rollen
 *     `executor` — aldrig til en planner eller implementer,
 *   - verificerer den registrerede runbook-digest, så godkendelsen er bundet til
 *     præcis den version, der udføres.
 *
 * Signaturen (HMAC-SHA256) dækker hele det kanoniske indhold undtagen
 * signaturfeltet.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { stableStringify } from "../../approvals/src/binding.mjs";
import { deriveAudience } from "../../credentials/src/scope.mjs";
import { operationProblems } from "./model.mjs";

export const OPERATION_ALGORITHMS = ["hmac-sha256"];

export function canonicalOperation(operation) {
  const { signature, ...rest } = operation ?? {};
  return JSON.parse(JSON.stringify(rest));
}

export function signOperation(operation, { keyId, secret, signedAt = new Date().toISOString() } = {}) {
  if (!keyId) throw new Error("signOperation kræver keyId");
  if (!secret) throw new Error("signOperation kræver en signeringsnøgle (secret)");
  const value = createHmac("sha256", secret).update(stableStringify(canonicalOperation(operation))).digest("hex");
  return { ...canonicalOperation(operation), signature: { algorithm: "hmac-sha256", keyId, value, signedAt } };
}

function lookupKey(keyring, keyId) {
  if (!keyring || !keyId) return null;
  if (Array.isArray(keyring.keys)) return keyring.keys.find((k) => k.keyId === keyId) ?? null;
  return keyring[keyId] ? { keyId, secret: keyring[keyId] } : null;
}

export function verifyOperationSignature(operation, keyring) {
  const signature = operation?.signature;
  if (!signature) return { ok: false, reason: "operationen er ikke signeret" };
  if (!OPERATION_ALGORITHMS.includes(signature.algorithm)) return { ok: false, reason: `ukendt signaturalgoritme '${signature.algorithm}'` };
  const entry = lookupKey(keyring, signature.keyId);
  if (!entry) return { ok: false, reason: `signeringsnøglen '${signature.keyId}' er ikke kendt` };
  if (entry.revokedAt) return { ok: false, reason: `signeringsnøglen '${signature.keyId}' er tilbagekaldt` };
  const expected = createHmac("sha256", entry.secret).update(stableStringify(canonicalOperation(operation))).digest("hex");
  const a = Buffer.from(String(signature.value), "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "operationens signatur matcher ikke indholdet" };
  return { ok: true, keyId: signature.keyId };
}

export class BrokerDenied extends Error {
  constructor(message, code = "BROKER_DENIED", problems = []) {
    super(message);
    this.name = "BrokerDenied";
    this.code = code;
    this.problems = problems;
  }
}

/**
 * @param {object} opts
 * @param {object} opts.credentialBroker  DKC-010-broker (Ed25519-signeret).
 * @param {object} opts.keyring           Nøglesæt til operationens signatur.
 * @param {object} opts.enrollment        Hostens enrollment.
 * @param {object} opts.profile           Host-profilen.
 * @param {Map}    opts.runbooks          ref → digest for kendte runbooks.
 * @param {Array}  opts.allowlistedPackageSources
 * @param {Function} opts.clock
 */
export function createHostBroker({
  credentialBroker,
  keyring,
  enrollment,
  profile,
  runbooks = new Map(),
  allowlistedPackageSources = [],
  clock = () => Date.now(),
} = {}) {
  if (!credentialBroker) throw new BrokerDenied("host-brokeren kræver en credential-broker", "NO_CREDENTIAL_BROKER");
  if (!enrollment || !profile) throw new BrokerDenied("host-brokeren kræver et enrollment og en profil", "MISSING_CONTEXT");

  const tickets = new Map();

  function verifyOperation(operation) {
    const verified = verifyOperationSignature(operation, keyring);
    if (!verified.ok) throw new BrokerDenied(verified.reason, "BAD_SIGNATURE");
    const problems = operationProblems(operation, { enrollment, profile, runbooks });
    if (problems.length) throw new BrokerDenied(problems.map((p) => `${p.path} ${p.message}`).join("; "), "OPERATION_DENIED", problems);
    const approval = operation.approval ?? {};
    const expires = Date.parse(approval.expiresAt ?? "");
    if (!Number.isFinite(expires) || expires <= clock()) throw new BrokerDenied("den menneskelige godkendelse er udløbet", "APPROVAL_EXPIRED");
    if (operation.package && !allowlistedPackageSources.includes(operation.package.source)) {
      throw new BrokerDenied(`pakkekilden '${operation.package.source}' er ikke på allowlisten`, "PACKAGE_SOURCE_DENIED");
    }
    return operation;
  }

  /**
   * Autorisér og udsted operationsticket. Kun en executor-agent får et ticket.
   * En planner eller implementer afvises, uanset hvilket credential den måtte
   * medbringe.
   */
  function issueOperationTicket({ operation, executorAgent, ttlSeconds = 120 } = {}) {
    if (!executorAgent || executorAgent.role !== "executor") {
      throw new BrokerDenied("kun en agent med rollen 'executor' må modtage et operationsticket", "EXECUTOR_REQUIRED");
    }
    if (executorAgent.role === "planner" || executorAgent.role === "implementer") {
      throw new BrokerDenied("planner/implementer må ikke have host-credentials", "HOST_CREDENTIALS_FORBIDDEN");
    }
    verifyOperation(operation);
    const resource = operation.operation.target;
    const audience = deriveAudience({ action: { target: resource, audience: "module:host" } });
    const verb = operation.operation.verb;
    const { token, jti, claims } = credentialBroker.issue({
      spiffeId: executorAgent.spiffeId,
      agentRef: executorAgent.id ?? executorAgent.agentRef,
      role: "executor",
      tenantId: operation.tenantId,
      verb,
      resource,
      audience,
      environment: operation.environment,
      taskId: operation.operation.id,
      ttlSeconds,
      onBehalfOf: operation.approval.humanSubject,
    });
    const ticket = {
      operationId: operation.operation.id,
      hostRef: operation.hostRef,
      verb,
      target: resource,
      environment: operation.environment,
      tenantId: operation.tenantId,
      dryRun: operation.operation.dryRun === true,
      credential: token,
      jti,
      expiresAt: claims.exp,
      executor: { id: executorAgent.id ?? null, spiffeId: executorAgent.spiffeId, role: "executor" },
      approvedBy: operation.approval.humanSubject,
      runbookRef: operation.approval.runbookRef,
    };
    tickets.set(operation.operation.id, ticket);
    return ticket;
  }

  /** Implementer/planner må ikke have host-credentials — hverken nu eller senere. */
  function assertNoHostCredentials({ agent, credentials = [] } = {}) {
    if (agent && (agent.role === "planner" || agent.role === "implementer")) {
      if (credentials.length > 0) throw new BrokerDenied(`rollen '${agent.role}' må ikke have host-credentials`, "HOST_CREDENTIALS_FORBIDDEN");
    }
    return true;
  }

  function getTicket(operationId) {
    return tickets.get(operationId) ?? null;
  }

  return { kind: "host-broker", enrollment, profile, issueOperationTicket, verifyOperation, assertNoHostCredentials, getTicket, tickets };
}
