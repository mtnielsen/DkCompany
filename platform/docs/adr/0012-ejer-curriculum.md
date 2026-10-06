# ADR-0012: Ejer-curriculum som versioneret scenariedata bygget på rigtige approval-payloads

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2025-09-01
- **Beslutningsdrev:** Træning i prosa lærer godkenderen reglerne, men ikke at genkende et forslag, der skal afvises.

## Kontekst og problemstilling

4.1 kræver et ejer-curriculum bygget på de faktiske approval-payloads, inkl. forslag der skal afvises, versioneret med platformen og med gennemførelse logget som CloudEvent og håndhævet af approval-servicen (2.4). Skrives curriculumet som løs prosa eller som separate eksempel-filer, driver det fra kontrakten: et felt omdøbes i `approval-request`, og scenarierne peger på noget, der ikke findes. Samtidig skal "skal afvises" være objektivt og ikke en undervisers mavefornemmelse.

## Beslutningskriterier

- Scenarierne skal bygge på rigtige approval-payloads, ikke genfortællinger.
- Afvisningsscenarier skal kunne efterprøves maskinelt i CI.
- Curriculumet skal versioneres sammen med resten af platformen.
- Gennemførelse skal kunne håndhæves af 2.4 uden et nyt system.
- Alle fem krævede emner skal være dækket.

## Overvejede muligheder

- **Prosa-pensum med løse eksempler.** Nemt at skrive, driver fra kontrakten og kan ikke tjekkes.
- **Fulde payloads kopieret pr. scenarie.** Tæt på virkeligheden, men massiv duplication og hurtig forældelse.
- **Base-payload + sti-overrides + deterministiske afvisningskriterier.** Vores valg.
- **Træning uden for repoet.** Så kan 2.4 ikke håndhæve den, og versioneringen forsvinder.

## Beslutning

1. `contracts/curriculum.schema.json` definerer curriculumet: moduler, scenarier, `basePayloads`, `overrides` og `rejectionCriteria`.
2. Hvert scenarie tager en rigtig approval-request som base, muterer den via sti-overrides og valideres mod `approval-request.schema.json`.
3. Et reject-scenarie skal have `mustReject: true` og mindst ét `rejectionCriteria`, som efterprøves i CI. Et approve-scenarie må ikke opfylde et kriterium og må ikke have påstande, der ikke matcher evidensen.
4. Gennemførelse udsender `dk.platform.curriculum.module.completed`-CloudEvents. `trainingRegistryFromEvents` bygger det `trainingRegistry`, som approval-servicen bruger; manglende moduler giver HTTP 428.
5. Kontrolmappingen (3.2) fører kontrollen `at-2` mod NIS2 art. 21(2)g og AI Act art. 4.

## Konsekvenser

- **Positive:** Scenarierne kan ikke drive fra kontrakten. "Skal afvises" er maskinelt bevist. Gennemførelse er håndhævet af 2.4 og sporbart som CloudEvent. Curriculumet versioneres som kode.
- **Negative:** Nye scenarier kræver overrides og kriterier, ikke kun prosa. `trainingRegistryFromEvents` er en in-memory reference, som produktionen skal erstatte med audit-loggen eller en identitetsudbyder.
- **Neutrale:** Den juridiske del er teknisk træning, ikke juridisk rådgivning, og skal valideres af organisationens DPO.

## Mere information

- [`docs/spec/curriculum.md`](../spec/curriculum.md)
- [`contracts/curriculum.schema.json`](../../contracts/curriculum.schema.json), [`contracts/approval-request.schema.json`](../../contracts/approval-request.schema.json)
- [ADR-0007](0007-evidens-og-prosa-adskilt.md), [ADR-0009](0009-kontrolmapping-roller.md)
