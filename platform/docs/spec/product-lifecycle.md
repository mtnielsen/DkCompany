# Produktlivscyklus: opdatering, fjernelse, support og offline-drift

DKC-061 samler livscyklussen efter installationen i ét lag oven på
installationsprofilerne (DKC-053), installatøren (DKC-054), backupmålene
(DKC-057) og providerkontrakterne (DKC-059). Laget er versionsstyret data plus
deterministisk beslutningssemantik; intet er en placeholder.

## Signeret releasekatalog

Kilden er `catalog/releases.json` (`kind: ReleaseCatalog`). Hver release
erklærer:

- `channel`: `stable`, `security`, `eol` eller `revoked`,
- `supportWindow` (`from`, `until`, `tier`),
- `eolAt` og den vedtagne `handling` for `eol`/`revoked`,
- en `compatibilityLock` (komponent-id → låst version) og
- signerede `artefakter` samt `securityUpdates` med advisory og procedure.

Kataloget signeres deterministisk med HMAC-SHA256 over den kanoniske form, og
hver release har et digest. I produktion kommer nøglen fra KMS/HSM og den
offentlige trust anchor er `release/trust/release-keys.json` (DKC-014); i dette
miljø bruges det bevidst offentlige udviklingsnøglesæt
`configuration/dev-keyring.json`.

Semantikken (`installer/src/lifecycle-model.mjs`) afviser et usigneret eller
manipuleret katalog, en stable-release hvis lås ikke matcher komponentkataloget,
og en EOL/revoked-release uden håndtering. `releaseRunnable` tillader kun
`stable` og `security`.

## Modulopdatering

`installer/src/lifecycle-update.mjs` bygger en signeret, deterministisk
`LifecycleUpdatePlan`:

- **Påvirkning:** tilføjede, fjernede, opgraderede og nedgraderede komponenter
  samt berørte delte datatjenester.
- **Migrationskontrol:** hvilke faser (pre/schema/data/post) og om de er
  reversible.
- **Preflight:** målreleasen findes, er kørbar (stable/security),
  kompatibilitetslåsen resolver, og data bevares.
- **Rollback:** `snapshot-restore` med en dokumenteret procedure
  (`docs/runbooks/module-update-rollback.md`).
- **Godkendelse:** hvert muterende trin kræver en menneskelig godkendelse.

Eksekveringen er resumabel (`executeUpdate`/`resumeUpdate`) og kan rulles
tilbage til et snapshot taget før den første mutation (`rollbackUpdate`).
Uden en gyldig signatur kører intet.

## Fjernelse adskilt fra datasletning

`installer/src/lifecycle-remove.mjs`:

- **Reverse-dependency-kontrol:** en delt database eller IAM kan ikke fjernes,
  mens aktive moduler kræver den. Sikkerhedskernen kan ikke fjernes separat.
- **Almindelig afinstallering** (`remove-only`) bevarer data og
  recoverymetadata og er ikke destruktiv.
- **Datasletning** (`remove-and-delete-data`) kræver en eksport eller en
  verificeret backup, en eksplicit destruktiv godkendelse og to forskellige
  navngivne personer.

## Supportbundle og diagnostik

`support/policy.json` og `installer/src/lifecycle-support.mjs` bygger en
redigeret `SupportBundle` ud fra en allowlist. Hemmeligheder redigeres, og både
hemmelighedssignaturer og ikke-godkendt HR-indhold (løn, sygefravær,
fagforening, personalesager) blokerer bundlen (fail-closed). Der findes ingen
skjult fjernadgang: fjernadgang er default-deny og kræver et navngivent
menneskes samtykke med en TTL og et revisionsspor.

## Cloud-uafhængig drift og offlinepakke

`catalog/offline-package.json` og `installer/src/lifecycle-offline.mjs`
beskriver:

- hvilke komponenter offlinepakken indeholder (selvstændig),
- de **lokale kerneflows** der fortsætter uden internet (autorisation,
  dataadgang, audit, backup og lokal søgning), og
- hver **ekstern afhængighed** (model-API, ekstern API, opdateringskilde) med
  `offlineBehavior` og en eksplicit status ved udfald.

Enhver gateway-rute i `gateway/routes.json` skal være markeret, og der må ikke
findes en tavs fallback.

## Adgang

`installer/src/lifecycle-permissions.mjs` gør adgangen default-deny og
tenantadskilt: `lifecycle-admin`, `lifecycle-operator` og `lifecycle-auditor`
har forskellige rettigheder, datasletning kræver to-personers-kontrol, og
fjernadgang kræver samtykke.
