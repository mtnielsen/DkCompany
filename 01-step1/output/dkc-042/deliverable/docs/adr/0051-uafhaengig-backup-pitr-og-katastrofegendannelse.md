# ADR-0051 — Uafhængig backup, PITR og katastrofegendannelse efter 3-2-1-1-0

- **Status:** accepteret
- **Beslutningstagere:** Platform Owner, Continuity Officer, Security Owner
- **Dato:** 2026-09-28
- **Beslutningsdrev:** DKC-042. ADR-0039 gav en krypteret backup med separat nøgleadgang og en gendannelsesøvelse, ADR-0040 gjorde eksterne backupmål testbare, ADR-0046 gav database-HA med WAL/PITR, og ADR-0048/0049 gjorde WORM og sletning fysisk. Det mangler at kunne gendanne **hele** kundepakken efter tabet eller kompromitteringen af hele primærmiljøet — uden at primærklyngens egne driftscredentials kan slette historikken.

## Kontekst og problemstilling

Backup findes, men den er ikke uafhængig af primærmiljøet:

- der er ingen samlet 3-2-1-1-0-garanti for antal kopier, medier, ekstern kopi,
  offline/immutable kopi og verificeret restore,
- et natligt snapshot alene beviser ikke punktgenopretning; der mangler en
  applikationskonsistent WAL-kæde og en afstemning af data **og** adgangsregler,
- backup- og recovery-adgangen er ikke entydigt adskilt fra primærklyngens
  driftscredentials, så et kompromitteret driftscredentials kan røre historikken,
- der findes intet isoleret recovery-miljø, intet kendt rent restorepunkt og
  ingen planlagt, fence-krævende failback, og
- RPO/RTO måles kun for databaseopstart, ikke for det samlede brugerflow med
  IAM, DNS og secret-store.

En backup der deler skæbne og credentials med det, den skal redde, er ikke en
uafhængig backup.

## Beslutningskriterier

- 3-2-1-1-0 skal være et håndhævet driftsprincip, ikke et løst dokument.
- Primærklyngens driftscredentials må ikke kunne slette beskyttede backups —
  hverken direkte eller gennem en indirekte rolle.
- PITR skal ramme et valgt tidspunkt og afstemme både data og ACL.
- Recovery-adgangen skal være adskilt, kun kunne aktiveres af et verificeret
  menneske med to-personers godkendelse og tidsbegrænsning, uden stående adgang.
- Recovery-miljøet skal være isoleret og genoprette IAM, DNS og secret-store fra
  backup uden en fungerende primærklynge.
- Slettejournalen skal være append-only og hash-kædet, og failback skal være
  planlagt og kræve fence.
- RPO/RTO skal måles for det **samlede** brugerflow.

## Overvejede muligheder

- **A: Flere kopier af det eksisterende snapshot på samme konto.** Billigt, men
  deler fejl- og adgangsdomæne og credentials med primæret, så et
  ransomware- eller insiderangreb rammer alle kopier.
- **B: En ekstern managed backup-tjeneste alene.** Giver ekstern kopi, men
  beviser ikke applikationskonsistens, PITR, ACL-afstemning eller at
  primærdriften ikke kan slette historikken.
- **C: En DR-plan som kanonisk data plus et selvstændigt DR-lag oven på det
  rigtige backup-, WORM- og PITR-lager.** Flere komponenter, men hver
  acceptkriterium bliver efterprøvelig, og primærklyngens credentials forbliver
  adskilt fra historikken.

## Beslutning

Vi vælger **C**. `backup/dr/disaster-recovery-plan.json` er den kanoniske plan,
og `backup/src/dr/` implementerer:

1. **3-2-1-1-0** (`plan.mjs`): mindst tre kopier på mindst to medier, én ekstern
   og én offline/immutable kopi i adskilte fejl-/adgangsdomæner samt mindst én
   verificeret restore. Den deklarerede tælling skal stemme med de faktiske
   kopier.
2. **Primærklyngens grænse** (`access.mjs`): primærklyngens driftscredentials
   afvises altid ved sletning af en beskyttet backup; en tilladt sletning kræver
   to forskellige, navngivne godkendere, og det rigtige lager afviser den
   derefter mekanisk via COMPLIANCE-låsen (ADR-0048).
3. **Applikationskonsistent PITR** (`pitr.mjs`): en hash-kædet WAL-strøm vælges
   inden for recovery-vinduet, afspilles på en rigtig SQLite-kopi, og data og
   ACL afstemmes. Et snapshot alene er ikke bevis.
4. **Separat recovery-identitet** (`recovery-access-profile.json`,
   `access.mjs`): kun et verificeret menneske, to-personers godkendelse,
   tidsbegrænsning, ingen stående adgang, og nøgler/konfiguration/katalog/images
   holdes uden for backup-lageret og pinnes på digest.
5. **Isoleret recovery-miljø og kendt rent punkt** (`drill.mjs`): et
   netværksisoleret miljø uden afhængighed af den primære klynge genopretter
   IAM, DNS og secret-store fra backupen, anvender slettejournalen og måler
   RPO/RTO for det samlede brugerflow.
6. **Planlagt failback** (`plan.mjs`): en dokumenteret, fence-krævende
   failback-procedure med rejoin og checksum-verifikation.

### Konsekvenser

- **Positive:** Hele kundepakken kan genoprettes uden primærklyngen; et
  kompromitteret driftscredentials kan ikke slette historikken; PITR, data og
  ACL er efterprøvelige; og RPO/RTO dækker brugerflowet.
- **Negative:** Flere kopier og et ekstra recovery-miljø koster lager, båndbredde
  og drift; cloud-scenariet accepterer højere omkostninger for at holde
  fejldomæner adskilte.
- **Neutrale:** Den lokale PITR- og DR-øvelse er en deterministisk model på
  SQLite; en målt øvelse på en levende PostgreSQL-klynge forbliver en
  integrationsopgave.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | | |
| B | | |
| C | | |

## Mere information

- [`docs/spec/disaster-recovery.md`](../spec/disaster-recovery.md)
- [`docs/runbooks/disaster-recovery.md`](../runbooks/disaster-recovery.md)
- [`docs/continuity/dr-plan.md`](../continuity/dr-plan.md)
- ADR-0039, ADR-0040, ADR-0046, ADR-0048, ADR-0049
