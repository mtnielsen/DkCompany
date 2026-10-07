# Fælles adapter-SDK og godkendelsestest

- **Status:** accepteret
- **Beslutningstagere:** Platform Owner (Anna Andersen), Solution Architect (Hans Hansen)
- **Dato:** 2026-01-10
- **Beslutningsdrev:** DKC-023. Hver ny adapter genimplementerede auth, tenant-udledning, fail-closed PDP, audit, idempotens, health og versionsforhandling. Forskelle mellem adaptere blev til sikkerhedshuller, og en ny upstream-version/edition blev taget i brug uden en sporet godkendelse.

## Kontekst og problemstilling

Platformen integrerer mange upstream-produkter gennem adaptere. Hver adapter skal opfylde de samme ufravigelige kontroller: verificerbar identitet, tenant-isolation, default-deny policy gennem PDP, beskyttet audit, højst-én-gangs udførelse af gatede handlinger og ærlig partial/unsupported-conformance. Når hver adapter kopierer logikken, opstår der uundgåeligt afvigelser: én adapter glemmer at afvise en fremmed tenant, en anden lader en native admin-endpoint stå åben, og en tredje antager at "nyeste" upstream-version virker.

Samtidig er et upstream-produkt ikke ét produkt. Det er en eksakt version og edition med sin egen licens, SSO-understøttelse og gratis/betalt-skel. En adapter, der er godkendt på version 10.0 Enterprise, er ikke dermed godkendt på version 7.0 Community.

## Beslutningskriterier

- Nye adaptere skal arve kontrollerne, ikke genopfinde dem.
- En adapter må kunne deployes og testes offline mod en testdobbelt.
- Fail-closed skal være en egenskab ved SDK'en, ikke ved den enkelte adapter.
- En version/edition er først godkendt, når kandidaten og releaseprofilen er sporet.
- Manglende obligatorisk SSO eller uafklaret licens skal blokere, ikke advare.
- Native upstream-admin-endpoints må ikke kunne nås uden om adapter og PDP.
- En gated handling med idempotency-key skal overleve genstart og delte replikaer.

## Overvejede muligheder

- **A:** Fortsætte med kopieret adapterlogik pr. modul.
- **B:** Et tyndt SDK, der kun samler auth og PDP, og lade resten være modulspecifikt.
- **C:** Et fuldt SDK med auth, tenant, PDP, audit, idempotens, health, privacy, versionsforhandling og en genbrugelig godkendelsesharness, kombineret med en kandidatrapport/releaseprofil pr. version/edition.

## Beslutning

Vi vælger **C**. Den fælles adapter-SDK (`adapter-sdk/`) ejer den gatede verbumskæde og kalder adapterens handler efter auth, tenant-udledning, versionsforhandling, fail-closed PDP, godkendelses-/evidenskontrol og idempotens. Mattermost-adapteren er lagt om til SDK'en uden regression og er den første reference.

Idempotens er ikke in-memory: SDK'en bruger `adapter_idempotency`-tabellen via `persistence/src/adapters/adapter-idempotency.mjs` (migration v9), så en kvittering overlever genstart og deles mellem replikaer. En in-memory-store findes kun til tests og offline harness.

Godkendelse sker pr. eksakt upstream-version/edition i et `UpstreamReleaseProfile`, der binder en `IntegrationCandidate` til adapterens verbumskontrakt. Gaten er hård: manglende obligatorisk SSO eller en uafklaret licens blokerer. `nativeAdmin.exposed` skal være `false`, og beskyttelsen skal mindst omfatte adapter, PDP og netværkspolitik.

### Konsekvenser

- **Positive:** Nye adaptere arver kontrollerne; afvigelser bliver synlige i conformance; en upstream-opgradering kræver en ny, sporet godkendelse; native admin-omgåelse afvises maskinelt.
- **Negative:** SDK'en er endnu en afhængighed, og en ændring i den påvirker flere adaptere. Det kræver disciplin at holde releaseprofilerne genereret, ikke håndskrevet.
- **Neutrale:** Adapterens public API er uændret; `createMattermostAdapter` har samme signatur og adfærd.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Ingen ny abstraktion | Gentagne fejl; svær at revidere; ingen versionssporing |
| B | Lille ændring | Tenant, idempotens, health og versioner forbliver modulspecifikke og uens |
| C | Én kontrolleret vej; genbrugelig harness; sporet godkendelse | Mere kode og en ny tabel/migration at vedligeholde |

## Mere information

- [`docs/spec/adapter-sdk.md`](../spec/adapter-sdk.md)
- [`docs/runbooks/adapter-onboarding.md`](../runbooks/adapter-onboarding.md)
- [`contracts/upstream-release-profile.schema.json`](../../contracts/upstream-release-profile.schema.json)
- [`contracts/integration-candidate.schema.json`](../../contracts/integration-candidate.schema.json) (DKC-002, ADR-0013/0014)
- [`adapter-sdk/`](../../adapter-sdk/)
- [`persistence/migrations/0009_adapter_idempotency.sql`](../../persistence/migrations/0009_adapter_idempotency.sql)
