# Drift — migration og exit

Modulet `migration/` kører som et deterministisk værktøjssæt. Denne side
beskriver den daglige drift.

## Kommandoer

| Kommando | Formål |
| --- | --- |
| `make migration-dry-run` | Afstem hver kilde uden at skrive. |
| `make migration-export` | Skriv en selvbeskrivende exit-eksport til `migration/exports/`. |
| `make migration-run` | Kør den deterministiske kontrol (drill). |
| `make migration-render` | Skriv `migration/report/migration-report.json` og `docs/migration/migration-report.md`. |
| `make migration-check` | Skema + semantik for kilder, politik, dækning og scenarier. |
| `make migration-report` | Skriv rapporten til stdout. |

## Butikken

Migrationsbutikken er filbaseret (`migration/src/store.mjs`) og ligger på disk.
Den indeholder poster, idempotensnøgler, dedup-indeks, checkpoints, fejllister,
godkendelser og cutover-kvitteringer. Hver mutation hæver en **epoch**.
Checkpointet gør en afbrudt import resumabel.

## Fejlsøgning

| Symptom | Årsag | Handling |
| --- | --- | --- |
| `cross_tenant_object` i fejllisten | Kildeobjektet tilhører en anden tenant | Ret kilden; objektet importeres ikke. |
| `dedup_conflict` | To objekter har samme forretningsidentitet | Løs konflikten manuelt; der flettes aldrig automatisk. |
| `checksums.match = false` | Mapping eller butik er ude af trit | Kør `make migration-dry-run` og undersøg mappingen. |
| Cutover blokeret | Manglende godkendelse, konflikt eller mismatch | Gennemfør godkendelse/oprydning, og kør igen. |
| `migration_access_denied` | Principalen mangler rolle eller tenant | Tildel en dækkende rolle/scope. |

## Grænser

Adgang er default-deny og tenantadskilt. En cutover kræver en afstemt import, en
dokumenteret rollback og en menneskelig pilotgodkendelse af indhold og
adgangsrettigheder. Den målte migration mod en levende kilde er `make
migration-live` og er **NOT RUN** uden ekstern infrastruktur.
