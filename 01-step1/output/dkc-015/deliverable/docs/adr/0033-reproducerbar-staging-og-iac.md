# ADR-0033: Reproducerbar staging fra IaC og GitOps med rigtig drift

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), med Bo Bertelsen som stedfortræder
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-015. Et stagingmiljø, der kun findes som prosa eller som en simuleret JSON-fil, kan ikke bære en release. Vi skal kunne oprette en tom installation fra kode og secrets, holde dev/staging/prod adskilt, forhindre at et workload når en anden kundes database, og opdage faktisk drift — ikke kun simulere den.

## Kontekst og problemstilling

- **Én valgt hostingprofil.** Uden en konkret profil bliver IaC en samling løse filer. Vi vælger `small-vps` for staging.
- **Miljøadskillelse.** Dev, staging og prod skal have hver sin namespace (eller klynge) og ikke kunne nå hinanden.
- **Netværk.** En applikation må ikke kunne nå fremmede databaser. Det kræver default-deny og eksplicitte allow-regler.
- **TLS, DNS, storage.** Alle tre skal være en del af den reproducerbare opsætning, ikke manuelle handlinger.
- **Secrets.** Ingen hemmeligheder i git; injektion via en secret-backend.
- **Bootstrap, nøgler og break-glass.** Der skal være en dokumenteret vej ind, en nøgleforvaltning og en autoriseret, tidsbegrænset nødvej.
- **Omkostning.** En staginginstallation uden et registreret beløb er ikke dokumenteret.
- **Miljøet.** Der er ingen klynge og ingen `tofu`/`kubectl`/`helm` her. Det skal siges højt.

## Beslutningskriterier

- En versioneret infrastrukturplan med miljøer, TLS, DNS, storage, secrets, netværk, bootstrap og omkostning.
- Et OpenTofu-modul for den valgte hostingprofil og en statisk kontrol af det.
- Deterministisk genererede GitOps-manifester og Argo CD-apps for staging og prod.
- En statisk dokumentation for, at workloads ikke kan nå andre kunders databaser.
- En ren break-glass-autorisation uden agent- eller selv-godkendelse.
- Rigtig drift eller et ærligt NOT RUN.

## Overvejede muligheder

- **Kun dokumentation og manuelle trin.** Hurtigt, men ikke reproducerbart og ikke efterprøveligt.
- **Kun simulerede klyngetilstande.** GitOps-driften fra DKC-001/DKC-014 findes allerede, men simulering tæller ikke som bevis.
- **Plan + IaC + genererede manifester + statisk isolation + ærlig NOT RUN for provisionering og drift.** Kræver vedligeholdelse, men gør hver grænse efterprøvelig i dag.

## Beslutning

Vi indfører en reproducerbar stagingvej, håndhævet i
`contracts/infrastructure-plan.schema.json`,
`conformance/src/infrastructure.mjs`, `infrastructure/`,
`infrastructure/iac/small-vps/`, `gitops/manifests/{staging,prod}` og
`gitops/apps/{staging,prod}`:

1. **Plan.** Dev/staging/prod med hver sin namespace, TLS-issuer, DNS, krypteret storage, secret-referencer og eksplicit netværk.
2. **IaC.** Et OpenTofu-modul med pinned providere, privat netværk, default-deny firewall, k3s, cert-manager, external-secrets og Argo CD.
3. **Rendering.** Determinerede GitOps-manifester og apps for staging og prod fra planen; dev forbliver den eksisterende reference.
4. **Netværk.** Default-deny pr. namespace og eksplicitte allow-regler; wildcards og kryds-miljø-egress afvises statisk.
5. **Secrets.** Kun referencer; klartekst og committede `Secret`-objekter afvises.
6. **Break-glass.** Tidsbegrænset, godkendt, scope-bundet og uden agent- eller selv-godkendelse.
7. **Omkostning.** `docs/costs/staging.json` genereres fra planens poster og skal stemme.
8. **Drift.** `gitops/src/reconcile.mjs` bruges mod en levende klynge; uden den er resultatet NOT RUN.

Resultatet valideres i `make infrastructure-render`, `make infrastructure-check`,
`make infrastructure-test`, `make infrastructure-verify` og
`make infrastructure-iac-check`.

## Konsekvenser

- **Positive:** Staging er reproducerbart fra kode og secrets, miljøer og databaser er adskilt, og drift kan måles rigtigt i CI.
- **Negative:** Plan, IaC og genererede manifester skal holdes i sync, og den fulde effekt kræver en klynge og en secret-backend.
- **Neutrale:** Containerne pinnes bevidst til pladsholder-digests, indtil DKC-014's CI har bygget og signeret dem.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| Kun dokumentation | Hurtigt | Ikke reproducerbart eller efterprøveligt |
| Kun simulerede klyngetilstande | Findes allerede | Simulering er ikke drift |
| Plan + IaC + rendering + statisk isolation | Efterprøveligt i dag | Kræver klynge for fuld effekt |

## Mere information

- [`docs/spec/staging.md`](../spec/staging.md)
- [`infrastructure/plan.json`](../../infrastructure/plan.json),
  [`infrastructure/iac/small-vps/`](../../infrastructure/iac/small-vps)
- [`docs/runbooks/bootstrap.md`](../runbooks/bootstrap.md),
  [`docs/runbooks/key-management.md`](../runbooks/key-management.md),
  [`docs/runbooks/break-glass.md`](../runbooks/break-glass.md)
- [ADR-0005](0005-git-eneste-aendringskanal.md), [ADR-0013](0013-deployment-og-tenantmodel.md), [ADR-0017](0017-tenant-kontekst-og-ressource-id.md), [ADR-0026](0026-fejlomraader-n-plus-1-og-recovery.md), [ADR-0032](0032-reproducerbare-artefakter-og-releasevej.md)
