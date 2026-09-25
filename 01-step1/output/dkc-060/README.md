# DKC-060 — Tværgående IAM og dataadgang for Communications, HR, BI og Reporting

Kumulativ overlay oven på DKC-001..DKC-066. Lægges med `./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73`
- **Undersøgt checkout:** `83ad91a`
- **Forudsætninger:** DKC-006, DKC-019, DKC-023, DKC-053, DKC-055, DKC-056 —
  alle verificeret til stede i den anvendte stak. Overlayen kæder
  `dkc-066/apply.sh` (→ `dkc-017/apply.sh` → … → DKC-001).
- **Node:** v22.22.1

## Implementeret adfærd

DKC-060 indfører en fælles, default-deny model for ressource-, række- og
feltadgang for de fire valgfrie funktionspakker og genbruger den i rapportering,
offboarding og datakildeconnectoren.

1. **Funktionsprofiler** (`feature-access/profiles/*.json`) for Communications,
   HR, BI og Reporting med hvert sit formål, modulvalg, dataklasser og
   default-deny-feltregler. Følsomme og særlige kategorier kræver en eksplicit
   `requiresGrant`; alle syv flader skal være dækket; `platform-core` er
   obligatorisk.
2. **Adgangsmotoren** (`feature-access/src/access.mjs`) afgør ressource-,
   række- og feltadgang ud fra den verificerede principal. Tenant udledes af
   principalen, formålet skal matche profilen, og kun læsehandlinger tillades.
   `filterRows` er tenantstram og default-deny.
3. **Fladelighed:** `evaluateAcrossSurfaces`/`surfaceConsistencyProblems`
   evaluerer samme beslutning på UI, API, connector, søgning, eksport, cache og
   AI-værktøj og afviser enhver afvigelse.
4. **Gæster** (`guests.mjs`): tidsbegrænset, eksplicit ressourceliste og
   feltsæt, ingen rollearv, aldrig tenantbred.
5. **Servicekonti** (`service-accounts.mjs`): præcis rollen `service-account`,
   ikke-interaktiv, ingen impersonation, afgrænsede scopes uden `*`; admin-
   credentials afvises.
6. **Offboarding** (`offboarding.mjs`): lukker sessioner, API-tokens, delinger,
   planlagte workflows og AI-værktøjsbevillinger inden en frist; idempotent og
   holdbar (fil-lager med atomisk skrivning).
7. **Rapportering** (`reporting.mjs`): definitionen bærer kun afsenderens
   subject — aldrig et creator-token. `authorizedReportRun` genopretter
   afsenderens og alle modtageres rettigheder ved hver kørsel (`run`,
   `reauthorize`, `blocked`); `deliverReport` gentager revalideringen ved
   afsendelse.
8. **Beskyttet connector** (`connector-guard.mjs`): afviser rå SQL,
   administratorcredentials og ikke-afgrænsede identiteter; tillader kun
   godkendte, parameteriserede skabeloner og genbruger DKC-056-connector'ens
   read-only-/scope-/tenantkontrol.
9. **Kontrakter:** `feature-profile`, `report-definition`, `report-run` og
   `offboarding-plan` med semantiske validatorer i
   `conformance/src/feature-access.mjs`, wired ind i `validate-schemas.mjs`.
10. **Reporting uden HR/Communications:** rapportdefinitioner mod en ekstern
    HR-kilde bruger `moduleRef: reporting` og kildens connector; HR- og
    Communications-applikationerne indgår ikke i reportings moduler.

## Ændrede og nye filer

Se `evidence/deliverable-files.txt` (52 filer). Hovedgrupper:

- `feature-access/` — nyt modul: `profiles/` (4), `src/` (11), `test/` (9),
  `package.json`.
- `contracts/` — 4 nye skemaer + 5 eksempler.
- `conformance/src/feature-access.mjs`, `conformance/test/feature-access-conformance.test.mjs`,
  `conformance/src/schemas.mjs` og `conformance/src/validate-schemas.mjs`.
