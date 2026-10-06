# Evidensmodes: kontraktchecks, integration og driftsbevis (DKC-018)

> Et fixture-pass er ikke bevis på håndhævelse i en rigtig deployment. Denne
> spec beskriver, hvordan platformen holder de fire bevisniveauer adskilt:
> `fixture`, `contract`, `integration` og `runtime`.

## Formål

Conformance-suiten skal fortsat kunne køre hurtige, deterministiske
fixture- og kontraktchecks offline. Men et grønt fixture-pass må ikke kunne
læses som produktionsstatus. Derfor bærer hver evidenspost sit eget niveau og
sin egen binding, og en produktionsbadge kræver et integration/runtime-bevis.

## Evidensposten

Kontrakten er [`contracts/evidence-record.schema.json`](../../contracts/evidence-record.schema.json).
En post indeholder:

| Felt | Betydning |
| --- | --- |
| `mode` | `fixture`, `contract`, `integration` eller `runtime` |
| `result` | `pass`, `fail`, `skip` eller `not-run` |
| `commit` | Fuld 40-tegns commit-SHA |
| `imageDigest` | `sha256:<64 hex>` eller `null` |
| `environment` | `local`, `dev`, `staging` eller `prod` |
| `upstreamVersion` | Versionen af det målte system |
| `runId` | CI-/runtime-run-id |
| `capturedAt` / `expiresAt` | Indsamlingstid og udløb |
| `producer` | `ci`/`runtime`/`human`/`implementer` med subject |
| `command` | Den kommando der producerede beviset |
| `artifact` | `uri` + `sha256` til det rå artefakt |
| `digest` | SHA-256 over postens kanoniske indhold (uden `digest`/`signature`) |
| `signature` | Valgfri Ed25519-signatur over digesten |

`digest` beregnes af `recordDigest()` i
[`conformance/src/evidence-mode.mjs`](../../conformance/src/evidence-mode.mjs).
En manuel redigering af `result` — fx fra `fail` til `pass` — ændrer
indholdet, så digesten ikke længere matcher. Posten afvises med status
`tampered`.

## Modenhedsniveauer

| Mode | Produktionsegnet | Betydning |
| --- | --- | --- |
| `fixture` | nej | Sample-/negativdata |
| `contract` | nej | Skema-/metavalidering |
| `integration` | ja | Kørt mod et levende system på det angivne commit |
| `runtime` | ja | Målt i en kørende deployment i det angivne miljø |

Et modul hvis beviser alle er `fixture`/`contract`, kan højst få badgen
`fixture-only`. Produktionsbadgen `production` kræver mindst ét
`integration`/`runtime`-bevis pr. påkrævet emne, bundet til det præcise
commit/image/miljø og uudløbet.

## Afvisningsregler

`evidenceRecordProblems()` og `assessRecord()` afviser:

- **udløbet** evidens (`expired`),
- **fremtidsdateret** evidens,
- **forkert commit/image/miljø/upstream** (`wrong-artifact`),
- **manuelt ændret** indhold (`tampered`),
- **uverificeret signatur**, når et trust anchor eller `requireSignature` er sat,
- **ikke-pass** resultater (`not-pass`),
- **fixture/contract** hvor et produktionsbevis kræves (`fixture-only`).

## Prober

[`evidence/probes.json`](../../evidence/probes.json) erklærer integration- og
runtime-prober. Køreren ligger i
[`evidence/src/probes.mjs`](../../evidence/src/probes.mjs) og CLI'en i
[`evidence/src/probe-cli.mjs`](../../evidence/src/probe-cli.mjs).

Bindingen læses fra miljøet:

```
DKC_PROBE_COMMIT            fuld commit-SHA (påkrævet)
DKC_PROBE_ENVIRONMENT       local|dev|staging|prod (påkrævet)
DKC_PROBE_RUN_ID            CI-/runtime-run-id (påkrævet)
DKC_PROBE_IMAGE_DIGEST      sha256:<64 hex> (valgfri)
DKC_PROBE_UPSTREAM_VERSION  version af det målte system
DKC_PROBE_PDP_URL / DKC_PROBE_AUDIT_URL / DKC_PROBE_GATEWAY_URL / DKC_PROBE_RUNTIME_URL
```

```bash
node evidence/src/probe-cli.mjs check   # validér manifestet (offline)
make evidence-probe                     # kør mod levende endpoints
```

Mangler endpointet eller bindingen, skrives posten som `not-run` med en
begrundelse — aldrig som `pass`. Den eneste netværksadfærd er de konfigurerede
probe-kald.

## Negative bypass-tests

`conformance/test/evidence-mode.test.mjs` og `evidence/test/probes.test.mjs`
dækker:

- fixture-only-sæt får ikke produktionsbadge,
- udløbet/forkert-bundet/tamperet evidens afvises,
- en manuel redigering af PASS afvises,
- en frakoblet PDP giver `halted` og kalder aldrig executoren,
- direkte endpoint-kald fra en utillidtværdig adresse eller med rå
  `x-spiffe-id` afvises, og gatewayens ingress afviser manglende token,
- en negativ probe fejler, hvis det uautoriserede kald ikke afvises.

## Kommandoer

```bash
make evidence-mode-check   # kontrakt + probemanifest + fixture-only-regel
make evidence-mode-test    # evidensmode- og probe-testene
make evidence-probe        # NOT RUN uden DKC_PROBE_* og levende endpoints
```

## Begrænsninger

- Der er ingen kørende PDP/audit/gateway/runtime i dette miljø, så den
  eksterne check `evidence-probe-staging` er registreret `external: true` og
  rapporteres NOT RUN.
- `REQ-EVIDENCE-001` er obligatorisk og release-blokerende, indtil
  integration/runtime-beviserne faktisk er indsamlet.
