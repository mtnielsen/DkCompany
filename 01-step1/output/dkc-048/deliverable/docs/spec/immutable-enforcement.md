# Immutable data uden for agentens kontrol

DKC-048. DKC-047 indførte AI-immutable dataklasser som adgangs- og
transitionskontrol. Denne spec beskriver den **fysiske** håndhævelse, så en
kompromitteret agent eller appkonto ikke kan ødelægge beskyttede data eller
deres nøgler.

## Mål

- Et verificeret storage-produkt håndhæver object-lock i GOVERNANCE og
  COMPLIANCE.
- AI og app-konti kan ikke skrive, slette, forkorte retention, skifte pointer,
  slette nøgle eller bruge en indirekte adminvej.
- Audit-ingest er append-only og adskilt fra administration.
- KMS, key-deletion, lifecycle, backups, serviceaccounts og trust-config er
  beskyttede.
- GOVERNANCE-bypass kræver et navngivet menneske og to-personers godkendelse;
  COMPLIANCE kan aldrig omgås.
- En ny version skjuler ikke den autoritative låste version.
- Backup/restore bevarer versioner, låse og adgangsregler.

## Politikken

`data-protection/enforcement/immutable-policy.json` er den kanoniske politik og
valideres af `contracts/immutable-enforcement.schema.json` samt semantikken i
`data-protection/src/enforcement.mjs`:

- **Storage-produkt:** MinIO med versioning og object-lock i GOVERNANCE og
  COMPLIANCE; verifikationen kræver et menneske for governance-bypass og forbyder
  COMPLIANCE-bypass.
- **Rollematrix:** `agent` (AI) er nægtet alle muterende operationer; `workload`
  (app-konto) kan læse/skrive/tilføje men ikke slette eller ændre retention;
  `audit-ingest` er append-only; `storage-admin` og `security-admin` er
  mennesker med to-personers krav.
- **Agentnægtelse:** eksplicitte forbud, syv indirekte adminveje og seks
  beskyttede ressource-typer.
- **Beskyttede ressourcer:** KMS-nøgle, backup, serviceaccount, trust-config,
  lifecycle-policy og object-lock-policy.
- **To-personers kontrol:** beskyttelsespolitik, recovery-adgang og
  governance-bypass.

## Håndhævelsen

`storage/src/object-store.mjs` håndhæver object-lock mekanisk:

- `lockVersion` kan kun forlænge en lås eller opretholde COMPLIANCE — aldrig
  forkorte eller nedgradere,
- `deleteVersion` afviser en aktiv COMPLIANCE-lås og en GOVERNANCE-lås uden et
  eksplicit bypass-flag,
- `authoritative` returnerer den låste version, så en ny version ikke skjuler
  den,
- `getAuthoritative` læser den låste version.

`data-protection/src/enforcement.mjs` afgør rollen (default-deny), og
`data-protection/src/key-protection.mjs` beskytter KMS-nøgler: sletning kræver
`security-admin` og en separat godkender og afvises for nøgler der stadig
understøtter en retention-locked post.

`data-protection/src/storage-semantics.mjs` udfører negative
håndhævelsestests mod en konkret lagerinstans. Resultatet er en deterministisk
selvtest (`verifiedByHuman: false`); en målt verifikation på et levende
storage-produkt er `integration-immutable-live` og er NOT RUN.

## Backup/restore

`data-protection/src/protected-backup.mjs` eksporterer versioner, låse,
autoritativ pointer og politikken og kan importere dem i et rent lager.
`compareProtectedState` afviser en gendannelse der har mistet en lås.

## Kontrakter

- `contracts/immutable-enforcement.schema.json` — den kanoniske politik.
- `contracts/examples/immutable-enforcement.example.json` — politikken som eksempel.
- `contracts/protected-data.schema.json` — beskyttelsesregisteret (DKC-047).

## Test og kontrol

| Kommando | Dækker |
| --- | --- |
| `make immutable-render` | Genererer `gitops/manifests/data-protection/` fra politikken |
| `make immutable-check` | Politik, semantik, manifester, register og lagersemantik |
| `make immutable-test` | WORM-låse, retention, versionsskjul, roller, nøgler, backup/restore, semantik og konformans |

En **målt** WORM-verifikation på et levende storage-produkt er
`integration-immutable-live` og er NOT RUN i dette miljø. S3-kompatibilitet
alene er ikke et WORM-bevis; håndhævelsen er efterprøvet med negative tests mod
den rigtige fillager-model.
