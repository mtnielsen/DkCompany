# DKC-011 — Værktøjsgrænse og injection-tests (leverance)

Implementering af **DKC-011** for `mtnielsen/DkCompany`. Bygger på
DKC-001 .. DKC-010 og DKC-055. `00-core/` er fortsat **ikke ændret**; alt ligger
under `01-step1/output/dkc-011/`.

## Forudsætninger og valg

DKC-011 afhænger formelt af **DKC-007** (runtimegrænse, A4 og fælles
klassifikation) og **DKC-010** (kortlivede, scope-bundne rettigheder og
nødstop). Den lægges derfor oven på hele den nuværende stak via
`dkc-010/apply.sh`, som til gengæld kæder `dkc-009/apply.sh` (og dermed
DKC-008 .. DKC-001 + DKC-055). `apply.sh` i denne pakke kæder `dkc-010/apply.sh`
og kopierer derefter DKC-011-overlayen.

## Hvad der er implementeret

1. **Ubetroet indhold er data, ikke kald.**
   `runtime/src/untrusted.mjs` pakker logs, dokumenter, mails, tool-output og
   model-output i fryset konvolutter (`__untrusted: true`, `executable: false`).
   `separateUntrusted(action)` læser den eksekverbare kerne og konvolutterne
   hver for sig, så indholdet ikke kan overskrive verbum, mål eller parametre.
   `parseModelOutput` markerer model-output som ubetroet **også når JSON er
   gyldig**, og `buildTaskFromProposal`/`runProposedTask` lader kun `actions`
   blive et forslag; identitet, kunde og `agentRef` kommer fra serveren.

2. **Servervaliderede typed tools med allowlist.**
   `runtime/src/tools.mjs` er en allowlist af typede værktøjer (`observe.read`,
   `propose`, `upgrade.dry-run`, `upgrade.apply`, `credential.rotate`,
   `backup.restore`, `subject.privacy`). `validateToolCall` kræver at
   værktøjet er på listen, at verbet er bundet til netop det værktøj, at
   parametrene matcher et typeskema, at den serialiserede størrelse er under
   grænsen (`maxInputBytes`), at farlige parameternavne (`shell`, `command`,
   `exec`, `token`, `password`, `private_key`, …) ikke optræder rekursivt, og at
   udgående netværk følger værktøjets egress-allowlist. Shell-/eval-verber og
   secret-hentende verber afvises, selv når et manifest erklærer dem.

3. **Udgående netværksregler og tenant-adskillelse.**
   `validateEgress` afviser URL-parametre i netværksløse værktøjer,
   uautoriserede værter, `http`, metadata-adresser (`169.254.169.254`,
   `metadata.google.internal`), loopback og private net. Et tenant-felt i
   parametrene må ikke pege på en anden kunde end den aktive, og
   `crossTenant: true` afvises.

4. **Runtimen kalder kun validerede værktøjer.**
   `createAgentRuntime` bygger en `toolBoundary` (default hele allowlisten) og
   validerer hvert kald efter A4/scope/rolle og før executor. Afvises kaldet,
   udføres der intet, og hændelsen audit-logges som `agent.refused`.

5. **Flersproget angrebskorpus; regex er kun et ekstra signal.**
   `runtime/src/injection.mjs` scanner dansk, engelsk, kodede (base64, hex,
   rot13, unicode-escape, HTML-entities, procent) og indirekte instruktioner fra
   logs, dokumenter, mails, tool-output og model-output.
   `runtime/test/fixtures/injection-corpus.json` er den vedvarende korpus (30
   tilfælde, 11 kategorier). Et negativt scannersvar er aldrig en tilladelse:
   grænsen er strukturel. En test beviser at et payload der bevidst undgår
   scanneren stadig ikke kan udvide rettigheder.

6. **Kontrakter, check og docs.**
   Ny kontrakt `contracts/tool-call.schema.json` + eksempel;
   `agent-task`-skemaet får `tool`/`untrustedContext`/`untrustedContent`, og
   `agent-manifest`-capability får et valgfrit `tool`-felt. `make
   tool-boundary-check` validerer allowlist, egress og korpusdækning, og
   `make tool-boundary-test` kører de nye tests. ADR-0023 og
   `docs/spec/tool-boundary.md` dokumenterer designet; begge indeks er opdateret.

## Ændrede/nye filer (overlay, relativt til `00-core/`)

