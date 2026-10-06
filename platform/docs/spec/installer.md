# Installer (DKC-054)

**Kode:** [`installer/`](../../installer)
**Kontrakter:** [`installer-plan.schema.json`](../../contracts/installer-plan.schema.json), [`host-scope.schema.json`](../../contracts/host-scope.schema.json)
**Runbook:** [`docs/runbooks/installation.md`](../runbooks/installation.md)
**ADR:** [ADR-0059](../adr/0059-installer-og-faelles-konfiguration.md)

## Formål

Installatøren udfører den plan, DKC-053's resolverlægger, uden at give en agent
fri root- eller hypervisoradgang og uden at gætte på værts-OS, diske eller et
eksisterende databaseskema. Planen er **signeret** og **resumable**, og
diagnostikken indeholder aldrig hemmeligheder.

## Preflight (read-only)

`installer/src/preflight.mjs` ændrer intet og fejler lukket. Den blokerer hele
planen, hvis:

- OS-kombinationen ikke er i den navngivne Linux-LTS-matrix (ikke-understøttede
  versioner afvises),
- en disk kræver formatering, eller eksisterende data ikke bevares,
- et eksisterende databaseskema ikke er navngivet/ejet med en verificeret
  backup (installatøren overtager det aldrig),
- host-OS ændres uden et konkret oplyst scope,
- en agent har fri root, eller broker og executor er samme identitet,
- forbudte operationer (arbitrær shell, uploadet script, usigneret pakke,
  ændring af broker/pakkekilde/payload) er tilladt,
- recoverykonsollen uden for platformen eller backupkravet mangler.

```bash
make installer-preflight
```

## Signeret plan

`installer/src/plan.mjs` bygger en deterministisk plan med:

- preflight-resultatet (checks + blokerende problemer),
- idempotente trin med `idempotencyKey`, rækkefølge, afhængigheder og om trinnet
  muterer/kræver godkendelse,
- resumable tilstand (`resume.stateRef`),
- diagnostik (`diagnostics.redacted`, `secretScan: pass`),
- faste restriktioner: `formatDisks`, `adoptExistingSchema` og `changeHostOs` er
  altid `false`.

Signaturen er HMAC-SHA256 over hele det kanoniske indhold (undtagen
signaturfeltet). Nøglesættet er `configuration/dev-keyring.json` (syntetisk
testfixture; i produktion KMS/HSM). En ændret plan eller et ukendt/tilbagekaldt
nøgle-id afvises.

```bash
make installer-plan
```

## Resumable, idempotent udførelse

`installer/src/state.mjs` skriver tilstanden atomisk efter hvert trin
(`tmp` + `rename`), og nægter at genoptage, hvis planens digest ikke matcher det
gemte forløb. `installer/src/run.mjs` springer fuldførte trin over, kræver en
menneskelig autorisation for hvert muterende trin (et scoped operationsticket) og
giver kun executoren det ene trin og dets idempotency-key — ikke planen, policyen,
pakkekilden eller payloaden.

## Diagnostik uden hemmeligheder

`installer/src/diagnostics.mjs` redigerer følsomme feltnavne og scanner for
signaturer på nøgler/tokens. Et fund blokerer bundlen (`SECRET_LEAK`); det
skjules ikke. Hemmeligheder optræder hverken i preview, CLI-argumenter, Git eller
supportbundle.

## Grænser

En grøn preflight og en gyldig signatur er **ikke** en gennemført installation.
En ren installation på en levende værtsmaskine er `integration-installer-live`
og kræver ekstern infrastruktur og et navngivet menneskes godkendelse.
