# IaC: small-vps (DKC-015)

OpenTofu-modul for den valgte hostingprofil **small-vps**: ét privat netværk,
en hærdet k3s-server, krypteret block-storage, DNS, cert-manager og
external-secrets. Kubernetes-applikationerne deployes af Argo CD fra
`gitops/apps/<miljø>` — ikke af OpenTofu.

```sh
tofu -chdir=infrastructure/iac/small-vps init
tofu -chdir=infrastructure/iac/small-vps validate
tofu -chdir=infrastructure/iac/small-vps plan  -var-file=env/staging.tfvars
tofu -chdir=infrastructure/iac/small-vps apply -var-file=env/staging.tfvars
```

I dette miljø findes `tofu`/`terraform` ikke, så `validate`/`plan`/`apply` er
**NOT RUN**. `make infrastructure-iac-check` kører en statisk kontrol af
modulet (pinnede providere, default-deny firewall, kryptering, private netværk,
ingen klartekst-hemmeligheder).
