# DKC-010 — Udsted reelle kortlivede rettigheder og nødstop (leverance)

Implementering af **DKC-010** for `mtnielsen/DkCompany`. Bygger på
DKC-001 .. DKC-009 og DKC-055. `00-core/` er fortsat **ikke ændret**; alt ligger
under `01-step1/output/dkc-010/`.

## Forudsætninger og valg

DKC-010 afhænger formelt af **DKC-003** (verificerbar identitet), **DKC-007**
(runtimegrænse/A4) og **DKC-055** (én uforanderlig rolle pr. agent). Derudover
lægges **DKC-008** (holdbar tilstand) og **DKC-009** (holdbar audit), fordi
tilbagekaldelse og nødstop skal være holdbare og deles mellem processer/noder.
`apply.sh` kæder derfor `dkc-009/apply.sh` og lægger derefter denne overlay.

## Hvad der er implementeret

1. **KMS-/secret-broker-signerer.** `credentials/src/keys.mjs` definerer en
   signerer der kun eksponerer `sign()` og den offentlige nøgle (Ed25519/EdDSA).
   `createLocalSigner` er udviklingsimplementeringen; i produktion er det en
   cloud-KMS eller HashiCorp Vault Transit, hvor nøglen er ikke-eksporterbar.
   Verifikationssiden får kun et JWKS. `credentials/src/jws.mjs` er en kompakt,
   fuldt verificerbar JWS.

2. **Scope-bundne, kortlivede tokens.** `credentials/src/broker.mjs` udsteder et
   token bundet til **kunde** (`tenant_id`), **ressource** (`scope.resource`),
   **verbum**, **miljø**, **audience** (`aud`) og **TTL** (`iat/nbf/exp`), med
   `jti` og `role`. `credentials/src/scope.mjs` afviser A4-beskyttede ressourcer
   og verber rollen ikke må. TTL klemmes til `[min, max]`.

3. **Modtagerverifikation.** `credentials/src/verifier.mjs` afviser fail-closed
   på signatur/`alg`/`kid`, `iss`, `aud`, `sub`, scope, udløb, tilbagekaldelse og
   nødstop. `credentials/src/receiver.mjs` er executor-vagten, så modtageren ikke
   stoler på kalderen. Audit-servicen bruger samme verifier på hver privilegeret
   rute via `x-platform-credential`-headeren.

4. **Tilbagekaldelse.** `credentials/src/revocation.mjs` tilbagekalder pr.
   credential (`jti`), agent (`spiffeId`) eller kunde (`tenantId`). Listen er
   holdbar via `persistence/src/adapters/revocations.mjs` og slås op ved hver
   modtagelse.

5. **Nødstop pr. agent, kunde og globalt.** `credentials/src/kill-switch.mjs`
   med eksplicit myndighedsmatrix (agent-owner/tenant-admin/platform-admin/
   security-officer). Kun et verificeret menneske kan aktivere/ophæve.
   Tilstanden er holdbar (`persistence/src/adapters/stops.mjs`), caches højst
   5 s, og runtimen tjekker den før hver handling → `halted`/`emergencyStop`.

6. **Kontrolplans-isolation.** `runtime/src/classification.mjs` udvider A4 med
   agentregistrering, GitOps og nødstop/broker/KMS-rødder. Runtimen afviser
   sådanne handlinger før executor, og brokeren nægter at udstede credentials til
   dem. GitOps-gaten **G-009** afviser RBAC der giver en agent-ServiceAccount
   adgang til kontrolplanet.

7. **Kontrakter, migration og docs.** Nye kontrakter `credential-token` og
   `kill-switch` + eksempler; `agent-manifest` får et valgfrit `executor`-felt
   (audience). Migration `0004_credentials_and_stops.sql` tilføjer
   `credential_issuances`, `revocations` og `kill_switches` samt en fjerde
   databaseidentitet `credentials`. `make credentials-test`/`credentials-check`
   og komponenten `credentials` er registreret. ADR-0022 og
   `docs/spec/credentials.md` dokumenterer designet.

