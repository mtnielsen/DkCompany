# ADR-0017: Tenant udledes af verificeret kontekst og bæres af ressource-ID'er

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-006. Flere tjenester udledte tenanten som `body.tenantId ?? principal.tenantId`. Et felt, kalderen selv kunne skrive, bestemte altså hvilken kunde en handling gjaldt — og et `tenantId` i body kunne pege på en fremmed kunde.

## Kontekst og problemstilling

ADR-0013 fastlagde kundeadskilte app-instanser og databaser, og DKC-003 gjorde identiteten verificerbar. Men identiteten bar kun tenanten som en egenskab; tjenesterne læste den ikke konsekvent. Audit-servicen, adapterne og gatewayens budget/modelhistorik behandlede `tenantId` som et input-felt frem for en autoriseret kontekst, og subjektregistret, søgeindekset og audit-listen havde ingen tenant-dimension. Resultatet var, at to kunder med samme lokale objekt-ID kunne blande data, og at en tenant-swap i URL, header eller body blev accepteret.

## Beslutningskriterier

- Tenant skal udledes af den verificerede kontekst (OIDC, mTLS-SVID, betroet proxy eller session), aldrig af et klientfelt.
- En påstand om tenant i URL, header eller body skal enten stemme eller afvises.
- Identiske lokale objekt-ID'er hos to kunder må ikke kollidere eller kunne læses på tværs.
- Baggrundsjob, eksport, cache, filer, audit, modelhistorik og søgning skal bevare tenanten.
- Administrative handlinger på tværs af kunder skal kræve en særskilt rolle **og** en eksplicit scope — rollen alene er ikke nok.

## Overvejede muligheder

- **Stol på `body.tenantId` med et fald tilbage til principalen.** Billigt, men kalderen bestemmer kunden.
- **Én delt database med et tenant-filter, der "huskes" af applikationen.** Isoleringen bliver en konvention, ikke en grænse.
- **Kanonym ressource-ID + tenant-scoped datalag og en streng kontekst-resolver.** Isoleringen bliver en kontrakt, der kan testes negativt.

## Beslutning

1. Der indføres ét fælles modul, `identity/src/tenant.mjs`, med `normalizeTenantId`, `resolveTenantContext`, `authorizeTenantAccess` og ressource-ID-kontrakten `res://<tenant>/<type>/<lokal-id>`. Kontrakten dokumenteres i `contracts/tenant-context.schema.json` og valideres semantisk i `conformance/src/tenant.mjs`.
2. `resolveTenantContext` gør principalens tenant autoritativ. Alle tenant-påstande i header, body, query og ressource-ID skal stemme; ellers afvises requesten med `tenant_mismatch`. Har principalen ingen tenant, kræves platformrollen `platform-admin` **og** en eksplicit scope (`platform-admin:<kunde>`, `platform-admin:*` eller et signeret `tenantScope`).
3. `identity/src/tenant-store.mjs` giver tenant-scoped datalager, cache, jobkø, filer, søgning, modelhistorik og audit-trail. Hver adapter tager tenanten som første argument og nægter at returnere data på tværs.
4. Audit-servicen, Mattermost- og IAM-adapterne og AI-gatewayen udleder tenanten gennem resolversen. Godkendelsesservicen kræver platformrolle + eksplicit scope for krydskunde-godkendelse og tenant-afgrænser læse-adgang til en anmodning.
5. Runtimen afviser en opgave, hvis `task.tenantId` ikke matcher agentens autoriserede tenant, og alle audit-events bærer tenanten.

## Konsekvenser

- **Positive:** Tenant-swap i URL/header/body giver 403. To kunder med identiske lokale ID'er kan ikke læse, ændre eller godkende hinandens data. Baggrundsjob og eksport bevarer tenanten gennem kø og artefakt-sti. Krydskunde-administration er en eksplicit rolle + scope.
- **Negative:** Modulerne får en ny afhængighed til `identity/tenant.mjs`, og kalde-kontrakter ændres (fx `subjects.locate(tenantId, ...)`). Eksisterende tjenester, der stolede på `body.tenantId`, skal omlægges.
- **Neutrale:** Ressource-ID'erne bliver længere, men selvbærende. En delt database er stadig mulig, men tenanten skal være en del af nøglen i hvert lag.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| Body-felt med fallback | Ingen ændringer | Kalderen bestemmer kunden |
| Applikationshusket filter | Simpelt | Isolering er en konvention, svær at teste negativt |
| Kanonym ressource-ID + scoped datalag | Testbar grænse, negative tests | Flere led og en ny afhængighed |

## Mere information

- [`docs/spec/tenant-isolation.md`](../spec/tenant-isolation.md)
- [`contracts/tenant-context.schema.json`](../../contracts/tenant-context.schema.json), [`conformance/src/tenant.mjs`](../../conformance/src/tenant.mjs)
- [`identity/src/tenant.mjs`](../../identity/src/tenant.mjs), [`identity/src/tenant-store.mjs`](../../identity/src/tenant-store.mjs)
- [ADR-0013](0013-deployment-og-tenantmodel.md), [ADR-0014](0014-identitets-og-tillidsmodel.md), [ADR-0015](0015-autentiske-godkendelser.md)
