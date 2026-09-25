# Platformskontrakter

Et monorepo for de kontrakter, der gør en fler-modul-platform styrbar og beviselig — og den konformanssuite, der afgør, om et modul må kalde sig kompatibelt.

Udgangspunktet er [BACKLOG.md](BACKLOG.md). Princippet er **kontrakt før implementering, test før moduler, to beviste adaptere før skalering, agenter før dashboards.**

> **Dette repo er ikke «compliant software».** Det er kontrakter, tests og evidensmaskineri. Det gør en organisation i stand til at dokumentere og håndhæve sine kontroller — ikke til at være compliant. Ansvaret ligger hos den, der deployer og driver platformen. Læs mere i [`docs/compliance`](docs/compliance).

## Status

Bølgerne 0–4 har kode i repoet. Tabellen herunder er den **historiske** oversigt over, at der findes en implementering. Den siger ikke, at den er efterprøvet mod en rigtig ekstern installation. Den faktiske, efterprøvede modenhed pr. komponent — inklusive mocks, fixtures og ikke-kørte integrationer — findes i [`docs/status/implementation-matrix.md`](docs/status/implementation-matrix.md), der genereres af `make baseline`.

| Punkt | Status | Bevis |
| --- | --- | --- |
| 0.1 Repo-skelet og beslutningslog | ✅ | [`docs/adr`](docs/adr), `make validate`/`make lint` (CI-workflowet er fjernet; kør lokalt) |
| 0.2 Identitetsplan | ✅ | [`contracts/identity.schema.json`](contracts/identity.schema.json), check `C-005` |
| 0.3 Telemetriplan | ✅ | [`contracts/cloud-event.schema.json`](contracts/cloud-event.schema.json), `make telemetry-test` |
| 0.4 Ops-kontrakt (manifest + verber) | ✅ | [`contracts/module-manifest.schema.json`](contracts/module-manifest.schema.json) |
| 0.5 Privacy-verber | ✅ | [`contracts/privacy-request.schema.json`](contracts/privacy-request.schema.json), `make dsar-demo` |
| 0.6 Konformanssuite | ✅ | [`conformance/`](conformance), `make conform MODULE=dummy-ok` |
| 1.1 Policy-plan (PDP) | ✅ | [`policy/pdp`](policy/pdp), checks `C-009`/`C-010`, [ADR-0004](docs/adr/0004-letvaegts-pdp.md) |
| 1.2 GitOps-skelet | ✅ | [`gitops/`](gitops), `make gitops-verify`/`gitops-drift`, [ADR-0005](docs/adr/0005-git-eneste-aendringskanal.md) |
| 1.3 Referencemodul A (audit-service) | ✅ | [`modules/audit-service`](modules/audit-service), `make conform MODULE=audit-service` |
| 1.4 Referenceadapter B (mattermost) | ✅ | [`modules/mattermost-adapter`](modules/mattermost-adapter), `make conform MODULE=mattermost-adapter` |
| 2.1 Agent-manifest + approval-payload | ✅ | [`contracts/agent-manifest.schema.json`](contracts/agent-manifest.schema.json), [`approval-request.schema.json`](contracts/approval-request.schema.json), checks `A-001`/`A-002` |
| 2.2 AI-gateway | ✅ | [`gateway/`](gateway), check `A-003`, [ADR-0006](docs/adr/0006-alle-modelkald-gennem-gateway.md) |
| 2.3 Agent-runtime | ✅ | [`runtime/`](runtime), 10 tests |
| 2.4 Approval-service + UI | ✅ | [`approvals/`](approvals), adskilt evidens/prosa-visning |
| 2.5 Adversarial reviewer-agent | ✅ | [`reviewer/`](reviewer), [ADR-0007](docs/adr/0007-evidens-og-prosa-adskilt.md) |
| 2.6 Agent-konformanstests (seks) | ✅ | [`conformance/test/agent-conformance.test.mjs`](conformance/test/agent-conformance.test.mjs) |
| 2.7 Reviewer-effektmåling | ✅ | [`reviewer/src/metrics.mjs`](reviewer/src/metrics.mjs), `make reviewer-metrics` |
| 3.1 Compliance-evidens-emitter (OSCAL) | ✅ | [`evidence/`](evidence), [`contracts/oscal-assessment-results.schema.json`](contracts/oscal-assessment-results.schema.json), `make oscal-evidence` / `make evidence-test`, [ADR-0008](docs/adr/0008-oscal-evidensprofil.md) |
| 3.2 Kontrolmapping NIS2 / GDPR / AI Act | ✅ | [`compliance/`](compliance), [`docs/compliance/mapping.md`](docs/compliance/mapping.md), check `C-012`, [ADR-0009](docs/adr/0009-kontrolmapping-roller.md) |
| 3.3 Ops-dashboards (Prometheus/Grafana/Loki) | ✅ | [`observability/`](observability), `make observability-dashboards` / `observability-check`, [ADR-0010](docs/adr/0010-dashboards-fra-manifest.md) |
| 3.4 Security-plan (Trivy/Falco/Wazuh) | ✅ | [`security/`](security), check `SEC-*` i OSCAL-pakken, [ADR-0011](docs/adr/0011-sikkerhedsfund-i-evidensplanen.md) |
| 4.1 Ejer-curriculum | ✅ | [`curriculum/`](curriculum), `make curriculum-check` / `curriculum-test`, kontrol `at-2`, [ADR-0012](docs/adr/0012-ejer-curriculum.md) |
| 4.2 Yderligere adaptere (IAM) | ✅ | [`modules/keycloak-adapter`](modules/keycloak-adapter), `make iam-adapter-test` / `iam-adapter-evidence`, [`docs/spec/iam-adapter.md`](docs/spec/iam-adapter.md) |
| 4.3 Pitch / LinkedIn | ✅ | [`docs/pitch`](docs/pitch), `make pitch-check` / `pitch-test` |
| 4.4 Fælles adapter-SDK og godkendelsestest (DKC-023) | ✅ | [`adapter-sdk/`](adapter-sdk), `make adapter-sdk-check` / `adapter-sdk-test`, [`docs/spec/adapter-sdk.md`](docs/spec/adapter-sdk.md) |
| 4.5 Live integration og opgradering af adaptere (DKC-024) | ✅ | [`adapter-sdk/live-targets.json`](adapter-sdk/live-targets.json), `make adapter-live-check` / `adapter-live-test` / `adapter-live-plan`, [`docs/spec/adapter-live-integration.md`](docs/spec/adapter-live-integration.md) |
| 4.6 Indsigt og eksport som tværgående proces (DKC-020) | ✅ | [`privacy/`](privacy), `make privacy-check` / `privacy-test` / `privacy-run`, [`docs/spec/privacy-process.md`](docs/spec/privacy-process.md) |

