# Approval-service

**Kode:** [`approvals/`](../../approvals)
**Kontrakter:** [`approval-request.schema.json`](../../contracts/approval-request.schema.json)
**Backlog:** 2.4 · **DKC-004**

## Formål

En A3-handling kan ikke merges uden et menneske. Servicen håndhæver godkendelseskrav, approver-grupper, udløb og træningskrav — og renderer maskinevidens adskilt fra agentens prosa. DKC-004 gør godkendelsen **autentisk** (kun et verificeret, berettiget menneske) og **bundet** til præcis den ændring, godkenderen så.

## Adskillelse af evidens og prosa

Payloaden har to blokke:

- `evidence` — **maskingenereret** (policy, tests, dry-run, scans, diff). Må ikke skrives af en LLM.
- `agentAssessment` — **agentens prosa**. Er ikke evidens.

Visningen (`GET /v1/approvals/:id/view`) renderer dem i hver sin visuelt adskilte blok: grøn "MASKINE · EVIDENS" og rød "AGENT · PROSA (ikke evidens)". Godkenderen ser diff + evidens først, ikke kun prosa.

## Verificerbare påstande

Prosa kan ikke tjekkes maskinelt. `agentAssessment.claims` gør den delvist checkbar: hver påstand peger på en `evidenceRef` (fx `change.diff.summaryStats.filesChanged`) med operator og værdi. `checkClaims()` verificerer dem deterministisk og viser afvigelser i tabellen. Det er grundlaget for agent-konformanstest 1.

## Autentisk godkender (DKC-004)

`decide(id, { principal, verdict })` kræver en **verificeret** identitet fra DKC-003:

- `principal.kind` skal være `human`. Agenter og demo-identiteter afvises.
- Grupper og roller læses fra identiteten (`principal.groups`/`principal.roles`). Klientens `groups`-påstand ignoreres.
- Træning slås op server-side via `trainingRegistry(subject)`. Klientens `completedTrainingModules` ignoreres.
- Samme `subject` kan ikke godkende mere end én gang (unikke godkendere).
- Er `decision.requestedBy` sat (den verificerede skaber), afvises selv-godkendelse efter rollepolitik.
- En godkender fra en anden kunde (`tenantId`) afvises, medmindre politikken giver en platformrolle ret.

Over HTTP forudsætter beslutninger en konfigureret `authenticator`; uden den svarer servicen `503`. Produktionsdrift skal stille servicen bag DKC-003-pipelinen (rate limit, CSRF, body-grænse, header-strip).

## Binding til ændringen (DKC-004)

`approvals/src/binding.mjs` beregner en kanonisk SHA-256 over:

| Felt | Kilde |
| --- | --- |
| Kunde | `tenantId` |
| Miljø | `change.environment` |
| Verbum | `change.verb` |
| Mål | `change.targets` (sorteret) |
| Diff | `change.diff.sha256` |
| Parametre | `change.parameters` (kanonisk digest) |
| Policy-version | `evidence.policyEvaluation.bundleVersion` |
| Udløb | `decision.expiresAt` |

Digesten gemmes som `decision.binding` og kopieres til hver `approval.bindingDigest`. `amend()` genberegner bindingen; ændres den, ryddes godkendelser, og anmodningen går tilbage til `pending`. `decide()` kan desuden kræve `changeDigest`, som skal matche, og afviser hvis den lagrede binding er drevet.

## State machine (DKC-004)

```
pending → approved | rejected | expired | withdrawn | revoked
approved → expired | revoked
rejected | expired | withdrawn | revoked  (terminale)
```

- `create()` afviser enhver anden starttilstand end `pending` og afviser medsendte godkendelser.
- `merge-check` er kun `mergeable`, når tilstanden er `approved`, bindingen er intakt, alle godkendelser er bundet til samme digest, der er nok **unikke** godkendere, ingen selv-godkendelse indgår, og intet er udløbet.
- Kun politikudpegede roller (`revocationRoles`) må `revoke()`.
- `expireIfNeeded` flytter `pending`/`approved` til `expired`, når `expiresAt` er passeret.

## Persistence og beskyttet audit (DKC-004)

Tilstanden ligger ikke kun i hukommelsen:

- **Lager.** `approvals/src/store.mjs` har `createMemoryStore` (tests/kortlivede
  processer) og `createFileStore`, der skriver hver anmodning **atomisk**
  (temp + rename) til `${dataDir}/requests/`. Filnavnet er en SHA-256 af id'et,
  så et ondsindet id ikke kan skrive uden for mappen. Ved start indlæses alle
  anmodninger, og bindingen genberegnes ved brug — et ændret binding på disken
  ugyldiggør godkendelsen.
