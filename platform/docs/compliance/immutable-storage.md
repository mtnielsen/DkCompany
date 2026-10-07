# Immutable storage — fysisk håndhævelse

DKC-048. DKC-047 beskyttede data på adgangs- og transitionsniveau og erklærede
ærligt, at den fysiske lager-/nøglehåndhævelse manglede. DKC-048 leverer den:
object-lock i GOVERNANCE og COMPLIANCE, en rollematrix der nægter AI og
app-konti alle muterende operationer, append-only audit-ingest, en beskyttet
KMS-nøglebutik og to-personers kontrol.

## Hvad der er håndhævet fysisk

| Kontrol | Håndhævelse |
| --- | --- |
| WORM-lås på en version | Object-lock (`storage/src/object-store.mjs`); kun forlængelse |
| COMPLIANCE-bypass | Altid afvist, også med menneskelig godkendelse |
| GOVERNANCE-bypass | Kræver navngivet menneske + to-personers godkendelse |
| Retention-forkortelse | Altid afvist |
| Current-pointer af AI | Afvist; den låste version forbliver autoritativ |
| KMS-nøglesletning | Kun security-admin + separat godkender; blokeret mens en retention-locked post refererer nøglen |
| Audit-ingest | Append-only rolle adskilt fra administration |
| Indirekte adminveje | Syv stier nægtet for AI (RBAC, bucket-policy, KMS-politik, serviceaccount, trust-config, lifecycle) |
| Backup/restore | Bevarer versioner, låse og adgangsregler |

## Registerets status

Beskyttelsesregisteret `data-protection/records/register.json` erklærer nu
`storageEnforcement.status: full` for alle poster, med
`deliveredBy: DKC-048` og evidensreferencer. En påstand om fuld håndhævelse
kræver bevis; `conformance/src/protected-data.mjs` afviser en `full`-status uden
evidens.

## Verifikation

`data-protection/src/storage-semantics.mjs` udfører negative håndhævelsestests
mod en konkret lagerinstans og bekræfter at COMPLIANCE afvises, at GOVERNANCE
kræver et flag, at retention ikke forkortes, og at en ny version ikke skjuler
den låste. Testen er deterministisk (`verifiedByHuman: false`). S3-kompatibilitet
alene er ikke et WORM-bevis; en målt verifikation på et levende storage-produkt
er `integration-immutable-live` og er **NOT RUN** i dette miljø.

```bash
make immutable-render   # genskab gitops/manifests/data-protection/
make immutable-check    # politik, semantik, manifester, register og lagersemantik
make immutable-test     # WORM, roller, nøgler, backup/restore, semantik, konformans
```

## Trusselsmodel

Menneskelige storage-administratorer og fysiske begrænsninger er dækket af
trusselsmodellen: `THREAT-IMMUTABLE-001` (kompromitteret agent/appkonto) og
`THREAT-IMMUTABLE-002` (indirekte adminvej eller governance-bypass). Se
[`docs/security/threat-model.md`](../security/threat-model.md) og
[ADR-0048](../adr/0048-immutable-data-uden-for-agentens-kontrol.md).
