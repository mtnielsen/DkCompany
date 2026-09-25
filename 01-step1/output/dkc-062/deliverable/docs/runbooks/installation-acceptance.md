# Runbook: installations- og releaseacceptance

Denne runbook beskriver en menneskelig accept af en installation på en ren
understøttet VPS, en lokal server eller en HA-klynge. Runbooken er dokumentation;
den udfører ingen mutation selv.

## Forberedelse

1. Bekræft det præcise commit og den præcise artefakt-digest der skal accepteres.
2. Vælg acceptmålet (profil, platform og eventuelle tilvalg) og læs
   `distribution/acceptance/gate-policy.json`.
3. Kør `make acceptance-render` og læs `docs/pilot/acceptance-report.md`.

## Trin

1. **Kør de deterministiske rejser.** `make acceptance-run`. Alle rejser for
   målet skal bestå. En fejlende rejse stoppes, ikke undertrykkes.
2. **Kør acceptkontrollen.** `make acceptance-check`. Den afviser en rapport der
   er ude af trit, manglende forudsætningskapabiliteter og et rollebrud.
3. **Udfør den faktiske installation** på den rene VPS/lokale server/HA efter
   `docs/runbooks/installation.md` og `docs/runbooks/ha-failover.md`.
4. **Mål de aktive gates** mod den levende installation:
   - fælles gates: sikkerhed, privacy, restore og rolle,
   - HA: quorum, N+1, failover inden for servicemålet (DKC-038–043, DKC-050–052),
   - host management: enrollment, lukkede operationer og recoveryvej (DKC-058),
   - immutable: WORM-håndhævelse og bypass-tests (DKC-047–049),
   - self-healing: godkendt runbook, lease/cooldown og en uafhængig menneskelig
     recoveryøvelse (DKC-045–046).
5. **Registrér ejeraccepten** pr. aktiv gate i
   `distribution/acceptance/owner-acceptance.json` med commit, artefakt-digest,
   profil og et bevis-reference. Se
   [docs/operations/installation-acceptance.md](../operations/installation-acceptance.md).
6. **Genkør `make acceptance-check`.** Først når alle aktive gates har både
   testbevis og registreret ejeraccept, bliver beslutningen `accepted`.

## Stopbetingelser

- En aktiv gate uden gyldigt, friskt og commit/artefakt-bundet testbevis.
- En manglende forudsætningskapabilitet for en aktiv gate.
- Et rollebrud (rotation, alias eller subagent).
- En ejeraccept der er forældet, givet af en uautoriseret rolle eller bundet til
  et andet commit/artefakt.

Stands accepten og eskalér til den menneskelige ejer. Registrér ikke en accept på
et ufuldstændigt grundlag.

## Roller

- **Responsible:** Platform Owner (og Deputy Platform Owner som stedfortræder).
- **Accountable:** Security Owner for sikkerheds-/host-gates, Data Protection
  Officer for privacy-/immutable-gates.
- **Consulted/Informed:** se `distribution/acceptance/raci.json`.