- **Audit-log.** `approvals/src/ledger.mjs` skriver append-only poster for
  `approval.created|decided|amended|expired|withdrawn|revoked`. Hver post bærer
  hashen af den foregående. Er der sat en `secret`, bruges en HMAC, så en
  angriber med skriveadgang ikke kan genberegne kæden uden nøglen. En brudt kæde
  er en hård fejl ved start (`AUDIT_CHAIN_BROKEN`, fail-closed).
- **Drift.** `approvals/src/cli.mjs` starter tjenesten med filbaseret lager og
  audit-log; `make approval-run`. Træningsopslaget kan gives som en JSON-fil
  (`--training`), så det er serverstyret og ikke en klientpåstand.

## Autorisation og forbrug (DKC-005)

Runtimen bruger `POST /v1/approvals/:id/authorize` (eller den in-process
`authorizeExecution`). Kaldet bærer den handling, der er ved at blive udført
(kunde, miljø, verbum, mål, diff-digest, parametre og policy-version). Servicen:

1. genberegner den kanoniske binding og sammenligner med `decision.binding`;
2. afviser hvis beslutningen ikke er `approved`, er udløbet, drevet eller allerede
   forbrugt;
3. reserverer godkendelsen **atomisk** (`store.claim`, `wx`-fil eller et
   in-memory-claim) og skriver `decision.consumed` plus et
   `approval.consumed`-event i audit-loggen.

Dermed kan en godkendelse ikke flyttes til en anden handling/kunde/diff, og to
samtidige workers kan ikke forbruge den samme beslutning. Et mislykket
bindings-tjek forbruger intet.

## Håndhævelse

| Krav | Effekt |
| --- | --- |
| `eligibleGroups` | Godkender uden for gruppen → `403` (gruppe fra identiteten) |
| `requiredTrainingModules` | Manglende træningsmodul → `428` (serverstyret opslag, AI Act art. 4) |
| `requiredApprovals` | Færre **unikke** godkendere → ikke `approved` |
| `requestedBy` | Selv-godkendelse → `403` |
| `tenantId` | Godkender fra anden kunde → `403` |
| `expiresAt` | Forældet anmodning → `410`/`expired`; gammel evidens skal ikke genbruges |
| `binding` | Ændret diff/tenant/mål/parametre/policy-version → godkendelser ryddes |
| `revoked` | Tilbagekaldt beslutning → ikke mergeable |
| `store`/`ledger` | Tilstand og beslutninger overlever genstart; brudt audit-kæde afvises |
| `merge-check` | Kun `approved` med intakt binding er `mergeable` |

## Acceptkriterier

2.4:

- [x] A3 kan ikke merges uden godkendelse (`merge-check` + test 2).
- [x] Godkender uden påkrævet træningsmodul afvises (test 2b).
- [x] UI viser diff + evidens adskilt fra prosa (`renderView`).

DKC-004 (se `conformance/test/approval-conformance.test.mjs`):

- [x] Oprettelse med approved-state afvises.
- [x] Samme person kan ikke tælle som to godkendere.
- [x] Forfalskede grupper og kursusbeviser afvises.
- [x] Ændret diff, tenant, mål eller parametre ugyldiggør godkendelsen.
- [x] Afvist, udløbet eller tilbagekaldt beslutning kan ikke anvendes.
- [x] Godkendelsestilstand og beslutninger overlever genstart, og et brud på
  audit-loggen opdages (`approvals/test/persistence.test.mjs`).

## Kendte begrænsninger

- **Ingen rigtig IdP i drift.** Verificeret identitet testes med genererede nøgler; en levende OIDC-udbyder er fortsat en integration (NOT RUN).
- **`verifyJwt` HS256-stien er defekt** (bruger `crypto.verify` på en secret key). Produktions- og teststien bruger RS256; DKC-003's egen suite dækkede ikke HS256-verifikation. Bør rettes separat.
- **Ingen delt persistence.** Lageret er lokale filer på én node; et delt,
  HA-lager (fx en database med transaktioner) er en senere opgave. Audit-loggen
  er tamper-evident, ikke tamper-proof mod en aktør med både skriveadgang og
  nøglen.
- **Rolle-/policydata** er kode (`defaultApprovalPolicy`), ikke en ekstern
  PDP-beslutning.
