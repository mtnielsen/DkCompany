# Installer og fælles konfiguration med sikre standarder

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), Cecilia Christensen (Security Owner)
- **Dato:** 2026-09-24
- **Beslutningsdrev:** DKC-054 kræver en signeret installer og én autoritativ, versioneret ønsket tilstand, så fil, UI og API ikke kan give tavs drift, og så en installation aldrig formaterer diske, overtager et databaseskema eller ændrer host-OS uden et konkret oplyst scope.

## Kontekst og problemstilling

Installationsprofilerne fra DKC-053 beskriver *hvad* der skal installeres, men ikke *hvordan* en installation udføres sikkert, genoptages efter afbrydelse eller konfigureres pr. installation/tenant/modul. Uden én ønsket tilstand kan UI, en deklarativ fil og et API bære hver sin sandhed: en ændring ser udført ud ét sted uden at have effekt. En installer med brede rettigheder kan desuden komme til at formatere diske, overtage et eksisterende databaseskema eller ændre host-OS, hvis scopet ikke er eksplicit.

## Beslutningskriterier

- Én autoritativ ønsket tilstand med én validerings-API; ingen skjulte eller modstridende kilder.
- Sikre standarder: debug slukket, backup tændt, ingen modelrute uden egress-godkendelse, WORM for beskyttede dataklasser.
- Resumable, idempotent installation med tydelig status og diagnostik uden hemmeligheder.
- Menneskeautorisation for ændringer; revisionssporet kan ikke slukkes via logniveau.
- Mindst muligt privilegium: ingen diskformatering, ingen databaseovertagelse, ingen host-OS-ændring uden konkret scope.

## Overvejede muligheder

- **A:** Konfiguration som fri tekst pr. modul og en installer uden signatur.
- **B:** Én versioneret kontrakt, én validerings-API og en signeret, resumable plan med fail-closed preflight.
- **C:** Kun et UI uden deklarativ fil, med tilstanden i en database.

## Beslutning

Vi vælger **B**. `configuration/` ejer den ene ønskede tilstand (`platform-configuration.schema.json`), sikre standarder, retention-/WORM-regler og den fælles validerings-API, som både fil, UI og API kalder. `installer/` ejer den signerede, deterministiske plan, preflight og den resumable udførelse. Host-scopet (`host-scope.schema.json`) er eksplicit og fail-closed; installationsplanens restriktioner (`formatDisks`, `adoptExistingSchema`, `changeHostOs`) er altid `false`.

### Konsekvenser

- **Positive:** Tavs drift opdages; en ændring kræver en navngiven menneskelig beslutning; en afbrudt installation genoptages idempotent; hemmeligheder lækkes ikke i preview/supportbundle.
- **Negative:** Nye moduler og profiler skal levere konfiguration og et host-scope; en platform-ændring kræver en eksplicit scope for en platform-admin.
- **Neutrale:** Retention udtrykkes nu også i konfigurationen og skal stemme med loggepolitikken og dataregistret.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Hurtigt at komme i gang | Ingen garanti mod drift, ingen genoptagelse, bredt installationsscope |
| B | Én sandhed, sikre standarder, fail-closed scope | Mere formel; kræver vedligeholdte kontrakter |
| C | Centralt UI | Skjuler den deklarative vej; cirkulær afhængighed ved bootstrap |

## Mere information

- [`docs/spec/installer.md`](../spec/installer.md), [`docs/spec/configuration.md`](../spec/configuration.md)
- [`docs/runbooks/installation.md`](../runbooks/installation.md)
- DKC-053: [`docs/spec/distribution-profiles.md`](../spec/distribution-profiles.md)
- DKC-019/021/049: dataregister, retention og logging
