# Rettighedsbevidst videnssøgning — rapport

> Genereret af `make search-render` som en deterministisk kontrol. **Målt:** nej — en faktisk målt slettefrist på en levende BookStack kræver en ekstern kilde.

- **Genereret:** 2026-03-01T00:00:00Z
- **Dokumenter:** 9 (4 fortrolige/personlige), tenants: 2
- **Indeks genindlæst fra disk:** ja
- **Slettefrist:** 0 ms brugt af 300000 ms (målt: nej)

## Scenarier

| Scenarie | Principal | Resultat | Synlige kilder | Skjulte kilder |
| --- | --- | --- | --- | --- |
| hr-private-hidden | oidc|bo.bertelsen | PASS | — | bookstack-acme:page-hr-private, bookstack-acme:page-hr-oncall, bookstack-acme:page-salary-process |
| hr-private-visible-hr | oidc|carla.christensen | PASS | bookstack-acme:page-hr-private, bookstack-acme:page-salary-process, bookstack-acme:page-hr-oncall | — |
| tenant-isolation | oidc|bo.bertelsen + oidc|gus.globex | PASS | bookstack-acme:page-onboarding, bookstack-globex:page-globex-onboarding | — |
| revoked-access | oidc|bo.bertelsen | PASS | — | bookstack-acme:page-architecture |
| deleted-document | oidc|bo.bertelsen | PASS | — | bookstack-acme:page-onboarding |
| prompt-injection | oidc|bo.bertelsen | PASS | bookstack-acme:page-injection, bookstack-acme:page-security | — |
| cache-invalidation | oidc|bo.bertelsen | PASS | — | — |

## Slettefrist

- Slettet dokument: `bookstack-acme:page-onboarding`
- Fjernet fra indeks: ja
- Cache invalideret: ja

## Injektionsneutralisering

- Fund: ignore-previous-da, shell-da, tool-call-forgery
- Værktøjsforslag: 0 (indhold kan ikke aktivere et værktøj)

