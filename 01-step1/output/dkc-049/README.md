# DKC-049 — Gør logging komplet på tværs af agenter og servere

Kumulativ overlay oven på DKC-001..DKC-021. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73`
- **Undersøgt checkout:** `83ad91a`
- **Forudsætninger:** DKC-009, DKC-017, DKC-040 og DKC-048 er verificeret til
  stede i den anvendte stak: den holdbare, hash-kædede audit-log med
  intent/outcome (`persistence/src/adapters/audit-journal.mjs`,
  `persistence/src/adapters/audit.mjs`), den tenantadskilte telemetri og
  sensorkatalog (`observability/`), den holdbare outbox (`jobs/`), og
  WORM-/objektlageret (`data-protection/`, `storage/`). Overlayen kæder
  `dkc-021/apply.sh` (→ `dkc-048/apply.sh` → `dkc-041/apply.sh` → … → DKC-001).
- **Node:** v22.22.1

## Implementeret adfærd

Logging er nu et komplet, korreleret og manipuleringssikkert revisionsspor —
uden at skabe en parallel sandhed ved siden af den obligatoriske audit.

1. **Den komplette logpost** (`contracts/log-record.schema.json`,
   `logging/src/record.mjs`): hver post bærer fælles korrelation
   (`correlationId`, `executionId`, `incidentId`, `changeId`, `traceId`,
   `parentId`), en stabil `res://`-ressource, præcis én provenance
   (`sensor`, `model`, `verified`, `human`, `system`) med præcis den tilhørende
   blok, samt data-/retention-klassifikation. En post der blander blokke, en
   muterende handling uden holdbar kvittering, tenant-/ressourcemismatch eller
   en fremtidig tidsstempling afvises.
2. **Adskilt provenance** (`logging/src/provenance.mjs`): sensorobservationer,
   modeludsagn og verificerede resultater kan ikke blandes i samme post. Et
   modeludsagn kan derfor ikke læses som et faktum.
