# Reproducerbar staging med GitOps (DKC-015)

Målet er, at en **tom staginginstallation kan oprettes fra dokumenteret kode og
nødvendige secrets**, at dev/staging/prod er adskilt, at workloads ikke kan nå
andre kunders databaser, at genstart/nodefejl og manglende secret giver
forventet adfærd, og at stagingomkostningen er registreret.

Den valgte hostingprofil er **`small-vps`** fra
[`catalog/profiles/small-vps.profile.json`](../../catalog/profiles/small-vps.profile.json).

## Kontrakt og kilde

Infrastrukturen er beskrevet i
[`contracts/infrastructure-plan.schema.json`](../../contracts/infrastructure-plan.schema.json)
og instansieret i [`infrastructure/plan.json`](../../infrastructure/plan.json)
(eksempel: [`contracts/examples/infrastructure-plan.example.json`](../../contracts/examples/infrastructure-plan.example.json)).
Planen er den ene kilde for miljøer, tjenester, TLS, DNS, storage, secrets,
netværk, bootstrap, nøgleforvaltning, break-glass og omkostning.

`conformance/src/infrastructure.mjs` håndhæver ud over skemaet:

- at **dev, staging og prod** alle findes med unikke namespaces,
- at hver kontroltjeneste (pdp, audit-service, approvals, ai-gateway, runtime) er med,
- at netværksallowlisten er eksplicit og ikke krydser miljøer eller indeholder wildcards,
- at **ingen hemmelighed står i klartekst** (PEM eller værdier),
- at break-glass ejes af et navngivet menneske, kræver godkendelse og er tidsbegrænset til højst 240 minutter,
- at omkostningsposterne summer til det registrerede månedsbeløb.

## IaC (OpenTofu)

Modulet [`infrastructure/iac/small-vps/`](../../infrastructure/iac/small-vps)
provisionerer den valgte profil:

- **privat netværk** (`hcloud_network`) og en **default-deny firewall** med kun HTTPS (443) og SSH fra et administrator-CIDR,
- en **k3s-server** med pinnet version,
- **krypteret block-storage** (`hcloud_volume`) og DNS (`cloudflare_record`),
- **cert-manager** med en ClusterIssuer (Let's Encrypt) og **external-secrets** mod Vault,
- **Argo CD**, der fører klyngen til GitOps-tilstanden i git.

Kubernetes-applikationerne deployes af Argo CD fra `gitops/apps/<miljø>` — ikke
af OpenTofu. `make infrastructure-iac-check` kører en statisk kontrol
(pinnede providere, default-deny firewall, kryptering, privat netværk, sensitive
outputs, ingen klartekst-hemmeligheder).

## Miljøadskillelse

| Miljø | Namespace | Isolation | Replika | TLS-issuer |
| --- | --- | --- | --- | --- |
| dev | `platform` | namespace (eksisterende reference) | 1 | letsencrypt-staging |
| staging | `platform-staging` | namespace | 2 | letsencrypt-staging |
| prod | `platform-prod` | cluster | 3 | letsencrypt-prod |

`make infrastructure-render` genererer deterministisk GitOps-manifester og
Argo CD-apps for **staging og prod** fra planen. `dev` er den eksisterende
reference og genskabes ikke.

## Netværksisolering

Hver namespace har en `default-deny`-NetworkPolicy for både ingress og egress.
Derefter lukkes der eksplicit op for DNS, intern trafik i samme namespace og
model-egress fra ai-gateway til navngivne FQDN'er. `infrastructure/src/netpol.mjs`
afviser:

- en manglende eller ufuldstændig default-deny,
- en tom `namespaceSelector` (alle namespaces),
- et wildcard-IP (`0.0.0.0/0`),
- egress til et andet miljøs namespace.

Det er den statiske dokumentation for, at et workload ikke kan nå en anden
kundes database. Den levende håndhævelse kræver en klynge (NOT RUN her).

## Secrets

Secrets er referencer, ikke værdier. `infrastructure/src/secrets.mjs` afviser et
committet `Secret`-objekt, en reference til en udeklareret secret, en ubrugt
deklareret secret og klartekst-materiale. Injektion sker via external-secrets
(staging) eller Vault (prod).

## TLS, DNS og storage

Ingress bruger en cert-manager-issuer og en TLS-secret; DNS peger på
k3s-serverens IP; applikationsdata ligger på et krypteret
`PersistentVolumeClaim`. Alle tre dele er en del af planen og valideres.

## Bootstrap, nøgleforvaltning og break-glass

- [`docs/runbooks/bootstrap.md`](../runbooks/bootstrap.md) — trinene fra tom konto til staging.
- [`docs/runbooks/key-management.md`](../runbooks/key-management.md) — backends, rotation og forbud mod nøgler i git.
- [`docs/runbooks/break-glass.md`](../runbooks/break-glass.md) — autoriseret, tidsbegrænset break-glass.

`infrastructure/src/break-glass.mjs` er en ren autorisationsfunktion: en agent
kan ikke anmode eller godkende, forfatteren kan ikke godkende sig selv, scope og
varighed håndhæves, og tilladelsen udløber automatisk.

## Omkostning

`make infrastructure-cost` registrerer stagingomkostningen i
[`docs/costs/staging.json`](../costs/staging.json) fra planens poster. Posterne
skal summer til månedsbeløbet.

## Drift

`make infrastructure-drift` sammenligner den ønskede tilstand i git med den
observerede tilstand i klyngen via `gitops/src/reconcile.mjs`. Den ægte kontrol
kræver `kubectl` og en `KUBECONFIG` mod staging; uden dem er resultatet **NOT
RUN** med en begrundelse. Et simuleret JSON-objekt tæller ikke.

## Kommandoer

```sh
make infrastructure-render      # generér manifester, apps og omkostning
make infrastructure-check       # plan, IaC, rendering, netværk, secrets, omkostning
make infrastructure-test        # enhedstests for hele modulet
make infrastructure-verify      # GitOps-gates for dev/staging/prod + isolation
make infrastructure-iac-check   # statisk OpenTofu-kontrol
make infrastructure-cost        # registrér stagingomkostningen
make infrastructure-drift       # rigtig drift eller NOT RUN
```

## Ærlige begrænsninger

Der findes **ingen stagingklynge**, og `tofu`, `terraform`, `kubectl`, `helm`
og `kustomize` er ikke installeret i dette miljø. Derfor er
`integration-staging-provision` og `integration-staging-drift` **NOT RUN**.
Det, der er efterprøvet her, er den statiske IaC-kontrol, den deterministiske
rendering, miljøadskillelsen, netværksisoleringen, secret-injektionen,
break-glass-guarden, omkostningsintegriteten og reconcile mod injiceret
observeret tilstand. Se [ADR-0033](../adr/0033-reproducerbar-staging-og-iac.md).
