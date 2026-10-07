#!/usr/bin/env node
/**
 * DKC-025 — CLI for portalen.
 *
 *   node portal/src/cli.mjs check     # validér pakker, autorisation og dokument
 *   node portal/src/cli.mjs write      # skriv docs/status/portal.md
 *   node portal/src/cli.mjs preview    # vis bestillingspreview for en pakke
 *   node portal/src/cli.mjs demo       # kør et kontrolleret kunde-forløb
 */
import { relative } from "node:path";
import { checkPortal, formatProblems, outputPath, writePortalDoc } from "./check.mjs";
import { loadServicePackages, orderPreview, selectPackage } from "./packages.mjs";
import { createMemoryPortalStore } from "./store.mjs";
import { createLifecycle } from "./lifecycle.mjs";
import { createMemoryExecutor, createProvisioner } from "./provisioning.mjs";
import { repoRoot } from "./packages.mjs";

const HELP = `Brug: node portal/src/cli.mjs <kommando>

Kommandøer:
  check             validér servicepakker, autorisation, livscyklus og dokument
  write              skriv docs/status/portal.md fra pakkerne
  preview <pakke>   vis bestillingspreview (pris og konsekvenser)
  demo              kør et kontrolleret kunde-forløb med revisionsspor
`;

const OPERATOR = { id: "oidc|ops.olsen", kind: "human", name: "Ops Olsen", roles: ["platform-operator", "platform-operator:*"], tenantScope: ["*"] };
const APPROVER = { id: "oidc|ada.approver", kind: "human", name: "Ada Approver", roles: ["platform-approver", "platform-approver:acme"], tenantScope: ["acme"] };
const CUSTOMER_ADMIN = { id: "oidc|carol.customer", kind: "human", name: "Carol Customer", tenantId: "acme", roles: ["customer-admin"] };

async function demo() {
  const packages = loadServicePackages().map((entry) => entry.package);
  const store = createMemoryPortalStore();
  const lifecycle = createLifecycle({ store, packages, clock: () => Date.parse("2026-09-24T08:00:00Z") });
  const executor = createMemoryExecutor({ failAfterKeys: new Set(["hr"]) });
  const provisioner = createProvisioner({ store, packages, executor, clock: () => Date.parse("2026-09-24T08:00:00Z") });
  const recordEvent = lifecycle.recordEvent;

  const output = { steps: [] };
  lifecycle.createCustomer({ principal: OPERATOR, customer: { tenantId: "acme", name: "Acme ApS" } });
  output.steps.push("customer.created");

  const pkg = selectPackage(packages, { packageId: "hr-suite" });
  const preview = orderPreview(pkg);
  const order = lifecycle.orderModule({
    principal: CUSTOMER_ADMIN,
    tenantId: "acme",
    packageId: "hr-suite",
    acknowledgedConsequences: preview.requiresAcknowledgment,
  });
  output.steps.push("order.created");
  output.preview = { monthly: preview.monthly, firstMonthTotal: preview.firstMonthTotal, consequences: preview.consequences.length };

  lifecycle.approveOrder({ principal: APPROVER, orderId: order.orderId });
  output.steps.push("order.approved");

  // Første forsøg fejler på HR-modulet efter ressourceoprettelsen; derefter
  // genoptages forløbet, og ressourcen genbruges i stedet for at blive oprettet
  // igen.
  const first = await provisioner.runOrder({ orderId: order.orderId, principal: APPROVER, recordEvent });
  output.firstRun = { status: first.status, failedStepId: first.failedStepId };
  const second = await provisioner.runOrder({ orderId: order.orderId, principal: APPROVER, recordEvent });
  output.secondRun = { status: second.status, reused: second.steps.filter((s) => s.state === "reused").length };
  output.duplicates = provisioner.duplicateResources(order.orderId);

  lifecycle.suspendCustomer({ principal: CUSTOMER_ADMIN, tenantId: "acme", reason: "planlagt vedligeholdelse" });
  lifecycle.resumeCustomer({ principal: CUSTOMER_ADMIN, tenantId: "acme", reason: "vedligeholdelse afsluttet" });
  lifecycle.windDownCustomer({ principal: CUSTOMER_ADMIN, tenantId: "acme", reason: "kunden opsiger abonnementet" });
  lifecycle.completeWindDownStep({ principal: OPERATOR, tenantId: "acme", step: "export", reason: "dataeksport leveret" });
  lifecycle.completeWindDownStep({ principal: OPERATOR, tenantId: "acme", step: "deletion", reason: "data slettet" });
  lifecycle.closeCustomer({ principal: OPERATOR, tenantId: "acme", reason: "afvikling gennemført og verificeret" });
  output.steps.push("customer.closed");

  output.auditProblems = lifecycle.verifyAuditTrail("acme");
  output.eventCount = store.listEvents("acme").length;
  output.customer = store.getCustomer("acme");

  const ok = output.auditProblems.length === 0 && output.duplicates.length === 0 && output.secondRun.status === "active" && output.secondRun.reused >= 1;
  console.log(JSON.stringify(output, null, 2));
  if (!ok) process.exit(1);
}

function main() {
  const [command, arg] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  try {
    if (command === "check") {
      const { problems, packages } = checkPortal(repoRoot);
      if (problems.length) {
        console.error(`✘ Portal-kontrol fejlede med ${problems.length} problem(er):\n${formatProblems(problems)}`);
        process.exit(1);
      }
      console.log(`✔ Portalen er konsistent: ${packages.length} servicepakker, autorisation og livscyklus dækket`);
    } else if (command === "write") {
      const path = writePortalDoc(repoRoot);
      console.log(`✔ ${relative(repoRoot, path)} skrevet`);
    } else if (command === "preview") {
      const packages = loadServicePackages().map((entry) => entry.package);
      const pkg = selectPackage(packages, { packageId: arg });
      if (!pkg) {
        console.error(`✘ Ukendt servicepakke: ${arg ?? "(mangler)"}`);
        process.exit(2);
      }
      console.log(JSON.stringify(orderPreview(pkg), null, 2));
    } else if (command === "demo") {
      demo().catch((err) => {
        console.error(`✘ ${err.message}`);
        process.exit(1);
      });
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

export { demo, OPERATOR, APPROVER, CUSTOMER_ADMIN };
