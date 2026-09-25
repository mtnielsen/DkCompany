# Katastrofegendannelsesplan (DKC-042)

> Genereret fra `backup/dr/disaster-recovery-plan.json` med `make dr-write`. Planen er kilden; dette dokument er en afledt visning. En plan er ikke en målt øvelse.

**Ejer:** Anna Andersen (Platform Owner) · **Sidst gennemgået:** 2026-09-28 · **Princip:** 3-2-1-1-0

## 3-2-1-1-0

| Krav | Erklæret | Faktisk |
| --- | --- | --- |
| Kopier | 3 | 3 |
| Medier | 3 | 3 |
| Eksterne kopier | 1 | 1 |
| Offline/immutable | 1 | 1 |
| Verificerede restores | 1 | ≥1 |

### Kopier

| Kopi | Mål | Type | Medie | Fejldomæne | Adgangsdomæne | Immutable | Sletning |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `primary-filesystem` | local-filesystem | primary | disk | staging-local | staging-account | nej | none |
| `offsite-object-store` | offsite-object-store | offsite | object-store | offsite-zone-b | backup-prod-account | ja | compliance |
| `offline-vault` | offline-vault | offline-immutable | tape | airgap-vault | airgap-account | ja | governance-two-person |

## Primærklyngens grænse

Driftsrollen `platform-primary-ops` må ikke slette beskyttede backups.

- Tilladte operationer: `read`, `write`, `backup`, `failover`
- Forbudte operationer: `delete`, `retention-shorten`, `pointer-switch`, `key-delete`, `recovery-access`

## Applikationskonsistent PITR

- Motor: postgresql; base-backup: `0 2 * * *`; WAL-arkiv: `s3://platform-wal-archive/eu-west-1`.
- Quiescence: `checkpoint-and-fence-writes` (maks. 30s, omfatter database, objects, config, queue).
- Valgbart recovery-tidspunkt: ja (second); bundet af RPO for bekræftede writes: 0 min.
- ACL-afstemning: `compare-subject-role-matrix` mod database, iam, object-store.

## Recovery-identitet

- Profil: `backup/dr/recovery-access-profile.json`
- Adskilt fra primærdriften: ja; kun verificeret menneske: ja; to-personers: ja; stående adgang: nej.
- Nøgle: `kms:alias/platform-backup` (adskilt fra backup-lageret: ja).
- Katalog pinnet på digest: `eec0766469e24c43075d9a6e0ef6f548c02debcbbbd8d2c6fea8be170fa51fc9`; images pinnet: 1.

## Isoleret recovery-miljø

Netværk: `dedicated-recovery-vpc-without-peering-to-primary`. Ingen afhængighed af den primære klynge.

| Afhængighed | Genoprettes fra | Metode |
| --- | --- | --- |
| `iam` | `backup/restored-identities.json` | restore-identity-table-from-pitr-and-rebind-trust |
| `dns` | `backup/components/config-config.enc` | rebuild-zone-from-config-and-reexport |
| `secret-store` | `kms:alias/platform-backup` | recover-keys-from-separate-custody-and-reissue-workload-secrets |
| `database` | `s3://platform-wal-archive/eu-west-1` | pitr-to-known-clean-point |
| `object-storage` | `offsite-object-store` | restore-versioned-objects-and-preserve-locks |

## Kendt rent restorepunkt

- Backup: `clean-2026-09-28T020000Z`, verificeret 2026-09-28T02:05:00Z af Carla Officer.
- Metode: isolated-restore-plus-functional-and-acl-checks. Evidens: `docs/continuity/dr-plan.md#kendt-rent-restorepunkt`.

## Slettejournal og failback

- Slettejournal: `srv/backup/suppression.ndjson` (append-only: ja, hash-kædet: ja).
- Failback:
  1. fence-den-gamle-primary-og-bekraeft-monotont-epoch
  1. rejoin-og-indhent-wal-paa-den-tidligere-primary
  1. verificer-checksums-og-acl-foer-promotion
  1. planlaeg-switchover-i-vedligeholdelsesvindue
- Switchover-vindue: maintenance; fence påkrævet: ja.

## Samlet brugerflow

**F3 — Udføre et ops-verbum med fuld sporbarhed** (RPO 0 min, RTO 60 min).

| Trin | Beskrivelse | Komponent | Afhænger af |
| --- | --- | --- | --- |
| `signin` | Logge ind og få adgang til platformen | `keycloak-adapter` | — |
| `approval` | Godkende anmodningen med to-personers kontrol | `approval-service` | `signin` |
| `execute` | Udføre ops-verbummet mod det rette modul | `dummy-ok` | `approval` |
| `audit` | Bekræfte handlingen i det hash-kædede revisionsspor | `audit-service` | `execute` |

## Beskyttede backups

| Backup | Kopi | Retention (dage) | Sletningsspærring | To-personers | Immutabilitet verificeret |
| --- | --- | --- | --- | --- | --- |
| `offsite-protected` | `offsite-object-store` | 365 | `compliance-object-lock` | ja | ja |
| `offline-protected` | `offline-vault` | 3650 | `offline-airgap` | ja | ja |
