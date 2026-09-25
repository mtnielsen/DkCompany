#!/usr/bin/env node
/**
 * DKC-026 — CLI for arbejdspladsadapteren.
 *
 *   node src/cli.mjs serve [--port 8091 ...]   # kør adapteren mod en Nextcloud
 *   node src/cli.mjs demo                      # kør et kontrolleret arbejdspladsforløb mod mock
 *
 * `serve` kræver en rigtig Nextcloud (NOT RUN i dette miljø). `demo` beviser
 * domæneadfærden deterministisk mod mock-upstream og en lokal allow-PDP.
 */
import { createNextcloudAdapter } from "./server.mjs";
import { createNextcloudClient } from "./nextcloud.mjs";
import { createMockNextcloud } from "./mock-nextcloud.mjs";
import { createWorkspaceService } from "./workspace.mjs";
import { createPdpClient } from "./pdp-client.mjs";
import { createSpiffeAuthenticator, createAuthenticator } from "./auth.mjs";
import { PERMISSIONS, ROLES } from "./constants.mjs";

function parseArgs(argv) {
  const args = { command: argv[0] ?? "serve", port: 8091, pdp: "http://127.0.0.1:8181/v1/data/platform/ops/decision", nextcloud: "http://nextcloud:80", token: "change-me", trustDomain: "platform.example.org", environment: "dev", profile: "production", trustedProxies: [] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") args.port = Number(argv[++i]);
    else if (a === "--pdp") args.pdp = argv[++i];
    else if (a === "--nextcloud") args.nextcloud = argv[++i];
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
    console.log("Brug: node src/cli.mjs serve [--port 8091] [--nextcloud url] [--pdp url]");
    return;
  }
  const adapter = createNextcloudAdapter({
    authenticate: createAuthenticator([
      createSpiffeAuthenticator({
        trustDomain: args.trustDomain,
        profile: args.profile,
        trustedProxies: args.trustedProxies,
        proxySecret: args.proxySecret,
      }),
    ]),
    pdp: createPdpClient({ endpoint: args.pdp, failMode: "closed" }),
    client: createNextcloudClient({ baseUrl: args.nextcloud, token: args.token }),
    environment: args.environment,
    profile: args.profile,
    onEvent: (e) => console.log(JSON.stringify(e)),
  });
  const port = await adapter.listen(args.port);
  console.log(`nextcloud-adapter lytter på http://127.0.0.1:${port}`);
  console.log(`  upstream: ${args.nextcloud} (uændret)`);
  console.log(`  PDP: ${args.pdp} (fail-closed)`);
}

async function demo() {
  const mock = createMockNextcloud();
  const mockPort = await mock.listen(0);
  const client = createNextcloudClient({ baseUrl: `http://127.0.0.1:${mockPort}`, token: "test-token" });
  const service = createWorkspaceService({ client, policy: { publicLinks: { enabled: true, requirePassword: true, requireExpiry: true, maxTtlDays: 7, allowUpload: false } } });
  const anna = { id: "anna", kind: "human", tenantId: "acme", role: ROLES.TENANT_ADMIN, groups: ["acme"] };
  const bo = { id: "bo", kind: "human", tenantId: "acme", role: ROLES.MEMBER, groups: ["acme"] };
  const carla = { id: "carla", kind: "human", tenantId: "acme", role: ROLES.MEMBER, groups: ["acme"] };

  const share = await service.shareFile({ actor: anna, owner: "anna", path: "/projekt/plan.docx", shareWith: "bo", permissions: PERMISSIONS.READ | PERMISSIONS.UPDATE, tenantId: "acme" });
  console.log(`deling oprettet: id=${share.id} -> bo (læs+skriv)`);
  const edit = await service.editFile({ actor: bo, owner: "anna", path: "/projekt/plan.docx", content: "version-2", tenantId: "acme" });
  console.log(`bo redigerede filen via ${edit.via}`);
  await service.readFile({ actor: carla, owner: "anna", path: "/projekt/plan.docx", tenantId: "acme" }).then(
    () => console.log("FEJL: carla fik adgang"),
    (err) => console.log(`carla nægtet som forventet: ${err.code}`)
  );
  const link = await service.createPublicLink({ actor: anna, owner: "anna", path: "/projekt/plan.docx", tenantId: "acme", ttlDays: 3, password: "langnokadgangskode" });
  console.log(`offentligt link oprettet med udløb ${link.expiration}`);
  const receipt = await service.offboardUser({ actor: anna, subject: { id: "bo" }, tenantId: "acme" });
  console.log(`bo afviklet: sessioner=${receipt.closedSessions}, delinger=${receipt.revokedShares}, filer overført til ${receipt.transferredTo}`);
  await service.requestDeletion({ actor: anna, subject: { id: "carla" }, tenantId: "acme", reason: "kunden har bedt om sletning", approvals: [{ verdict: "approve" }] }).then((r) => {
    console.log(`sletning gennemført: filer=${r.deletedFiles}, resterende kopier=${r.remainingCopies.length}`);
  });
  await mock.close();
  console.log("demo færdig (mock-upstream; en rigtig Nextcloud er NOT RUN)");
}

const args = parseArgs(process.argv.slice(2));
const run = args.command === "demo" ? demo : () => serve(args);
run().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
