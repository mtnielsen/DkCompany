# Installations- og releaseacceptance

DKC-062 beviser, at en administrator kan installere, konfigurere og drive **kun
de ønskede moduler**. Acceptancen består af fire dele:

1. **Kørebare brugerrejser** på de understøttede profiler og platforme.
2. **En profilbevidst acceptgate** der aktiverer de rigtige gates pr. mål.
3. **Et RACI-register** med et ansvarligt menneske og en stedfortræder.
4. **En særskilt registreret menneskelig ejeraccept** — aldrig en genereret PASS.

## Kontrakter

| Kontrakt | Formål |
| --- | --- |
| `contracts/acceptance-scenario.schema.json` (`AcceptanceScenarioSet`) | Brugerrejser med trin, forventet udfald, profil/platform og ejer. |
| `contracts/acceptance-gate-policy.schema.json` (`AcceptanceGatePolicy`) | Fælles og særskilte gates, forudsætningskapabiliteter, krav, checks og ejeraccept. |
| `contracts/raci-registry.schema.json` (`RaciRegistry`) | RACI pr. service, dataklasse og kontrolproces. |
| `contracts/acceptance-result.schema.json` (`AcceptanceResult`) | Maskinlæsbart resultat pr. mål med distinkte statusser og beslutning. |

Kanoniske data:

- `distribution/acceptance/scenarios.json`
- `distribution/acceptance/gate-policy.json`
- `distribution/acceptance/raci.json`
- `distribution/acceptance/owner-acceptance.json`

## Brugerrejser

| Rejse | Handling | Eksempel |
| --- | --- | --- |
| `install` | Ren installation, afbrudt installation, udvidelse, HA/enterprise-installation | `install-clean-small-vps-local`, `install-interrupted-resumed`, `install-ha-cluster` |
| `configure` | Anvende den ene ønskede tilstand med sikre standarder | `configure-safe-defaults` |
| `add-remove` | Tilføje/fjerne en applikation og bevare data | `expand-add-hr`, `remove-app-preserve-data` |
| `upgrade` | Opgradering mellem signerede releases | `upgrade-release` |
| `provider-switch` | Skifte provider efter capability-preflight | `provider-switch-database` |
| `escalation` | Afvise et muterende trin uden godkendelse og gennemføre det godkendt | `escalation-approval` |
| `recovery` | Afbrudt opgradering rulles tilbage fra snapshot | `recover-interrupted-upgrade` |
| `exit` | Maskinlæsbar eksport der kan læses uden platformen | `exit-export` |

Rejserne eksekveres af `distribution/src/acceptance-run.mjs` mod den faktiske
installer-, livscyklus-, provider- og migrationstak i midlertidige arbejdstræer.

## Profilbevidste gates

**Fælles gates** (gælder altid): `security`, `privacy`, `restore`, `role`.

**Særskilte profilgates** (kun aktive når valgt):

| Gate | Aktiveres når | Forudsætningskapabiliteter |
| --- | --- | --- |
| `ha` | `profileType: multiple-servers` | `ha-cluster`, `database-ha`, `messaging`, `storage`, `disaster-recovery`, `deduplication`, `performance-capacity`, `chaos-continuity`, `recovery-takeover` |
| `host-management` | host management tilvalgt | `host-management` |
| `immutable` | immutable-profil valgt | `data-protection`, `immutable-enforcement`, `logging`, `audit-durability` |
| `self-healing` | self-healing aktiveret | `change-runbooks`, `self-remediation` |

En aktiv gate består kun når:

- dens forudsætningskapabiliteter findes i kode/register,
- dens checks og krav har gyldigt, friskt og commit/artefakt-bundet evidens,
- dens brugerrejser består, og
- et navngivet menneske i en tilladt rolle har registreret sin ejeraccept.

## Statusser og beslutning

Evidensstatusser: `passed`, `failed`, `missing`, `stale`, `wrong-artifact`,
`not-run`. Dertil `not-applicable` for en ikke-aktiv gate og `unapproved` for en
gate der mangler ejeraccept.

Beslutningen er:

- `accepted` — alle aktive gates har både testbevis og ejeraccept.
- `pending-owner-acceptance` — alle aktive gates har testbevis, men mindst én
  mangler registreret ejeraccept.
- `blocked` — mindst én aktiv gate mangler gyldigt testbevis eller en
  forudsætningskapabilitet.

## Rapport

`make acceptance-render` skriver den deterministiske rapport til
`acceptance/report/acceptance-report.json` og `docs/pilot/acceptance-report.md`.
`make acceptance-check` afviser en rapport der er ude af trit med kilden.

## Afgrænsning

Alt er efterprøvet deterministisk (`measured: false`). En faktisk målt
installation på en ren VPS/lokal server/HA og den menneskelige ejeraccept kræver
ekstern infrastruktur og et navngivet menneske og er **NOT RUN**
(`integration-acceptance-live`).
