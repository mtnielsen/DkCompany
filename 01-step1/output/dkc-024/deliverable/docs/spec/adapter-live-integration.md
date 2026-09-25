# Live integration og opgradering af adaptere

> DKC-024 · ADR-0037. Løfter Mattermost- og Keycloak-adapterne fra mock-test til
> reel integration og gør opgradering/rollback planlagt og gated.

DKC-023 gav adapterne en fælles SDK, en kandidatrapport og en releaseprofil pr.
eksakt upstream-version/edition. DKC-024 binder den godkendte version til en
konkret live-integration: hvilke miljøbindinger der kræves, hvilke privacy-verber
der prøves mod upstream, hvordan scope/rate limits/restdata ser ud, og hvordan en
version opgraderes og rulles tilbage uden at miste data eller rettigheder.

## Pinning af version og edition

`adapter-sdk/live-targets.json` er den ene kilde til, hvad der er pinnet:

| Adapter | Pinnet version | Edition | Adapterbinding |
| --- | --- | --- | --- |
| `mattermost-adapter` | `10.0.0` | `Enterprise` | `DKC_LIVE_MATTERMOST_ADAPTER_URL` |
| `keycloak-adapter` | `26.0.0` | `upstream` | `DKC_LIVE_KEYCLOAK_ADAPTER_URL` |

Pinningen skal matche `upstream.exactVersion`/`upstream.edition` i den godkendte
releaseprofil. `make adapter-live-check` afviser en live-målfil hvis versionen,
editionen eller SSO-kravet ikke stemmer med releaseprofilen og kandidaten. En
pin er derfor ikke en fri påstand.

## Live-køren

`adapter-sdk/src/live.mjs` læser bindingerne fra miljøet og kalder adapterens
dokumenterede flade. Hver prøve giver en `EvidenceRecord` med mode
`integration`, bundet til commit, image-digest, miljø, upstream-version, run-ID
og udløb (samme kontrakt som DKC-018).

```bash
export DKC_LIVE_COMMIT=$(git rev-parse HEAD)
export DKC_LIVE_ENVIRONMENT=staging
export DKC_LIVE_MATTERMOST_ADAPTER_URL=https://mattermost-adapter.staging.example.org
export DKC_LIVE_MATTERMOST_ASSERTION=...   # verificerbar workload-assertion
export DKC_LIVE_KEYCLOAK_ADAPTER_URL=https://keycloak-adapter.staging.example.org
export DKC_LIVE_KEYCLOAK_ASSERTION=...
make adapter-live-run
```

Ærlighedsreglerne er de samme som DKC-018:

- er bindingen ikke sat, eller kan endpointet ikke nås, bliver posten `not-run`
  med en begrundelse — aldrig `pass`,
- et svar der ikke matcher den forventede status bliver `fail`,
- et privacy-verbum der er erklæret `partial`, men svarer `partial: false`,
  bliver `fail` (adapteren må ikke overerklære sin egen sletning),
- en ikke-understøttet version/edition afvises, før PDP eller handler spørges.

Uden `DKC_LIVE_COMMIT` (og dermed uden en bindende miljøvariabelsæt) udskriver
`make adapter-live-run` en samlet **NOT RUN**-rapport med begrundelse og
returnerer 0. Et manglende driftsbevis bliver aldrig et grønt resultat.

## Demo-header må ikke give produktionsadgang

En demo-shim findes kun for udvikling uden en rigtig IdP.
`identity/src/compat.mjs` nægter allerede at konstruere den uden for
`profile: "test"`. DKC-024 tilføjer et uafhængigt værn i selve verbumskæden
(`adapter-sdk/src/guards.mjs`): hvis en authenticator alligevel udsteder en
principal med `demo: true`, afviser både SDK'en og Keycloak-adapteren den med
`401 demo_forbidden`, før tenant, PDP eller handler ser principalen. Dette
dækker en fejlkonfigureret eller kompromitteret proxypåstand, ikke kun den
normale konstruktionsvej.

## Scopes, rate limits og restdata

