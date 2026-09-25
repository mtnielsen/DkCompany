# Migrations- og exitværktøjer

En virksomhed skal kunne flytte **ind og ud** uden at miste indhold og
rettigheder. Modulet `migration/` giver ét valgt, dokumenteret kildeformat pr.
pilotapp, en dækningsmatrix, en dry-run og en resumabel import, en
selvbeskrivende exit-eksport og en cutover-/rollback-procedure med menneskelig
pilotgodkendelse.

## Kilder og valgt format

| Pilotapp | Produkt | Valgt kildeformat | Entitetstyper |
| --- | --- | --- | --- |
| files | Nextcloud | `nextcloud-export-bundle@1` | File, Folder |
| projects | OpenProject | `openproject-api-v3-json@1` | Project, WorkPackage |
| knowledge | BookStack | `bookstack-content-export@1` | Page |
| support | Zammad | `zammad-ticket-archive@1` | Ticket |
| crm | EspoCRM | `espocrm-rest-json@1` | Contact |

Hvert format er maskinlæsbart, dokumenteret (`docs/migration/exit-export.md`) og
kan læses uden en aktiv DkCompany-installation (`format.readableWithoutPlatform`).
Kilden beskriver desuden relationen til upstream (`systemOfRecord: upstream`),
et ejerskabsfelt, en standardejer, roller, dedup-nøgler og retention.

## Dækningsmatrix

For hver app/entitet/facet beregnes en status:

- `full` — feltet mappes direkte.
- `partial` — feltet mappes, men en del af betydningen går tabt (fx
  @-mention-metadata på en kommentar).
- `unsupported` — feltet findes ikke i kilden eller overføres ikke.

Enhver ikke-fuld facet **skal** have en forklaring og optræder i
`coverage.lostFunctionality`, så tabt funktionalitet vises **før** cutover.
Facetterne er: `ownership`, `timestamps`, `comments`, `attachments`, `acl` og
`links`.

## Dry-run, mapping og import

1. **Dry-run** (`migration/src/import.mjs` → `dryRun`): mapper hvert objekt,
   klassificerer det (create/update/conflict/fejl) og afstemmer antal og
   checksums. Den skriver intet.
2. **Mapping** (`migration/src/mapping.mjs`): mappet er drevet af de erklærede
   facetter. En `unsupported` facet efterlader feltet tomt — der fabrikeres
   aldrig data.
3. **Dedup** (`migration/src/dedup.mjs`): nøglen beregnes tenantafgrænset ud fra
   kildens identitetsfelter. To objekter med samme forretningsidentitet bliver
   en **konflikt** og flettes aldrig automatisk (DKC-043's
   `assertStorageDedupAllowed`).
4. **Resumabel import** (`importBatch`): importen gemmer et checkpoint. Et
   afbrudt forløb genoptages uden at gentage allerede importerede objekter, og
   et retry er idempotent på en idempotency-nøgle. En fejlliste føres pr. kilde.

Den stabile reference er `mig:<tenant>:<app>:<entityType>:<sourceObjectId>`
(`migration/src/references.mjs`). En tværtenant-reference afvises fail-closed.

## Exit-eksport

`buildExport` + `writeExport` skriver en selvbeskrivende pakke:

- `records.jsonl` — én post pr. linje med alle seks facetter.
- `records.csv` — samme poster som CSV.
- `manifest.json` — antal, checksum og hver fils SHA-256.
- `README.md` og `read-export.mjs` — et standalone læse-script, der kun bruger
  Nodes indbyggede moduler, så eksporten kan læses og verificeres uden
  platformen.

## Cutover og rollback

En cutover kræver:

1. en import-afstemning hvor antal og checksums matcher og fejllisten er tom,
2. at den tabte funktionalitet er kendt og vist,
3. en pilotgodkendelse fra et navngivet menneske af **både indhold og
   adgangsrettigheder** (og ikke fra den der udførte migrationen), og
4. en dokumenteret rollback til et snapshot taget før cutover.

`executeCutover` tager snapshot **før** overgangen; `rollbackCutover` gendanner
poster, ACL og rettigheder.

## Adgang

Adgang er default-deny og tenantadskilt (`migration/src/permissions.mjs`). En
læserolle må læse og eksportere, men ikke importere eller cutover. En principal
kan ikke handle på en anden tenants data uden en eksplicit platform-scope.

## Checks

- `make migration-check` — skema + semantik for kilder, politik, dækning og
  scenarier.
- `make migration-test` — unit- og konformanstests.
- `make migration-run` — den deterministiske kontrol.
- `make migration-render` / `make migration-report` — rapporten.

En faktisk målt migration fra en levende pilotkilde, en rigtig cutover og en
menneskelig pilotgodkendelse kræver ekstern infrastruktur og er **NOT RUN**
(`make migration-live`).
