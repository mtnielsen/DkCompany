# Runbook: bootstrap af staging

Formålet er at oprette en tom staginginstallation fra kode og nødvendige
secrets. Alt nedenstående er den dokumenterede vej; intet trin afhænger af en
manuelt gættet tilstand.

## 0. Forudsætninger

- En cloud-konto til den valgte hostingprofil og et DNS-område.
- En secret-backend (Vault eller external-secrets) med de nødvendige poster.
- `tofu` (eller `terraform`), `kubectl`, `helm` og `argocd` installeret på den maskine, der kører bootstrap.

## 1. Provisionér infrastrukturen

```sh
cd infrastructure/iac/small-vps
tofu init
tofu validate
tofu plan  -var-file=env/staging.tfvars
tofu apply -var-file=env/staging.tfvars
```

Modulet opretter privat netværk, default-deny firewall, k3s-server, krypteret
storage, DNS samt cert-manager og external-secrets.

## 2. Læg secrets i backenden

Intet hemmeligt materiale må ligge i git. Opret de poster, planen refererer til
(se [`infrastructure/plan.json`](../../infrastructure/plan.json)):

- `staging-pdp-signing` (nøglen til at signere policy-bundles),
- `staging-db` (brugernavn og adgangskode),
- `platform-release-signing` og `platform-break-glass` (nøgleforvaltning).

`make infrastructure-check` fejler, hvis et manifest refererer til en secret,
der ikke er deklareret i planen.

## 3. Før klyngen til GitOps-tilstanden

```sh
make infrastructure-render
make infrastructure-check
```

Peg Argo CD på `gitops/apps/staging`, så `selfHeal` + `prune` fører klyngen til
den ønskede tilstand. Verificér:

```sh
make infrastructure-verify
```

## 4. Verificér drift og sikkerhed

```sh
export KUBECONFIG=...
make infrastructure-drift       # skal give in-sync
make infrastructure-cost        # registrér omkostningen
```

Uden en levende klynge er drift **NOT RUN** — det er ikke det samme som grøn.

## 5. Forventet adfærd ved fejl

- **Genstart/nodefejl:** fordi ønsket tilstand er i git, genoprettes Deployments og Services af Argo CD. PVC'er og data ligger på krypteret block-storage.
- **Manglende secret:** en pod, der refererer til en ikke-injiceret secret, starter ikke og forbliver i `CreateContainerConfigError`. Det er den forventede fail-closed-adfærd; den forsøges ikke skjult.
