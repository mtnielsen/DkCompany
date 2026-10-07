# ADR-0046 — Database-HA med fencing, synkron quorum-commit og konsistent failover

- **Status:** accepteret
- **Beslutningstagere:** Platform Owner, Security Owner
- **Dato:** 2026-09-25
- **Beslutningsdrev:** DKC-039. ADR-0031 fastslog, at platformen ikke driver sin egen databaseengine, og DKC-056 indførte managed/BYO-databaseprofiler. ADR-0044 gjorde HA-klyngen konkret for kontrolplan og workloads. Det mangler at gøre selve databasen HA: en bekræftet transaktion må ikke kunne forsvinde, og en partition må ikke give to skrivere.

## Kontekst og problemstilling

En database uden en eksplicit replikerings- og durability-politik kan:

- bekræfte en write til kalderen og derefter tabe den, hvis kun primary'en
  skrev,
- skifte tavst til asynkron replikering når en sync-replika forsvinder,
- give to konkurrerende primary'er efter en netværkspartition, og
- betjene godkendelser eller policy-læsning fra en forældet replica.

En databaseprofil med `serviceTier: high-availability` er kun en forpligtelse.
Uden en konkret topologi, en sync-politik, fencing og read-consistency pr. flow
kan forpligtelsen ikke opfyldes.

## Beslutningskriterier

- En vedligeholdt operator/failover-controller skal være valgt.
- Mindst tre stemmeberettigede instanser i adskilte fejldomæner.
- Kritiske writes bekræftes synkront til quorum; ingen tavs async-overgang.
- Tab af en nødvendig sync-replika stopper writes.
- Den tidligere primary fences før promotion; usikker promotion er forbudt.
- Godkendelser læses kun fra primary.
- WAL arkiveres med PITR, og failback/rejoin kræver fence og checksum.

## Overvejede muligheder

- **A:** Støt på databaseprofilens HA-markering uden en konkret replikeringsplan.
- **B:** Brug asynkron replikering og accepter et lille datatab ved failover.
- **C:** En konkret plan med synkron quorum-commit, monotont fencing-token,
  read-consistency pr. flow, WAL/PITR og en deterministisk, ærligt mærket
  failover-simulering.

## Beslutning

Vi indfører (C). `persistence/ha-plan.json` er den kanoniske plan,
`contracts/database-ha.schema.json` beskriver formen, `persistence/src/ha.mjs`
og `conformance/src/database-ha.mjs` håndhæver beslutningerne, og
`persistence/src/replication.mjs` implementerer sync-quorum, commitkvitteringer,
fencing, partition og rejoin. `persistence/src/ha-render.mjs` genererer
`gitops/manifests/db-ha/` med den krævede CloudNativePG-konfiguration.

### Konsekvenser

- **Positive:** Bekræftede transaktioner har en kvittering og findes efter
  failover; partitioner giver højst én autoritativ skriver; godkendelser kan
  ikke læses fra en forældet replica; rejoin og schemaopgradering er testbare.
- **Negative:** Der findes ingen levende PostgreSQL/operator i dette miljø. En
  målt failover og en faktisk WAL-arkivering (`integration-db-failover`) er
  NOT RUN.
- **Neutrale:** Simuleringen er deterministisk og bærer `measured: false`.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Ingen ekstra konfiguration | HA forbliver en etiket uden replikeringsgaranti |
| B | Højere skriveydelse | Bekræftede writes kan gå tabt; ingen stærk læsning |
| C | Holdbart, fenced og testbart | Kræver vedligeholdt operator og en rigtig motor for fuld effekt |

## Mere information

- [ADR-0031 — Indbyggede og eksterne datatjenester med entydigt ejerskab](0031-indbyggede-og-eksterne-datatjenester.md)
- [ADR-0044 — HA-klynge og sikker kommunikation mellem servere](0044-ha-klynge-og-sikker-serverkommunikation.md)
- [Spec: database-HA](../spec/database-ha.md)
- [Runbook: database-failover](../runbooks/database-failover.md)
