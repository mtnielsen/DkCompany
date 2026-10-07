# Runbook: krypteret backup og gendannelse

> DKC-016. Gælder `backup/`, `persistence/` og de serviceklasser der erklærer et
> backup-/gendannelsesmål. En gendannelse er en privilegeret, godkendt og sporet
> handling — ikke et manuelt databaseindgreb.

## Roller og adgang

- **Backup** kræver et verificeret menneske i tenanten med rollen
  `backup-operator` eller `continuity-officer`.
- **Gendannelse** kræver rollen `continuity-officer` **og** en separat,
  navngivet godkendelse bundet til backup-id'et. Godkenderen må ikke være den
  samme som den, der udfører gendannelsen.
- Krypteringsnøglen findes i et **andet** magasin end backup-lageret. En
  operatør med adgang til lageret kan ikke dekryptere uden nøglen.

## Trin

1. **Tag en backup.** Database, objekter og nødvendig konfiguration krypteres
   hver for sig. Hemmeligheder i konfigurationen redigeres væk før kryptering.
   Manifestet bærer checksums og nøgle-id — aldrig nøglen.

2. **Forankr audit-loggen.** Sørg for at det eksterne checkpoint (DKC-009) er
   skrevet, så den gendannede log kan verificeres mod et medie uden for
   databasen.

3. **Kør en gendannelsesøvelse** i et isoleret miljø:

   ```bash
   make backup-drill
   ```

   Øvelsen måler RTO (gendannelsestid) og RPO (datatab siden sidste committede
   skrivning), anvender suppressionsjournalen og kører de funktionelle checks.

4. **Læs rapporten.** `gate.status` skal være `pass`. Ved `blocked` angiver
   `gate.reasons` præcis afvigelsen (integritet, funktionelle checks,
   suppression, tenant-afgrænsning, audit-kæde eller RTO/RPO over mål).
   **En afvigelse spærrer pilotrelease** — den må ikke ties eller omgås.

5. **Ved en rigtig gendannelse:** godkendelsen skal være navngivet og bundet til
   backup-id'et. Gendan til et isoleret miljø først, verificér, og skift først
   derefter trafik. Slettede persondata må ikke genindføres; kontrollér
   `suppression.recordsErased`.

6. **Efter gendannelsen:** bekræft at audit-kæden og checkpointet stadig
   stemmer, og at tenant-afgrænsningen holder. Roter nøglen hvis der er mistanke
   om lækage, og tag en ny backup.

## Fejlfinding

| Symptom | Betydning | Handling |
| --- | --- | --- |
| `dekryptering fejlede` | Forkert nøgle, AAD eller ændret chiffertekst | Stop; undersøg nøgle/kilde og integritet |
| `manifestdigesten matcher ikke` | Manifestet er ændret | Afvis backupen; brug en ældre verificeret |
| `suppressionsjournalen er trunkeret` | Journalen er kortere end det pinnede hoved | Stop; genskab journalen fra en betroet kopi |
| `gate.status = blocked` med RTO/RPO | Målet er ikke nået | Spær release; undersøg kapacitet/backupfrekvens |
| `audit-checkpoint` fejler | Gendannet log matcher ikke checkpointet | Undersøg om loggen er ændret eller trunkeret |
