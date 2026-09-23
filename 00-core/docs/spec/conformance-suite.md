# Konformanssuiten

**Kode:** [`conformance/`](../../conformance)
**Backlog:** 0.6

> Dette punkt afgør, om projektet lever. En spec uden testsuite er en PDF, ingen følger.

## Brug

```bash
make install                 # npm ci i conformance/
make validate                # metavalidér skemaer + eksempler
make lint                    # JSON + tekstfiler
make test                    # suitens egne tests
make conform MODULE=dummy-ok # kør mod ét modul
make conform-all             # alle rigtige moduler + rapport + badge
make conform-negative        # bevis at den brudte fixture fejler
make dsar-demo               # DSAR-fan-out
make telemetry-test          # CloudEvent gennem collectoren
```

Direkte:

```bash
node conformance/src/cli.mjs --module dummy-ok --json
```

## Checks

| ID | Krav |
| --- | --- |
| C-001 | `module-manifest.json` validerer mod kontrakten |
| C-002 | Alle ops- og privacy-verber er deklareret |
| C-003 | Conformance-niveauer er ærlige (reason på partial/unsupported) |
| C-004 | Bevisfiler for `full`-verber findes og validerer |
| C-005 | Ingen lokal brugerdatabase; OIDC/SCIM/SPIFFE erklæret |
| C-006 | OTel-signaler og obligatoriske CloudEvent-attributter |
| C-007 | CloudEvent-eksempler validerer mod envelopen |
| C-008 | Privacy-verber og datakategorier hænger sammen |
| C-009 | Modulet er bundet til central PDP (fail-closed) |
| C-010 | Aktiv policy-bundle er skemagyldig og signeret |
| A-001 | Agent-manifester validerer mod agent-kontrakten |
| A-002 | Agent-capabilities ligger inden for scope; navngivet ansvarlig |

Statusser: `pass`, `fail`, `skip` (kunne ikke afgøres, fx probe offline). `skip` tæller ikke som `pass`.

## Fixtures

- `modules/dummy-ok` — består alle checks. Demonstrerer også ærlig `partial` på `subject.legal_hold`.
- `modules/dummy-broken` — bevidst brudt. CI kører `make conform-negative` og fejler, hvis den *ikke* fejler.

## Badge

`make conform-all` skriver `.conformance-out/badge.json` i shields.io endpoint-format. Filen kan publiceres, så konformansstatus er synlig uden at åbne CI.

## Acceptkriterier (0.6)

- [x] `make conform MODULE=x` giver pass/fail-rapport.
- [x] Dummy-modul består; bevidst brudt modul fejler.
