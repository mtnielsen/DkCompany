# Runbook: vælg og skift eksternt backupmål

> DKC-057. Gælder `backup/targets/`, `backup/target-sets/` og
> `backup/src/backends/`. At godkende et backupmål er en privilegeret handling:
> målet skal kunne gendanne uden primærmiljøet.

## Roller og adgang

- **Recoveryejeren** (navngivet menneske) ejer målsættet og godkender skift.
- **Credentials** ligger i et separat magasin og refereres med `<provider>:<sti>`.
  En hemmelighed må aldrig stå i profilen.

## Trin: godkend et nyt mål

1. **Opret profilen** efter `contracts/backup-target.schema.json` med `endpoint`,
   `credentialsRef`, `tls`, `encryption`, `retention.immutability`, `schedule`,
   `bandwidth`, `failureDomain` og `recoveryOwner`.

2. **Kør read-only preflight** — den viser credentials-, certifikat-,
   plads- og retention-fejl før godkendelse:

   ```bash
   make backup-target-preflight
   ```

3. **Kør canary** — en særskilt skriveøvelse der skriver, læser og sletter en
   lille fil:

   ```bash
   make backup-target-canary
   ```

   Mod et immutable mål bliver canary-objektet tilbageholdt af object-lock
   (`retained-by-object-lock`). Det er forventet.

4. **Validér målsættet** med preflight-resultatet som grundlag:

   ```bash
   make backup-target-check
   ```

   I produktion skal målet have et andet fejl-/adgangsdomæne end primæret, og et
   WORM-krav skal være verificeret med evidens. Ellers afvises profilen.

## Trin: skift aktivt mål

1. Kør `planTargetSwitch` (eller brug den i et godkendt GitOps-flow). Det gamle
   mål bliver et `previousTarget` med `retainedUntil = sidste backup +
   retentionDays`.
2. **Fjern ikke** et tidligere mål før `retainedUntil` er passeret, eller et
   navngivet menneske har godkendt en purge. `canPurgePreviousTarget` svarer på
   om det er tilladt.
3. Opdatér `activeTargetRef`, og bekræft at en frisk gendannelsesøvelse stadig
   giver en `pass`-gate (`make backup-drill`).

## Trin: håndtér eksterne datakilder

En connector alene erklærer ikke en ekstern kilde beskyttet. For hver ekstern
kilde i `externalSources`:

- `owner-backup` — ejeren tager backup; angiv den navngivne ejer.
- `authorized-platform-backup` — platformen tager backup inden for en eksplicit
  scope-aftale; `agreementRef` skal matche kildens `scopeAgreementRef`, og
  kilden skal tillade `autoBackup`.
- `no-backup` — kilden sikkerhedskopieres ikke.

## Fejlfinding

| Symptom | Fejlklasse | Handling |
| --- | --- | --- |
| Adgang nægtet / signaturfejl | `credentials_error` | Kontrollér `credentialsRef` og rettigheder |
| Certifikatfejl | `certificate_error` | Kontrollér CA-reference, pinning og TLS-version |
| Målet kan ikke nås | `network_error` | Kontrollér endpoint, DNS og netværkspolitik |
| Ingen ledig plads | `space_error` | Frigør plads eller vælg et andet mål |
| Object-lock/retention afviser | `retention_error` | Kontrollér WORM-tilstand og mindsteretention |
| Ikke-understøttet protokol | `unsupported_capability` | Brug en valideret backend |
