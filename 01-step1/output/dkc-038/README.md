# DKC-038 — HA-klynge og sikker kommunikation mellem servere

Kumulativ overlay oven på DKC-001..DKC-060. Lægges med `./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73`
- **Undersøgt checkout:** `83ad91a`
- **Forudsætninger:** DKC-015 og DKC-037 — verificeret til stede i den anvendte
  stak. Overlayen kæder `dkc-060/apply.sh` (→ `dkc-066/apply.sh` → … → DKC-001).
- **Node:** v22.22.1

## Implementeret adfærd

DKC-038 gør `ha-cluster`-profilen konkret som en maskinelt kontrolleret topologi.

1. **Kontrolplan og quorum** (`infrastructure/ha-plan.json`,
   `infrastructure/src/ha.mjs`): tre quorum-medlemmer i hver sit fejldomæne,
   mindst to leder-kandidater, quorum = flertal. `assessQuorum` beviser, at ét
   tab bevarer quorum og writes, mens to tab afviser writes og ingen leder
   vælger; usikre writes er strukturelt umulige.
2. **Redundant ingress og DNS:** mindst to replikaer, to fejldomæner, to sunde
   endpoints og mindst to DNS-mål; `round-robin` uden sundhedstjek afvises.
3. **Workload-HA:** stateless-tjenester har mindst to replikaer,
   startup/readiness/liveness, `topologySpreadConstraints` med
   `DoNotSchedule`, et disruption budget og ressourcegrænser. Stateful workloads
   har en eksplicit `statefulPlan` med `writeMode`, `activeWriters`,
   `upstreamSupportsMultiWriter`, `nPlusOne` og en `recoveryLocation` uden for
   de primære fejldomæner.
4. **Sikker kommunikation:** mTLS er obligatorisk med `spiffe`-peer-identitet og
   automatisk rotation inden for 90 dage; netværkspolitikken er default-deny og
   kræver `default-deny` og `allow-internal`, med en Cilium-politik der afviser
   krydskunde-trafik.
5. **N+1-kapacitet:** `capacityAfterLoss` beviser, at ét fejldomæne kan tages
   ud, og at to ikke kan.
6. **Deterministisk failover-simulering:** `voluntaryDrain` og `hardCrash` er
   separate forløb; `runFailoverDrill` bærer `measured: false`, så et design
   ikke forveksles med en måling.
7. **Renderede manifester** (`gitops/manifests/ha/`, 24 filer) med
   probes/spread/PDB/grænser, mTLS-annoteringer, default-deny og
   ingress-controller-redundans; `ha-check` holder plan og manifester i sync.
8. **Krydsvalidering mod DKC-037:** `haServiceClassProblems` kræver, at planen
   dækker de HA-egnede serviceklassers fejldomæner, N+1, replikaer og writeMode.

## Ændrede og nye filer

Se `evidence/deliverable-files.txt` (47 filer). Hovedgrupper:

- `infrastructure/ha-plan.json`, `infrastructure/src/{ha,ha-render,ha-cli}.mjs`,
  `infrastructure/test/ha.test.mjs`.
- `gitops/manifests/ha/` — 24 genererede manifester.
- `contracts/ha-cluster.schema.json` + `contracts/examples/ha-cluster.example.json`,
  `conformance/src/ha.mjs`, `conformance/test/ha-conformance.test.mjs`,
  `conformance/src/schemas.mjs`, `conformance/src/validate-schemas.mjs`.
- `Makefile` (`ha-render/-check/-test/-drill` + `ci`),
  `tools/baseline/registry.mjs` (komponent + 5 checks).
- `release/matrix/test-matrix.json` (1.13.0, `REQ-HA-001`),
  `release/matrix/threats.json` (2 trusler), `docs/testing/test-matrix.md`,
  `docs/security/threat-model.md`.
- `docs/adr/0044-…`, `docs/adr/README.md`, `docs/spec/ha-cluster.md`,
  `docs/spec/README.md`, `docs/runbooks/ha-failover.md`,
  `docs/status/implementation-matrix.md`.

## Testkommandoer og resultater

| Kommando | Resultat |
|---|---|
| `node conformance/src/validate-schemas.mjs` | PASS |
| `node conformance/src/lint.mjs` | PASS |
| `make ha-check` | PASS |
| `make ha-test` | PASS (14 HA-tests + 8 konformanstests) |
| `make ha-drill` | PASS (drain og hårdt nedbrud separat, `målt=false`) |
| `make infrastructure-check` | PASS |
| `make infrastructure-test` | PASS (47 tests) |
| `make release-check` | PASS (36 krav, matrixversion 1.13.0) |
| `make release-test` | PASS |
| `make gitops-test` | PASS |
| `make supply-chain-check` | PASS |
| `make test` | PASS (218 tests) |
| `make baseline` | 106 PASS / 1 FAIL / 28 NOT RUN (135 checks) |

Den ene FAIL er den forud eksisterende `changelog-check` (manglende DCO
sign-off). Den er hverken skjult eller ændret.

## Acceptkriterier

| Kriterium | Status | Bevis |
|---|---|---|
| En server slukkes: øvrige servere overtager inden vedtaget servicemål | **NOT RUN** (målt) | `ha-drill` simulerer overtagelsen deterministisk og bekræfter quorum/N+1; en faktisk måling kræver en levende klynge (`integration-ha-failover`) |
| Quorumtab tillader ikke konkurrerende ledere eller usikre writes | **PASS** | `infrastructure/test/ha.test.mjs` + `conformance/test/ha-conformance.test.mjs`: to af tre nede → ingen leder, writes afvist, `unsafeWrites=false` |
| Trafik mellem uautoriserede tenants afvises af faktisk netværksplugin | **NOT RUN** (faktisk plugin) | Default-deny + `cross-tenant-deny` er strukturelt valideret (`ha-check`, `netpol.mjs`); faktisk Cilium/Calico-håndhævelse er `integration-network-policy-plugin` (NOT RUN) |
| Tab af én ingress-/DNS-instans giver ikke totalt udfald | **PASS** (redundansdesign) | `haClusterProblems` afviser <2 ingress-replikaer/endpoints/mål; `voluntaryDrain`/`hardCrash` bekræfter, at DNS forbliver redundant. Faktisk udfaldstest er NOT RUN |
| Frivillig drain og hårdt servernedbrud testes separat | **PASS** | Separate funktioner og tests (`voluntaryDrain` vs `hardCrash`) og separat `make ha-drill` |
| N+1-kapacitet og eksplicit plan for stateful workloads | **PASS** | `capacityAfterLoss`, `statefulPlan`-regler og `haServiceClassProblems` |

## Restgrænser

- Ingen levende HA-klynge og ingen kørende netværksplugin i dette miljø; begge
  dele er registreret som `external: true` og NOT RUN med begrundelse.
- Simuleringen er deterministisk og mærket `measured: false`; den er ikke et
  driftsbevis.
- `changelog-check` fejler fortsat (forud eksisterende, DCO sign-off mangler).
- Overlayen erklærer ikke produktionsparathed; kun lokale kontrakt-, autorisations-
  og simulationstests er kørt.
