# DKC-061 — Opdatering, fjernelse, support og offline-drift

Kumulativ overlay oven på stak-tippet **DKC-059**. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-059/apply.sh` → `dkc-031/apply.sh` →
  `dkc-030/apply.sh` → … → `dkc-001/apply.sh`. DKC-061 afhænger formelt af
  **DKC-014** (reproducerbare artefakter), **DKC-031** (migrations- og
  exitværktøjer), **DKC-053** (installationsprofiler og dependency-resolver),
  **DKC-054** (installer og fælles konfiguration), **DKC-057** (eksterne
  backupmål) og **DKC-059** (providerkontrakter og migrationskontrol). Alle er
  verificeret i den anvendte stak (`evidence/prerequisites.txt`).
- **Miljø:** Node v22.22.1. Ingen levende installation, intet rigtigt snapshot
  og ingen menneskelig godkendelse. Releasekataloget, opdateringsplanen,
  migrationskontrollen, rollbacken, fjernelsen, datasletningsgaten,
  supportbundlen og offlineberedskabet er efterprøvet deterministisk mod
  syntetiske fixtures. Den målte livscyklus (`make lifecycle-live`) er NOT RUN.

## Implementeret adfærd

1. **Signeret releasekatalog** (`catalog/releases.json`,
   `installer/src/lifecycle-model.mjs`). Hver release har `channel`
   (`stable`/`security`/`eol`/`revoked`), supportvindue, `eolAt`, vedtaget
   håndtering, en `compatibilityLock` pr. komponent og signerede artefakter.
   Kataloget er HMAC-signeret med det bevidst offentlige udviklingsnøglesæt;
   trust anchor er `release/trust/release-keys.json` (DKC-014). Kun `stable` og
   `security` må køres; `eol`/`revoked` afvises af opdateringsplanens preflight.
2. **Modulopdatering** (`installer/src/lifecycle-update.mjs`). En deterministisk,
   signeret `LifecycleUpdatePlan` med påvirkningsplan (tilføjede/fjernede/
   opgraderede/nedgraderede komponenter og berørte delte datatjenester),
   migrationskontrol (faser + reversibilitet), read-only preflight,
   rollback/gendannelse og en menneskelig godkendelse. `executeUpdate`/
   `resumeUpdate` er resumable, og `rollbackUpdate` gendanner et snapshot taget
   før første mutation. Uden en gyldig signatur kører intet.
3. **Fjernelse adskilt fra datasletning** (`installer/src/lifecycle-remove.mjs`).
   Reverse-dependency-kontrollen afviser fjernelse af en delt database eller IAM
   mens aktive moduler kræver den, og sikkerhedskernen kan ikke fjernes separat.
   `remove-only` bevarer data og recoverymetadata; `remove-and-delete-data`
   kræver eksport eller verificeret backup, en eksplicit destruktiv godkendelse
   og to forskellige navngivne personer.
4. **Redigeret supportbundle** (`support/policy.json`,
   `installer/src/lifecycle-support.mjs`). Bundlen bygges ud fra en allowlist,
   redigeres, og både hemmelighedssignaturer og ikke-godkendt HR-indhold
   (løn, sygefravær, fagforening, personalesager) blokerer bundlen
   (fail-closed). Der findes ingen skjult fjernadgang: fjernadgang er
   default-deny og kræver et navngivent menneskes samtykke med en TTL og et
   revisionsspor.
5. **Offlinepakke og cloud-uafhængig drift** (`catalog/offline-package.json`,
   `installer/src/lifecycle-offline.mjs`). Offlinepakken er selvstændig, de
   lokale kerneflows (autorisation, dataadgang, audit, backup, lokal søgning)
   består ved et internetudfald, og hver ekstern afhængighed (model-API, ekstern
   API, opdateringskilde) har en `offlineBehavior` og en eksplicit status.
   Enhver gateway-rute skal være markeret; der findes ingen tavs fallback.
6. **Adgang** (`installer/src/lifecycle-permissions.mjs`). Default-deny,
   tenantadskilt og rollebeskyttet (`lifecycle-admin`, `lifecycle-operator`,
   `lifecycle-auditor`); datasletning kræver to-personers-kontrol, og
   fjernadgang kræver samtykke.
7. **Holdbar butik** (`installer/src/lifecycle-store.mjs`). Filbaseret butik med
   epochs, release, komponenter, opdaterings-/fjernelsesrecords, supportbundles
   og snapshot/restore.
8. **Kontrakter og konformans.** Seks kontrakter og seks eksempler
   (`release-catalog`, `lifecycle-update-plan`, `lifecycle-removal-plan`,
   `support-bundle-policy`, `support-bundle`, `offline-package`), semantiske
   validatorer i `conformance/src/lifecycle.mjs` og afsnit 49 i
   `conformance/src/validate-schemas.mjs`.
9. **Rapport.** `installer/src/lifecycle-check.mjs` og
   `installer/src/lifecycle-cli.mjs` bygger en deterministisk rapport
   (`lifecycle/report/lifecycle-report.json`,
   `docs/lifecycle/lifecycle-report.md`) med `measured: false`.
10. **Release-matrix.** Nyt krav `REQ-LIFECYCLE-001` og trussel
    `THREAT-LIFECYCLE-001` (grænse `privileged-host-operations`); matrixversion
    **1.41.0**. ADR **0072**.

## Ændrede og nye filer

Se `OVERLAY-MANIFEST.txt` for den fulde, hash-verificerede liste (50
leverancefiler + `README.md`, `apply.sh`, `OVERLAY-MANIFEST.txt` i pakken).
Overordnet:

- Nye data: `catalog/releases.json`, `catalog/offline-package.json`,
  `support/policy.json`, `lifecycle/report/lifecycle-report.json`.
- Ny kode: `installer/src/lifecycle-{model,update,remove,support,offline,permissions,store,check,report,cli}.mjs`.
- Nye tests: `installer/test/lifecycle-{update,remove,support,offline}.test.mjs`,
  `conformance/test/lifecycle-conformance.test.mjs`.
- Nye kontrakter: `contracts/{release-catalog,lifecycle-update-plan,lifecycle-removal-plan,support-bundle-policy,support-bundle,offline-package}.schema.json`
  + seks eksempler.
- Ændret: `Makefile`, `tools/baseline/registry.mjs`, `conformance/src/schemas.mjs`,
  `conformance/src/validate-schemas.mjs`, `release/matrix/{test-matrix,threats}.json`,
  `docs/{adr/README.md,security/threat-model.md,status/implementation-matrix.md,testing/test-matrix.md}`.
- Nye dokumenter: `docs/spec/product-lifecycle.md`,
  `docs/operations/{update-and-remove,support-bundle,offline-operation}.md`,
  `docs/runbooks/{module-update-rollback,module-removal}.md`,
  `docs/lifecycle/lifecycle-report.md`,
  `docs/adr/0072-opdatering-fjernelse-support-og-offline-drift.md`.

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make validate` | PASS — skemaer + eksempler; 6 livscykluskontrakter valideret |
| `make lint` | PASS — 775 JSON-filer, 2019 filer |
| `make lifecycle-check` | PASS — 9 scenarier; 4 releases, 11 låste komponenter, 5 kerneflows |
| `make lifecycle-test` | PASS — 26 installer-tests + 18 konformanstests |
| `make lifecycle-run` | PASS — alle 9 scenarier PASS |
| `make lifecycle-render` | PASS — 2 artefakter skrevet deterministisk |
| `make release-check` | PASS — 64 krav, matrixversion 1.41.0 |
| `make release-test` | PASS |
| `make distribution-check` | PASS |
| `make supply-chain-check` | PASS — SBOM-digest uændret `3456a5aa690c…` (ingen ny `package.json`) |
| `make baseline-test` | PASS |
| `make test` | PASS — 473 konformanstests |
| `make baseline` | FAIL — 254 checks: 198 PASS, 1 kendt FAIL (`changelog-check`, manglende DCO sign-off), 55 NOT RUN |

