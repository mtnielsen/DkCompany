# Byggeplan — prioriteret backlog

**Sådan bruges den:** ét GitHub-issue pr. punkt. "Done when" er acceptance criteria — giv dem ordret til kode-agenten. Et punkt er ikke færdigt, før dets konformanstest er grøn i CI.

**Prioriteringslogik:** kontrakt før implementering, test før moduler, to beviste adaptere før skalering, agenter før dashboards. Alt hvad der kan udskydes, er udskudt (se sidste afsnit).

---

## Bølge 0 — Kontrakten (ingen apps endnu)

Mål: en spec, der kan testes. Ingen upstream-integration i denne bølge.

### 0.1 Repo-skelet og beslutningslog
Monorepo med `/contracts`, `/conformance`, `/modules`, `/policy`, `/docs/adr`. ADR-format (MADR). CI: lint, schema-validering, DCO/sign-off.
**Done when:** ugyldig schema-fil fejler CI; ADR-0001 dokumenterer valget af de fire planer.
**Depends on:** —

### 0.2 Identitetsplan
Spec for OIDC (auth), SCIM 2.0 (provisionering), SPIFFE (workload). Regel: intet modul har egen brugerdatabase.
**Done when:** spec + JSON Schema for `identity`-blokken i module manifest; konformanstest afviser modul med lokal user store.
**Depends on:** 0.1

### 0.3 Telemetriplan
OTel traces/metrics/logs + CloudEvents-envelope med obligatorisk `tenant_id`, `trace_id`, `principal`. Én envelope for både menneske- og agenthandlinger.
**Done when:** CloudEvents-schema committet; testevent valideres end-to-end gennem collector.
**Depends on:** 0.1

### 0.4 Ops-kontrakt (module manifest + verber)
Verbsæt: `backup`, `restore`, `verify-restore`, `drain`, `upgrade --dry-run`, `upgrade`, `migrate`, `rollback`, `health`, `slo`. Manifest deklarerer understøttelse **pr. verbum med conformance-niveau** (`full` / `partial` / `unsupported` + begrundelse).
**Done when:** `module-manifest.schema.json` findes; partial conformance er repræsenterbar uden at lyve.
**Depends on:** 0.1
**Note:** Uden partial conformance lyver alle manifester. Det er ikke en svaghed i kontrakten — det er det, der gør den brugbar.

### 0.5 Privacy-verber (den egentlige IP)
`subject.locate`, `subject.export`, `subject.erase`, `subject.legal_hold`, `retention.policy`. Ét fan-out-kald på tværs af moduler i stedet for 12 manuelle processer.
**Done when:** schema + orkestrator-spec; DSAR mod to dummy-moduler returnerer samlet resultat med per-modul status.
**Depends on:** 0.4

### 0.6 Konformanssuite (harness)
Kørbar testsuite + badge. Skrives **samtidig** med specen, ikke efter.
**Done when:** `make conform MODULE=x` giver pass/fail-rapport; dummy-modul består, bevidst brudt modul fejler.
**Depends on:** 0.2–0.5
**Note:** Dette punkt afgør, om projektet lever. En spec uden testsuite er en PDF, ingen følger.

---

## Bølge 1 — Beviset

Mål: vis at kontrakten holder mod virkeligheden, ikke kun mod dummies.

### 1.1 Policy-plan (OPA/PDP)
Central PDP. Moduler og agenter *spørger*; de beslutter ikke selv. Bundle-versionering + signering.
**Done when:** PDP deployet; modul uden PDP-kald fejler konformans.
**Depends on:** 0.6

### 1.2 GitOps-skelet
Argo CD eller Flux + policy-gates i CI. Alt går gennem git — mennesker og agenter ens.
**Done when:** ændring uden for git afvises/reconciles væk; git-historik er komplet change log (NIS2).
**Depends on:** 1.1

### 1.3 Referencemodul A (greenfield)
Lille tjeneste du selv ejer — foreslået: **evidens-/audit-service**, fordi den er nødvendig alligevel. Implementerer alle fire planer 100 %.
**Done when:** konformans `full` på alle verber; deployet via GitOps.
**Depends on:** 1.2

### 1.4 Referenceadapter B (stædig upstream)
Wrap **Mailcow** eller **Mattermost** uændret med adapter/sidecar. Forventet resultat: `partial` på `subject.erase`.
**Done when:** adapter kører; manifest deklarerer ærligt hvad der ikke kan lade sig gøre; suiten accepterer det som partial, ikke fail.
**Depends on:** 1.3
**Note:** Det er dette punkt, der afslører om kontrakten er realistisk. Forvent at måtte revidere 0.4/0.5 bagefter — det er forventet, ikke fiasko.

---

## Bølge 2 — Agenter

Mål: autonomi inden for en grænse, der kan forsvares.

### 2.1 Agent-manifest + approval-payload
Schemaerne `agent-manifest.schema.json` og `approval-request.schema.json`. Autonomiklasser A0–A3 deklarerbare; **A4 kan ikke deklareres**.
**Done when:** schemaer i `/contracts`; validering i CI.
**Depends on:** 1.1
**Status:** udkast foreligger.

