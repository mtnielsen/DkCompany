# Referencemodul A: evidens-/audit-service

**Kode:** [`modules/audit-service`](../../modules/audit-service)
**Manifest:** [`module-manifest.json`](../../modules/audit-service/module-manifest.json)
**Backlog:** 1.3

## Formål

Et lille, grønt modul, vi selv ejer, som implementerer alle fire planer 100 % — og som samtidig er nødvendigt alligevel: en evidens- og audit-service. Det er her, DSAR-svar, ops-handlinger og policy-beslutninger får et hash-kædet spor.

Det er referenceimplementationen: andre moduler (og adaptere) skal kunne måles op imod den.

## Hvad den gør

| Plan | Implementering |
| --- | --- |
| Identitet | OIDC RS256-verifikation (issuer, audience, exp, signatur) og SPIFFE-workload-identitet. Ingen lokal brugerdatabase. |
| Telemetri | CloudEvent pr. handling med `tenantid`, `traceid`, `principal` — samme envelope for menneske og agent. |
| Ops | Alle ti verber: `backup`, `restore`, `verify-restore`, `drain`, `upgrade.dry-run`, `upgrade`, `migrate`, `rollback`, `health`, `slo`. |
| Privacy | Alle fem verber: `subject.locate`, `subject.export`, `subject.erase`, `subject.legal_hold`, `retention.policy`. |
| Policy | Hver privilegeret handling spørger central PDP. `deny` stopper; `allow-with-approval` kræver godkendelser; manglende evidens afvises; utilgængelig PDP giver 503 (fail-closed). |

## Hash-kædet audit-log

Hvert event bærer `prevHash` og sin egen `hash`. Ændrer man et gammelt event, brækker kæden fra det punkt og frem. `verifyChain()` bruges i test og kan kaldes løbende:

```
✔ audit-kæde: intakt (15 events)
```

Loggen er append-only i den forstand, at enhver efterredigering er detekterbar. Det er den egenskab, der gør den til bevis i stedet for en fil.

## Endpoints

```
GET  /healthz                       (uautentificeret liveness)
GET  /v1/audit/events               (kræver identitet)
POST /v1/ops/{backup,restore,verify-restore,drain,upgrade/dry-run,upgrade,migrate,rollback,slo}
GET  /v1/privacy/retention
POST /v1/privacy/{locate,export,erase,legal-hold}
```

En privilegeret handling følger denne rækkefølge:

1. Autentificér principal (OIDC eller SPIFFE).
2. Byg `PolicyInput` og spørg PDP.
3. `deny` → 403. `allow-with-approval` uden nok godkendelser → 428.
4. Manglende påkrævet evidens → 428.
5. Udfør, append til audit-log, emit CloudEvent, svar.

## Bevis fremkaldt, ikke påstået

`make audit-service-evidence` starter tjenesten med den rigtige PDP og kalder hvert verbum. For hvert verbum skrives et `verb-evidence`-fixture med HTTP-status, varighed og sha256 af svaret. Den faktiske PDP-beslutning for et gated verbum gemmes som `policy-decision.json`. Konformanssuiten læser dem og kræver, at modulet er `full` på alle 15 verber.

```bash
make audit-service-evidence
make conform MODULE=audit-service
# RESULTAT: PASS  (10 pass, 2 skip, 0 fail)
```

## Kør lokalt

```bash
node policy/pdp/src/cli.mjs serve --port 8181 &
make audit-service-run
```

## Acceptkriterier (1.3)

- [x] Konformans `full` på alle verber (`make conform MODULE=audit-service`).
- [x] Deployet via GitOps (`gitops/manifests/dev/audit-service-*.json` + Application).
- [x] Alle fire planer implementeret og testet (19 tests).