## Ændrede/nye filer (overlay, relativt til `00-core/`)

```
credentials/package.json                  (ny)
credentials/src/keys.mjs                  (ny: Ed25519-signerer + JWKS)
credentials/src/jws.mjs                   (ny: kompakt JWS sign/verify)
credentials/src/scope.mjs                 (ny: kunde/ressource/verbum/miljø/audience-binding)
credentials/src/broker.mjs                (ny: udstedelse)
credentials/src/verifier.mjs              (ny: modtagerverifikation)
credentials/src/receiver.mjs              (ny: executor-vagt)
credentials/src/revocation.mjs            (ny: tilbagekaldelse)
credentials/src/kill-switch.mjs           (ny: nødstop + myndighedsmatrix)
credentials/src/index.mjs, check.mjs      (ny)
credentials/test/credentials.test.mjs     (ny: 9 tests)
persistence/migrations/0004_credentials_and_stops.sql (ny)
persistence/src/adapters/revocations.mjs  (ny)
persistence/src/adapters/stops.mjs        (ny)
persistence/src/adapters/issuances.mjs    (ny)
persistence/src/db.mjs, identities.mjs, index.mjs (+ 4. identitet, nye repos)
persistence/test/credentials-stores.test.mjs (ny: 3 tests)
persistence/test/migrations.test.mjs      (+ v4)
runtime/src/runtime.mjs                   (+ credentialBroker/killSwitch, scoped credential pr. handling)
runtime/src/classification.mjs            (+ kontrolplans-rødder)
runtime/test/credentials-runtime.test.mjs (ny: 7 tests)
modules/audit-service/service/src/server.mjs (+ credentialVerifier på privilegerede ruter)
modules/audit-service/service/src/cli.mjs    (+ --credential-jwks/--credentials-dir)
modules/audit-service/service/test/credential-receiver.test.mjs (ny: 4 tests)
modules/dummy-ok/agents/backup-agent.json (+ executor/audience)
gitops/src/verify.mjs                     (+ G-009)
gitops/test/verify.test.mjs               (+ negativ G-009-test)
contracts/credential-token.schema.json    (ny)
contracts/kill-switch.schema.json         (ny)
contracts/examples/credential-token.example.json (ny)
contracts/examples/kill-switch.example.json      (ny)
contracts/agent-manifest.schema.json      (+ executor)
conformance/src/validate-schemas.mjs      (+ 2 eksempel-mappings)
conformance/test/credentials-conformance.test.mjs (ny: 4 accept-tests)
Makefile                                  (+ credentials-check/-test, + i ci)
tools/baseline/registry.mjs               (+ 2 checks, komponent credentials)
docs/adr/0022-rettigheder-og-noedstop.md  (ny ADR)
docs/adr/README.md, docs/spec/README.md   (indeks)
docs/spec/credentials.md                  (ny spec)
docs/spec/agent-runtime.md, persistence.md (+ DKC-010)
docs/status/implementation-matrix.md      (regenereret)
```

## Testkommandoer og resultater (checkout `83ad91a` + DKC-001..009 + DKC-055, Node v22.22.1)

| Kommando | Resultat |
| --- | --- |
| `make credentials-test` | **27 pass / 0 fail** (9 credentials + 7 runtime + 4 audit-service + 3 gitops + 4 konformans) |
| `make credentials-check` | **OK** (signerer/JWKS, holdbar tilbagekaldelse/nødstop, A4-afvisning) |
| `make persistence-test` | **42 pass / 0 fail** |
| `make persistence-check` | **OK** (4 migrationer, 4 databaseidentiteter, 9 tenant-views) |
| `make runtime-test` | **59 pass / 0 fail** |
| `make boundary-test` | **21 pass / 0 fail** |
| `make test` (conformance) | **77 pass / 0 fail** (inkl. 4 nye DKC-010-accept-tests) |
| `make audit-service-test` | **34 pass / 0 fail** |
| `make gitops-test` / `make gitops-verify` | **10 pass / 0 fail** / **9/9 gates** |
| `make agent-registry-test` | **33 pass / 0 fail** |
| `make agent-conformance-test` | **10 pass / 0 fail** |
| `make approval-test` | **11 pass / 0 fail** + **20 pass / 0 fail** |
| `make validate` | 30 skemaer, 29 eksempler |
| `make lint` | OK (187 JSON-filer, 467 filer) |
| `make baseline` | 62 checks: **52 pass, 1 fail, 0 error, 9 NOT RUN**; `credentials-test` og `credentials-check` **PASS** |

