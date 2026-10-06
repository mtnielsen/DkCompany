# ADR-0022: Kortlivede rettigheder udstedes af en KMS-broker og kan nødstoppes

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-010. Runtimens "JIT-credential" var et lokalt `randomUUID()` uden kryptografisk binding, uden audience, uden scope og uden modtagerkontrol. Det kunne hverken bevise hvem der udstedte det, hvilken tjeneste der måtte bruge det, eller hvilken kunde/ressource/handling det gjaldt. Der fandtes heller intet nødstop, der kunne stoppe en agent hurtigt.

## Kontekst og problemstilling

Et rettighedstoken er kun så stærkt som dets binding. Den daværende model havde fire huller:

- **Ingen kryptografisk udsteder.** Et UUID kan enhver gætte/efterligne.
- **Ingen audience.** Et token kunne bruges hos en hvilken som helst executor.
- **Intet scope.** Tokenet var ikke bundet til kunde, ressource, verbum eller miljø.
- **Intet nødstop.** En agent i et loop eller under angreb kunne ikke stoppes hurtigt, og der var ingen defineret myndighed til at aktivere/ophæve et stop.

## Beslutningskriterier

- Udstedelse sker i en ikke-eksporterbar nøgle (KMS/secret-broker); kun signaturen forlader udstederen.
- Tokenet bindes til kunde, ressource, verbum, miljø, audience og TTL.
- Modtageren (executoren) verificerer selv tokenet — ikke kun udstederen.
- Udløb og tilbagekaldelse afviser efterfølgende handlinger hos modtageren.
- Nødstop pr. agent, pr. kunde og globalt afviser nye handlinger inden fem sekunder i staging.
- En agent kan ikke ændre sit eget manifest, sin deployment eller kontroltjenesters adgang.

## Overvejede muligheder

- **Fortætte med et lokalt UUID.** Ingen af kravene opfyldes.
- **Symmetrisk HMAC delt mellem udsteder og modtager.** Enhver modtager kan så også udstede.
- **Asymmetrisk signerer (EdDSA), adskilt udsteder/verifier, scope-binding og nødstop.** Kræver en ny komponent og kontrakter, men lukker alle huller.

## Beslutning

1. **Signerer-abstraktion.** `credentials/src/keys.mjs` definerer en signerer der kun eksponerer `sign()` og den offentlige nøgle. `createLocalSigner` er udviklingsimplementeringen; i produktion er det en cloud-KMS eller Vault Transit, hvor nøglen er ikke-eksporterbar. Verifikationssiden får kun et JWKS.
2. **Scope-bundne tokens.** `credentials/src/broker.mjs` udsteder en kompakt JWS (EdDSA) med claims `iss/sub/aud/jti/iat/nbf/exp`, `tenant_id`, `agent_ref`, `role`, `task_id` og `scope { verb, resource, environment }`. `credentials/src/scope.mjs` kræver kunde, ressource, verbum, miljø, audience og TTL, og afviser A4-beskyttede ressourcer.
3. **Modtagerverifikation.** `credentials/src/verifier.mjs` afviser fail-closed på signatur, `alg`/`kid`, `iss`, `aud`, `sub`, scope, tilbagekaldelse og nødstop. `credentials/src/receiver.mjs` er executor-vagten, så modtageren ikke stoler på kalderen.
4. **Tilbagekaldelse.** `credentials/src/revocation.mjs` tilbagekalder pr. credential (jti), agent (spiffeId) eller kunde (tenantId); holdbar via `persistence/src/adapters/revocations.mjs`.
5. **Nødstop.** `credentials/src/kill-switch.mjs` har tre scopes (agent/kunde/global). Kun et verificeret menneske med en eksplicit rolle (se ADR'ens matrix i specs) kan aktivere/ophæve. Verifikationssiden cacher højst 5 s, så et stop slår igennem inden for grænsen; tilstanden er holdbar via `persistence/src/adapters/stops.mjs`.
6. **Kontrolplans-isolation.** `runtime/src/classification.mjs` udvider de A4-beskyttede rødder med agentregistrering, GitOps og nødstop/broker/KMS. Runtimen afviser sådanne handlinger før executor, og brokeren vil ikke udstede et credential til dem. GitOps-gaten `G-009` afviser RBAC der giver en agent-ServiceAccount adgang til kontrolplanet.

## Konsekvenser

- **Positive:** Rettigheder er kryptografisk bundne og virker kun hos den tilsigtede executor og det tilladte scope. Udløb, tilbagekaldelse og nødstop afvises på modtagersiden. En agent kan ikke ændre kontrolplanet.
- **Negative:** Der kommer en ny `credentials/`-komponent, en fjerde databaseidentitet (`credentials.db`) og en migration (v4). Runtimen får `credentialBroker`/`killSwitch`; uden dem bevares den gamle UUID-adfærd for bagudkompatibilitet.
- **Neutrale:** Agent-manifestets capability får et valgfrit `executor`-felt (audience). Uden feltet udledes audience fra target.

## Mere information

- [`docs/spec/credentials.md`](../spec/credentials.md)
- [`credentials/`](../../credentials), [`persistence/src/adapters/revocations.mjs`](../../persistence/src/adapters/revocations.mjs), [`persistence/src/adapters/stops.mjs`](../../persistence/src/adapters/stops.mjs)
- [`contracts/credential-token.schema.json`](../../contracts/credential-token.schema.json), [`contracts/kill-switch.schema.json`](../../contracts/kill-switch.schema.json)
- [ADR-0018](0018-stram-policy-scope-og-evidenkontrol.md), [ADR-0019](0019-holdbar-tilstand-og-migrationer.md), [ADR-0021](0021-holdbar-audit-og-fail-closed.md)
