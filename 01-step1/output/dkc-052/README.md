# DKC-052 — Implementér beredskabsøvelser og overtagelseskontrol

Kumulativ overlay oven på stak-tippet DKC-032. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-032/apply.sh` → `dkc-051/apply.sh` →
  `dkc-050/apply.sh` → … → `dkc-001/apply.sh`. DKC-052 afhænger formelt af
  **DKC-022** (evidens-/risikoregister og brudøvelse), **DKC-032** (AI i
  skyggetilstand og begrænset autonomi), **DKC-044** (ITSM med menneskelige
  ejere), **DKC-045** (change og runbooks) og **DKC-051** (fejl- og
  katastrofematrix). Den genbruger desuden **DKC-037/038/039/041/042**. Alle er
  verificeret i den anvendte stak (se `evidence/prerequisites.txt`).
- **Miljø:** Node v22.22.1. Ingen levende hosts/klynge, ingen uafhængig
  kontaktkanal (telefonbro/SMS) og ingen menneskelige operatører. Øvelsen er en
  **deterministisk model** (`measured: false`); menneskelige out-of-band-trin
  forbliver `AFVENTER`, og en målt øvelse er NOT RUN
  (`docs/continuity/recovery-drill-live.md`).

## Implementeret adfærd

1. **Overtagelsesplan** (`continuity/takeover-plan.json`,
   `contracts/takeover-plan.schema.json`): navngiver serviceejer, on-call,
   stedfortræder, incidentleder, change authority og dataansvarlig funktion;
   en uafhængig kontaktkanal med en eskalationskæde; en offline/recoverykopi af
   runbooks med digest; credentials under to-personers menneskekontrol; en
   prioriteret restoreplan; den formelt valgte
   HA-/immutable-/self-healing-profil; og fem øvelsesscenarier.
2. **Gentagelig øvelsesrunner med trin-/tilstandsmodell**
   (`continuity/src/takeover.mjs`): `takeover → restore → failback →
   validation`. Hvert trin er `machine` (en probe) eller `human` (en
   out-of-band handling). Separate single-server- og HA-scenarier (samt
   ai-offline, iam-loss og site-catastrophe) binder resultatet til
   artefakt-digest, profil, operatør og tidsstempel.
3. **Menneskelige trin kan ikke auto-bestå.** En `human`-handling forbliver
   `pending`, indtil et navngivet menneske efterlader evidens. `agentCanApprove`
   er altid `false`, og en `validated`-øvelse kræver en menneskelig
   incidentaccept og målt dataintegritet. En timeout eskalerer gennem en kæde,
   der altid ender hos et menneske.
4. **Rigtige prober** (`continuity/src/takeover-probes.mjs`): HA-failover
   (`runFailoverDrill`, DKC-038), database-failover med rejoin
   (`runDatabaseFailoverDrill`, DKC-039), lager-holdbarhed (`runStorageDrill`,
   DKC-041), `recoveryAccessProblems` (DKC-042), fejlmatrixen (DKC-051),
   autonomibevillingen (DKC-032) og serviceklasserne (DKC-037).
5. **Struktureret evidens** (`contracts/recovery-drill.schema.json`,
   `continuity/report/recovery-drill-report.json`,
   `docs/continuity/recovery-drill-report.md`): status, trin, eskalationer,
   målinger, ejerbeslutninger og gate. Den kanoniske gate er `awaiting-human`
   med 30 afventende menneskelige trin — ikke en påstand om beredskab.
6. **Konformans og negativ kontrol** (`conformance/src/takeover.mjs`,
   `conformance/test/takeover-conformance.test.mjs`): skema + beslutningssemantik,
   deterministic genkørsel og afvisning af auto-beståede menneskelige trin,
   fejlede påkrævede trin og `validated` uden målt dataintegritet.
7. **Periodisk kontrol** i planen: adgangsrevision (90 d), backupkontrol (30 d),
   kapacitetsvurdering (90 d), DR-øvelse (180 d) og runbookrecertificering
   (180 d), med sidst gennemførte dato.
8. **Ejer-curriculum**: nyt modul `takeover-drill` med et afvisningsscenarie
   (forslag uden testet rollback).
9. **Releasebinding**: nyt krav `REQ-TAKEOVER-001` og trussel
   `THREAT-TAKEOVER-001` (matrixversion **1.34.0**), registreret i
   `tools/baseline/registry.mjs` som komponenten `recovery-takeover` med
   `takeover-check`, `takeover-test`, `takeover-run`, `takeover-report` og
   `integration-takeover-live` (sidstnævnte NOT RUN).

## Ændrede og nye filer

Se `deliverable/`. Filerne er beregnet ved at diffe arbejdsklonen mod en frisk
klon med kun `dkc-032/apply.sh` anvendt (30 filer, ekskl.
`node_modules`, `.conformance-out`, `.git`, `evidence/generated`). De vigtigste:

- Nye: `continuity/src/takeover*.mjs`, `continuity/takeover-plan.json`,
  `continuity/report/recovery-drill-report.json`,
  `continuity/test/takeover.test.mjs`, `conformance/src/takeover.mjs`,
  `conformance/test/takeover-conformance.test.mjs`,
  `contracts/{takeover-plan,recovery-drill}.schema.json` + eksempler,
  `docs/continuity/{takeover-plan,recovery-drill-report,recovery-drill-live}.md`,
  `docs/operations/takeover-control.md`,
  `docs/adr/0065-menneskelig-overtagelse-og-beredskabsoevelser.md`.
- Ændrede: `Makefile` (6 targets + `ci`), `conformance/src/schemas.mjs`,
  `conformance/src/validate-schemas.mjs`, `tools/baseline/registry.mjs`,
  `curriculum/curriculum.json`, `release/matrix/{test-matrix,threats}.json`,
  genererede `docs/status/implementation-matrix.md`,
  `docs/testing/test-matrix.md`, `docs/security/threat-model.md`.

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make validate` | PASS (2 nye kontrakter valideret) |
| `make lint` | PASS |
| `make takeover-check` | PASS (plan, øvelse og artefakter konsistente) |
| `make takeover-test` | PASS (9 enhedstests + 6 konformanstests) |
| `make takeover-run` | PASS (5 scenarier; gate `awaiting-human`; 30 menneskelige trin afventer) |
| `make continuity-test` | PASS (inkl. de nye takeover-enhedstests) |
| `make curriculum-test` | PASS (9 scenarier) |
| `make release-check` | PASS (57 krav; matrixversion 1.34.0) |
| `make release-test` | PASS |
| `make supply-chain-check` | PASS (SBOM uændret — intet nyt `package.json`) |
| `make test` | PASS |
| `make conform-all` | PASS |
| `make baseline-test` | PASS |
| `make baseline` | 219 checks: **170 PASS, 1 FAIL, 48 NOT RUN**. Det ene FAIL er det kendte, forudgående `changelog-check` (manglende DCO sign-off, også i `83ad91a`); det er ikke "rettet". |

