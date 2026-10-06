# ADR-0044 — HA-klynge og sikker kommunikation mellem servere

- **Status:** accepteret
- **Beslutningstagere:** Platform Owner, Security Owner
- **Dato:** 2026-09-24
- **Beslutningsdrev:** DKC-038. ADR-0026 fastlagde, at HA kræver mindst tre fejldomæner, N+1 og en særskilt recovery-lokation. Men en serviceklasse er kun en forpligtelse; uden en konkret kontrolplan, replikerede workloads og håndhævet netværkspolitik kan klyngen ikke faktisk fortsætte ved tab af én server.

## Kontekst og problemstilling

`ha-cluster`-profilen er erklæret, og serviceklasserne kræver tre fejldomæner. Det
mangler at gøre profilen konkret:

- kontrolplanen skal have tre quorum-medlemmer i adskilte fejldomæner,
- ingress og DNS skal have mindst to uafhængige mål,
- stateless-tjenester skal replikeres med probes, topology spread, disruption
  budgets og ressourcegrænser,
- stateful workloads skal have en eksplicit skrive-/recovery-plan,
- kommunikation mellem servere skal bruge mTLS med rotation, og
- trafik mellem uautoriserede tenants skal afvises af en default-deny-politik.

En konfiguration må ikke certificere et målt niveau, og en simuleret failover er
ikke en målt failover.

## Beslutningskriterier

- Mindst tre quorum-medlemmer i hver sit fejldomæne.
- Quorumtab giver hverken leder eller writes.
- N+1-kapacitet, så ét domæne kan tages ud.
- Redundant ingress og DNS.
- Probes, spread, disruption budgets og grænser for stateless workloads.
- Eksplicit stateful-plan og ekstern recovery-lokation.
- mTLS, automatisk rotation og default-deny.
- Frivillig drain og hårdt nedbrud testes separat.

## Overvejede muligheder

- **A:** Kald klyngen HA ud fra serviceklasserne alene.
- **B:** Antag at alle apps kan replikeres og køre multi-writer.
- **C:** En konkret HA-plan med tre quorum-medlemmer, replikerede workloads,
  mTLS/netværkspolitik, N+1 og en deterministisk, ærligt mærket simulering.

## Beslutning

Vi indfører (C). `infrastructure/ha-plan.json` er den kanoniske plan,
`contracts/ha-cluster.schema.json` beskriver formen, `conformance/src/ha.mjs`
håndhæver beslutningerne, og `infrastructure/src/ha.mjs` beregner quorum, N+1 og
failover-adfærd. `infrastructure/src/ha-render.mjs` genererer
`gitops/manifests/ha/` med de krævede HA-felter.

### Konsekvenser

- **Positive:** HA bliver en konkret, testbar topologi; quorum- og
  netværksregler håndhæves maskinelt; drain og hårdt nedbrud er adskilte forløb.
- **Negative:** Der findes ingen levende klynge i dette miljø. En målt failover
  (`integration-ha-failover`) og faktisk netværksafvisning
  (`integration-network-policy-plugin`) er NOT RUN.
- **Neutrale:** Simuleringen er deterministisk og bærer `measured: false`.

## Fordele og ulemper ved mulighederne

- **A** er billig, men gør HA til en etiket uden kontrolplan eller replikaer.
- **B** antager multi-writer, som de fleste stateful apps ikke understøtter.
- **C** gør HA målbart og ærligt, men kræver vedligeholdelse af plan og
  manifester.
