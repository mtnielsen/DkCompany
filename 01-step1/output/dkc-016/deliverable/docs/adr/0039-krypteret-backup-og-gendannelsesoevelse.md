# ADR-0039 — Krypteret backup med separat nøgleadgang og en gennemført gendannelsesøvelse

- **Status:** accepteret
- **Beslutningstagere:** Platform Owner, Kontinuitetsansvarlig
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-008 gav en verificeret backup/restore af databasen, og DKC-037 gav serviceklasser med RPO/RTO-mål. Der manglede en krypteret backup af database, objekter og konfiguration med **separat nøgleadgang**, en **isoleret gendannelsesøvelse** med målt RPO/RTO og en kontrol af, at slettede persondata ikke genindføres ved en restore.

## Kontekst og problemstilling

En backup er værdiløs som driftsevidens, hvis den ikke kan gendannes, hvis
nøglen ligger sammen med backupen, eller hvis et øjebliksbillede fra før en
sletning genindfører persondata. DKC-008's `persistence/src/backup.mjs` tager en
konsistent SQLite-snapshot og verificerer rækkeantal, men den dækker kun
databasen, den er ikke krypteret, og den har ingen forestilling om sletninger
eller målte RPO/RTO.

## Beslutningskriterier

- Database, objekter og nødvendig konfiguration skal kunne gendannes sammen.
- Krypteringsnøglen skal ligge i et **andet** magasin end backupen.
- Gendannelsen skal ske i et **isoleret** miljø og verificeres med checksums og
  funktionelle checks.
- Persondata slettet efter backupen må ikke genindføres ukontrolleret.
- Tid og datatab skal **måles**, og afvigelser skal spærre pilotrelease.

## Overvejede muligheder

- **A:** Udvide `persistence/src/backup.mjs` med kryptering og lade
  gendannelsen skrive hen over den kørende database.
- **B:** Overlade backup til en ekstern managed tjeneste uden lokal
  efterprøvning.
- **C:** Et selvstændigt `backup/`-modul med AES-256-GCM pr. komponent, en
  nøgleprovider uden for lageret, en append-only suppressionsjournal og en målt
  gendannelsesøvelse med en eksplicit gate.

## Beslutning

Vi indfører (C). Modulet [`backup/`](../../backup) krypterer hver komponent
(database, objekter, konfiguration) særskilt med AES-256-GCM og AAD-binding til
backup-id, komponenttype og navn. `manifest.json` bærer checksums, men aldrig
nøglen; nøglen leveres af en provider hvis `keyPath` ligger uden for
backup-lageret. Gendannelsen skriver til en **tom, isoleret** mappe, verificerer
databasens integritet og kører funktionelle checks på hash-kæden,
tenant-afgrænsningen og — når den findes — det eksterne checkpoint.

Suppressionsjournalen ligger uden for backupen, er append-only og hash-kædet, og
manifestet pinner dens hoved. Ved gendannelse anvendes kun poster nyere end
backupens skæringstidspunkt, så en sletning efter backupen ikke fortrydes. En
trunkeret journal afvises.

`backup/src/drill.mjs` måler RTO (gendannelsestid) og RPO (afstand mellem sidste
committede skrivning og backupens skæringstid) og sætter `gate.status` til
`blocked` ved enhver afvigelse. Kontrakterne
[`contracts/backup-manifest.schema.json`](../../contracts/backup-manifest.schema.json)
og [`contracts/restore-drill.schema.json`](../../contracts/restore-drill.schema.json)
håndhæver formen, og `conformance/src/backup.mjs` håndhæver beslutningerne.

### Konsekvenser

- **Positive:** Backupen er krypteret og nøglen adskilt; gendannelsen er
  isoleret og verificeret; sletninger overlever en restore; RPO/RTO er målt og
  spærrer release ved afvigelse.
- **Negative:** En produktionsøvelse med tab af den primære database kræver en
  levende klynge og et navngivet menneskes godkendelse og kan ikke udledes af en
  lokal kørsel.
- **Neutrale:** `persistence/src/backup.mjs` bevares uændret og genbruges til
  selve SQLite-snapshotet.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Lille ændring | Nøgle nær data, ingen objekt-/konfigurationsbackup, overskriver drift |
| B | Drift outsourcet | Ingen lokal efterprøvning, ingen sletningskontrol |
| C | Krypteret, adskilt, isoleret, målbar og privatlivsbevarende | Kræver nøgleprovider og en produktionsøvelse uden for miljøet |

## Mere information

- `docs/spec/backup-restore.md`
- `docs/runbooks/backup-restore.md`
- `backup/`, `persistence/src/backup.mjs`, `persistence/src/checkpoint.mjs`
- `contracts/backup-manifest.schema.json`, `contracts/restore-drill.schema.json`
- ADR-0019 (holdbar tilstand), ADR-0021 (holdbar audit), ADR-0026
  (fejldomæner og recovery), ADR-0037 (serviceklasser)
