# ADR-0013: Fælles kontrolplan med kundeadskilte app-instanser og databaser som pilotstandard

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), med Bo Bertelsen som stedfortræder
- **Dato:** 2026-09-23
- **Beslutningsdrev:** Uden ét fælles svar på "hvordan skiller vi kunder?" bygger hver kodeagent sin egen model, og tenantgrænsen bliver en UI-detalje i stedet for en kontrakt.

## Kontekst og problemstilling

Platformen skal betjene alt fra en enkelt lille virksomhed til en enterprise-kunde med egne isolationskrav. Installationsprofilerne i [reference/06](../../../reference/06-installation-modularity-and-responsibilities.md) beskriver single server, flere servere, dedikeret kundemiljø og eksterne datatjenester. Spørgsmålet er, hvad der er **standard**, så SMV, servicevirksomhed og enterprise deler samme kontrakt uden at dele samme isolation.

En delt database uden tenantkolonnebinding er den klassiske fejl: den er billig at bygge og umulig at bevise isoleret. En dedikeret installation pr. kunde er den modsatte fejl: den er nem at bevise isoleret og dyr for SMV.

## Beslutningskriterier

- Samme kontrakt skal beskrive alle tre kundesegmenter.
- Kundeisolering skal kunne håndhæves og testes, ikke kun beskrives.
- Driftsomkostningen skal være eksplicit for hver profil.
- En enterprise-kunde skal kunne kræve fuld dedikering uden en anden kontrakt.

## Overvejede muligheder

- **Én delt installation med tenantkolonne.** Billigst, men svag isolation og svære negative tests.
- **Kun dedikerede installationer.** Stærk isolation, men uøkonomisk for SMV og servicevirksomhed.
- **Fælles kontrolplan med særskilte app-instanser og databaser pr. kunde (pilotstandard), og dedikeret installation som enterprise-profil.** To varianter af samme kontrakt.

## Beslutning

Vi gør følgende, og håndhæver det i `deployment-profile.schema.json` og `conformance/src/architecture.mjs`:

1. **Pilotstandarden** er `tenantModel.mode: "shared-control-plane"`. Den deler kontrolplanen (portal, policy-PDP, audit-log), men kræver `applicationInstancesPerTenant: true` og `databasePerTenant: true`. Tenantgrænsen skal håndhæves mindst i `api` og `database`.
2. **Enterprise** er `profileType: "dedicated-customer"` med `tenantModel.mode: "dedicated-installation"`. Kunden får sin egen installation.
3. `single-server` er en understøttet **ikke-HA** produktionsprofil og skal eksplicit nævne nedetid i `limitations`.
4. `multiple-servers` kræver `highAvailability.enabled: true`, mindst to failure domains, fencing og **målte** fejltest — ikke en påstand.
5. Host-/OS-styring er `hostManagement.enabled: false` som standard. Tændes den, kræves broker, whitelist af operationer og en out-of-band recovery.
6. Hver profil har `cost` og `limitations`. En profil uden eksplicit driftspris og begrænsninger afvises.

Kontrakten er versioneret (`apiVersion: contracts.platform/v1alpha1`, `metadata.version`) og valideres i `make validate`/`make architecture-test`.

### Konsekvenser

- **Positive:** Én kontrakt dækker SMV, service og enterprise. Tenantisolering er et schemakrav med negative fixtures. Driftspris og begrænsninger kan ikke udelades.
- **Negative:** Flere app-instanser og databaser pr. kunde koster mere drift end en delt database. Dedikeret installation er dyrere og skal sælges som enterprise.
- **Neutrale:** K3s/containerruntimevalget er stadig åbent; ADR'en fastlægger tenant- og profilkontrakten, ikke klyngeproduktet.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| Delt DB med tenantkolonne | Billigst | Svag isolation, svære negative tests |
| Kun dedikeret | Stærk isolation | Uøkonomisk for SMV/service |
| Fælles kontrolplan + dedikeret enterprise | Passer segmenterne, testbar | Flere instanser, højere basisdrift |

## Mere information

- `contracts/deployment-profile.schema.json`
- `conformance/src/architecture.mjs` (`deploymentProfileProblems`)
- `conformance/test/architecture.test.mjs` og negative fixtures i `conformance/test/fixtures/architecture/`
- [ADR-0014 — identitets- og tillidsmodel](0014-identitets-og-tillidsmodel.md)
