node --no-warnings security-assessment/src/cli.mjs report
# Sikkerhedsvurdering — regressionsharness og assessment-gate (DKC-065)

- **Genereret:** 2026-03-01T00:00:00Z (deterministisk)
- **Målt:** nej — dette er en deterministisk lokal kørsel, ikke en uafhængig vurdering
- **Commit:** 83ad91a963d8055f77c29fb4361455689df95acb
- **Artefakt:** sha256:360668be68ec924e95e01d3d89d27ecebccaf323187ac2cd49808cbbc3bf0459
- **Vurderingsversion:** 1.0.0
- **Status:** outstanding
- **Produktionsgate:** BLOCKED (udestående)

## Dækning

| Kategori | Version | Status | Sonder |
| --- | --- | --- | --- |
| auth | 1.0.0 | passed | 2 |
| direct-apis | 1.0.0 | passed | 2 |
| cross-tenant-access | 1.0.0 | passed | 2 |
| injection | 1.0.0 | passed | 3 |
| agent-role-approval-bypass | 1.0.0 | passed | 2 |
| host-broker | 1.0.0 | passed | 2 |
| connectors | 1.0.0 | passed | 1 |
| telemetry-leaks | 1.0.0 | passed | 2 |
| immutable-bypass | 1.0.0 | passed | 1 |

## Isoleret regressionsharness

- Kørsler: 1, sonder: 17, bestået: 17, fejlet: 0

## Fund

- I alt: 0, åbne: 0, blokerende: 0

## Uafhængig vurdering

- **Udestående:** der findes ingen uafhængig assessor. En implementørkørsel tæller ikke.

## Releasebeslutning

- **Ikke truffet:** et navngivet menneske skal træffe den.

## Gate-blokkere

- `no-independent-assessment`
- `no-release-decision`
- `assessment-outstanding`

> Rapporten er klassificeret `confidential` og redigeret. Rå evidens er adgangskontrolleret, og rapporter indeholder hverken tokens eller persondata.
