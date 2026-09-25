# Exit-eksport og kildeformater

Dette dokument beskriver de valgte kildeformater pr. pilotapp og den
cutover-/rollback-procedure exit bruger. Eksporten er selvbeskrivende og kan
læses uden en aktiv DkCompany-installation.

## Sådan læses en eksport

En eksport er en mappe med:

| Fil | Indhold |
| --- | --- |
| `manifest.json` | `recordCount`, `checksum` (sha256) og hver fils `sha256`. |
| `records.jsonl` | Én post pr. linje; alle seks facetter. |
| `records.csv` | Samme poster som CSV. |
| `read-export.mjs` | Standalone Node-script (kun indbyggede moduler) der verificerer antal og checksum. |
| `README.md` | Kort læsevejledning. |

Verificér:

```sh
node read-export.mjs .
```

## nextcloud

*Valgt format:* `nextcloud-export-bundle@1` (`application/zip+json`).

Nextclouds eksport indeholder filer og mapper med `owner`, `createdAt`/`updatedAt`,
`comments`, `attachments`, delinger (`acl`) og links. Bemærk at **mapper ikke har
kommentarer** i Nextcloud; facetten `Folder.comments` er `unsupported` og vises
som tabt funktionalitet før cutover. Filkommentarer overføres uden
@-mention-metadata (`partial`).

## openproject

*Valgt format:* `openproject-api-v3-json@1` (`application/json`).

OpenProjects API v3-eksport indeholder projekter og arbejdspakker med ansvarlige,
medlemskaber, kommentarer, relationer og vedhæftninger. Vedhæftninger overføres
som referencer til fil-appen (`partial`), fordi selve filen migreres separat.

## bookstack

*Valgt format:* `bookstack-content-export@1` (`application/json`).

BookStacks indholdseksport indeholder bøger, kapitler og sider med ejer,
rettigheder (`restrictions`), kommentarer, bilag og links. Kommentarer overføres
uden redigeringshistorik (`partial`).

## zammad

*Valgt format:* `zammad-ticket-archive@1` (`application/json`).

Zammads ticket-arkiv indeholder tickets med artikler (kommentarer), bilag,
gruppe-ACL og links. Links mellem tickets overføres **ikke** (`unsupported`), og
artikel-niveau-hemmeligholdelse bevares ikke som separat regel (`partial`).

## espocrm

*Valgt format:* `espocrm-rest-json@1` (`application/json`).

EspoCRMs REST-eksport indeholder kontakter (og relaterede entiteter) med
`assignedUser`, aktiviteter (kommentarer), bilag, teams (ACL) og links. Links
overføres som referencer uden forretningslogik (`partial`).

## Cutover

1. Kør en import og afstem antal og checksums (`make migration-run`).
2. Gennemgå den viste tabte funktionalitet.
3. Lad pilotbrugerne godkende indhold og adgangsrettigheder.
4. Tag et snapshot, og gennemfør cutover.
5. Bekræft over for kunden, at eksport er leveret, og at data er afstemt.

## Rollback

1. Stop skrivninger til den nye platform for appen.
2. Gendan butikkens snapshot fra før cutover (poster, ACL og rettigheder).
3. Genåbn den gamle kilde som system-of-record.
4. Registrér rollback og grund i revisionssporet.

Rollback gendanner både poster og rettigheder, fordi snapshot'et tages før
cutover.
