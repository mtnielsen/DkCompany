# ADR-0015: Godkendelser er autentiske og bundet til den præcise ændring

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-004. En godkendelse uden verificeret identitet og uden binding til ændringen er en knap, ikke en kontrol.

## Kontekst og problemstilling

Approval-servicen (2.4) håndhævede grupper, træning, udløb og `merge-check`, men den stolede på felter, som kalderen selv sendte med: `groups`, `completedTrainingModules` og i praksis også ændringens indhold. Det giver tre reelle angrebsveje:

1. En kalder kan påstå at være i `platform-approvers` og at have gennemført træningen.
2. Den samme person kan godkende flere gange og opfylde `requiredApprovals` alene — eller godkende sin egen ændring.
3. En godkendelse kan flyttes til en anden ændring: hvis diff, tenant, mål, parametre eller policy-version ændres efter godkendelsen, peger godkendelsen stadig på "anmodningen" og ikke på det konkrete indhold.

DKC-003 gjorde identiteten verificerbar (OIDC/JWT, workload-identitet). DKC-004 skal gøre godkendelsen *autentisk* (et rigtigt, berettiget menneske) og *bundet* (til præcis den ændring, der blev set).

## Beslutningskriterier

- Kun en verificeret menneskelig identitet kan godkende; grupper og roller kommer fra identiteten, ikke fra payloaden.
- Træning slås op server-side; klientens kursusbeviser ignoreres.
- Antal godkendere tælles over **unikke** identiteter, og selv-godkendelse afvises efter rollepolitik.
- En beslutning er ugyldig, hvis noget bundet ændres: kunde, miljø, verbum, mål, parameter-/diff-digest, policy-version eller udløb.
- State machine er kontrolleret: `pending → approved | rejected | expired | withdrawn | revoked`, og `approved → expired | revoked`. Terminale tilstande kan ikke genbruges.
- Afvist, udløbet og tilbagekaldt kan ikke merges.

## Overvejede muligheder

- **Behold klientleverede `groups`/træning og stol på dem.** Simpelt, men så er kontrollen en påstand.
- **Lad UI'et filtrere, hvem der må godkende.** UI er ikke en sikkerhedsgrænse.
- **Bind godkendelsen til `request.id`.** Billigt, men flytter problemet: indholdet under samme id kan ændres.
- **Serverstyret politik + verificeret identitet + kanonisk binding-digest + kontrolleret state machine.** Kræver et digest og et par nye felter i kontrakten, men gør godkendelsen til en kontrol.

## Beslutning

1. **Serverstyret pending-state.** `create()` afviser enhver payload, der påstår en anden tilstand end `pending`, eller som medsender godkendelser. Serveren sætter `pending`, rydder `approvals`, udleder politik (grupper, træning, antal, udløb, tilbagekaldelsesroller) fra ændringen og sætter `requestedBy` fra den verificerede skaber.
2. **Serverstyret træningsopslag.** `decide()` læser udelukkende `trainingRegistry(subject)`. `completedTrainingModules` i payloaden ignoreres. `groups` ignoreres til fordel for identitetens `groups`/`roles`.
3. **Kanonisk binding.** `approvals/src/binding.mjs` hasher en kanonisk struktur af tenant, miljø, verbum, mål, diff-digest, parameter-digest, policy-version og udløb. Digesten gemmes i `decision.binding` og på hver godkendelse. Enhver ændring af et bundet felt ændrer digesten; `amend()` rydder godkendelser og sætter anmodningen tilbage til `pending`.
4. **Unikke godkendere og selv-godkendelse.** Samme `subject` kan ikke optræde to gange. Er `requestedBy` sat, kan den identitet ikke godkende egen ændring (rollepolitik; kan slås fra eksplicit i politikken).
5. **Tilbagekaldelse og state machine.** Kun politikudpegede roller kan `revoke()`. Afvist/udløbet/tilbagekaldt/trukket kan ikke bruges; `merge-check` lister begrundelserne.
6. **Kontrakten opdateres:** top-level `tenantId`, `change.parameters`, `decision.binding`, `decision.requestedBy`, `decision.revoked*` og `approvals[].bindingDigest`/`actorKind`. `revoked` føjes til state-enum. En semantisk validator (`conformance/src/approval.mjs`) efterprøver binding og state-konsistens i CI.
7. **Persistence og beskyttet audit.** `approvals/src/store.mjs` lægger den serverstyrede tilstand i et filbaseret lager (atomisk skrivning), så en afvist/tilbagekaldt beslutning ikke forsvinder ved genstart, og et ændret binding på disken opdages. `approvals/src/ledger.mjs` skriver en append-only, hash-kædet (HMAC-valgfri) audit-log over hver beslutning; en brudt kæde afvises ved start. `approvals/src/cli.mjs` starter tjenesten med begge dele.

## Konsekvenser

- **Positive:** En godkendelse kan ikke flyttes til en anden ændring, kunde, mål eller parameter. Forfalskede grupper og kursusbeviser har ingen effekt. Selv-godkendelse og gentagne godkendelser fra samme person afvises. Afviste/udløbne/tilbagekaldte beslutninger kan ikke merges og forsvinder ikke ved genstart. Beslutningshistorikken er tamper-evident.
- **Negative:** Politikken (grupper, træning, antal, udløb) skal vedligeholdes ét sted i koden i stedet for at stå i payloaden. Eksisterende kald, der sendte `groups`/`completedTrainingModules`, skal omlægges til verificerede identiteter. `approval-request` får nye påkrævede/valgfrie felter.
- **Neutrale:** `renderView` viser nu binding-digest, kunde, anmoder og blokeringer. `merge-check` returnerer en liste af begrundelser i stedet for kun et flag.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| Klientleverede grupper/træning | Ingen ændringer | Sikkerheden er en påstand |
| UI-filtrering | Let | Ingen håndhævelse |
| Binding til `request.id` | Billigt | Indholdet kan skifte under samme id |
| Serverpolitik + digest + state machine | Reel kontrol, maskinelt checkbar | Kræver kontraktudvidelse og omlægning |

## Mere information

- [`docs/spec/approval-service.md`](../spec/approval-service.md)
- [`docs/spec/identity-verification.md`](../spec/identity-verification.md), [ADR-0014](0014-identitets-og-tillidsmodel.md)
- [`approvals/src/binding.mjs`](../../approvals/src/binding.mjs), [`approvals/src/approval-policy.mjs`](../../approvals/src/approval-policy.mjs), [`approvals/src/store.mjs`](../../approvals/src/store.mjs), [`approvals/src/ledger.mjs`](../../approvals/src/ledger.mjs)
- [`contracts/approval-request.schema.json`](../../contracts/approval-request.schema.json)
