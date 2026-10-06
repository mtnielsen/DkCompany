# Opdatering og fjernelse af moduler

Driftsvejledning for DKC-061. Al mutation går gennem en signeret plan og en
menneskelig godkendelse; intet af dette må køres direkte på en produktion uden
den dokumenterede godkendelse.

## Opdatering

1. **Vælg målrelease.** Kun `stable` eller `security` i
   `catalog/releases.json` må være mål. En `eol`- eller `revoked`-release
   afvises af preflight.
2. **Byg planen.**
   ```bash
   node installer/src/lifecycle-cli.mjs update 1.3.0 1.4.0
   ```
   Planen viser påvirkning, migrationsfaser, rollback og hvilke trin der kræver
   godkendelse.
3. **Verificér signaturen** med den kendte nøgle. Uden en gyldig signatur kører
   intet.
4. **Godkend hvert muterende trin** med en navngiven, verificeret person.
5. **Kør planen.** Der tages et snapshot før den første mutation.
   ```bash
   node installer/src/lifecycle-cli.mjs execute-update 1.3.0 1.4.0
   ```
6. **Ved afbrydelse:** genoptag (idempotent) eller rul tilbage efter
   `docs/runbooks/module-update-rollback.md`.

## Fjernelse

- `remove-only` afinstallerer modulet og **bevarer data og recoverymetadata**.
- `remove-and-delete-data` er en separat, eksplicit destruktiv handling og
  kræver eksport eller verificeret backup og to-personers-kontrol.
- Reverse-dependency-kontrollen afviser fjernelse af en delt database eller IAM,
  mens aktive moduler kræver den.
- Sikkerhedskernen kan ikke fjernes separat; den kræver en planlagt udfasning.

```bash
node installer/src/lifecycle-cli.mjs remove communications remove-only
node installer/src/lifecycle-cli.mjs remove communications remove-and-delete-data
```

Se `docs/runbooks/module-removal.md` for den fulde procedure.
