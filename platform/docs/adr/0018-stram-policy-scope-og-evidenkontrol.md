# ADR-0018: Ugyldigt eller tvetydigt input afvises før en executor kan køre

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-007. Runtimen behandlede alt andet end et eksplicit `deny` som en tilladelse, havde en håndholdt liste af muterende verber og A4-mål, et scope der matchede i begge retninger, og et evidensbegreb der var en fri tekststreng.

## Kontekst og problemstilling

Ved runtimegrænsen kunne et tomt eller ukendt PDP-svar passere som en tilladelse, fordi kun `decision === "deny"` stoppede handlingen. `MUTATING_VERBS` og A4-regexen var lokale lister: et nyt muterende verbum (`upgrade.hotfix`) eller et alias/encoding af et beskyttet mål (`POLICY/Bundles`, `policy%2Fbundles`, `audit_service`) kunne omgå A4. `withinScope` matchede også baglæns, så en capability til `module/child` åbnede `module`. Endelig var `evidence: ["tests-pass"]` blot en etikette, kalderen selv kunne skrive.

## Beslutningskriterier

- Et ukendt, tomt eller ikke-bundet PDP-svar må ikke føre til en handling.
- Miljø, `ownedComponents`, datakategori og target-scope skal håndhæves ensrettet.
- A4 må ikke kunne omgås med case, aliaser, encoding, sti-tricks eller nye verber.
- Et bevis skal slås op og bindes til en digest/commit, ikke være en tekstetikette.

## Overvejede muligheder

- **Behold kun `deny`-tjekket og udvid listerne.** Nye verber og aliaser fortsætter med at slippe igennem.
- **Stol på PDP'ens egen A4-regel.** PDP'en er ikke den sidste grænse; et manglende/uklart svar ville stadig passere.
- **Validér manifest, task og PDP-svar ved grænsen, klassificér verbet default-muterende og bind evidens til digests.** Lukker alle fire huller i ét lag.

## Beslutning

1. `runtime/src/boundary.mjs` validerer manifestets form, taskens form og PDP-svaret. Et svar med ukendt/tom `decision`, manglende `pdp`/`matchedRules`, eller en `inputSha256` der ikke matcher `digestOf(input)`, stopper handlingen (fail-closed). `runtime/src/digest.mjs` er kanonisk identisk med PDP'ens.
2. `runtime/src/classification.mjs` er den fælles klassifikation. Alle verber undtagen en udtømmende læseliste er muterende; beskyttede A4-ressourcer matches på normaliserede segmenter (NFKC, encode-decode, separatorer, `.`/`..`, case og aliaser). `policy/pdp`-reglen og conformance bruger samme regel.
3. Scope er ensrettet: et capability-scope dækker sig selv og sine børn, aldrig sine forældre. `ownedComponents` og `scope.environments` håndhæves pr. handling sammen med `action.dataCategories`.
4. `runtime/src/evidence.mjs` kræver en `evidenceIndex`-reference med uri og SHA-256. Runtimen læser artefaktet, genberegner digesten og afviser ved mismatch. `policy-allow` er intrinsisk (den validerede PDP-beslutning); alle andre labels kræver en reference. De verificerede digester følger med i policy-inputtet (`context.evidenceSha256`).

## Konsekvenser

- **Positive:** Tomme/ukendte PDP-svar, prod-handlinger fra en staging-agent, child-scope der åbner forælderen, A4-aliaser/encoding og tekstetikette-beviser afvises alle før en executor kaldes. Klassifikationen er ét sted.
- **Negative:** Agent-task-kontrakten får `evidenceIndex` og `dataCategories`, og eksisterende opgaver skal levere digest-bundne beviser. PDP-stubber i tests skal returnere et bundet svar.
- **Neutrale:** Klassifikationen er default-muterende, så et nyt verbum behandles konservativt indtil det står på læselisten.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| Udvid listerne | Små ændringer | Nye verber/aliaser slipper igennem |
| Stol på PDP'ens A4 | Ét sted | Grænsen er ikke den sidste |
| Grænsevalidering + default-klassifikation + digest-evidens | Lukker hullerne | Kontraktudvidelse og opdaterede tests |

## Mere information

- [`docs/spec/policy-boundary.md`](../spec/policy-boundary.md)
- [`runtime/src/boundary.mjs`](../../runtime/src/boundary.mjs), [`runtime/src/classification.mjs`](../../runtime/src/classification.mjs), [`runtime/src/evidence.mjs`](../../runtime/src/evidence.mjs)
- [`contracts/agent-task.schema.json`](../../contracts/agent-task.schema.json), [`contracts/policy-input.schema.json`](../../contracts/policy-input.schema.json)
- [ADR-0004](0004-letvaegts-pdp.md), [ADR-0017](0017-tenant-kontekst-og-ressource-id.md)
