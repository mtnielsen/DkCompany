# Runbook — HA-failover

Formål: håndtere tab af ét kontrolplansmedlem eller én server sikkert, og skelne
frivillig drain fra et hårdt nedbrud.

## Forudsætninger

- Klyngen har tre quorum-medlemmer i adskilte fejldomæner (se
  `infrastructure/ha-plan.json`).
- Mindst to sunde ingress-endpoints og to DNS-mål.
- En navngivet incident commander og den aftalte failover-frist.

## Frivillig drain

1. Bekræft at de øvrige medlemmer har quorum, og at N+1-kapaciteten holder.
2. Cordon medlemmet, og drain med respekt for disruption budgets.
3. Bekræft at workloads er flyttet, og at ingen writes er tabt.
4. Følg op med en ny quorum-kontrol.

## Hårdt servernedbrud

1. Bekræft at quorum stadig er intakt; er det ikke, må der **ikke** skrives.
2. Lad ledervalget genoprette en ny leder; bekræft at der kun er én.
3. Genstart de mistede workloads og verificér data-integriteten.

Ved quorumtab: stop nye writes, eskalér til security-owner, og genopret quorum
før skrivning genoptages. Der findes ingen vej til usikre writes.

## Bevis

`make ha-drill` simulerer begge forløb deterministisk. Simuleringen er **ikke**
en måling (`measured: false`). En rigtig failover-øvelse skal dokumenteres med
målt overtagelsestid og er i dette miljø NOT RUN (`integration-ha-failover`).
Faktisk netværksafvisning af krydskunde-trafik er ligeledes NOT RUN.
