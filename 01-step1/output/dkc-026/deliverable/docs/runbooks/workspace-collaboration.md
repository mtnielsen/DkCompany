# Runbook: Arbejdspladsmodul (filer, deling, kalender)

> DKC-026. Gælder for `modules/nextcloud-adapter/` mod en kundes Nextcloud.

## Forudsætninger

- Nextcloud Hub Enterprise med OIDC/SAML-SSO og en OCS-servicekonto.
- En valideret kontoredaktør (se `docs/spec/nextcloud-adapter.md`).
- PDP tilgængelig (fail-closed) og en kundepolitik i `createWorkspaceService`.

## Daglig drift

1. **Sundhed**: `GET /healthz` skal svare `ok`. `degraded`/`unavailable` betyder
   at upstream-versionen ikke forhandles, eller at ping fejler.
2. **Versionsforhandling**: adapteren afviser et verbum mod en ikke-understøttet
   Nextcloud-version/edition (409), før PDP spørges.
3. **Deling**: alle delinger går gennem `workspace.share.create` og kræver et
   verificeret menneske. Eksterne delinger og offentlige links håndhæves af
   kundepolitikken.

## Offboarding af en bruger

1. Bekræft at kundepolitikken har en beslutning for ejerens filer
   (`transferOwnedFilesTo` eller `deleteOwnedFiles`). Ellers afvises forløbet.
2. Kør `workspace.user.offboard`. Adapteren lukker sessioner, tilbagekalder
   delinger og overfører/sletter filer.
3. Gem kvitteringen (tællere, ikke indhold) i sagen.

## Sletning (DSAR)

1. Kontrollér at der ikke er aktiv legal hold eller retention på subjektet.
2. Sletning kræver en begrundelse (mindst 10 tegn) og en navngiven godkendelse.
3. Efter sletning: håndtér de resterende kopier (backup, versions-/papirkurv,
   søgeindeks) gennem DKC-021. Adapteren rapporterer dem i kvitteringen.

## Gendannelse

- Adapteren erklærer restore `unsupported`: gendannelse sker på volume- og
  databaseniveau. Følg DKC-016/DKC-021 og re-apply slettejournalen, så slettede
  persondata ikke genindføres.

## Fejlfinding

| Symptom | Sandsynlig årsag | Handling |
| --- | --- | --- |
| 403 `access_denied` | ingen deling eller utilstrækkelig rettighedsbit | kontrollér delingen i Nextcloud |
| 403 `tenant_mismatch` | påstået tenant stemmer ikke med principalen | afvis kaldet; ret identiteten |
| 403 `public_link_denied` | kundepolitikken tillader ikke link/adgangskode/levetid | opdatér politikken eller linket |
| 409 `deletion_denied` | legal hold, aktiv retention eller manglende godkendelse | eskalér til DPO/ejer |
| 503 `governance unavailable` | PDP utilgængelig | handlingen er **ikke** udført; genoptag efter PDP er oppe |
