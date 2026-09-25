# Runbook: godkend en ny adapter på den fælles SDK

> DKC-023. Bruges når et nyt upstream-produkt skal bag adapter-SDK'en, eller når en
> eksisterende adapter opgraderes til en ny version/edition.

## 0. Forudsætninger

- Kandidaten er vurderet som `IntegrationCandidate` og har en navngivet, menneskelig
  verifikator (`contracts/examples/integration-candidate.<modul>.example.json`).
- Modulet har et `module-manifest.json`, hvor **alle** ops- og privacy-verber er
  deklareret med et ærligt conformance-niveau og begrundelse for partial/unsupported.
- Adapteren kalder `createAdapterSdk` og eksponerer kun de deklarerede verber. Der
  findes ingen rå proxy til upstreams admin-API.

## 1. Kobl adapteren på SDK'en

```js
import { createAdapterSdk } from "../../../../adapter-sdk/src/sdk.mjs";

const sdk = createAdapterSdk({
  serviceName: "min-adapter",
  version: "1.0.0",
  authenticate,            // identity/src/compat.mjs
  pdp,                     // fail-closed decide(input)
  idempotency,             // createDurableIdempotencyStore({ db })
  upstream: { name: "upstream", version: "10.0.0", edition: "Enterprise",
              supportedRanges: ["^10.0.0"], supportedEditions: ["Enterprise"] },
  onAudit, onEvent,
});
```

Alle verbumskald går gennem `sdk.guard(req, res, verb, handler)`. Ingen handler må
kalde upstream uden om `guard`.

## 2. Registrér kandidat og releaseprofil

Tilføj adapteren til `adapter-sdk/registry.json` med `supportedRanges`,
`supportedEditions`, `requiredSso` og `nativeAdmin`. Generér profilerne:

```bash
make adapter-sdk-write
make adapter-sdk-check
```

`check` fejler hvis profilen er ude af trit, hvis en version ikke matcher en serie,
hvis native admin er eksponeret, eller hvis gaten er `approved` med blockers.

## 3. Kør godkendelsesharnessen

Skriv en test som den for Mattermost, der wrapper upstream-klienten i en
`createFaultPlan()` og kalder `runAdapterHarness`. Harnessen skal dække:

- API-fejl (5xx → 502), rate limits (429 + `Retry-After`),
- versionsskift (ikke-understøttet version/edition → afvist),
- backup (ærlig partial/unsupported, aldrig fingeret),
- negativ adgang (manglende identitet → 401, fremmed tenant → 403),
- idempotens (samme nøgle udfører handlingen én gang),
- native admin-veje (401/403/404).

```bash
make adapter-sdk-test
```

## 4. Bevis og godkendelse

- `make adapter-sdk-check` er grøn.
- `make adapter-sdk-test` er grøn.
- Rigtige upstream-instanser er en **separat** integration og er `NOT RUN`, indtil de
  faktisk er kørt mod et levende system. Et fixture-pass er ikke driftsbevis.
- Den menneskelige godkender underskriver kandidatens `verification.status =
  "approved"` på den **eksakte** version/edition.

## Eskalering

- Manglende obligatorisk SSO eller uafklaret licens: kandidaten blokeres. Det er en
  ejerbeslutning at acceptere en undtagelse — ikke en adapterbeslutning.
- Upstream har ændret API i en ny major-version: opret en ny releaseprofil og en ny
  kandidatvurdering. Genbrug ikke den gamle godkendelse.
- Native admin-endpoints kan ikke beskyttes af adapter + PDP + netværkspolitik:
  adapteren må ikke godkendes. Se `docs/adr/0036-faelles-adapter-sdk-og-godkendelsestest.md`.
