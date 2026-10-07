# Fælles konfiguration (DKC-054)

**Kode:** [`configuration/`](../../configuration)
**Kontrakter:** [`platform-configuration.schema.json`](../../contracts/platform-configuration.schema.json), [`retention-change-preview.schema.json`](../../contracts/retention-change-preview.schema.json)
**Kanonisk kilde:** [`configuration/desired-state.json`](../../configuration/desired-state.json)
**ADR:** [ADR-0059](../adr/0059-installer-og-faelles-konfiguration.md)

## Formål

Der findes **én autoritativ ønsket tilstand** pr. installation. Den deklarative
fil, portalen (UI) og API'et læser og skriver samme versionerede dokument,
validerer det med samme funktion og beregner samme digest. Dermed kan en ændring
ikke se udført ud i ét kontrolplan uden at have effekt i et andet.

## Indstillinger

`desiredState.installation` bærer de fulde indstillinger, og `overrides` kan
tilsidesætte dem pr. tenant eller modul (delvist, arvende):

| Felt | Betydning |
| --- | --- |
| `logLevel` | `trace`/`debug`/`info`/`warn`/`error`. Kan ikke slukke revisionen. |
| `debug` | `enabled` + absolut `expiresAt` (TTL), begrundelse og ansvarlig. Slukket debug har `expiresAt: null`. |
| `retention` | Pr. dataklasse: dage, `legalHold`, `worm` og et formålsbestemt grundlag. |
| `backups` | Slået til, schedule, ekstern + `targetSetRef`, retention. |
| `modelRoutes` | Dataklasse → modelrute/provider + `egressApproved`. Default-deny. |
| `resourceLimits` | CPU, hukommelse, lager og maks. replikaer. |

Sikre standarder: debug er slukket, backup er tændt, der er ingen modelrute uden
eksplicit egress-godkendelse, og `personal`/`security` er WORM-beskyttede.

## Én validerings-API

`configuration/src/validate-api.mjs` er den ene indgang. `validateSubmission`
afviser en ukendt kontrolkilde, og en `file`- og en `portal`-indsendelse med
samme indhold giver samme digest og samme effekt. Den semantiske kontrol
(`configuration/src/model.mjs`) håndhæver det, JSON Schema ikke kan: at
revisionssporet er uforanderligt, at retention dækker hver dataklasse, at WORM
bevares, at modelruter findes i `gateway/routes.json`, og at en override ikke
svækker backup eller sikkerhedsgrænser.

## Ønsket vs. faktisk og tavs drift

`configuration/src/desired-state.mjs` planlægger ændringer som et diff,
opdager drift mellem ønsket og faktisk tilstand (`driftPolicy: fail-closed`) og
skriver en ændring atomisk efter en navngiven menneskelig autorisation bundet til
dokumentets digest. Portalen viser ønsket og faktisk tilstand side om side.

## Debug og revisionsspor

`configuration/src/debug.mjs` slukker debug automatisk, når TTL udløber. De
obligatoriske revisionsevents (fx `config.change`, `auth.decision`,
`retention.change`) registreres uanset logniveau; kun støjniveauer kan filtreres.
Revisionssporet kan ikke deaktiveres via konfigurationen.

## Retentionændringer

`configuration/src/retention-change.mjs` viser hvilke dataklasser og
databærende artefakter en ændring berører, og afviser enhver ændring der
forkorter en WORM-beskyttet klasse, bryder et legal hold eller ligger uden for den
menneskeligt vedtagne ramme. En tilladt ændring kræver stadig en navngiven
menneskelig autorisation.

## Kommandoer

| Kommando | Dækning |
| --- | --- |
| `make configuration-check` | Skema + semantik for konfiguration, host-scope, plan og retention-preview. |
| `make configuration-test` | Én ønsket tilstand, retention/WORM, signeret plan og resumable installation. |
| `make configuration-preview` | Ønsket vs. faktisk tilstand og drift. |