Bølge 1 og bølge 2 har fungerende førstepartsimplementeringer: agenten kører et A1-verbum end-to-end, stopper ved utilgængelig PDP/audit-log, eskalerer ved budget- og loop-brud, afviser udeklarerede verber, A4-handlinger og prompt injection. De seks agent-konformanstests er grønne, og reviewer-effekten måles. Bølge 3 og 4 har ligeledes kode og tests: OSCAL-evidens emitteres, kontrolmappingen mod NIS2/GDPR/AI Act er maskinlæsbar og håndhævet, SLO-dashboards og agenthandlinger genereres fra manifesterne, og sikkerhedsfund normaliseres.

**Forbehold, der skal læses sammen med tabellen:** Mattermost- og Keycloak-adapterne er pinnet til en eksakt upstream-version/edition og har en live-kører, men de er i dette miljø fortsat kun efterprøvet mod mock-instanser — live-prøverne registreres ærligt som NOT RUN uden `DKC_LIVE_*`-bindinger. AI-gatewayen er kun efterprøvet mod en echo-provider; Trivy/Falco/Wazuh-fund kommer fra committede samples og ikke fra kørende værktøjer; og GitHub Actions-workflowet er fjernet. "Efterprøves i CI" betyder derfor i dag "efterprøves lokalt med `make ci`/`make baseline`". Se [`docs/status/implementation-matrix.md`](docs/status/implementation-matrix.md) for den fulde, ærlige status.

