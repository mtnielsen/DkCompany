/**
 * DKC-004 — serverstyret godkendelsespolitik.
 *
 * Politikken bestemmer hvem der må godkende, hvor mange unikke godkendere der
 * kræves, hvilke træningsmoduler der er obligatoriske, hvor længe anmodningen
 * lever, hvem der må tilbagekalde, og om selv-godkendelse er forbudt.
 *
 * Politikken udledes af ændringens verbum/miljø/autonomiklasse — aldrig af
 * klientens påstande om egne grupper eller gennemført træning. En installation
 * kan overskrive den med `approvalPolicy`.
 */
export function defaultApprovalPolicy(request) {
  const verb = request?.change?.verb ?? "";
  const environment = request?.change?.environment ?? "dev";

  const base = {
    requiredApprovals: 2,
    eligibleGroups: ["platform-approvers"],
    requiredTrainingModules: ["evidence-over-prose", "when-to-reject"],
    expiresInSeconds: 24 * 60 * 60,
    revocationRoles: ["security-officer", "approval-administrator"],
    selfApprovalForbidden: true,
  };

  if (/^privacy\./.test(verb)) {
    return { ...base, requiredApprovals: 1, eligibleGroups: ["dpo-approvers"], requiredTrainingModules: ["evidence-over-prose", "privacy"] };
  }

  if (environment === "prod") {
    return { ...base, requiredApprovals: 3, eligibleGroups: ["platform-approvers", "release-managers"] };
  }

  if (request?.change?.autonomyClass === "A2") {
    return { ...base, requiredApprovals: 1 };
  }

  return base;
}

/** Anvend politikken på en anmodning og returnér den effektive politik. */
export function resolvePolicy(request, approvalPolicy = defaultApprovalPolicy) {
  const resolved = approvalPolicy(request) ?? {};
  return {
    requiredApprovals: resolved.requiredApprovals ?? 2,
    eligibleGroups: resolved.eligibleGroups ?? ["platform-approvers"],
    requiredTrainingModules: resolved.requiredTrainingModules ?? [],
    expiresInSeconds: resolved.expiresInSeconds ?? 24 * 60 * 60,
    revocationRoles: resolved.revocationRoles ?? ["security-officer", "approval-administrator"],
    selfApprovalForbidden: resolved.selfApprovalForbidden !== false,
  };
}