- `Makefile` (`feature-access-check/-test/-demo` + `ci`), `tools/baseline/registry.mjs`
  (komponent + 5 checks).
- `release/matrix/test-matrix.json` (1.12.0, `REQ-FEATURE-ACCESS-001`),
  `release/matrix/threats.json` (3 trusler), `docs/testing/test-matrix.md`,
  `docs/security/threat-model.md`.
- `release/sbom/platform-sbom.cdx.json`, `release/artifacts.json`,
  `docs/status/supply-chain.md` (SBOM regenereret for `feature-access/package.json`).
- `docs/adr/0043-…`, `docs/adr/README.md`, `docs/spec/feature-access.md`,
  `docs/spec/README.md`, `docs/runbooks/offboarding.md`,
  `docs/status/implementation-matrix.md`.

## Testkommandoer og resultater

| Kommando | Resultat |
|---|---|
| `node conformance/src/validate-schemas.mjs` | PASS |
| `node conformance/src/lint.mjs` | PASS |
| `make feature-access-check` | PASS |
| `make feature-access-test` | PASS (54 enheds-/autorisationstests + 8 konformanstests) |
| `make feature-access-demo` | PASS |
| `make release-check` | PASS (35 krav, matrixversion 1.12.0) |
| `make release-test` | PASS |
| `make supply-chain-check` | PASS |
| `make test` | PASS (210 tests) |
| `make baseline` | 103 PASS / 1 FAIL / 26 NOT RUN (130 checks) |

Den ene FAIL er den forud eksisterende `changelog-check` (commits mangler DCO
sign-off). Den er hverken skjult ellerændret.

## Acceptkriterier

| Kriterium | Status | Bevis |
|---|---|---|
| BI-bruger kan ikke læse lønfelter uden udtrykkelig HR-autorisation | **PASS** | `feature-access/test/access.test.mjs`, `profiles.test.mjs`; demo viser `deny` |
| Skemalagte rapporter stoppes/genautoriseres efter tab af afsenders/modtagers rettigheder | **PASS** | `feature-access/test/reporting.test.mjs` (`reauthorize`/`blocked`), `deliverReport` leverer intet |
| Offboarding lukker sessioner, API-tokens, delinger og planlagte workflows efter frist | **PASS** | `feature-access/test/offboarding.test.mjs` (alle fem klasser, idempotens, fristbrud, holdbarhed) |
| Connector må ikke lave vilkårlige queries med admincredentials | **PASS** | `feature-access/test/connector-guard.test.mjs` (rå SQL, admin, ikke-tjenestekonto) |
| Reporting kan installeres uden hele HR/Communications-pakken hvis datakilden ikke kræver dem | **PASS** | `feature-access/test/installability.test.mjs`: DKC-053-resolveren giver `reporting`-closure uden `hr`/`communications`; `feature-access/profiles/reporting.json` + `report-definition.example.json` bruger ekstern HR-kilde |
| SSO-login alene accepteres ikke som bevis for downstream-autorisation | **PASS** | `feature-access/test/access.test.mjs` (SSO-only-principal nægtes beskyttet felt); feltkrav om bevilling |
| Rigtig rapportleveringskanal (SMTP/filshare/portal) | **NOT RUN** | `integration-reporting-delivery`; ingen modtager i miljøet |
| Rigtig IdP/tokenudbyder ved offboarding | **NOT RUN** | `integration-idp-offboarding`; ingen IdP i miljøet |

## Restgrænser

- Ingen live leveringskanal eller live IdP i dette miljø; begge er registreret som
  `external: true` og NOT RUN med begrundelse.
- `changelog-check` fejler fortsat (forud eksisterende, DCO sign-off mangler).
- Overlayen erklærer ikke produktionsparathed; kun lokale kontrakt- og
  autorisationstests er kørt.