| Forhold | Mattermost | Keycloak |
| --- | --- | --- |
| Login-scopes | `openid profile email groups` | `openid profile email groups` |
| Dedikerede admin-scopes | `manage_system`, `manage_team` | `view-users`, `manage-users`, `view-events` |
| Rate limits | upstream 429 bevares som 429 + `Retry-After` | upstream 429 bevares som 429 + `Retry-After` |
| Sletning | `partial` — opslag slettes, men ikke backups/søgeindeks/audit | `partial` — brugeren slettes, men ikke event-store/backups/cachede tokens |
| Legal hold | `unsupported` — kræver manuel indgriben i upstream | `partial` — kontoen kan deaktiveres, men sletning kan ikke garanteres blokeret |

Adapterne bruger en dedikeret tjenestekonto med mindst mulig scope, og native
admin-endpoints er ikke eksponeret (se releaseprofilernes `nativeAdmin`).
Restdata beskrives pr. adapter i `adapter-sdk/live-targets.json` og gælder både
ved DSAR-sletning og ved opgradering, hvor en gendannelse kan genindføre
personoplysninger, der ellers var slettet. Det er en kendt begrænsning, ikke et
løfte om fuld sletning.

## Opgradering og rollback

`adapter-sdk/src/upgrade.mjs` udleder en deterministisk plan pr. adapter:

```bash
make adapter-live-plan     # vis preflight, trin, verifikation og rollback
make adapter-live-write    # genskab contracts/examples/upstream-upgrade-plan.*
make adapter-live-check    # fejl hvis planerne er ude af trit
```

Planen har:

- **preflight**: versionsforhandling, frisk verificeret backup og annonceret
  vedligeholdelsesvindue,
- **trin**: dræn → øjebliksbillede → opgradering → genåbn,
- **verifikation**: health/versionsforhandling, central identitet (OIDC) og
  privacy-verber,
- **rollback**: gendan øjebliksbilledet og verificér, med `backupRequired: true`
  og et eksplicit nedetidsbudget.

En målversion uden for releaseprofilens understøttede serie blokerer planen og
kræver en ny `IntegrationCandidate` og `UpstreamReleaseProfile`. En kandidat uden
erklæret og afprøvet backup/gendannelse blokerer rollback. Planen er et grundlag
for det almindelige policy-/godkendelses-/executor-flow; den udfører intet selv.

## Acceptkriterier (DKC-024)

| Kriterium | Status | Evidens |
| --- | --- | --- |
| Begge adaptere passerer live integration med syntetiske data | NOT RUN | Kræver rigtige Mattermost-/Keycloak-instanser og `DKC_LIVE_*`-bindinger. Køreren, pinningen og de negative prøver er efterprøvet offline. |
| Ingen demo-header giver produktionsadgang | PASS | `adapter-sdk/src/guards.mjs`, `adapter-sdk/test/demo-guard.test.mjs`, begge adaptere svarer `401 demo_forbidden`. |
| Sletning/hold rapporteres ærligt som partial | PASS | Releaseprofilerne erklærer `partial`/`unsupported`; live-køreren fejler hvis adapteren svarer `partial: false`. |
| Den testede edition kan bruge den valgte centrale identitet | PASS (kontrakt) / NOT RUN (live) | Pinning + SSO-gate i `adapter-live-check`; selve OIDC-loginet kræver en levende instans. |
| Én upstreamopgradering og rollback/gendannelse er demonstreret | NOT RUN | Plan og semantik er genereret og valideret; selve opgraderingen kræver et levende miljø. |

## Begrænsninger

- Rigtige Mattermost-/Keycloak-instanser, credentials og en stagingklynge findes
  ikke i dette miljø. Den samlede live-kørsel er **NOT RUN** og registreres
  ærligt som `integration-adapter-live` i baseline-registeret.
- Opgraderingsplanens versioner (`10.1.0`, `26.1.0`) er syntetiske
  inden-for-serien-eksempler; de er ikke godkendte kandidater.
- En live-opgradering og en faktisk rollback er ikke demonstreret her.
