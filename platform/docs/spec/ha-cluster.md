# HA-klynge og sikker kommunikation mellem servere

DKC-038 gør `ha-cluster`-profilen konkret. `infrastructure/ha-plan.json` er den
kanoniske plan; `conformance/src/ha.mjs` håndhæver den, og
`infrastructure/src/ha-cli.mjs` renderer og simulerer.

## Kontrolplan og quorum

| Felt | Krav |
|---|---|
| `failureDomains` | Mindst tre unikke fejldomæner |
| `controlPlane.members` | Mindst tre medlemmer, fordelt på mindst tre domæner, mindst to leder-kandidater |
| `controlPlane.datastore.quorum` | Mindst `floor(n/2)+1` og højst `n` |
| `controlPlane.datastore.unsafeWritesOnQuorumLoss` | Skal være `false` |

`assessQuorum` beregner quorum-tilstanden: med ét af tre medlemmer nede holdes
quorum, writes tillades, og der vælges højst én leder. Med to nede er der ikke
quorum, writes afvises, og der vælges ingen leder. Der findes ingen vej til
usikre writes eller konkurrerende ledere.

## Redundant ingress og DNS

`ingress.replicas >= 2` og `ingress.failureDomains >= 2`; mindst to sunde
endpoints i mindst to fejldomæner. Hver DNS-post har mindst to mål, og
`minHealthyTargets >= 2`. `round-robin` uden sundhedstjek afvises.

## Workload-HA

- **Stateless:** mindst to replikaer, `startup`/`readiness`/`liveness`,
  `topologySpreadConstraints` med `DoNotSchedule`, et disruption budget og
  ressourcegrænser.
- **Stateful:** en `statefulPlan` med `writeMode`, `activeWriters`,
  `upstreamSupportsMultiWriter`, `nPlusOne` og en `recoveryLocation` uden for de
  primære fejldomæner.

## Kommunikation og netværk

mTLS er obligatorisk (`mtlsRequired: true`), certifikater roteres automatisk
inden for 90 dage, og peer-identiteten er `spiffe`. Netværkspolitikken er
default-deny og kræver mindst `default-deny` og `allow-internal`; planen
understøtter Cilium/Calico. Krydskunde-trafik afvises af en
`CiliumNetworkPolicy` med `ingressDeny`.

## Failover-øvelser

`ha-drill` kører to separate forløb mod ét medlem:

- **Frivillig drain:** cordon og drain, respekterer disruption budgets, intet
  in-flight tab.
- **Hårdt nedbrud:** intet drain, ledervalg, in-flight tab.

Begge simuleres deterministisk. Resultatet bærer `measured: false` og
`requiresLiveMeasurement: true`; en rigtig failover-måling er NOT RUN.

## Kommandoer

```bash
make ha-render   # skriv gitops/manifests/ha fra planen
make ha-check    # plan, semantik, rendering, netværk, serviceklasser
make ha-test     # quorum, N+1, ingress/DNS, mTLS, workloads + konformans
make ha-drill    # frivillig drain og hårdt nedbrud separat
```

## Kendte grænser

- `integration-ha-failover` (målt overtagelse) er NOT RUN: ingen levende klynge.
- `integration-network-policy-plugin` (faktisk Cilium/Calico-håndhævelse) er
  NOT RUN: politikkerne er kun strukturelt valideret.
