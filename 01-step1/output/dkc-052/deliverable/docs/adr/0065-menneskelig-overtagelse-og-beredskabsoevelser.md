# Menneskelig overtagelse og beredskabsøvelser

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), Cecilia Christensen (Security Owner)
- **Dato:** 2026-09-30
- **Beslutningsdrev:** DKC-052 kræver, at mennesker kan overtage og gendanne tjenesten, også når AI'en og den primære platform er nede, og at beredskabet er en gentagelig, målt øvelse.

## Kontekst og problemstilling

Platformen har HA, databasefailover, holdbar beskedsudveksling, holdbart lager, dedup, immutable data, begrænset selvreparation, en fejl- og katastrofematrix (DKC-051) og en AI i skyggetilstand (DKC-032). Men en plan er ikke en øvelse, og en øvelse er ikke en overtagelse. Hvis AI'en eller den primære platform er nede, skal et navngivet menneske kunne overtage: vide hvem der har ansvaret, nå on-call gennem en uafhængig kanal, finde en offline runbook, få credentials udleveret under kontrol, gendanne i den rigtige rækkefølge og beslutte failback — og en kritisk incident må først lukkes efter servicevalidering og menneskelig accept. Uden et gentageligt trin- og tilstandsmodell kan ingen af delene bevises.

## Beslutningskriterier

- En navngiven serviceejer, on-call, stedfortræder, incidentleder, change authority og dataansvarlig funktion.
- En uafhængig kontaktkanal og en offline/recoverykopi af runbooks.
- Credentials under menneskekontrol og en prioriteret restoreplan.
- En øvelse for AI-offline, IAM-tab og sitekatastrofe med eskalationer til testmodtagere.
- Separate single-server- og HA-scenarier bundet til eksakte artefakter, profiler, operatører og tidsstempler.
- Menneskelige out-of-band-trin forbliver `pending`, indtil de faktisk er udført; agenten kan ikke godkende beredskab.
- Periodisk adgangsrevision, backupkontrol, kapacitetsvurdering, DR-øvelse og runbookrecertificering.
- Den formelt valgte HA-/immutable-/self-healing-profil er testet før kundedrift.

## Overvejede muligheder

- **A:** En manuel beredskabsplan i et dokument uden kørt øvelse.
- **B:** En deterministisk øvelsesrunner med et eksplicit trin-/tilstandsmodell, rigtige prober mod de eksisterende moduler og en menneskelig acceptgate; menneskelige trin forbliver `pending`, og en målt øvelse på levende hosts er en ekstern integration.
- **C:** Stole på, at agenten selv kan godkende beredskab.

## Beslutning

Vi vælger **B**. `continuity/takeover-plan.json` (`TakeoverPlan`) navngiver rollerne, den uafhængige kanal med eskalationskæde, offline-runbooks, credentials, restoreprioriteten, den formelt valgte profil og fem scenarier (single-server, ha, ai-offline, iam-loss, site-catastrophe). `continuity/src/takeover.mjs` driver trinnene `takeover → restore → failback → validation`. Maskintrin kalder rigtige prober (`continuity/src/takeover-probes.mjs`) mod HA, database, storage, recovery-adgangsprofilen, fejlmatrixen og autonomibevillingen og binder resultatet til artefakt-digest, operatør og tidsstempel. Menneskelige trin bliver aldrig automatisk `pass`: de forbliver `pending`, indtil et navngivet menneske har efterladt evidens. En timeout eskalerer gennem en kæde, der altid ender hos et menneske. `agentCanApprove` er `false`, og en `validated`-øvelse kræver en menneskelig incidentaccept og målt dataintegritet. Rapporten bærer `measured: false`; den målte øvelse er `make takeover-live` og er NOT RUN.

### Konsekvenser

- **Positive:** Beredskabet er gentageligt og kan ikke grønnes af agenten; menneskelige out-of-band-trin er eksplicitte; gendannelse og failback har ejerbeslutning og målt integritet; den valgte profil er bundet og testet.
- **Negative:** Planen og scenarierne skal vedligeholdes, når roller, runbooks eller profiler ændres, og en målt øvelse mangler stadig.
- **Neutrale:** Øvelsen er en ny førstepartsevne i `continuity/`; den genbruger HA-, DB-, storage-, DR-, chaot- og autonomimodulerne.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Ingen kode | Ingen evidens; beredskabet er en påstand |
| B | Gentagelig, ærlig om menneskelige trin, binder artefakter og beslutninger | Kræver vedligeholdt plan og en ekstern målt øvelse |
| C | Hurtigt | Uacceptabelt; agenten må ikke godkende beredskab |

## Mere information

- [`docs/continuity/takeover-plan.md`](../continuity/takeover-plan.md), [`docs/continuity/recovery-drill-report.md`](../continuity/recovery-drill-report.md), [`docs/continuity/recovery-drill-live.md`](../continuity/recovery-drill-live.md), [`docs/operations/takeover-control.md`](../operations/takeover-control.md)
- [`continuity/takeover-plan.json`](../../continuity/takeover-plan.json), [`contracts/takeover-plan.schema.json`](../../contracts/takeover-plan.schema.json), [`contracts/recovery-drill.schema.json`](../../contracts/recovery-drill.schema.json)
- [`docs/adr/0051-uafhaengig-backup-pitr-og-katastrofegendannelse.md`](0051-uafhaengig-backup-pitr-og-katastrofegendannelse.md), [`docs/adr/0063-automatiseret-fejl-og-katastrofematrix.md`](0063-automatiseret-fejl-og-katastrofematrix.md), [`docs/adr/0064-ai-i-skyggetilstand-og-begraenset-autonomi.md`](0064-ai-i-skyggetilstand-og-begraenset-autonomi.md)