Se `evidence/` for de fulde logs. Baseline muterer 31 sporede
`modules/*/conformance`-fixtures; de er gendannet fra en ren reference-klon, og
`diff -rq` er tom.

## Acceptkriterier

| Kriterium | Status | Evidens |
| --- | --- | --- |
| Fjernelse af en delt database eller IAM afvises når aktive moduler kræver den | **PASS** | `lifecycle-remove.test.mjs`, scenarie `shared-database-and-iam-removal-rejected` |
| Almindelig uninstall bevarer data og recoverymetadata som oplyst | **PASS** | `lifecycle-remove.test.mjs`, scenarie `uninstall-preserves-data-and-recovery-metadata` |
| Udgået eller tilbagekaldt pakke giver synlig status og vedtaget håndtering | **PASS** | scenarie `release-catalog-signed-and-lifecycle-visible`; EOL/revoked afvises som opdateringsmål |
| Afbrudt upgrade kan genoptages eller gendannes efter dokumenteret procedure | **PASS** | `lifecycle-update.test.mjs`, scenarie `update-impact-migration-approval-resume-rollback`; `docs/runbooks/module-update-rollback.md` |
| Supportbundle har ingen secrets eller ikke-godkendt HR-indhold | **PASS** | `lifecycle-support.test.mjs`, scenarie `support-bundle-redacted-no-secrets-no-hr-no-hidden-access` |
| Internet-/LLM-udfald bevarer lokale kerneflows; ikke-understøttede eksterne funktioner vises tydeligt | **PASS** | `lifecycle-offline.test.mjs`, scenarie `offline-local-core-flows-preserved-external-visible` |
| Målt opdatering/fjernelse på en levende installation | **NOT RUN** | Ingen levende installation, intet snapshot og ingen menneskelig godkendelse i dette miljø (`integration-lifecycle-live`) |

## Ærlige begrænsninger

- `make lifecycle-live` og `integration-lifecycle-live` er **NOT RUN**: der
  findes ingen levende installation, intet rigtigt snapshot og ingen
  menneskelig godkendelse i dette miljø.
- Releasekataloget signeres i dette miljø med det bevidst offentlige
  udviklingsnøglesæt (`configuration/dev-keyring.json`). I produktion leveres
  signeringsnøglen af KMS/HSM og den offentlige trust anchor er
  `release/trust/release-keys.json`.
- `make baseline` fejler fortsat på den præeksisterende `changelog-check`
  (manglende DCO sign-off, inkl. `83ad91a`); fejlen er ikke "fixet" og er ikke
  en del af DKC-061.
- Offlinepakken er en versionsstyret definition og kontrolleres deterministisk;
  selve mediet/artefakterne er ikke bygget i dette miljø.

## Review-identifikator

- Base: `83ad91a963d8055f77c29fb4361455689df95acb`
- Stak-tip-forudsætning: `01-step1/output/dkc-059/apply.sh`
- Denne overlay: `01-step1/output/dkc-061/apply.sh` →
  `01-step1/output/dkc-061/deliverable/`
