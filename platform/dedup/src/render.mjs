/**
 * DKC-043 — generering af dedup-planen som dokumentation.
 *
 * Dokumentet er afledt af den kanoniske politik, så et menneske kan læse
 * grænserne, garbage collection og besparelsesgaten uden at læse JSON.
 */
export function renderDedupPlan(policy) {
  const lines = [];
  lines.push("# Dedup-plan");
  lines.push("");
  lines.push("> Genereret fra `dedup/dedup-policy.json` med `make dedup-write`. Redigér kilden, ikke dette dokument.");
  lines.push("");
  lines.push(policy.metadata?.description ?? "");
  lines.push("");
  lines.push(`- **Politikversion:** ${policy.metadata?.version}`);
  lines.push(`- **Gennemprøvet backupløsning:** \`${policy.provenBackupSolutionRef}\``);
  lines.push(`- **Dedup af primærdata valgfrit:** ${policy.primaryDataDedupOptional ? "ja" : "nej"}`);
  lines.push(`- **Tværkundededuplikering:** ${policy.crossTenantDedup ? "ja (FORBUDT)" : "nej"}`);
  lines.push("");
  lines.push("## Dedup-domæner");
  lines.push("");
  lines.push("| Kategori | Aktiv | Semantik | Tenant | Krypteringsdomæne | Retentionklasse | Tværkunde |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const domain of policy.domains ?? []) {
    const b = domain.boundary ?? {};
    lines.push(`| ${domain.category} | ${domain.enabled ? "ja" : "nej"} | ${domain.mergeSemantics} | ${b.tenantScoped ? "ja" : "nej"} | ${b.encryptionDomainScoped ? "ja" : "nej"} | ${b.retentionClassScoped ? "ja" : "nej"} | ${b.crossTenantDedup ? "ja" : "nej"} |`);
  }
  lines.push("");
  lines.push("## Garbage collection");
  lines.push("");
  const gc = policy.garbageCollection ?? {};
  lines.push(`- Retention-aware: ${gc.retentionAware ? "ja" : "nej"}`);
  lines.push(`- Mark-and-sweep: ${gc.markAndSweep ? "ja" : "nej"}`);
  lines.push(`- Single-writer lease: ${gc.singleWriterLease ? "ja" : "nej"} (prune kræver lease: ${gc.leaseRequiredForPrune ? "ja" : "nej"})`);
  lines.push("");
  lines.push("## Besparelsesgate");
  lines.push("");
  const gate = policy.savingsGate ?? {};
  lines.push(`- Kræver integritetskontrol: ${gate.requireIntegrityCheck ? "ja" : "nej"}`);
  lines.push(`- Kræver fuld restore: ${gate.requireFullRestore ? "ja" : "nej"}`);
  lines.push(`- Aktiveres kun når begge består: ${gate.activateOnlyWhenBothPass ? "ja" : "nej"}`);
  lines.push("");
  return lines.join("\n") + "\n";
}

export const DEDUP_PLAN_DOC = "docs/storage/dedup-plan.md";
