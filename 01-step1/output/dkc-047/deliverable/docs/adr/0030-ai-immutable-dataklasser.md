# ADR-0030: AI-immutable som håndhævede dataklasser — tre adskilte forbud

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), med Bo Bertelsen som stedfortræder
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-047. «AI må ikke ændre», «data er under WORM-retention» og «AI må ikke læse» bliver let til ét krav. Det giver forkerte beslutninger: en WORM-frist forveksles med et adgangsforbud, et læseforbud forveksles med et ændringsforbud, og en AI kan omklassificere eller genskabe data gennem en anden adapter. Uden et fælles klassifikations- og guard-lag kan beskyttelsen ikke efterprøves.

## Kontekst og problemstilling

- **Tre forbud, tre formål.** Ændringsforbud handler om integritet, WORM-retention om opbevaring, og no-AI-access om fortrolighed. De har forskellige ejere, frister og konsekvenser.
- **Indirekte ændring.** En AI kan ændre data ved at omskrive en alias-/current-pointer, en policy, en lifecycle-regel, en nøgle eller ved at slette — ikke kun ved et direkte write.
- **Adapter-omgåelse.** En app-, admin- eller restore-adapter kan føre til samme mutation. Beskyttelsen skal være fælles for alle indgange.
- **Transitioner.** Kopi, eksport og restore kan nedgradere beskyttelsen, hvis destinationen ikke arver klasse og no-AI-access-flag.
- **Ubestemt WORM på persondata.** En WORM-lås uden vurderet formål og endelig frist er en ulovlig opbevaring.
- **Ærlighed.** Fysisk lager-/nøglehåndhævelse findes ikke endnu (DKC-048). En påstand om fuld immutabilitet ville være usand.

## Beslutningskriterier

- En versioneret kontrakt med klasserne `ordinary`, `ai-read-only`, `append-only`, `retention-locked` og `noAiAccess` som **selvstændigt** flag.
- Beskyttelsesmetadata: ejer, versions-ID, retention/hold, nøgledomæne og hvem der må omklassificere.
- Forbud der dækker direkte og indirekte ændring, alias/current-pointer, autoritativ pointer, policy, lifecycle, nøgler og sletning.
- En menneskelig proces for ny version, lovlig sletning og retentionvurdering.
- En deny-only guard foran PDP og executor, fælles for app-, admin- og restore-adaptere.
- Transitioner bevarer beskyttelsen; WORM-frist og aktivt hold kan ikke falde bort.
- Ærlig erklæring af at lager-/nøglehåndhævelse leveres af DKC-048.

## Overvejede muligheder

- **Én samlet «immutable»-klasse.** Simpelt, men sammenblander ændrings-, opbevarings- og læsebeslutninger og giver forkerte svar.
- **Kun lagerhåndhævelse (WORM-drev).** Løser fysisk immutabilitet, men ikke AI-ændring gennem pointere, policy og nøgler, og ikke læseforbud.
- **Klasser + metadata + deny-only guard, med ærlig DKC-048-grænse.** Kræver vedligeholdelse, men gør hvert forbud efterprøveligt og hver transition kontrolleret.

## Beslutning

Vi indfører beskyttede dataklasser, håndhævet i
`contracts/protected-data.schema.json`,
`conformance/src/protected-data.mjs`, `data-protection/` og
`runtime/src/runtime.mjs`:

1. **Klasser og flag.** `ordinary`, `ai-read-only`, `append-only` og
   `retention-locked`; `noAiAccess` er et separat adgangsflag.
2. **Metadata.** Hver post bærer ejer, `versionId`, autoritativ pointer,
   nøgledomæne, reclassifiers, retention/hold og den menneskelige proces.
3. **Forbud.** En beskyttet post dækker alle otte forbud eksplicit.
4. **Guard.** `data-protection/src/guard.mjs` er ren og deny-only. Runtimen
   kalder den efter scope/rolle og før PDP/executor. `guardAdapterCall` gør
   app-, admin- og restore-adaptere identiske.
5. **Transitioner.** `copy`, `export` og `restore` skal bevare klasse og
   no-AI-access; en WORM-retention og et aktivt hold skal følge med.
6. **Retention.** `retention-locked` kræver en vurderet, formålsbestemt og
   endelig frist — også for persondata.
7. **Ærlighed.** `storageEnforcement` erklærer `unsupported`/`partial`, indtil
   DKC-048 leverer den fysiske lås. `make data-protection-check` fejler ved en
   ubevist `full`-påstand.
8. **Dokument.** `docs/compliance/protected-data.md` genereres fra registeret og
   kontrolleres for sync.

Resultatet valideres i `make validate`, `make data-protection-check`,
`make data-protection-test` og i CI.

## Konsekvenser

- **Positive:** De tre forbud er efterprøvelige og kan ikke smelte sammen. AI kan
  ikke ændre, omklassificere eller læse beskyttede data gennem nogen adapter, og
  WORM-frister er vurderede og endelige.
- **Negative:** Registeret og politikken skal vedligeholdes, og den fysiske
  immutabilitet er først komplet med DKC-048.
- **Neutrale:** Beskyttelsespolitikken er en delt, versioneret regel uden for den
  signerede platform-bundle.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| Én «immutable»-klasse | Simpel | Sammenblander tre beslutninger |
| Kun WORM-drev | Fysisk immutabilitet | Ingen AI-ændrings-/læsekontrol |
| Klasser + metadata + guard | Efterprøveligt, adapter-uafhængigt | Kræver DKC-048 for fuld effekt |

## Mere information

- [`docs/spec/data-protection.md`](../spec/data-protection.md)
- [`docs/compliance/protected-data.md`](../compliance/protected-data.md)
- [`contracts/protected-data.schema.json`](../../contracts/protected-data.schema.json)
- [`data-protection/src/guard.mjs`](../../data-protection/src/guard.mjs),
  [`runtime/src/runtime.mjs`](../../runtime/src/runtime.mjs)
- [ADR-0006](0006-alle-modelkald-gennem-gateway.md), [ADR-0018](0018-stram-policy-scope-og-evidenkontrol.md), [ADR-0021](0021-holdbar-audit-og-fail-closed.md), [ADR-0029](0029-dataregister-og-retention.md)
