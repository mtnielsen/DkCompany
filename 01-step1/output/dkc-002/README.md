# DKC-002 — Deployment- og identitetskontrakter (leverance)

Implementering af **DKC-002** for `mtnielsen/DkCompany`. Opgaven afhænger af
**DKC-001** og bygger oven på dennes overlay.

`00-core/` er fortsat **ikke ændret**. Alt ligger under `01-step1/output/dkc-002/`.
Overlayen i `deliverable/` spejler repositoryets stier og lægges på en checkout,
hvor DKC-001 allerede er lagt, med [`apply.sh`](apply.sh).

## Hvad der er implementeret

1. **Tre versionerede kontrakter** med `apiVersion: contracts.platform/v1alpha1`:
   - `contracts/deployment-profile.schema.json` — installationsprofil, tenantmodel,
     HA, host-styring, datatjenester, driftspris og eksplicitte begrænsninger.
   - `contracts/identity-trust.schema.json` — OIDC til mennesker, SPIFFE til
     tjenester, passwordfrit skygge-ID, trust roots og tenantbinding.
   - `contracts/integration-candidate.schema.json` — eksakt version, edition,
     licens, hosting/videredistribution, SSO, SCIM, API, isolation, eksport,
     backup, pris, vedligeholdelse og gratis/betalt-skel.
2. **Semantiske validatorer** i `conformance/src/architecture.mjs`, der håndhæver
   det, JSON Schema ikke kan: pilotstandardens kundeadskillelse, ukendte trust
   roots, tvetydig identitet, ikke-understøttede profilkombinationer, og at
   `unknown` ikke er godkendt.
3. **Gyldige eksempler og ugyldige fixtures** plus **10 tests** i
   `conformance/test/architecture.test.mjs` med negative fixtures i
   `conformance/test/fixtures/architecture/`.
4. **Koblet til den eksisterende indgang:** `make validate` validerer nu også
   arkitektur/identitet, `make architecture-test` kører de nye tests, begge er i
   `make ci`, og DKC-001's `make baseline` medtager `architecture-test`.
5. **To ADR'er** med kodehenvisninger (ikke prosa alene): ADR-0013 og ADR-0014,
   samt `docs/spec/architecture-contracts.md`.

## Ændrede filer (overlay, relativt til `00-core/`)

```
Makefile                                            (+ architecture-check/-test, i ci)
contracts/deployment-profile.schema.json            (ny)
contracts/identity-trust.schema.json                (ny)
contracts/integration-candidate.schema.json         (ny)
contracts/examples/deployment-profile.smv.example.json
contracts/examples/deployment-profile.service.example.json
contracts/examples/deployment-profile.enterprise.example.json
contracts/examples/identity-trust.example.json
contracts/examples/integration-candidate.example.json
conformance/src/architecture.mjs                    (ny, semantiske regler)
conformance/src/schemas.mjs                         (+ 3 SCHEMA_IDS)
conformance/src/validate-schemas.mjs                (+ arkitekturvalidering)
conformance/test/architecture.test.mjs              (ny, 10 tests)
conformance/test/fixtures/architecture/*.invalid.json (6 negative fixtures)
docs/adr/0013-deployment-og-tenantmodel.md          (ny)
docs/adr/0014-identitets-og-tillidsmodel.md         (ny)
docs/adr/README.md                                  (+ indeks)
docs/spec/architecture-contracts.md                 (ny)
docs/spec/README.md                                 (+ indeks)
tools/baseline/registry.mjs                         (+ architecture-test, ny komponent)
```

## Testkommandoer og resultater

Kørt i en disposable clone af checkout `83ad91a` med DKC-001 lagt, Node v22.22.1.

| Kommando | Resultat |
| --- | --- |
| `make install` | exit 0 |
| `make validate` | exit 0 — 22 skemaer, 21 eksempler, 5 arkitektur-/identitetseksempler |
| `make architecture-test` | **10 pass / 0 fail** |
| `make test` (hele conformance-suiten) | **30 pass / 0 fail** |
| `make baseline` | 48 checks: **38 pass, 1 fail, 0 error, 9 NOT RUN**; `architecture-test` PASS |

Evidens: `evidence/logs/*.log`, `evidence/baseline/latest.json`,
`evidence/baseline/runs/`, `evidence/baseline/logs/`.
`make baseline` fejler fortsat på `changelog-check` (DKC-001-fundet om manglende
DCO sign-off); det er ikke skjult.

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Alle nødvendige beslutninger har en navngivet menneskelig ejer | **PASS** | Alle tre skemaer kræver `accountableHuman`; `isNamedHuman` afviser `team|platform`; trust roots og kandidater har ejere; ADR-0013/0014 navngiver personer. Negativ fixture `deployment-profile.team-owner.invalid.json`. |
| Samme kontrakter bruges for SMV, servicevirksomhed og enterprise | **PASS** | `deployment-profile.{smv,service,enterprise}.example.json` validerer mod samme skema i `make validate` og i testen "samme deployment-kontrakt dækker SMV, servicevirksomhed og enterprise". |
| Pilotkandidater har dokumenteret gratis/betalt funktionsskel; ukendt er ikke godkendt | **PASS** | `integration-candidate.schema.json` + `integrationCandidateProblems`; negative fixtures `unknown-approved` og `no-freemium`; testene "ukendt egenskab er ikke godkendt" og "betalte features uden dokumenteret gratis/betalt-skel afvises". |
| Arkitekturens driftspris og begrænsninger er eksplicitte | **PASS** | `cost` og `limitations` er påkrævede i skemaet; `single-server` skal nævne nedetid; testen "pilotstandarden kræver særskilte app-instanser og databaser pr. kunde" m.fl. |

## Resterende begrænsninger

- **Ingen rigtig IdP/SPIFFE-integration.** Kontrakterne og reglerne findes; den
  faktiske OIDC-/SPIFFE-kobling er senere opgaver (DKC-003, DKC-023/024).
- **Kandidatvurderingen er syntetisk.** OpenProject-eksemplet er et realistisk
  men ikke autoritativt datapunkt; den præcise version/edition skal verificeres
  af en menneskelig ejer i DKC-023. Ukendt er derfor ikke godkendt.
- **Runtime-/klyngevalg (fx K3s) er ikke taget.** ADR-0013 fastlægger tenant- og
  profilkontrakten, ikke klyngeproduktet.
- **Priser er illustrative** og i syntetiske valutaenheder.
- **DKC-001's `changelog-check`-fejl består** indtil historikken er signeret.
- **Overlay, ikke committed kode.** `00-core/` er urørt; ændringerne skal lægges
  på med `apply.sh` og derefter reviewes.

## Til uafhængig gennemgang

- **Reviewets base-commit:** `5f9fa73457d22583b9948611d5cc3afffec4ae38`.
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb`, ren arbejdskopi.
- **Forudsætning:** `01-step1/output/` (DKC-001) skal lægges først.
- **Ændringen:** `01-step1/output/dkc-002/deliverable/` (25 filer) plus evidens i
  `01-step1/output/dkc-002/evidence/`. Lokal testcommit i den disposable clone:
  `b49fe01`. `00-core/` er bit-for-bit urørt.
