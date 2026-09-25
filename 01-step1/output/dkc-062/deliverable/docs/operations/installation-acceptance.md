# Drift: installations- og releaseacceptance

Denne side beskriver, hvordan acceptancen bruges i drift. Acceptancen er
**profilbevidst**: de fælles gates gælder altid, mens HA, host management,
immutable og self-healing kun er aktive når profilen/kapabiliteten er valgt.

## Kommandoer

```bash
make acceptance-check     # validér scenarier, gates, RACI, ejeraccept og rapport-sync
make acceptance-test      # kør acceptgate-, brugerrejse- og konformanstestene
make acceptance-run       # kør de deterministiske acceptscenarier
make acceptance-render    # skriv acceptance/report/acceptance-report.json og docs/pilot/acceptance-report.md
make acceptance-report    # skriv acceptrapporten til stdout
make acceptance-live      # NOT RUN uden levende hosts og menneskelig accept
```

## Acceptmål og gates

Se det genererede dokument [docs/pilot/acceptance-report.md](../pilot/acceptance-report.md).
For hvert acceptmål viser rapporten:

- hvilke gates der er aktive,
- om testbeviset er `passed`/`missing`/`stale`/`wrong-artifact`/`not-run`,
- om ejeraccepten er `accepted`/`pending`, og
- den samlede beslutning.

En enkelt-server-installation markeres non-HA. HA-gaten er `not-applicable`, men
den fælles sikkerhedsgate (inkl. auditbeskyttelse) består uændret. Fravalg af
immutable ophæver derfor **ikke** den obligatoriske auditbeskyttelse.

## Registrér menneskelig ejeraccept

Ejeraccept er en særskilt menneskelig begivenhed. Den registreres i
`distribution/acceptance/owner-acceptance.json`:

```json
{
  "id": "oa-2026-10-07-security",
  "gateId": "security",
  "acceptedBy": { "subject": "oidc|sven.security", "name": "Sven Security", "role": "Security Officer" },
  "acceptedAt": "2026-10-07T09:00:00Z",
  "targetCommit": "<release-commit>",
  "artifactDigest": "sha256:<acceptance-artefakt>",
  "profileRef": "small-vps",
  "evidenceRef": "acceptance/report/acceptance-report.json#security",
  "notes": "Gennemgået mod det aktuelt kørte testbevis."
}
```

Accepter kun:

- navngivne mennesker i en rolle fra `acceptedByRoles`,
- bind accepten til det commit og den artefakt-digest der faktisk accepteres,
- og forny den inden `maxAgeDays`, ellers bliver gaten `unapproved` igen.

## Forudsætninger pr. gate

| Gate | Kræver |
| --- | --- |
| `ha` | DKC-038–043 og DKC-050–052 (HA-klynge, database-HA, beskeder, lager, DR, dedup, kapacitet, chaos, overtagelse) |
| `host-management` | DKC-058 |
| `immutable` | DKC-047–049 |
| `self-healing` | DKC-045–046 og en uafhængig menneskelig recoveryøvelse |

Mangler en forudsætningskapabilitet i koden, giver gaten `missing` og blokerer
accepten.

## NOT RUN

En faktisk målt installation på en ren VPS/lokal server/HA, konfiguration,
provider-skift og den menneskelige ejeraccept kræver ekstern infrastruktur og et
navngivet menneske. Det er registreret som `integration-acceptance-live` og
**ikke** det samme som en grøn deterministisk kørsel.
