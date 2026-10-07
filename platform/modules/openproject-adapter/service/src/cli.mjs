#!/usr/bin/env node
/**
 * DKC-027 — CLI for projektstyringsadapteren.
 *
 *   node src/cli.mjs serve [--port 8092 ...]   # kør adapteren mod en OpenProject
 *   node src/cli.mjs demo                      # kør et kontrolleret projektforløb mod mock
 *
 * `serve` kræver en rigtig OpenProject (NOT RUN i dette miljø). `demo` beviser
 * domæneadfærden deterministisk mod mock-upstream uden netværk.
 */
import { createOpenProjectAdapter } from "./server.mjs";
import { createOpenProjectClient } from "./openproject.mjs";
import { createMockOpenProject } from "./mock-openproject.mjs";
import { createProjectService } from "./projects.mjs";
import { createPdpClient } from "./pdp-client.mjs";
import { createSpiffeAuthenticator, createAuthenticator } from "./auth.mjs";
import { ROLES } from "./constants.mjs";

function parseArgs(argv) {
  const args = { command: argv[0] ?? "serve", port: 8092, pdp: "http://127.0.0.1:8181/v1/data/platform/ops/decision", openproject: "http://openproject:80", token: "change-me", trustDomain: "platform.example.org", environment: "dev", profile: "production", trustedProxies: [] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") args.port = Number(argv[++i]);
    else if (a === "--pdp") args.pdp = argv[++i];
    else if (a === "--openproject") args.openproject = argv[++i];
    else if (a === "--token") args.token = argv[++i];
    else if (a === "--trust-domain") args.trustDomain = argv[++i];
    else if (a === "--profile") args.profile = argv[++i];
    else if (a === "--trusted-proxy") args.trustedProxies.push(argv[++i]);
    else if (a === "--proxy-secret") args.proxySecret = argv[++i];
    else if (a === "--environment") args.environment = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`ukendt argument: ${a}`);
  }
  return args;
}

async function serve(args) {
  if (args.help) {
    console.log("Brug: node src/cli.mjs serve [--port 8092] [--openproject url] [--pdp url]");
    return;
  }
  const adapter = createOpenProjectAdapter({
    authenticate: createAuthenticator([
      createSpiffeAuthenticator({
        trustDomain: args.trustDomain,
        profile: args.profile,
        trustedProxies: args.trustedProxies,
        proxySecret: args.proxySecret,
      }),
    ]),
    pdp: createPdpClient({ endpoint: args.pdp, failMode: "closed" }),
    client: createOpenProjectClient({ baseUrl: args.openproject, token: args.token }),
    environment: args.environment,
    profile: args.profile,
    onEvent: (e) => console.log(JSON.stringify(e)),
  });
  const port = await adapter.listen(args.port);
  console.log(`openproject-adapter lytter på http://127.0.0.1:${port}`);
  console.log(`  upstream: ${args.openproject} (uændret)`);
  console.log(`  PDP: ${args.pdp} (fail-closed)`);
}

async function demo() {
  const mock = createMockOpenProject();
  const mockPort = await mock.listen(0);
  const client = createOpenProjectClient({ baseUrl: `http://127.0.0.1:${mockPort}`, token: "test-token" });
  const service = createProjectService({ client, policy: { guestAccess: "own-projects-only" } });
  const anna = { id: "anna", kind: "human", tenantId: "acme", role: ROLES.TENANT_ADMIN, groups: ["acme"] };
  const bo = { id: "bo", kind: "human", tenantId: "acme", role: ROLES.MEMBER, groups: ["acme"] };
  const gus = { id: "gus", kind: "human", tenantId: "acme", role: ROLES.GUEST, groups: ["acme"] };
  const carla = { id: "carla", kind: "human", tenantId: "globex", role: ROLES.MEMBER, groups: ["globex"] };

  const listed = await service.listProjects({ actor: bo });
  console.log(`bo ser ${listed.projects.length} projekter (projektion v${listed.projection.version})`);

  const bundle = await service.exportProjectData({ actor: anna, projectId: "10" });
  console.log(`alpha eksporteret: ${bundle.workPackages.length} arbejdspakker, ${bundle.statusEvents.length} statushændelser`);

  const incoming = { ...bundle, workPackages: [...bundle.workPackages, { externalId: "WP-NEW", subject: "Ny opgave", type: "task", status: "new", tenantId: "acme" }] };
  const first = await service.importProjectBundle({ actor: anna, bundle: incoming, approvals: [{ verdict: "approve" }] });
  const second = await service.importProjectBundle({ actor: anna, bundle: incoming, approvals: [{ verdict: "approve" }] });
  console.log(`import 1: oprettet=${first.created} opdateret=${first.updated}; import 2 (retry): idempotent=${second.idempotent}`);

  await service.readProject({ actor: carla, projectId: "10" }).then(
    () => console.log("FEJL: carla (globex) fik adgang"),
    (err) => console.log(`carla nægtet som forventet: ${err.code}`)
  );

  await service.readProject({ actor: gus, projectId: "11" }).then(
    () => console.log("FEJL: gus fik adgang til beta"),
    (err) => console.log(`gus nægtet til beta som forventet: ${err.code}`)
  );

  const before = await service.searchProjection({ actor: bo });
  await service.addMember({ actor: anna, projectId: "11", principal: "gus", role: ROLES.GUEST });
  const after = await service.searchProjection({ actor: bo });
  console.log(`rettighedsændring: projektion v${before.version} -> v${after.version} (gus fik beta)`);
  await service.aiRetrieval({ actor: bo, projection: before, results: [{ projectId: "10" }] }).then(
    () => console.log("FEJL: forældet projektion blev accepteret"),
    (err) => console.log(`forældet projektion afvist som forventet: ${err.code}`)
  );

  const receipt = await service.requestDeletion({ actor: anna, subject: { id: "bo" }, reason: "kunden har bedt om sletning", approvals: [{ verdict: "approve" }] });
  console.log(`bo slettet: medlemskaber=${receipt.deletedMemberships}, afknyttede opgaver=${receipt.unassignedWorkPackages}, resterende kopier=${receipt.remainingCopies.length}`);

  await mock.close();
  console.log("demo færdig (mock-upstream; en rigtig OpenProject er NOT RUN)");
}

const args = parseArgs(process.argv.slice(2));
const run = args.command === "demo" ? demo : () => serve(args);
run().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
