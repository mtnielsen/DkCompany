# GitOps-skelettet

**Kode:** [`gitops/`](../../gitops)
**Backlog:** 1.2

## Formål

Alt går gennem git — mennesker og agenter ens. En ændring uden om git er ikke en ændring, den er drift der skal føres tilbage. Git-historikken er den komplette change log (NIS2).

## Struktur

```
gitops/
  manifests/dev/    ønsket tilstand: Kubernetes-ressourcer som JSON (git er sandheden)
  apps/             Argo CD Application pr. applikation
  observed/         simulerede klynge-tilstande til drift-testen
  src/              verify (policy-gates), reconcile (drift), changelog
```

Ønsket tilstand er ressourcer i JSON, fordi Kubernetes accepterer JSON og Argo CD kan læse det. Det gør hele tilstanden maskinlæsbar og testbar uden en klynge.

Fra DKC-015 findes desuden genererede miljøer for `staging` og `prod`
(`gitops/manifests/{staging,prod}` og `gitops/apps/{staging,prod}`), som
udledes deterministisk fra `infrastructure/plan.json`. Se
[`docs/spec/staging.md`](staging.md).

## Argo CD

Hver applikation har `syncPolicy.automated` med:

- `selfHeal: true` — en ændring i klyngen føres tilbage til git.
- `prune: true` — ressourcer der fjernes fra git, slettes i klyngen.
- `allowEmpty: false` — en tom/stub kilde må ikke tømme klyngen.

Det er `selfHeal` + `prune`, der gør "ændring uden for git afvises/reconciles væk" sandt.

## Policy-gates i CI

`make gitops-verify` (checks `G-001`–`G-008`):

| ID | Krav |
| --- | --- |
| G-001 | Alle moduler har en Argo CD Application og en Deployment i git |
| G-002 | Alle container-images er pinnet på `@sha256:`-digest — `:latest` afvises |
| G-003 | Obligatoriske labels på alle ressourcer |
| G-004 | Argo CD selfHeal + prune, `allowEmpty: false` |
| G-005 | Containere er hærdet: non-root, read-only rootfs, drop ALL |
| G-006 | PDP kører fail-closed på den signerede bundle (digest matcher) |
| G-007 | Ingen ressourcer i privilegerede namespaces |
| G-008 | Application-kilder peger på eksisterende stier |

## Reconcile og drift

`make gitops-reconcile` sammenligner ønsket tilstand (git) med observeret tilstand:

```bash
make gitops-reconcile
# ✔ Klyngen er i sync med git (8 ressourcer)

make gitops-drift
# Simuleret drift (4 ændringer uden om git):
#   revert  apps/v1/Deployment/platform/pdp — afviger fra git
#   delete  v1/ConfigMap/platform/hotfix-temporary — findes ikke i git
#   create  v1/Service/platform/dummy-ok — findes ikke i klyngen
# ✔ 3 drift-handlinger opdaget og ville blive ført tilbage til git
```

Driften simuleres i [`gitops/observed/dev-drift.json`](../../gitops/observed/dev-drift.json): en ændret replicas-værdi, et flydende image-tag, en ekstra ConfigMap og en slettet Service. Reconcile opdager dem alle tre slags: `revert`, `delete`, `create`.

## Change log (NIS2)

`make changelog` udleder en maskinlæsbar change log fra git: hash, forfatter, dato, emne, filer og DCO sign-off. `make changelog-check` fejler, hvis en commit mangler sign-off. Den genererede fil er et evidensudtræk — sandheden er git-historikken.

## Acceptkriterier (1.2)

- [x] Ändring uden for git afvises/reconciles væk (`make gitops-drift`).
- [x] Git-historik er komplet change log (`make changelog`, `make changelog-check`).
- [ ] Argo CD deployet i en rigtig klynge — skeleton og apps er på plads.