```
runtime/src/tools.mjs                         (ny: allowlist + typed tools + egress)
runtime/src/untrusted.mjs                     (ny: ubetroede konvolutter + model-output)
runtime/src/injection.mjs                     (ændret: flersproget scanner + decoding)
runtime/src/tool-check.mjs                    (ny: tool-boundary-check)
runtime/src/boundary.mjs                      (ændret: validerer action.tool/untrustedContext)
runtime/src/runtime.mjs                       (ændret: toolBoundary + runProposedTask + scanAll)
runtime/test/tool-boundary.test.mjs           (ny: 15 tests)
runtime/test/injection.test.mjs               (ny: 10 tests)
runtime/test/fixtures/injection-corpus.json   (ny: 30 korpustilfælde)
conformance/test/tool-boundary-conformance.test.mjs (ny: 8 accepttests)
conformance/src/validate-schemas.mjs          (ændret: + tool-call-eksempel)
contracts/tool-call.schema.json               (ny)
contracts/examples/tool-call.example.json     (ny)
contracts/agent-task.schema.json              (ændret: + tool/untrustedContext)
contracts/agent-manifest.schema.json          (ændret: + capability.tool)
Makefile                                      (ændret: + tool-boundary-check/-test, + i ci)
tools/baseline/registry.mjs                   (ændret: + 2 checks, komponent tool-boundary)
docs/adr/0023-vaerktoejsgraense-og-injection.md (ny ADR)
docs/adr/README.md, docs/spec/README.md        (indeks)
docs/spec/tool-boundary.md                    (ny spec)
docs/status/implementation-matrix.md          (regenereret)
```

## Testkommandoer og resultater (checkout `83ad91a` + DKC-001..010 + DKC-055, Node v22.22.1)

| Kommando | Resultat |
| --- | --- |
| `make tool-boundary-check` | **OK** (7 typede værktøjer, 27 verber, 11 kategorier, korpusdækning) |
| `make tool-boundary-test` | **33 pass / 0 fail** (15 typed tools + 10 injection + 8 konformans) |
| `make runtime-test` | **84 pass / 0 fail** |
| `make boundary-test` | **21 pass / 0 fail** |
| `make agent-conformance-test` | **10 pass / 0 fail** |
| `make reviewer-test` | **3 pass / 0 fail** |
| `make test` (conformance) | **85 pass / 0 fail** (inkl. 8 nye DKC-011-accepttests) |
| `make validate` | **31 skemaer / 30 eksempler** valideret (inkl. `tool-call`) |
| `make lint` | **OK** (190 JSON-filer, 479 filer) |
| `make credentials-test` | alle blokke **pass / 0 fail** (ingen regression) |
| `make persistence-test` | **42 pass / 0 fail** |
| `make baseline` | **54 pass, 1 fail (DCO), 0 error, 9 not run af 64**; både `tool-boundary-test` og `tool-boundary-check` **PASS** |

## Acceptkriterier

| Krav | Status | Bevis |
| --- | --- | --- |
| Danske, engelske, kodede og indirekte instruktioner kan ikke udvide rettigheder | **PASS** | `conformance/test/tool-boundary-conformance.test.mjs` (1, 1b), `runtime/test/injection.test.mjs` (korpus + evasiv strukturtest) |
| Forsøg på at hente secrets, bruge fri shell, kontakte uautoriserede URLer eller flytte data mellem kunder afvises | **PASS** | `tool-boundary-conformance.test.mjs` (2a–2d), `runtime/test/tool-boundary.test.mjs` (allowlist, params, egress, cross-tenant) |
| Reviewer kan ikke godkende eller hæve autonomi | **PASS** | `tool-boundary-conformance.test.mjs` (3), `conformance/test/agent-conformance.test.mjs` (3), `reviewer/src/reviewer.mjs` |
| Model-output behandles som ubetroet, også ved korrekt JSON | **PASS** | `injection.test.mjs` (model-output), `tool-boundary-conformance.test.mjs` (4), `runtime/src/untrusted.mjs` |

## Resterende begrænsninger

- **Ingen rigtig modelleverandør.** Model-output-stien er bevist med syntetisk
  JSON og den lokale runtime; en rigtig leverandør gennem AI-gatewayen er
  fortsat **NOT RUN** (jf. DKC-001/DKC-010).
- **Egress er en allowlist, ikke en netværksproxy.** Reglen håndhæves i
  værktøjsgrænsen før executor; at den faktiske udgående trafik også er
  netværksisoleret (service mesh/firewall) er en driftsopsætning og **NOT RUN**.
- **Generisk fallback for ukendte ops-verber.** Et deklareret verbum uden et
  typet værktøj får en konservativ type uden egress; nye verber bør få et rigtigt
  værktøj i allowlisten.
- **Regex/decoding er stadig kun et signal.** Scanneren eskalerer ved kendte
  mønstre, men er ikke adgangskontrollen; et payload der undgår den afvises
  alligevel af den strukturelle grænse (testet).
- **DKC-001's `changelog-check`-fejl består** (4 commits mangler DCO sign-off).
- Overlay, ikke committed kode: `00-core/` er urørt.

## Til uafhængig gennemgang

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (5f9fa73).
- **Undersøgt checkout:** `83ad91a`.
- **Forudsætnings-overlays:** DKC-001 .. DKC-010 samt DKC-055 (lægges via
  `apply.sh`, som kæder `dkc-010/apply.sh`).
- **Denne leverance:** `01-step1/output/dkc-011/` (22 filer i `deliverable/`,
  SHA256 i `OVERLAY-MANIFEST.txt`).
- Uafhængig verifikation, live-integrationer (rigtig model/klynge) og
  menneskelig release-godkendelse er separate handlinger og er **ikke** udført
  her.
