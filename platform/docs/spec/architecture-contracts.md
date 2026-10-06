# Arkitektur- og identitetskontrakter (DKC-002)

Tre versionerede kontrakter giver alle kodeagenter én fælles arkitekturbeslutning
og udvælgelsesmodel. De er ikke prosa alene: skemaerne, de semantiske regler og de
negative fixtures kører i `make validate` og `make architecture-test`.

| Kontrakt | Formål | Skema | Semantik |
| --- | --- | --- | --- |
| DeploymentProfile | Installations-/tenantmodel, HA, host-styring, datatjenester, driftspris og begrænsninger | [`contracts/deployment-profile.schema.json`](../../contracts/deployment-profile.schema.json) | `deploymentProfileProblems` |
| IdentityTrust | OIDC til mennesker, SPIFFE til tjenester, passwordfrit skygge-ID, trust roots og tenantbinding | [`contracts/identity-trust.schema.json`](../../contracts/identity-trust.schema.json) | `identityTrustProblems` |
| IntegrationCandidate | Eksakt version, edition, licens, hosting/videredistribution, SSO, SCIM, API, isolation, eksport, backup, pris, vedligeholdelse og gratis/betalt-skel | [`contracts/integration-candidate.schema.json`](../../contracts/integration-candidate.schema.json) | `integrationCandidateProblems` |

De semantiske regler ligger i
[`conformance/src/architecture.mjs`](../../conformance/src/architecture.mjs), fordi
de beslutninger, der betyder noget, ikke kan udtrykkes i JSON Schema alene: en
fælles kontrolplan skal kræve databaser pr. kunde, et ukendt trust root skal
afvises, og `unknown` må ikke være godkendt.

## Beslutninger der håndhæves

- **Pilotstandard:** `tenantModel.mode: "shared-control-plane"` kræver
  `applicationInstancesPerTenant: true`, `databasePerTenant: true` og
  tenantgrænse i mindst `api` og `database`. **Enterprise:** `dedicated-customer`
  med `dedicated-installation`. Se [ADR-0013](../adr/0013-deployment-og-tenantmodel.md).
- **Identitet:** OIDC med MFA/PKCE til mennesker, SPIFFE med just-in-time
  credentials til tjenester, og lokalt skygge-ID med `passwordMode: "none"` hvor
  en upstream kræver det. Ukendt trust root og tvetydig tenantbinding afvises.
  Se [ADR-0014](../adr/0014-identitets-og-tillidsmodel.md).
- **Kandidater:** en kandidat kan ikke være `approved` så længe en nødvendig
  egenskab er `unknown`, uden et dokumenteret gratis/betalt-skel med kilde, eller
  uden en testet gendannelse. Ukendt er ikke godkendt.
- **Ejer:** hver kontrakt og hver trust root har et navngivet menneske.
- **Driftspris og begrænsninger:** `cost` og `limitations` er påkrævede, og
  `single-server` skal eksplicit nævne nedetid.

## Eksempler og fixtures

- Gyldige: `contracts/examples/deployment-profile.{smv,service,enterprise}.example.json`,
  `contracts/examples/identity-trust.example.json`,
  `contracts/examples/integration-candidate.example.json`.
- Ugyldige (semantik): `conformance/test/fixtures/architecture/*.invalid.json`.

## Kør

```bash
make validate           # metavalidering + eksempler + arkitektur/identitet
make architecture-test  # 10 tests inkl. negative fixtures
make baseline           # medtager architecture-test i den samlede modenhedsmatrix
```
