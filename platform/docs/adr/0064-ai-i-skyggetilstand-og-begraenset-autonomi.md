# AI i skyggetilstand og begrænset autonomi

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), Cecilia Christensen (Security Owner)
- **Dato:** 2026-09-29
- **Beslutningsdrev:** DKC-032 kræver, at AI'ens beslutninger måles, før den får ret til at ændre kundernes systemer, og at en udvidelse af autonomien er en versionsstyret ejerbeslutning med evidens.

## Kontekst og problemstilling

Agent-runtimen kan allerede læse, diagnosticere og foreslå, og selvreparationen (DKC-046) kan køre forhåndsgodkendte runbooks. Men der findes ikke et samlet sted, hvor AI'ens forslag måles mod historiske hændelser uden at røre produktionen, og hvor grænsen mellem "foreslå" og "udføre" er bundet til et model-/promptfingeraftryk og til menneskelig evidens. Uden det kan autonomi udvides ved et tilfælde — eller en modelopdatering kan ændre adfærden, uden at nogen gentager evalueringen.

## Beslutningskriterier

- Der skal findes en tilstand, hvor AI'en læser, diagnosticerer og foreslår uden at udføre en eneste mutation.
- Forslag og den menneskelige beslutning skal logges.
- Kun forhåndsgodkendte runbooks for afgrænsede, reversible handlinger må prøves — og kun i staging.
- Falske alarmer, fejl, eskalationer, omkostning og reviewerens ekstra fund skal måles.
- Replay af historiske hændelser skal give målbare resultater.
- Et model- eller promptskifte skal kræve gentaget evaluering.
- Nødstop og governance-nedbrud skal stoppe handlinger.
- Udvidelse af autonomi skal være en versionsstyret ejerbeslutning med evidens.

## Overvejede muligheder

- **A:** Fortsæt med manuel gennemgang af AI-forslag uden en målt skyggetilstand.
- **B:** En deterministisk skygge- og autonomimotor med en versionsstyret ejerbeslutning bundet til et model-/promptfingeraftryk og gentaget evaluering; begrænset autonomi gælder kun staging og kun reversible, forhåndsgodkendte runbooks. En målt kørsel mod en levende model og stagingklynge er en ekstern integration.
- **C:** Giv AI'en fuld autonomi og rul tilbage ved fejl.

## Beslutning

Vi vælger **B**. `shadow/autonomy-policy.json` er den versionsstyrede ejerbeslutning (`AutonomyGrant`). `shadow/replay-dataset.json` er et anonymiseret datasæt af historiske hændelser. `shadow/src/shadow.mjs` er motoren: den driver autonomistigen `observe → propose → shadow → limited-autonomy`, måler falske alarmer, fejl, eskalationer, omkostning og reviewerfund, og håndhæver at en `shadow`-kørsel har `mutationCount = 0`. `shadow/src/runner.mjs` kobler motoren til den rigtige runbookvalidering (DKC-045) og den rigtige nødstopsklient (DKC-010). `shadow/src/check.mjs` validerer bevilling, datasæt og de renderede artefakter og genkører replayet deterministisk.

Bevillingen er bundet til `evaluation.fingerprint = digest(modelRef, promptDigest)`. Et skift i model eller prompt ændrer fingeraftrykket, hvorefter `assertAllowed` afviser, indtil mindst `minEvaluationRuns` beståede evalueringer på det nye fingeraftryk foreligger. Resultatet bærer `measured: false`; den levende måling er `make shadow-live` og er NOT RUN.

### Konsekvenser

- **Positive:** Autonomi kan kun udvides med en navngivet ejer, en change-reference og gentaget evidens; en skyggekørsel kan ikke mutere; nødstop og governance-nedbrud stopper handlinger; implikationerne af et model-/promptskifte er eksplicitte.
- **Negative:** Bevillingen og datasættet skal vedligeholdes, og en målt kørsel mod en levende model/staging mangler stadig.
- **Neutrale:** Skyggetilstanden er en ny førstepartskomponent; den genbruger runtime-, reviewer-, approval-, observability- og curriculum-konventionerne.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Ingen kode | Ingen måling; autonomi kan ikke bevises sikkert |
| B | Gentagelig, versionsstyret, nul-mutation i skygge, staging-only autonomi | Kræver vedligeholdt datasæt og en ekstern måling |
| C | Maksimal hastighed | Uacceptabel risiko; ingen menneskelig kontrol |

## Mere information

- [`docs/spec/shadow-autonomy.md`](../spec/shadow-autonomy.md), [`docs/ai-operations/shadow-report.md`](../ai-operations/shadow-report.md), [`docs/ai-operations/shadow-live.md`](../ai-operations/shadow-live.md)
- [`shadow/autonomy-policy.json`](../../shadow/autonomy-policy.json), [`contracts/autonomy-grant.schema.json`](../../contracts/autonomy-grant.schema.json), [`contracts/shadow-run.schema.json`](../../contracts/shadow-run.schema.json)
- [`docs/adr/0058-begraenset-selvreparation.md`](0058-begraenset-selvreparation.md), [`docs/adr/0057-menneskestyret-change-og-runbooks.md`](0057-menneskestyret-change-og-runbooks.md), [`docs/adr/0025-modelgateway-og-bindende-budgetter.md`](0025-modelgateway-og-bindende-budgetter.md)
