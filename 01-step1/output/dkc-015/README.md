# DKC-015 — Reproducerbar staging med GitOps (leverance)

Implementering af **DKC-015** for `mtnielsen/DkCompany`. Bygger på
DKC-001 .. DKC-013, DKC-055, DKC-037, DKC-053, DKC-063, DKC-019, DKC-047,
DKC-056 og DKC-014. `00-core/` i det faktiske repo er fortsat **ikke ændret**;
alt ligger under `01-step1/output/dkc-015/`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætnings-overlays:** `dkc-014` → `dkc-056` → `dkc-047` → … → `dkc-001` (kædes af `apply.sh`)
- **Miljø:** Node v22.22.1, `openssl`. **Ingen** klynge, `kubectl`, `tofu`, `terraform`, `helm` eller `kustomize`.

## Forudsætninger og valg

DKC-015 afhænger formelt af DKC-008, DKC-010 og DKC-014. Overlayen lægges oven
på hele stakken via `dkc-014/apply.sh`, som kæder `dkc-056/apply.sh` →
`dkc-047/apply.sh` → … → `dkc-001`. **DKC-014 er valgt som forudsætning, fordi
den er den aktuelle stak-top.**

Opgaven er delvist miljøblokeret: der findes ingen stagingklynge og ingen
IaC-/klynge-værktøjer. Valget var at implementere de dele, der kan bygges og
efterprøves **rigtigt** her, og registrere resten ærligt som NOT RUN:

- **Rigtigt implementeret:** den versionerede infrastrukturplan, OpenTofu-modulet
  for den valgte profil, deterministisk rendering af GitOps-manifester og Argo
  CD-apps for staging/prod, statisk netværksisolation, secret-injektionskontrol,
  break-glass-autorisation, omkostningsregistrering og reconcile mod observeret
  tilstand.
- **NOT RUN med begrundelse:** selve provisioneringen (`tofu apply`) og den
  **rigtige** driftskontrol mod en klynge (`kubectl`), fordi værktøjerne og
  klyngen ikke findes her.

## Implementeret adfærd

1. **Ny kontrakt** `contracts/infrastructure-plan.schema.json` (`InfrastructurePlan`)
   + eksempel: hostingprofil, provider, dev/staging/prod, TLS, DNS, krypteret
   storage, secret-referencer, netværk, bootstrap, nøgleforvaltning, break-glass
   og omkostning.
2. **Semantisk validator** `conformance/src/infrastructure.mjs`: dev/staging/prod
   skal findes med unikke namespaces, alle kontroltjenester med, ingen
   wildcard- eller kryds-miljø-egress, ingen klartekst-hemmeligheder, break-glass
   med navngivet menneske/tidsgrænse/godkendelse, og omkostningsposter der summer.
3. **OpenTofu-IaC** `infrastructure/iac/small-vps/`: privat netværk, default-deny
   firewall (HTTPS + SSH fra admin-CIDR), k3s, krypteret block-storage, DNS,
   cert-manager, external-secrets og Argo CD — med pinnede providere og
   miljøtfvars for dev/staging/prod.
4. **Statisk IaC-kontrol** `infrastructure/src/hcl.mjs`: pinnede providere,
   default-deny firewall, kryptering, sensitivt kubeconfig-output og ingen
   klartekst-hemmeligheder.
5. **Deterministisk rendering** `infrastructure/src/render.mjs`: 24 manifester
   pr. miljø (Deployments/CronJob, Services, ServiceAccounts, NetworkPolicies,
   Ingress med TLS, PVC, ResourceQuota, LimitRange, pdp-bundle) og Argo CD-apps
   for **staging og prod**. `dev` er den eksisterende reference og genskabes ikke.
6. **Netværksisolation** `infrastructure/src/netpol.mjs`: default-deny pr.
   namespace, ingen tom `namespaceSelector`, intet wildcard-IP, ingen egress til
   et andet miljøs namespace.
7. **Secret-injektion** `infrastructure/src/secrets.mjs`: ingen committede
   `Secret`-objekter, alle referencer deklareret, ingen klartekst.
8. **Break-glass** `infrastructure/src/break-glass.mjs`: menneskelig rekvirent og
   godkender, ingen selv-godkendelse, scope- og varighedsgrænse, automatisk udløb.
9. **Omkostning** `infrastructure/src/cost.mjs` + `docs/costs/staging.json`.
10. **Drift** `infrastructure/src/drift.mjs`: rigtig `kubectl`-baseret reconcile
    eller NOT RUN. `gitops/src/verify.mjs` og `gitops/src/cli.mjs` understøtter nu
    `--env`, og `gitops/apps/{staging,prod}` er tilføjet.
11. **Containere**: `containers/approvals/Dockerfile` og
    `containers/runtime/Dockerfile` tilføjet til kataloget (deployet i staging),
    og SBOM/artefaktmanifest regenereret.

## Ændrede filer (120 leverancefiler)