Evidens: `evidence/logs/*.log` og `evidence/baseline/` (log + JSON). Den ene
baseline-fejl er fortsat `changelog-check` (manglende DCO sign-off, DKC-001-fundet).
Baselinekørslen ændrede de sporede `modules/*/conformance`-fixtures
(ikke-idempotente `*-evidence`-generatorer); de er nulstillet efter kørslen.

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Credential virker kun hos tilsigtet executor og til det tilladte scope | **PASS** | `credentials/test/credentials.test.mjs` (audience/verbum/ressource/kunde/miljø), `runtime/test/credentials-runtime.test.mjs` (runtime-token + receiver-afvisning), `modules/audit-service/service/test/credential-receiver.test.mjs` |
| Udløb og tilbagekaldelse afviser efterfølgende handlinger hos modtageren | **PASS** | `credentials/test/credentials.test.mjs` (udløb, jti-/agent-tilbagekaldelse), receiver- og audit-service-testene, `conformance/test/credentials-conformance.test.mjs` |
| Nødstop afviser nye handlinger inden fem sekunder i staging | **PASS** | `credentials/test/credentials.test.mjs` (agent/kunde/global), `runtime/test/credentials-runtime.test.mjs` (målt < 5000 ms, `maxPropagationMs <= 5000`) |
| Agenten kan ikke ændre sit eget manifest, deployment eller kontroltjenesters adgang | **PASS** | `runtime/test/credentials-runtime.test.mjs` + konformanstest (A4-refusal for policy/audit/credentials/agent-registry/gitops), `credentials/src/scope.mjs` (broker nægter A4), `gitops/src/verify.mjs` G-009 |

## Resterende begrænsninger

- **Den lokale signerer er en udviklingsimplementering.** En rigtig KMS/Vault
  Transit er en driftsopsætning og er **ikke** afprøvet her (NOT RUN).
- **Nødstoppets fem-sekunders-grænse** er bevist in-process med en cache på
  500 ms. Tværnodepropagering afhænger af, hvor hurtigt den holdbare tilstand
  læses, og er ikke afprøvet i en klynge (NOT RUN).
- **Runtimens journal/credential-broker er opt-in.** Uden `credentialBroker`
  bevares den gamle UUID-credential-adfærd for bagudkompatibilitet.
- **PostgreSQL-roller/RLS er ikke afprøvet**; den fjerde databaseidentitet er
  SQLite-baseret her.
- **Tilbagekaldelseslisten vokser**; produktion bør prune udløbne poster
  (`prune()` understøtter det).
- **DKC-001's `changelog-check`-fejl består** (4 commits mangler DCO sign-off).
- Overlay, ikke committed kode: `00-core/` er urørt.

## Til uafhængig gennemgang

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (5f9fa73).
- **Undersøgt checkout:** `83ad91a`.
- **Forudsætnings-overlays:** DKC-001 .. DKC-009 samt DKC-055 (lægges via
  `apply.sh`, som kæder `dkc-009/apply.sh`).
- **Denne leverance:** `01-step1/output/dkc-010/` (46 filer i `deliverable/`,
  SHA256 i `OVERLAY-MANIFEST.txt`).
- Uafhængig verifikation, live-integrationer (rigtig KMS, klynge-propagation)
  og menneskelig release-godkendelse er separate handlinger og er **ikke** udført
  her.
