# Overtagelses- og beredskabsplan (DKC-052)

> Genereret fra `continuity/takeover-plan.json` med `make takeover-write`. Planen er kilden; dette dokument er en afledt visning. En plan er ikke en målt øvelse.

**Ejer:** Anna Andersen (Platform Owner) · **Sidst gennemgået:** 2026-09-29 · **Version:** 1.0.0

## Navngivne roller

| Rolle | Person | Kontakt |
| --- | --- | --- |
| serviceOwner | Maja Mortensen (Service Owner) | phone +45 20 00 00 02 |
| substitute | Bo Bertelsen (Platform Owner) | phone +45 20 00 00 04 |
| onCall | Bo Bertelsen (Platform Owner) | phone +45 20 00 00 04 |
| incidentLead | Anna Andersen (Incident Lead) | phone +45 20 00 00 03 |
| changeAuthority | Anna Andersen (Incident Lead) | phone +45 20 00 00 03 |
| dataProtection | Cecilia Christensen (Security Owner) | phone +45 20 00 00 05 |

## Uafhængig kontaktkanal og eskalation

- Kanal: out-of-band telefonbro + SMS (uafhængig af platformen)
- Uafhængig af platformen: ja
- Testmodtagere: Anna Andersen, Cecilia Christensen, Bo Bertelsen

| Efter (min) | Eskaleres til |
| --- | --- |
| 15 | Anna Andersen (Incident Lead) |
| 30 | Cecilia Christensen (Security Owner) |

## Offline-runbooks og credentials

- Offline-medium: trykt kopi i aflåst skab + airgapped USB i bankboks (Hovedkontorets sikkerhedsskab og bankboks 2 (to geografiske steder))
- Sidst verificeret: 2026-09-29
- Credentials under menneskekontrol: ja; depositarer: Anna Andersen, Cecilia Christensen
- Break-glass: docs/runbooks/break-glass.md (to-personers: ja)

## Prioriteret restoreplan

Ejer: Bo Bertelsen (Platform Owner) · Integritetskontrol: sha256 på hver gendannet komponent, ACL-afstemning og et fuldt brugerflow

| Rækkefølge | Komponent | Reference |
| --- | --- | --- |
| 1 | identity | `backup/dr/recovery-access-profile.json` |
| 2 | database | `persistence/ha-plan.json` |
| 3 | storage | `storage/storage-plan.json` |
| 4 | configuration | `contracts/examples/deployment-profile.enterprise.example.json` |

## Formelt valgt profil

Valgt af Anna Andersen (Incident Lead) · formelt valgt: ja

| Profil | Reference |
| --- | --- |
| deploymentProfile | `contracts/examples/deployment-profile.enterprise.example.json` |
| haProfile | `infrastructure/ha-plan.json` |
| immutableProfile | `data-protection/enforcement/immutable-policy.json` |
| selfHealingProfile | `chaos/failure-matrix.json` |

## Øvelsesscenarier

| Scenarie | Kind | Miljø | Trin | Menneskelige trin |
| --- | --- | --- | --- | --- |
| single-server | single-server | isolated-recovery | 9 | 6 |
| ha | ha | isolated-recovery | 10 | 6 |
| ai-offline | ai-offline | airgapped-control | 9 | 6 |
| iam-loss | iam-loss | isolated-recovery | 10 | 6 |
| site-catastrophe | site-catastrophe | isolated-recovery-site-b | 10 | 6 |

## Periodisk kontrol

| Kontrol | Kadence (dage) | Sidst gennemført |
| --- | --- | --- |
| accessReview | 90 | 2026-08-15 |
| backupControl | 30 | 2026-09-01 |
| capacityReview | 90 | 2026-07-01 |
| drDrill | 180 | 2026-06-15 |
| runbookRecertification | 180 | 2026-06-01 |

## Sådan gentages øvelsen

```sh
make takeover-write    # genskab denne plan og rapporten
make takeover-check    # validér plan, øvelse og renderede artefakter
make takeover-test     # kør enheds- og konformanstestene
make takeover-live     # målt øvelse på levende hosts (NOT RUN)
```
