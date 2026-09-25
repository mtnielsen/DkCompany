# Runbook: fjernelse af et modul

Fjernelse er adskilt fra datasletning. Denne procedure beskriver begge spor.

## A. Almindelig afinstallering (`remove-only`)

1. Kør reverse-dependency-kontrollen:
   ```bash
   node installer/src/lifecycle-cli.mjs remove <komponent> remove-only
   ```
2. Afvis hvis `blocking: true`, eller hvis komponenten er sikkerhedskernen.
3. Bekræft at `dataDisposition.preserve` er `true`, og at
   `recoveryMetadataRef` er sat.
4. Godkend og afinstallér modulet. **Data og recoverymetadata bevares.**

## B. Datasletning (`remove-and-delete-data`)

1. Tag en eksport **eller** en verificeret backup. Uden et af disse må
   sletningen ikke gennemføres.
2. Skaff en eksplicit destruktiv godkendelse fra to forskellige navngivne,
   verificerede personer.
3. Afvis hvis `blocking: true`.
4. Gennemfør fjernelse og derefter sletning.
5. Verificér at data er slettet som godkendt, og at recoverymetadata og evidens
   for sletningen er bevaret.

## Stopbetingelser

- Reverse-dependency-kontrollen viser aktive, obligatoriske afhængigheder.
- Komponenten er sikkerhedskernen.
- Datasletning mangler eksport/backup eller to-personers-kontrol.

Ved en stopbetingelse må sletningen ikke fortsætte; eskalér til Platform Owner.