## Kom i gang

```bash
make install                 # npm ci i conformance/
make ci                      # hele CI-løbet lokalt (se target 'ci' i Makefile)
make baseline                # kør alle checks, skriv docs/status/implementation-matrix.md + evidens
```

`make baseline` er den reproducerbare indgang: den kører de eksisterende checks, registrerer exitstatus, commit, miljø og evidens pr. check og markerer mocks, fixtures og ikke-kørte integrationer særskilt. Kør den i en ren checkout eller et disposable worktree, hvis bevisgeneratorerne ikke må skrive i din arbejdskopi — se [`docs/status/implementation-matrix.md`](docs/status/implementation-matrix.md).

Kør mod ét modul:

```bash
make conform MODULE=dummy-ok
```

```
  ✔ C-001  module-manifest.json validerer mod kontrakten
  ✔ C-005  Ingen lokal brugerdatabase; OIDC/SCIM/SPIFFE erklæret
  ...
RESULTAT: PASS  (10 pass, 0 skip, 0 fail)
```

Bevis at suiten faktisk fanger fejl:

```bash
make conform-negative
# ✔ Negativ fixture fejlede som forventet
```

Policy-laget:

```bash
make policy-verify   # verificér den signerede bundle
make policy-test     # kør PDP'ens tests
make policy-decide   # træf en eksempelbeslutning
```

GitOps:

```bash
make gitops-verify   # policy-gates: digests, labels, hardening, fail-closed
make gitops-drift    # bevis at ændringer uden om git opdages og føres tilbage
make changelog       # maskinlæsbar change log fra git (NIS2)
```

Referencemodul (audit-service):

```bash
make audit-service-test       # 19 tests: identitet, hash-kæde, PDP, fail-closed
make audit-service-evidence   # fremkald konformansbevis ved at køre verberne
make conform MODULE=audit-service
```

Referenceadapter (mattermost):

```bash
make adapter-test             # 7 tests mod mock Mattermost
make adapter-evidence         # bevis at partial-erklæringen holder
make conform MODULE=mattermost-adapter
```

Agenter:

```bash
make gateway-test             # 7 tests: routing, budget, modelversion
make runtime-test             # 10 tests: A1, fail-closed, A4, budget, loop, JIT
make agent-conformance-test   # de seks agent-konformanstests (10 tests)
make reviewer-test            # reviewer + effektmåling (3 tests)
```

Evidens (OSCAL):

```bash
make conform-all              # skriver .conformance-out/report.json
make oscal-evidence           # OSCAL-assessment-results fra konformans, policy, audit, git og GitOps
make evidence-test            # validerer evidenspakken mod kontrakten (5 tests)
```

Compliance:

```bash
make compliance-mapping       # genskab docs/compliance/mapping.md fra registry
make compliance-check         # fejl hvis docs er ude af trit med registry
make compliance-test          # validering og krydsreferencer (4 tests)
```

Observability:

```bash
make observability-dashboards # genskab Prometheus-regler og Grafana-dashboards fra SLO
make observability-check      # fejl hvis dashboards er ude af trit med manifestet
make observability-test       # generator + configmap-synkronisering (5 tests)
```

Sikkerhed:

```bash
make security-ingest          # normalisér Trivy/Falco/Wazuh-fund
make security-check           # validér og fejl ved drift mod rådata
make security-test            # normaliseringens tests (4 tests)
```

Ejer-curriculum:

