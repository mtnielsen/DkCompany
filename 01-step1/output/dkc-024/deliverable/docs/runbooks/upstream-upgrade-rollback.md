# Runbook: opgradering og rollback af en upstream-adapter

> DKC-024. Gælder Mattermost- og Keycloak-adapterne og genbruger det
> almindelige policy-/godkendelses-/executor-flow (DKC-004, DKC-007, DKC-013).

## Formål

Opgrader én pinnet upstream-version/edition sikkert, med frisk backup,
verificeret gendannelse og et eksplicit rollback-punkt. En opgradering er en
irreversibel, gated ændring. Den må ikke udføres som et direkte
administratorindgreb uden om godkendelsen.

## Forudsætninger

- `make adapter-live-check` er grøn, og den ønskede version ligger inden for
  releaseprofilens understøttede serie.
- Kandidaten erklærer backup understøttet og en afprøvet gendannelse.
- En navngiven menneskelig ejer har godkendt planen (dens digest, miljø, mål og
  parameter).
- Der er et annonceret vedligeholdelsesvindue og ledig kapacitet til både den
  gamle og den nye version under skiftet.

## Trin

1. **Generér planen** og læg den til godkendelse:

   ```bash
   make adapter-live-plan
   make adapter-live-write
   make adapter-live-check
   ```

2. **Bekræft backup** taget efter sidste ændring, og at en gendannelse er
   verificeret i et isoleret miljø. Notér digest og versionsstempel.

3. **Dræn** adapteren: stop nye skrivninger, lad igangværende kald afslutte.

4. **Tag øjebliksbillede** umiddelbart før ændringen og registrér digesten.

5. **Opgrader** upstream (udskift container/binære) og lad upstreams egne
   migrationer køre.

6. **Verificér** før trafik genåbnes:
   - `health` rapporterer målversionen som `supported`,
   - central identitet (OIDC) og tenantbinding virker,
   - `locate`/`export`/`erase` med syntetiske data matcher releaseprofilens
     conformance (ærligt `partial`, hvor det gælder).

7. **Genåbn** for trafik og overvåg fejlrate, latenstid og rate limits.

## Rollback

1. Stop trafik mod den nye version.
2. Gendan øjebliksbilledet fra trin 4 og genstart upstream.
3. Verificér at upstream rapporterer den oprindelige version.
4. Kør health, identitet og privacy-verber igen.
5. **Vigtigt:** en gendannelse kan genindføre personoplysninger, der ellers var
   slettet. Rekonsumér slettefrister og DSAR-status efter en rollback, og
   rapporter restdata ærligt.

## Eskalation

- Ukendt udfald efter en irreversibel skrivning: eskalér frem for blind retry
  (DKC-013).
- Manglende eller gammel backup: stop opgraderingen; en planlagt opgradering uden
  frisk, verificeret backup er ikke tilladt.
- Rate limits eller gentagne 429: følg `Retry-After`; opgraderingen må ikke
  fremtvinges ved at hæve scope.
