#!/usr/bin/env node
/**
 * DKC-022 — CLI for evidens- og risikoregisteret.
 *
 *   node compliance/src/assurance-cli.mjs write    # skriv docs/compliance/assurance.md
 *   node compliance/src/assurance-cli.mjs check     # validér, krydsreferér og tjek dokumentsync
 *   node compliance/src/assurance-cli.mjs export    # saml evidenspakken fra evidence/records
 *   node compliance/src/assurance-cli.mjs status    # vis blokere for en pilot med persondata
 *
 * Registeret er kanonisk i compliance/assurance-register.json. En eksport
 * erklærer aldrig platformen compliant eller production-ready; den samler
 * faktisk evidens og markerer forældet, artefakt-mismatchet og manglende
 * evidens ærligt.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  assembleEvidencePackage,
  checkRegister,
  loadAssuranceRegister,
  loadEvidenceRecordMap,
  outputPath,
  packagePath,
  registerPath,
  renderAssuranceDoc,
  repoRoot,
} from "./assurance.mjs";
import { pilotBlockers } from "../../conformance/src/assurance.mjs";
import { runBreachExercise } from "./incident-drill.mjs";

const HELP = `Brug: node compliance/src/assurance-cli.mjs <kommando>

Kommandøer:
  write    skriv docs/compliance/assurance.md fra registeret
  check    validér registeret og fejl hvis dokumentet er ude af trit
  export   saml evidenspakken og skriv evidence/generated/assurance-package.json
  status   vis krav, beslutninger og blokere for en pilot med persondata
  drill    kør en deterministisk brudøvelse med dokumenteret beslutning
`;

function write() {
  const register = checkRegister();
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, renderAssuranceDoc(register));
  return register;
}

function check() {
  const register = checkRegister();
  const expected = renderAssuranceDoc(register);
  if (!existsSync(outputPath)) throw new Error(`${relative(repoRoot, outputPath)} mangler. Kør 'make assurance-write'.`);
  if (readFileSync(outputPath, "utf8") !== expected) {
    throw new Error(`${relative(repoRoot, outputPath)} er ude af trit med registeret. Kør 'make assurance-write'.`);
  }
  return register;
}

function exportPackage() {
  const register = check();
  const evidenceDir = join(repoRoot, "evidence", "records");
  const evidenceRecords = loadEvidenceRecordMap(evidenceDir);
  const pkg = assembleEvidencePackage({ register, evidenceRecords, registerCommit: process.env.DKC_COMMIT ?? null });
  mkdirSync(dirname(packagePath), { recursive: true });
  writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");
  return pkg;
}

function main() {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  try {
    if (command === "write") {
      const register = write();
      console.log(`✔ ${relative(repoRoot, outputPath)} skrevet fra ${relative(repoRoot, registerPath)} (${register.requirements.length} krav)`);
    } else if (command === "check") {
      const register = check();
      const blockers = pilotBlockers(register);
      console.log(`✔ Evidens- og risikoregister valideret: ${register.requirements.length} krav, ${register.risks.length} risici, ${register.decisions.length} beslutninger`);
      console.log(`✔ ${register.dataProtection.dpiaScreenings.length} DPIA-screening(er), ${register.dataProtection.processorAgreements.length} databehandleraftale(r), ${register.dataProtection.transferAssessments.length} overførselsvurdering(er)`);
      console.log(`⚠ ${blockers.length} blokerende forhold for en pilot med persondata (ikke en certificering)`);
    } else if (command === "export") {
      const pkg = exportPackage();
      console.log(`✔ Evidenspakke skrevet: ${relative(repoRoot, packagePath)}`);
      console.log(`  badge=${pkg.badge} productionReady=${pkg.productionReady} complianceStatus=${pkg.complianceStatus}`);
      console.log(`  ${pkg.summary.requirements} krav, ${pkg.summary.missing} manglende evidens, ${pkg.summary.rejectedEvidence} afvist, ${pkg.summary.pilotBlockers} pilot-blockere`);
    } else if (command === "status") {
      const register = check();
      const blockers = pilotBlockers(register);
      if (blockers.length === 0) console.log("Ingen blokere for persondatapilot fundet i registeret (ikke en certificering).");
      else for (const b of blockers) console.log(`- ${b.kind} ${b.id}: ${b.reason}`);
    } else if (command === "drill") {
      const register = check();
      const report = runBreachExercise({
        register,
        scenario: {
          id: "assurance-breach-drill",
          detectedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
          severity: "high",
          personalDataAffected: true,
          decision: {
            notifyAuthority: true,
            notifyCustomers: true,
            rationale: "Syntetisk øvelsesbeslutning: hændelsen er persondatabærende og anmeldes til myndighed og kunder.",
            decidedBy: { subject: "oidc|cecilia.christensen", name: "Cecilia Christensen", role: "Security Owner" },
          },
        },
      });
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.error(`Ukendt kommando: ${command}\n\n${HELP}`);
      process.exit(2);
    }
  } catch (err) {
    console.error(`✘ ${err.message}`);
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