3. **Redaktion** (`logging/src/redact.mjs`): hemmeligheder fjernes på feltnavn
   og værdimønster (DKC-009's `redactSecrets`), skjulte ræsonneringsfelter
   (chain-of-thought, intern tankestrøm) fjernes helt, og unødige persondata i
   de frie datablokke minimeres med en bevaret digest. `assertNoSecrets` og
   `assertNoHiddenReasoning` er fail-closed.
4. **Append-only ledger** (`logging/src/ledger.mjs`): poster skrives til den
   hash-kædede audit-log (DKC-009) og læses tenant-scopet. Der findes **ingen**
   update- eller delete-metode, så en agent ikke kan omskrive eller slette sin
   historik. `verify` efterprøver hash-kæden og monotone sekvenser.
5. **Uafhængigt WORM-arkiv** (`logging/src/archive.mjs`): posten spejles til
   arkivmål i flere fejldomæner og WORM-låses (COMPLIANCE) for de beskyttede
   dataklasser via det rigtige fil-/objektlager (DKC-041/048). Arkivet har
   ingen update/delete-metode; en WORM-låst post kan ikke slettes af
   driftscredentials.
6. **Holdbar kvittering før mutation** (`logging/src/receipt.mjs`):
   `recordMutation` skriver og (for beskyttede klasser) arkiverer intent-posten,
   skriver den to-fasede auditkvittering og udfører **først derefter**
   mutationen. Fejler et logtrin, kastes der, og mutationen udføres ikke.
7. **Logadgang** (`logging/src/access.mjs`): default-deny. Tenant udledes af
   den verificerede principal (DKC-006); en læserrolle kræves, og selve
   læsningen — også en nægtet — efterlader en
   `LogAccessDecision`-post.
8. **Rekonstruktion** (`logging/src/reconstruct.mjs`): et tværserverforløb
   samles på `correlationId`, provenance adskilles, hver muterende
   modelhandling bindes til en menneskelig godkendelse med matchende digest,
   og hvert verificeret resultat skal pege på et kendt artefakt. Huller
   rapporteres eksplicit.
9. **Integration** (`logging/src/hooks.mjs`, `runtime/src/runtime.mjs`,
   `modules/audit-service/service/src/server.mjs`): runtimes og
   audit-servicen kan kalde en best-effort observer, der lægger korrelerede
   logposter. Observatøren kan ikke ændre eksekveringen; den obligatoriske
   holdbare kvittering ligger fortsat i DKC-009-journalen og i `receipt.mjs`.

Politik, retention og dækning ligger i `logging/logging-policy.json` og det
genererede `docs/compliance/log-coverage.md`.

## Ændrede og nye filer

Se `evidence/deliverable-files.txt` (62 filer). Hovedgrupper:

- **Kontrakter:** `contracts/log-record.schema.json`,
  `contracts/logging-policy.schema.json`,
  `contracts/log-access-decision.schema.json` + 5 eksempler.
- **Nyt modul:** `logging/` (`logging-policy.json`, 15 `src/`-filer og 10
  test-filer + fixture).
- **Conformance:** `conformance/src/logging.mjs`,
  `conformance/test/logging-conformance.test.mjs`,
  `conformance/src/schemas.mjs`, `conformance/src/validate-schemas.mjs`
  (afsnit 30).
- **Persistens-integration:** `persistence/src/adapters/audit.mjs` (returnerer
  nu den holdbare `seq`), `persistence/src/redact.mjs` (eksporterer
  `isSecretValue`).
- **Runtime/tjeneste-hooks:** `runtime/src/runtime.mjs`,
  `modules/audit-service/service/src/server.mjs`.
- **Docs:** `docs/spec/logging.md`, `docs/runbooks/log-reconstruction.md`,
  `docs/compliance/log-coverage.md` (genereret),
  `docs/adr/0050-...md` + ADR-/spec-indeks.
- **Release/registry:** `release/matrix/test-matrix.json` (1.19.0 +
  `REQ-LOGGING-001`), `release/matrix/threats.json` (+2 trusler),
  `tools/baseline/registry.mjs`, `Makefile`, samt regenererede
  `release/sbom/platform-sbom.cdx.json`, `release/artifacts.json`,
  `docs/status/supply-chain.md`, `docs/testing/test-matrix.md`,
  `docs/security/threat-model.md`, `docs/status/implementation-matrix.md`.

## Testkommandoer og resultat

Alle kørt i den anvendte stak (checkout `83ad91a` + DKC-021 + DKC-049):

| Kommando | Resultat | Log |
| --- | --- | --- |
| `make validate` | PASS (3 logposter, 1 politik, 1 logadgang) | `evidence/validate.log` |
| `make lint` | PASS (511 JSON, 1316 filer) | `evidence/lint.log` |
| `make logging-check` | PASS | `evidence/logging-check.log` |
| `make logging-test` | PASS (42 + 8 tests) | `evidence/logging-test.log` |
| `make logging-demo` | PASS (tværserverforløb) | `evidence/logging-demo.log` |
| `make test` | PASS (266 tests) | `evidence/conformance-suite.log` |
| `make release-check` / `release-test` | PASS | `evidence/release-check.log`, `evidence/release-test.log` |
| `make supply-chain-check` | PASS | `evidence/supply-chain-check.log` |
| `make persistence-check` / `persistence-test` | PASS (v1..v12, 78 tests) | `evidence/persistence-check.log`, `evidence/persistence-test.log` |
| `cd runtime && node --test` | PASS (90 tests) | `evidence/runtime-test.log` |
| `cd modules/audit-service/service && node --test` | PASS (34 tests) | `evidence/audit-service-test.log` |
| `make baseline` | FAIL (1 kendt FAIL: `changelog-check`; 120 PASS, 34 NOT RUN) | `evidence/baseline.log`, `evidence/baseline-summary.txt` |

Den kendte, allerede tilstedeværende `changelog-check`-fejl (commit `83ad91a`
mangler DCO sign-off) er rapporteret ærligt og er hverken "fixet" eller skjult.

## Acceptance-kriterier

| Kriterium | Status | Evidens |
| --- | --- | --- |
| Et tværserverforløb kan rekonstrueres til samme artefakter og approval | **PASS** | `logging/src/reconstruct.mjs`, `logging/test/reconstruct.test.mjs`, `logging/test/end-to-end.test.mjs`, `evidence/logging-demo.log` |
| Logsvigt medfører ikke ulogget AI-mutation | **PASS** | `logging/src/receipt.mjs`, `logging/test/receipt.test.mjs` (journal- og logfejl → ingen mutation), `evidence/logging-demo.log` |
| Agenten kan ikke omskrive eller slette sin historik | **PASS** | `logging/src/ledger.mjs` (ingen update/delete), `logging/src/archive.mjs` (WORM; sletning afvist), `logging/test/ledger.test.mjs`, `logging/test/archive.test.mjs`, `logging/test/end-to-end.test.mjs` (hash-kæden opdager tampering) |
| Sensordata, modeludsagn og verificerede resultater er tydeligt adskilt | **PASS** | `logging/src/provenance.mjs`, `contracts/log-record.schema.json`, `conformance/test/logging-conformance.test.mjs` |
| Logs er komplette som revisionsspor uden passwords, tokens eller skjult intern modelræsonnering | **PASS** | `logging/src/redact.mjs`, `logging/test/redact.test.mjs`, `conformance/test/logging-conformance.test.mjs` |
| En målt logstrøm fra levende agenter/servere og rigtige OTel-/WORM-tjenester | **NOT RUN** | `integration-logging-live`; begrundelse i `evidence/baseline.log` og `tools/baseline/registry.mjs`. Kræver uafhængig driftsverifikation. |

## Kørte og beståede checks (baseline)

- `logging-check` … PASS
- `logging-test` … PASS
- `integration-logging-live` … NOT-RUN (se begrundelse)

## Rækkefølge og forudsætninger

Overlayen lægges med `./apply.sh <checkout>/00-core`, som først lægger
DKC-001..DKC-021 via `dkc-021/apply.sh`. Bekræftet end-to-end i
`evidence/e2e-apply.log`, `evidence/e2e-install.log`, `evidence/e2e-test.log`,
`evidence/e2e-check.log`, `evidence/e2e-tree-diff.txt`.

## Kendte begrænsninger

- En målt logstrøm fra en levende agent-/serverflåde og rigtige
  OTel-/WORM-tjenester er `integration-logging-live` og **NOT RUN**. Den
  deterministiske efterprøvning kører over den rigtige SQLite-ledger og det
  rigtige filbaserede WORM-lager.
- WORM-låsen modelleres på det rigtige filsystem (DKC-041); en målt
  object-lock-håndhævelse på et rigtigt S3-kompatibelt produkt er fortsat
  `integration-immutable-live` (NOT RUN) fra DKC-048.
- `make baseline` ændrer som sædvanligt 30 sporede filer under
  `modules/*/conformance`; de er gendannet byte-identisk fra et snapshot før
  kørslen (se `evidence/baseline-summary.txt`).
- Baseline har én kendt, præeksisterende FAIL (`changelog-check`), som ikke er
  en del af DKC-049.

## Review-identifikatorer

- Reviewets base: `5f9fa73`
- Undersøgt checkout: `83ad91a`
- Forudsætningsoverlays: `dkc-021` (kæder `dkc-048`, `dkc-041`, `dkc-039`,
  `dkc-040`, `dkc-038`, …, `dkc-001`)