### 2.2 AI-gateway
LiteLLM eller tilsvarende. Alle modelkald gennem gateway — direkte leverandørkald forbudt. Giver budget, logging, modelversionering, leverandørskifte.
**Done when:** agent uden gateway-route kan ikke nå en model.
**Depends on:** 2.1

### 2.3 Agent-runtime
SPIFFE-identitet, JIT-credentials, **kun deklarerede verber** (ingen fri shell), budgetter, loop-detektion, dødemandsgreb ved utilgængelig PDP/audit-log.
**Done when:** agent udfører A1-verbum end-to-end; mister PDP → stopper; overskrider budget → eskalerer.
**Depends on:** 2.2

### 2.4 Approval-service + UI
Renderer `evidence` (maskin) og `agentAssessment` (prosa) **visuelt adskilt**. Håndhæver approver-grupper, udløb, og trænings-krav.
**Done when:** A3 kan ikke merges uden godkendelse; godkender uden påkrævet træningsmodul afvises; UI viser diff + evidens, ikke kun prosa.
**Depends on:** 2.3

### 2.5 Adversarial reviewer-agent
Anden leverandør end forfatteren. Ser ændring + rådata, **ikke** forfatterens begrundelse. Kan kun `flag`/`reject`.
**Done when:** reviewer kan ikke godkende; kan ikke ændre autonomiklasse; verdict logges.
**Depends on:** 2.4

### 2.6 Agent-konformanstests
De vigtigste tests i hele projektet:
- Forklaring matcher faktisk diff (deterministisk)
- A3 kan ikke merges uden menneske
- Reviewer kan ikke hæve autonomiklasse
- **Prompt injection:** agent ignorerer instruktioner indlejret i logs/issues/changelogs
- Loop: eskalerer efter N gentagne fix
- Agent kan ikke ændre policy-bundle, audit-log eller egne rettigheder (A4)
**Done when:** alle seks grønne i CI.
**Depends on:** 2.5

### 2.7 Reviewer-effektmåling
Log hvor ofte reviewer fangede noget, mennesket ville have godkendt — og hvor ofte den gav grønt lys til noget, der brækkede.
**Done when:** metrik synlig i dashboard.
**Depends on:** 2.6
**Note:** Uden dette tal ved du ikke, om review-laget gør gavn eller skaber falsk tryghed.

---

## Bølge 3 — Evidens og drift

### 3.1 Compliance-evidens-emitter (OSCAL)
Moduler og agenter emitterer maskinlæsbar evidens for de kontroller, de påstår at opfylde.
**Done when:** OSCAL-assessment-results genereres automatisk fra konformanskørsler.
**Depends on:** 2.6

### 3.2 Kontrolmapping NIS2 / GDPR / AI Act
Map dine tekniske kontroller mod krav. Rolleafklaring: udgiver vs. deployer.
**Done when:** mapping-tabel i `/docs/compliance`; README siger eksplicit at repoet ikke er "compliant software".
**Depends on:** 3.1

### 3.3 Ops-dashboards
Grafana + Prometheus + Loki. SLO pr. modul fra manifest. Agenthandlinger som førsteklasses view.
**Depends on:** 0.3, 2.3

### 3.4 Security-plan
Trivy (CI), Falco (runtime), Wazuh (SIEM) — koblet ind i evidensplanen, ikke som separat silo.
**Depends on:** 3.1

---

## Bølge 4 — Ejerskab og spredning

### 4.1 Ejer-curriculum
Bygget på **rigtige approval-payloads**, inkl. forslag der *skal* afvises. Versioneret med platformen. Gennemførelse logges som CloudEvent og håndhæves af 2.4.
Moduler: juridisk ansvar · læs evidens frem for prosa · hvornår afvises · kill switch · første 24 timer ved hændelse.
**Depends on:** 2.4, 3.2

### 4.2 Yderligere moduladaptere
I rækkefølge efter behov: Keycloak/Authentik (IAM) → Metabase (BI) → Mattermost (chat) → Lago (billing) → Superset/Backstage.
**Depends on:** 1.4
**Note:** Hver adapter er ~1 issue. De er nemme *fordi* bølge 0–2 er lavet. Lav dem ikke først.

### 4.3 Pitch / LinkedIn
Først når 1.4 og 2.6 er grønne. Ét deck med én fungerende adapter og kørende konformanstest slår tolv tomme repos.
**Depends on:** 1.4, 2.6

---

## Eksplicit udskudt (skriv det ikke nu)

- Selvstændig betalingsafvikling — PCI-DSS; integrér Stripe/Adyen i stedet
- Egen chat/mail/BI **fra bunden** — adaptere, ikke genopfindelse
- Fuldt autonom A2-drift i prod før 2.6 er grøn
- Multi-cloud-abstraktion
- De resterende ~6 planer fra den oprindelige liste — fire planer beviste slår ti specificerede

---

## Kritisk vej

`0.1 → 0.4 → 0.6 → 1.1 → 1.2 → 1.3 → 1.4 → 2.3 → 2.4 → 2.6`

Alt uden for denne kæde kan parallelliseres eller udskydes. Største risiko er over-specifikation: 10 planer × 12 moduler = 120 kontrakter, der aldrig bliver implementeret.