```bash
make curriculum-check         # validér curriculum og afvisningsscenarier
make curriculum-render        # vis moduler og scenarier
make curriculum-test          # 5 tests, inkl. håndhævelse i approval-servicen
```

IAM-adapter:

```bash
make iam-adapter-test        # 7 tests mod mock Keycloak
make iam-adapter-evidence    # fremkald konformansbevis og partial-erkendelse
make conform MODULE=keycloak-adapter
```

Fælles adapter-SDK (DKC-023):

```bash
make adapter-sdk-write       # genskab releaseprofiler pr. upstream-version/edition
make adapter-sdk-check       # validér kandidatrapporter/releaseprofiler og drift
make adapter-sdk-test        # SDK-tests + godkendelsesharness mod mattermost-adapteren
make adapter-sdk-report      # vis kandidatrapporten pr. adapter
```

Live integration og opgradering (DKC-024):

```bash
make adapter-live-check      # validér pinning, live-mål og opgraderings-/rollbackplaner
make adapter-live-test       # live-kører, demo-værn i produktion og plansemantik
make adapter-live-plan       # vis preflight, trin, verifikation og rollback pr. adapter
make adapter-live-run        # kør mod rigtige instanser (kræver DKC_LIVE_*-binding; ellers NOT RUN)
```

Indsigt og eksport (DKC-020):

```bash
make privacy-check           # validér eksportkontrakten og den fail-closed identitetsmatchning
make privacy-test            # holdbar sag, to-app fan-out, timeout/nedetid og sikret eksport
make privacy-run             # offline demonstration: sag → per-modul status → eksport
```

Pitch:

```bash
make pitch-check              # hvert bevis i decket skal findes
make pitch-test               # checkerens tests (4 tests)
```

## Struktur

```
contracts/     JSON Schema-kontrakter + eksempler (det, der skal testes)
conformance/   kørbar testsuite og orkestratorer (det, der tester)
modules/       reference- og adaptermoduler med module-manifest.json
policy/        signerede policy-bundles og PDP (det, der beslutter)
gateway/       AI-gateway: alle modelkald gennem én tjeneste
runtime/       agent-runtime: SPIFFE, JIT-credentials, budgetter, dødemandsgreb
approvals/     approval-service: godkendelser, træningskrav, evidens/prosa-visning
reviewer/      adversarial reviewer-agent (kan kun flagge/afvise) + effektmåling
evidence/      OSCAL-evidens-emitter: maskinlæsbar compliance-evidens fra platformens artefakter
compliance/    kontrolmapping mod NIS2, GDPR og AI Act (kanonisk registry + generator)
observability/ Prometheus-regler og Grafana-dashboards genereret fra modulets SLO
security/      Trivy, Falco og Wazuh normaliseret ind i OSCAL-evidensplanen
curriculum/    ejer-curriculum bygget på rigtige approval-payloads
pitch/         pitch-deck og LinkedIn-udkast med efterprøvede beviser
gitops/        ønsket tilstand, Argo CD-apps og reconcile (det, der ruller ud)
docs/adr/      beslutningslog i MADR-format
docs/spec/     planerne i prosa
```

## De fire planer

1. **Identitet** — OIDC, SCIM 2.0, SPIFFE. Intet modul har egen brugerdatabase.
2. **Telemetri** — OTel + én CloudEvents-envelope for menneske- og agenthandlinger.
3. **Ops** — ti verber, hver med et conformance-niveau: `full` / `partial` / `unsupported`.
4. **Privacy** — ét DSAR-fan-out med per-modul status.
5. **Policy** — én central PDP; moduler og agenter spørger, de beslutter ikke selv. (Bølge 1.)

Læs mere i [`docs/spec`](docs/spec) og baggrunden i [`docs/adr`](docs/adr).

## Bidrag

Se [CONTRIBUTING.md](CONTRIBUTING.md). Alle commits skal være DCO-signeret (`git commit -s`).
