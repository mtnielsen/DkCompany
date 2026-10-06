# Runbook: providerudskiftning

Dette er en dokumenterende runbook. Den supplerer
`docs/operations/provider-swap.md` og `docs/spec/provider-contracts.md`.

## Formål

Skifte en provider (IAM, modelprovider, database, lager, backup, kø eller app)
uden at tabe data, adgangsrettigheder, identitet eller historisk audit, og uden
at efterlade aktive rettigheder hos den gamle provider.

## Roller

- **Operatør:** kører preflight og cutover.
- **Godkender (menneske i kundens tenant):** godkender indhold og
  adgangsrettigheder. Må ikke være operatøren.
- **Security Owner:** vurderer en sikkerhedskritisk nedgradering.
- **Auditor:** læser kvittering, referencespor og evidens.

## Trin

1. Slå skiftet op i supportmatricen. Notér `mode`.
2. Kør preflight. Ved `allowed: false`: stop og eskalér.
3. Ved `planned-migration`: vis funktionstab og kræv et migrationsbevis.
4. Indhent den menneskelige godkendelse.
5. Kør cutover. Bekræft afstemningen.
6. Bekræft read-only og credentialrevokation.
7. Arkivér kvitteringen og referencesporet.

## Rollback

Ved fejl i afstemningen: rul tilbage til snapshottet fra før cutover, genåbn den
gamle provider, og registrér grunden.

## Eskalation

En manglende obligatorisk capability, en sikkerhedskritisk nedgradering eller en
afstemning der ikke matcher eskalères til Security Owner og Platform Owner. En
målt udskiftning mod en levende provider kræver en ekstern installation og er
ikke en del af den lokale baseline.