| Område | Filer |
| --- | --- |
| Kontrakt | `contracts/infrastructure-plan.schema.json` + eksempel |
| Konformans | `conformance/src/infrastructure.mjs`, `schemas.mjs`, `validate-schemas.mjs` |
| Infrastruktur | `infrastructure/` (9 kilder, 8 tests, `package.json`, `plan.json`) |
| IaC | `infrastructure/iac/small-vps/` (11 `.tf`, cloud-init, 3 env-tfvars, README) |
| GitOps | `gitops/manifests/{staging,prod}/` (48), `gitops/apps/{staging,prod}/` (10), `gitops/src/verify.mjs`, `gitops/src/cli.mjs` |
| Containere | `containers/approvals/`, `containers/runtime/`, `containers/containers.json` |
| Release | `release/matrix/test-matrix.json`, `release/artifacts.json`, `release/sbom/platform-sbom.cdx.json` |
| Byg/CI | `Makefile`, `tools/baseline/registry.mjs` |
| Dokumentation | `docs/spec/staging.md`, `docs/adr/0033-…`, `docs/runbooks/{bootstrap,key-management,break-glass}.md`, `docs/costs/staging.json`, `docs/spec/gitops.md`, `docs/spec/README.md`, `docs/adr/README.md`, `docs/status/implementation-matrix.md`, `docs/status/supply-chain.md`, `docs/testing/test-matrix.md` |

Den fulde liste findes i `evidence/logs/deliverable-files.txt`.

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make validate` | PASS — 52 skemaer, 52 eksempler, 1 infrastrukturplan |
| `make lint` | PASS — 355 JSON-filer, 850 filer |
| `make test` | PASS — 131/131 |
| `make infrastructure-check` | PASS |
| `make infrastructure-test` | PASS — 33/33 |
| `make infrastructure-verify` | PASS — dev/staging/prod 9/9 GitOps-gates |
| `make infrastructure-iac-check` | PASS |
| `make release-check` | PASS — 25 krav, matrixversion 1.2.0 |
| `make release-test` | PASS |
| `make gitops-test` / `make gitops-verify` | PASS |
| `make supply-chain-check` / `make supply-chain-test` | PASS |
| `make infrastructure-drift` | **NOT RUN** — `kubectl` findes ikke (forventet) |
| `make baseline` | 80 PASS, **1 FAIL** (pre-eksisterende `changelog-check`), 14 NOT RUN, 0 ERROR af 95 |

Den ene FAIL er den kendte, pre-eksisterende `changelog-check` (commits mangler
DCO-sign-off), identisk med DKC-047/056/014-baselinerne.

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| En tom staginginstallation kan oprettes fra dokumenteret kode og nødvendige secrets | **NOT RUN** | Plan, OpenTofu-modul, miljø-tfvars og bootstrap-runbook er implementeret og statisk kontrolleret; `tofu apply` og en rigtig klynge findes ikke her (`integration-staging-provision`, NOT RUN). |
| Faktisk drift opdages og reconciles; simuleret JSON tæller ikke | **NOT RUN** | `infrastructure/src/drift.mjs` bruger `kubectl` + kubeconfig; uden dem NOT RUN (`integration-staging-drift`). Reconcile er efterprøvet mod **injiceret** observeret tilstand i `infrastructure/test/drift.test.mjs` og markeret som sådan. |
| Workloads kan ikke nå andre kunders databaser | **PASS** (statisk) | Default-deny pr. namespace + eksplicitte allow-regler; `infrastructure/test/netpol.test.mjs` afviser manglende default-deny, tom namespaceSelector, wildcard-IP og kryds-miljø-egress. Levende håndhævelse kræver en klynge (NOT RUN). |
| Genstart/nodefejl og manglende secret giver forventet adfærd | **PARTIAL / NOT RUN** | GitOps selfHeal+prune, PVC på krypteret storage og fail-closed ved manglende secret er dokumenteret i `docs/runbooks/bootstrap.md`; den faktiske fejløvelse kræver en klynge. |
| Stagingomkostning registreres | **PASS** | `docs/costs/staging.json` genereret fra planen; `infrastructure/test/cost.test.mjs` afviser et beløb, der ikke summer. |

## Ærlige begrænsninger

- **Ingen stagingklynge, ingen `kubectl`, ingen `tofu`/`terraform`/`helm`.** Provisionering og rigtig drift er NOT RUN.
- **Containerne er ikke bygget** (Docker mangler, jf. DKC-014). Staging-manifesterne bærer derfor bevidste pladsholder-digests, som DKC-014's gate afviser, indtil CI har pinnet rigtige digests.
- **Netværksisolationen er statisk dokumenteret**, ikke målt i en klynge.
- **En grøn enhedstest er ikke produktionsstatus.** Uafhængig verifikation er en separat menneskelig handling.

## Sådan efterprøves leverancen

```sh
git clone --no-hardlinks /mnt/c/projects/DkCompany /tmp/dkc-015-verify
cd /tmp/dkc-015-verify && git checkout 83ad91a
/mnt/c/projects/DkCompany/01-step1/output/dkc-015/apply.sh /tmp/dkc-015-verify/00-core
cd 00-core && make install
make validate && make lint && make test
make infrastructure-render && make infrastructure-check
make infrastructure-test && make infrastructure-verify && make infrastructure-iac-check
cd /mnt/c/projects/DkCompany/01-step1/output/dkc-015
sha256sum -c OVERLAY-MANIFEST.txt
```

`OVERLAY-MANIFEST.txt` dækker `deliverable/`, `evidence/`, `README.md` og
`apply.sh` med pakkerod-relative stier.
