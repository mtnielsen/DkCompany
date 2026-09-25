# Forsyningskæde (DKC-014)

> Genereret af `supply-chain/src/cli.mjs`. Kun artefakter der er byggede og signerede må installeres af GitOps; pladsholder-digests og usignerede images afvises af `make supply-chain-verify`.

**SBOM:** `release/sbom/platform-sbom.cdx.json` · **digest:** `sha256:b5e5386e6a278db61b849fa6e175b0eb42be7ba4522cdfb6d859a22d30ffed35` · **komponenter:** 42
**Kilde-commit:** `83ad91a963d8055f77c29fb4361455689df95acb` · **manifestversion:** 1.0.0

## Artefakter

| Artefakt | Type | Status | Digest | Signatur | Grund |
| --- | --- | --- | --- | --- | --- |
| `platform-sbom` | sbom | BYGGET, USIGNERET | `b5e5386e6a278db6…` | — | SBOM'en genereres deterministisk lokalt; releasesignaturnøglen ligger i CI-hemmeligheden og er ikke tilgængelig i dette miljø. |
| `ghcr.io/example/platform-pdp` | container-image | IKKE BYGGET | — | — | Docker er ikke tilgængelig i dette miljø; containerbilledet kan ikke bygges eller signeres her. |
| `ghcr.io/example/platform-ai-gateway` | container-image | IKKE BYGGET | — | — | Docker er ikke tilgængelig i dette miljø; containerbilledet kan ikke bygges eller signeres her. |
| `ghcr.io/example/audit-service` | container-image | IKKE BYGGET | — | — | Docker er ikke tilgængelig i dette miljø; containerbilledet kan ikke bygges eller signeres her. |
| `ghcr.io/example/mattermost-adapter` | container-image | IKKE BYGGET | — | — | Docker er ikke tilgængelig i dette miljø; containerbilledet kan ikke bygges eller signeres her. |
| `ghcr.io/example/keycloak-adapter` | container-image | IKKE BYGGET | — | — | Docker er ikke tilgængelig i dette miljø; containerbilledet kan ikke bygges eller signeres her. |
| `ghcr.io/example/platform-approvals` | container-image | IKKE BYGGET | — | — | Docker er ikke tilgængelig i dette miljø; containerbilledet kan ikke bygges eller signeres her. |
| `ghcr.io/example/platform-runtime` | container-image | IKKE BYGGET | — | — | Docker er ikke tilgængelig i dette miljø; containerbilledet kan ikke bygges eller signeres her. |

## Containere

| Tjeneste | Repository | Dockerfile | Status |
| --- | --- | --- | --- |
| pdp | `ghcr.io/example/platform-pdp` | `containers/pdp/Dockerfile` | IKKE BYGGET |
| ai-gateway | `ghcr.io/example/platform-ai-gateway` | `containers/ai-gateway/Dockerfile` | IKKE BYGGET |
| audit-service | `ghcr.io/example/audit-service` | `containers/audit-service/Dockerfile` | IKKE BYGGET |
| mattermost-adapter | `ghcr.io/example/mattermost-adapter` | `containers/mattermost-adapter/Dockerfile` | IKKE BYGGET |
| keycloak-adapter | `ghcr.io/example/keycloak-adapter` | `containers/keycloak-adapter/Dockerfile` | IKKE BYGGET |
| approvals | `ghcr.io/example/platform-approvals` | `containers/approvals/Dockerfile` | IKKE BYGGET |
| runtime | `ghcr.io/example/platform-runtime` | `containers/runtime/Dockerfile` | IKKE BYGGET |

## Betroede signaturnøgler

| Nøgle-id | Algoritme | Ejer |
| --- | --- | --- |
| `8042494d66640bc7` | ed25519 | Cecilia Christensen |

## Sårbarhedsscanning

**Kilde:** https://api.osv.dev · **Økosystem:** npm · **Spurgt:** 2026-09-23T14:36:11.979Z

**Resultat:** 0 advisories på 6 pakker — 0 blokerende, 0 undtaget.

Ingen kendte advisories for de låste versioner.

## Ærlige begrænsninger

- **Containerbuild og -publicering er NOT RUN.** Docker er ikke tilgængeligt i dette miljø, så ingen container er bygget, scannet eller publiceret her.
- **Signering af containere er NOT RUN.** Den private releasesignaturnøgle ligger i CI-hemmeligheden og findes ikke i dette miljø.
- **SBOM'en er bygget og digest-bundet**, men usigneret indtil CI signerer den.
- GitOps-manifesterne i `dev` bærer bevidste pladsholder-digests; gaten afviser dem, indtil rigtige byggede digests er pinnet.

---

En grøn statisk kontrol er ikke et byggeri. `NOT RUN` er ikke det samme som PASS.