`takeover-check` genkører øvelsen deterministisk og sammenligner byte-identisk.

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Et menneske kan overtage uden en fungerende model eller hovedportal | **PASS** (implementeret kontrol) | `ai-offline`-scenarie, offline-runbooks med digest, break-glass med to-personers kontrol, uafhængig kanal og menneskelige trin i `continuity/src/takeover.mjs`. Den faktiske overtagelse er en ekstern måling og er **NOT RUN**. |
| Ingen ansvarskæde ender hos en agent; timeout eskalerer til et menneske | **PASS** | `escalationFor` + `recoveryDrillProblems`; hver eskalation peger på et navngivet menneske; enhedstest |
| Gendannelse og failback har dokumenteret ejerbeslutning og målt dataintegritet | **PASS** | `owner-restore-decision` og `failback-decision` (human) → `decisions`; `dataIntegrityOk`/`failbackVerified` fra proberne; negativ kontrol afviser `validated` uden målt integritet |
| Kritiske incidents lukkes først efter servicevalidering og menneskelig accept | **PASS** | `service-validation` (machine) + `human-acceptance` (human) er påkrævede; `agentCanApprove: false`; `requiresHumanAcceptance: true` |
| Før kundedrift er HA-/immutable-/self-healing-profilen formelt valgt og testet | **PASS** | `profiles.formallyChosen/chosenBy/testedBy` + `profile-choice`-proben; plan-semantik |

## Tilknyttede krav/checks og hvad der er NOT RUN

- `REQ-TAKEOVER-001` binder `takeover-check`, `takeover-test`, `takeover-run`
  og `integration-takeover-live`; `THREAT-TAKEOVER-001` (privilegeret
  hostdrift/ansvarskæde) er tilføjet.
- **NOT RUN:** `integration-takeover-live` (`make takeover-live`) — kræver
  levende hosts, en uafhængig kontaktkanal og menneskelige operatører. De
  menneskelige trin er bevidst `AFVENTER`; se
  `docs/continuity/recovery-drill-live.md`.

## Resterende begrænsninger

- Den målte overtagelse (failover, restore, failback, eskalation til
  testmodtagere) er ikke udført; kun den deterministiske model og de rigtige
  autorisations-/probe-kald er efterprøvet.
- Offline-runbooks og credentials er ikke fysisk verificeret i en øvelse.
- Planen og scenarierne skal vedligeholdes, når roller, runbooks eller profiler
  ændres.
- Ingen ekstern WORM-arkivering af den målte øvelsesrapport.

## Godkendelse

Implementeringen er ikke produktionsklar, og agenten godkender ikke sin egen
indsats. Beredskab kan ikke godkendes af en agent (`agentCanApprove: false`);
uafhængig verifikation og menneskelig release-godkendelse er separate skridt.
