# Runbook: nøgleforvaltning

## Princip

Private nøgler committes **aldrig**. Repositoriet indeholder kun offentlige
halvdele (fx `release/trust/release-keys.json`, `policy/keys/trusted.json`) og
referencer til de secrets, der injiceres i klyngen.

## Backends

| Nøgle | Backend | Rotation | Formål |
| --- | --- | --- | --- |
| `platform-release-signing` | Vault | 90 dage | Signering af releaseartefakter (DKC-014) |
| `platform-pdp-signing` | Vault / external-secrets | 90 dage | Signering af policy-bundles |
| `platform-break-glass` | Vault | 90 dage | Break-glass-adgang |

`infrastructure/src/hcl.mjs` afviser et OpenTofu-modul med en klartekst-nøgle, og
`infrastructure/src/secrets.mjs` afviser et committet `Secret`-objekt eller en
klartekst-hemmelighed i et GitOps-manifest.

## Rotation

1. Opret den nye nøgle i backenden.
2. Publicér den nye offentlige halvdel i repoet (fx gennem en ændring med CODEOWNERS-review).
3. Rul arbejdsbelastningerne, så de læser den nye version.
4. Tilbagekald den gamle nøgle og verificér, at intet længere bruger den.
5. Registrér rotationen i change loggen.

`rotationDays` i planen skal ligge mellem 1 og 365 dage og valideres i
`make infrastructure-check`.
