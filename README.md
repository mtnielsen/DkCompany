# Platformskontrakter

Et monorepo for de kontrakter, der gør en fler-modul-platform styrbar og beviselig — og den konformanssuite, der afgør, om et modul må kalde sig kompatibelt.

Udgangspunktet er [BACKLOG.md](BACKLOG.md). Princippet er **kontrakt før implementering, test før moduler, to beviste adaptere før skalering, agenter før dashboards.**

## Status

Bølge 0 er implementeret:

| Punkt | Status | Bevis |
| --- | --- | --- |
| 0.1 Repo-skelet og beslutningslog | ✅ | [`docs/adr`](docs/adr), `make validate`/`make lint`, CI |
| 0.2 Identitetsplan | ✅ | [`contracts/identity.schema.json`](contracts/identity.schema.json), check `C-005` |
| 0.3 Telemetriplan | ✅ | [`contracts/cloud-event.schema.json`](contracts/cloud-event.schema.json), `make telemetry-test` |
| 0.4 Ops-kontrakt (manifest + verber) | ✅ | [`contracts/module-manifest.schema.json`](contracts/module-manifest.schema.json) |
| 0.5 Privacy-verber | ✅ | [`contracts/privacy-request.schema.json`](contracts/privacy-request.schema.json), `make dsar-demo` |
| 0.6 Konformanssuite | ✅ | [`conformance/`](conformance), `make conform MODULE=dummy-ok` |
| 1.1 Policy-plan (PDP) | ✅ | [`policy/pdp`](policy/pdp), checks `C-009`/`C-010`, [ADR-0004](docs/adr/0004-letvaegts-pdp.md) |
| 1.2 GitOps-skelet | ✅ | [`gitops/`](gitops), `make gitops-verify`/`gitops-drift`, [ADR-0005](docs/adr/0005-git-eneste-aendringskanal.md) |
| 1.3 Referencemodul A (audit-service) | ✅ | [`modules/audit-service`](modules/audit-service), `make conform MODULE=audit-service` |
| 1.4 Referenceadapter B (mattermost) | ✅ | [`modules/mattermost-adapter`](modules/mattermost-adapter), `make conform MODULE=mattermost-adapter` |

Bølge 1 er komplet: policy (1.1), GitOps (1.2), referencemodul (1.3) og adapter mod en stædig upstream (1.4). Adapteren erklærer ærligt `partial` på `subject.erase`, og suiten accepterer det. Næste på den kritiske vej er bølge 2 (agenter).

## Kom i gang

```bash
make install                 # npm ci i conformance/
make ci                      # validate + lint + test + conform-all + conform-negative
```

Kør mod ét modul:

```bash
make conform MODULE=dummy-ok
```

```
  ✔ C-001  module-manifest.json validerer mod kontrakten
  ✔ C-005  Ingen lokal brugerdatabase; OIDC/SCIM/SPIFFE erklæret
  ...
RESULTAT: PASS  (10 pass, 0 skip, 0 fail)
```

Bevis at suiten faktisk fanger fejl:

```bash
make conform-negative
# ✔ Negativ fixture fejlede som forventet
```

Policy-laget:

```bash
make policy-verify   # verificér den signerede bundle
make policy-test     # kør PDP'ens tests
make policy-decide   # træf en eksempelbeslutning
```

GitOps:

```bash
make gitops-verify   # policy-gates: digests, labels, hardening, fail-closed
make gitops-drift    # bevis at ændringer uden om git opdages og føres tilbage
make changelog       # maskinlæsbar change log fra git (NIS2)
```

Referencemodul (audit-service):

```bash
make audit-service-test       # 19 tests: identitet, hash-kæde, PDP, fail-closed
make audit-service-evidence   # fremkald konformansbevis ved at køre verberne
make conform MODULE=audit-service
```

Referenceadapter (mattermost):

```bash
make adapter-test             # 7 tests mod mock Mattermost
make adapter-evidence         # bevis at partial-erklæringen holder
make conform MODULE=mattermost-adapter
```

## Struktur

```
contracts/     JSON Schema-kontrakter + eksempler (det, der skal testes)
conformance/   kørbar testsuite og orkestratorer (det, der tester)
modules/       reference- og adaptermoduler med module-manifest.json
policy/        signerede policy-bundles og PDP (det, der beslutter)
gitops/        ønsket tilstand, Argo CD-apps og reconcile (det, der ruller ud)
docs/adr/      beslutningslog i MADR-format
docs/spec/     planerne i prosa
```

## De fire planer

1. **Identitet** — OIDC, SCIM 2.0, SPIFFE. Intet modul har egen brugerdatabase.
2. **Telemetri** — OTel + én CloudEvents-envelope for menneske- og agenthandlinger.
3. **Ops** — ti verber, hver med et conformance-niveau: `full` / `partial` / `unsupported`.
4. **Privacy** — ét DSAR-fan-out med per-modul status.
5. **Policy** — én central PDP; moduler og agenter spørger, de beslutter ikke selv. (Bølge 1.)

Læs mere i [`docs/spec`](docs/spec) og baggrunden i [`docs/adr`](docs/adr).

## Bidrag

Se [CONTRIBUTING.md](CONTRIBUTING.md). Alle commits skal være DCO-signeret (`git commit -s`).
