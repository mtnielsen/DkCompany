# Fælles adapter-SDK

> DKC-023 · ADR-0036. Nye adaptere skal kunne integreres med ensartede kontroller og ærlige begrænsninger.

Den fælles adapter-SDK samler de syv kontroller, hver adapter ellers genimplementerer,
plus versionsforhandling og en genbrugelig godkendelsesharness.

## Den gatede verbumskæde

`createAdapterSdk()` returnerer `guard(req, res, verb, handler)`, som kaldes for hvert
verbum. Rækkefølgen er fast og kan ikke omgås:

1. **Auth** — verificerbar identitet (mTLS-SVID eller signeret proxy-assertion). Rå
   identitetsheadere ignoreres. Fejl → `401`.
2. **Tenant** — tenant udledes af den verificerede principal via
   `identity/src/tenant.mjs`. En klientpåstand (header/body/query/ressource-ID) må
   stemme med den; ellers `403 tenant_mismatch`.
3. **Versionsforhandling** — hvis upstream er konfigureret med `supportedRanges`/
   `supportedEditions`, afvises en ikke-understøttet version/edition med
   `409 version_unsupported`, før PDP spørges.
4. **PDP** — fail-closed. `deny` → `403`; `allow-with-approval` uden nok godkendelser →
   `428`; manglende evidens → `428`; utilgængelig governance → `503`.
5. **Idempotens** — bærer requesten en `idempotencyKey`, kravet gøres atomisk. En
   gentaget nøgle med samme indhold replayes (`200`, `replayed: true`); samme nøgle med
   andet indhold afvises (`409`); en nøgle under behandling afvises (`409`).
6. **Handler** — adapterens oversættelse til upstream. En upstream-fejl klassificeres:
   `429` bevares med `Retry-After`, øvrige upstream-fejl bliver `502`. Et falsk `200`
   er ikke muligt gennem SDK'en.
7. **Audit + CloudEvent** — hvert verbum efterlader et revisionsspor; privacy-verber
   klassificeres som `personal`.

`GET /healthz` beskriver `status`, `upstreamVersion` og `negotiation`. En
ikke-understøttet version gør health `degraded` (`503`), ikke `ok`.

## Auth, tenant, PDP, audit

- Auth genbruger `identity/src/compat.mjs` og `identity/src/identity.mjs`.
- Tenant genbruger `identity/src/tenant.mjs`; SDK'en videreformidler
  `resourceIds` og samler alle påstande via `collectTenantClaims`.
- PDP er en `decide(input)`-funktion. `createPdpClient` (HTTP) og
  `createInProcessPdp` (in-process) oversætter fejl til governance-utilgængelighed.
- Audit kaldes gennem `onAudit`, CloudEvents gennem `onEvent`. Begge er injicerbare,
  så adapteren kan sende dem til den rigtige sink i en deployment.

## Idempotens og holdbarhed

SDK'en kræver en idempotens-store med `claim/complete/fail/get`. Der findes to:

- `createMemoryIdempotencyStore()` — deterministisk, til tests og offline harness.
- `createDurableIdempotencyStore({ db })` — den holdbare SQLite-adapter oven på
  `adapter_idempotency` (migration v9). Kvitteringer overlever genstart og deles
  mellem replikaer.

Rå svar gemmes kun for verber, der erklæres replaybare (`replayable(verb)`); for
privacy-verber gemmes alene digest og metadata, så idempotens-loggen ikke bliver et
personregister.

## Versionsforhandling

`negotiateUpstreamVersion({ upstreamVersion, edition, supportedRanges,
supportedEditions, onUnsupported })` svarer `supported`, `degraded` eller
`unsupported`. `version.mjs` understøtter `^`, `~`, `>=`, `<=`, `<`, `>`, `=`, `*` og
`||`. En uafklaret edition er `unsupported` — ikke "måske".

## Kandidatrapport og releaseprofil

En adapter godkendes pr. **eksakt** upstream-version/edition:

- `IntegrationCandidate` (DKC-002) beskriver licens, hosting, SSO, SCIM, API,
  isolation, eksport, backup, pris og gratis/betalt-skel.
- `UpstreamReleaseProfile` binder kandidaten til adapterens verbumskontrakt:
  conformance pr. verbum, forhandlede serier, `nativeAdmin` og `approvalGate`.

Godkendelsesgaten er hård:

- manglende obligatorisk SSO → blocker,
- `license.type === "unknown"` eller tom `spdx` → blocker,
- kandidaten ikke godkendt af et navngivet menneske → blocker,
- `nativeAdmin.exposed === true` → afvises af validatoren,
- releaseprofilen må ikke love stærkere conformance end modulmanifestet.

Profilerne genereres deterministisk af `adapter-sdk/registry.json`,
modulmanifesterne og kandidaterne:

```bash
make adapter-sdk-write    # genskab contracts/examples/upstream-release-profile.*
make adapter-sdk-check    # fejl hvis de er ude af trit
make adapter-sdk-report   # vis kandidatrapporten
```

## Godkendelsesharness

`runAdapterHarness` kører de seks prøver og rapporterer hver som `pass`, `fail` eller
`not-run`:

| Kategori | Hvad den beviser |
| --- | --- |
| `api-error` | upstream 5xx bliver ikke et falsk 200 |
| `rate-limit` | upstream 429 bevares som 429 + `Retry-After` |
| `version-change` | en ikke-understøttet version/edition afvises |
| `backup` | backup/restore erklæres ærligt, aldrig fingeres |
| `negative-access` | manglende identitet → 401, fremmed tenant → 403 |
| `idempotency` | samme nøgle udfører handlingen højst én gang |
| `admin-bypass` | native admin-veje svarer 401/403/404 |

`createFaultPlan().wrap(client)` injicerer fejl i upstream-klienten uden at ændre
adapteren. Mattermost-adapteren kører harnessen i
`modules/mattermost-adapter/service/test/sdk-harness.test.mjs`.

## Begrænsninger

Harnessen kører mod en mock-upstream og den rigtige PDP. Rigtige
upstream-instanser, en levende stagingklynge og rigtig drift er separate
integrationer og er **NOT RUN** her. Se `docs/status/implementation-matrix.md`.
