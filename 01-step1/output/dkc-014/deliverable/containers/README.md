# Containerbuilds (DKC-014)

Kontroltjenesterne bygges som containere med en fælles formel:

- **Base-images er pinnet på digest.** `base-images.lock.json` er den ene
  kilde. `supply-chain/src/containers.mjs` afviser et Dockerfile, hvis en
  `FROM`-linje ikke er `@sha256:<64 hex>` eller ikke matcher låsen.
- **Kørsel som non-root.** Den sidste stage skal sætte `USER` til en ikke-root
  bruger. Distroless `:nonroot` bruges som runtime.
- **Ingen hemmeligheder i build-args eller miljø.** Et `ARG`/`ENV`-navn der
  ligner en hemmelighed afvises.
- **Kilden er repository-roden.** Build-konteksten er repository-roden, og
  Dockerfilen kopierer kun den relevante tjeneste.

Kataloget `containers.json` binder hver tjeneste til sit repository og sin
Dockerfile. `release/artifacts.json` genereres ud fra kataloget, så GitOps kun
kan installere det, CI faktisk har bygget.

## Byg

```sh
make supply-chain-containers-check   # statisk kontrol af Dockerfiles og lås
make supply-chain-containers-plan    # vis de præcise docker buildx-kommandoer
make supply-chain-containers-build   # kræver Docker; ellers NOT RUN
```

I dette miljø er Docker ikke tilgængeligt i WSL-distroen
(`docker` er en Windows-shim), så `containers-build` registreres som
`NOT RUN`. Den statiske kontrol og byggeplanen er ægte og kørbare.
