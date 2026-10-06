# Dedup-plan

> Genereret fra `dedup/dedup-policy.json` med `make dedup-write`. Redigér kilden, ikke dette dokument.

Dedup-politik for platformen: separat design for backupblokke, primære objekter, jobhændelser og forretningsposter. Dedup sker kun inden for en tenant, et krypteringsdomæne og en retentionklasse, aldrig på tværs af kunder. Besparelser aktiveres kun efter bestået integritets- og restoretest.

- **Politikversion:** 1.0.0
- **Gennemprøvet backupløsning:** `backup/src/vault.mjs`
- **Dedup af primærdata valgfrit:** ja
- **Tværkundededuplikering:** nej

## Dedup-domæner

| Kategori | Aktiv | Semantik | Tenant | Krypteringsdomæne | Retentionklasse | Tværkunde |
| --- | --- | --- | --- | --- | --- | --- |
| backup-blocks | ja | content-addressed-chunks | ja | ja | ja | nej |
| primary-objects | nej | content-addressed-chunks | ja | ja | ja | nej |
| job-events | ja | idempotency-key-only | ja | ja | ja | nej |
| business-records | nej | never-merge | ja | ja | ja | nej |

## Garbage collection

- Retention-aware: ja
- Mark-and-sweep: ja
- Single-writer lease: ja (prune kræver lease: ja)

## Besparelsesgate

- Kræver integritetskontrol: ja
- Kræver fuld restore: ja
- Aktiveres kun når begge består: ja

