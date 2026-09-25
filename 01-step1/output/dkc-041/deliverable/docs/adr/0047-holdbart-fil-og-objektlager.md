# ADR-0047 — Holdbart fil- og objektlager med quorum, checksums og scrub/repair

- **Status:** accepteret
- **Beslutningstagere:** Platform Owner, Security Owner
- **Dato:** 2026-09-26
- **Beslutningsdrev:** DKC-041. ADR-0031 fastslog, at platformen ikke driver sin egen databaseengine, og ADR-0046 gjorde databasen HA. Men kundedata i filer og objekter kan stadig være bundet til den container eller server, der behandlede dem, og en diskfejl eller en bit-flip kan ændre autoritative data uden at blive opdaget.

## Kontekst og problemstilling

Et lager uden en eksplicit fejlmodel og quorum-politik kan:

- binde kundedata til den lokale container-disk, så en flytning eller et host-tab
  gør dem utilgængelige eller ufuldstændige,
- bekræfte en write der kun nåede én disk, og derefter tabe den ved en diskfejl,
- gemme en tavst korrupt blok uden at nogen opdager det, fordi der ikke findes en
  checksum,
- blande autoritative data med cache og genopbyggelige indeks, så et cache-tab
  ødelægger data,
- bruge én fælles nøgle til alle kunder, så én kompromitteret nøgle åbner alt.

Tre hosts i tre fejldomæner, et synkront skrive-quorum, versionsstyrede checksums,
scrub/repair og kundeafgrænsede nøgler er tilsammen svaret.

## Beslutningskriterier

- Et vedligeholdt CSI- og objektlager med dokumenteret fejlmodel skal være valgt.
- Mindst tre hosts i adskilte fejldomæner, og quorum skal være et flertal.
- En write bekræftes kun ved skrive-quorum; quorumtab må ikke give usikre writes.
- Objekter versionsstyres med en sha256-checksum ved skrivning og læsning.
- Scrub skal opdage silent corruption og reparere fra en sund replika eller parity.
- Ingen nødvendig tilstand på ephemeral disk; cache og indeks skal kunne genopbygges.
- Nøgler skal være kundeafgrænsede og ligge uden for lageret.
- En workload skal kunne flyttes til en anden server med samme filer og rettigheder.

## Overvejede muligheder

- **A:** Behold kundedata på den lokale container-disk og tag backup.
- **B:** Brug et enkelt replikeret lager uden checksums og uden quorum.
- **C:** En konkret plan med et vedligeholdt CSI-/objektlager, tre hosts i tre
  fejldomæner, synkront skrive-quorum, versionsstyrede checksums, scrub/repair,
  kundeafgrænsede nøgler og en ærligt mærket deterministisk holdbarhedsøvelse.

## Beslutning

Vi indfører (C). `storage/storage-plan.json` er den kanoniske plan,
`contracts/storage-plan.schema.json` beskriver formen, `storage/src/plan.mjs`
og `conformance/src/storage.mjs` håndhæver beslutningerne, og
`storage/src/object-store.mjs` implementerer et replikeret, versionsstyret lager
over et rigtigt filsystem. `storage/src/render.mjs` genererer
`gitops/manifests/storage/` med CSI-StorageClass, objektlager-bucket,
default-deny-netværk, scrub-CronJob og kapacitetsalarmer.

### Konsekvenser

- **Positive:** En bekræftet write findes på et quorum; silent corruption opdages
  og repareres; cache og indeks kan smides væk uden at røre autoritative data;
  nøgler er kundeafgrænsede; en workload kan flyttes uden datatab.
- **Negative:** Der findes ingen levende CSI-driver eller S3-kompatibelt
  objektlager i dette miljø. En målt host-/diskfejl og en faktisk rebalance er
  `integration-storage-live` og er NOT RUN.
- **Neutrale:** Holdbarhedsøvelsen er deterministisk og bærer `measured: false`.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Ingen ekstra infrastruktur | Data bundet til containeren; tavs korruption opdages ikke |
| B | Højere skriveydelse | Bekræftede writes kan gå tabt; cache og data blandes |
| C | Holdbart, quorum-bekræftet og testbart | Kræver vedligeholdt CSI/objektlager for fuld effekt |

## Mere information

- [ADR-0019 — Holdbar tilstand med versionerede migrationer og adskilte databaseidentiteter](0019-holdbar-tilstand-og-migrationer.md)
- [ADR-0031 — Indbyggede og eksterne datatjenester med entydigt ejerskab](0031-indbyggede-og-eksterne-datatjenester.md)
- [ADR-0039 — Krypteret backup med separat nøgleadgang](0039-krypteret-backup-og-gendannelsesoevelse.md)
- [ADR-0046 — Database-HA med fencing, synkron quorum-commit og konsistent failover](0046-database-ha-med-fencing-og-konsistent-failover.md)
- [Spec: holdbart fil- og objektlager](../spec/storage.md)
- [Runbook: storage scrub og repair](../runbooks/storage-scrub-repair.md)
