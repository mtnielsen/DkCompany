# Runbook — katastrofegendannelse (DKC-042)

> Brug denne runbook når hele primærmiljøet er tabt eller kompromitteret.
> Formålet er at genoprette hele kundepakken i et isoleret miljø og måle RPO/RTO
> for det samlede brugerflow — ikke kun databaseopstart.

## Forudsætninger

- Den kanoniske plan er `backup/dr/disaster-recovery-plan.json`, og
  recovery-adgangen er `backup/dr/recovery-access-profile.json`.
- Recovery-adgangen er **ikke** stående. Den aktiveres af et verificeret
  menneske med to-personers godkendelse og maksimal varighed.
- Primærklyngens driftscredentials kan ikke slette beskyttede backups. Forsøg
  afvises og logges.

## 0. Beslut og dokumentér

1. Bekræft hændelsen og beslut, at det isolerede recovery-miljø skal aktiveres.
2. Udpeg to forskellige, navngivne godkendere. Udføreren må ikke selv godkende.
3. Vælg det **kendte rene restorepunkt** (`knownCleanPoint`) eller et tidligere
   tidspunkt inden for recovery-vinduet.
4. Registrér beslutningen i revisionssporet.

## 1. Aktivér recovery-adgangen

```bash
node backup/src/dr/cli.mjs write   # bekræft at planen er i sync
make dr-check
```

Aktiveringen kræver den separate recovery-identitet. Primærklyngens
driftscredentials afvises.

## 2. Genopret databasen med PITR

1. Vælg base-backup og WAL-segmenter for det valgte tidspunkt.
2. Afspil WAL på en kopi af base-backup'en — ikke hen over primærtilstanden.
3. Afstem data (rækkeantal/digest) og ACL (subject → rolle).
4. Stop hvis ACL afviger, hvis WAL-kæden er brudt, eller hvis tidspunktet ligger
   uden for recovery-vinduet. Rapportér ærligt.

```bash
make dr-drill
```

## 3. Genopret IAM, DNS og secret-store

| Afhængighed | Kilde | Handling |
| --- | --- | --- |
| IAM | identitetstabellen fra PITR | gendan og genopbyg trust til det isolerede miljø |
| DNS | den gendannede konfiguration | genopbyg zonen og genudsted |
| secret-store | det separate nøglemagasin (KMS) | gendan nøgler og genudsted workloads' secrets |
| object storage | offsite/offline kopi | gendan versioner og bevar låse/adgangsregler |

Konfiguration og objekter gendannes fra den krypterede beholder. Nøglen kommer
fra det separate magasin — aldrig fra backup-lageret.

## 4. Anvend slettejournalen

Anvend suppressionsjournalen, så persondata slettet efter backupens
skæringstidspunkt ikke genindføres. Verificér at journalen er intakt og at det
pinnede hoved findes.

## 5. Kør funktionelle checks

- databaseintegritet,
- hash-kæden i audit-loggen,
- tenant-afgrænsning,
- ACL-afstemning, og
- det samlede brugerflow (log ind → godkend → udfør → audit).

## 6. Mål og rapportér

`make dr-drill` udskriver:

- RTO for det samlede brugerflow og for database alene,
- RPO for det valgte tidspunkt,
- hvilke afhængigheder der blev genoprettet, og
- om gaten er `pass` eller `blocked` med en begrundelse pr. afvigelse.

En `blocked`-gate må ikke omgås. Afvigelser skal udbedres eller accepteres
eksplicit med en dokumenteret begrundelse og en navngiven ejer.

## 7. Failback

1. Fence den gamle primary og bekræft et monotont epoch.
2. Rejoin og indhent WAL på den tidligere primary.
3. Verificér checksums og ACL før promotion.
4. Planlæg switchover i vedligeholdelsesvinduet.

## Miljøgrænse

Den lokale øvelse kører rigtigt mod SQLite og et rigtigt WORM-lager. En målt
øvelse på en levende PostgreSQL-klynge og eksterne object stores er
`integration-dr-live` og **NOT RUN** her; den kræver et navngivet menneskes
godkendelse og skal gennemføres i det rigtige miljø.
