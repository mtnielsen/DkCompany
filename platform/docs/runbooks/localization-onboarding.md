# Runbook: onboarding af en ny forretningsfamilie (DKC-035)

En ny familie (fx produktion eller feltservice) registreres i kataloget **før**
nogen adapter bygges. Følg rækkefølgen nedenfor.

1. **Vælg kandidat og begrund fravalg.** Tilføj et `IntegrationCandidate` i
   `contracts/examples/integration-candidate.<produkt>.example.json` med eksakt
   version, licens, hosting, SSO, API, isolation, eksport, backup,
   gratis/betalt-skel og en navngiven verifikator. Kandidaten forbliver
   `candidate_not_approved` uden en menneskelig godkendelse.
2. **Definér adaptergrænsefladen.** Tilføj grænsefladen i
   `localization/adapter-interfaces.json` med driftsverber, scopes, dataklasser
   og eventuelt `externalServiceRequired`. Betaling og bankadgang skal altid
   forbyde `bank:full-access` og kortdata.
3. **Tilføj lokaliseringskrav.** Genbrug eksisterende krav, eller tilføj et nyt
   i `localization/locale-requirements.json`. Et nyt krav starter `unreviewed`
   med et navngivet ansvar.
4. **Tilføj katalogkomponenten.** Opret
   `catalog/components/<navn>.component.json` med tekniske afhængigheder,
   datatjenester, migrationer, ressourcer og en `localization`-blok.
5. **Registrér familien.** Tilføj familien i `localization/families.json` med
   en unik rækkefølge og en begrundelse.
6. **Bind til release.** Tilføj `REQ-*` og `THREAT-*` i
   `release/matrix/{test-matrix,threats}.json` og registrér checkene i
   `tools/baseline/registry.mjs`.
7. **Validér.**
   ```bash
   make localization-check && make localization-test
   make localization-render && make localization-check
   make distribution-check && make validate && make release-check
   ```
8. **Stop ved gaten.** Familien forbliver `pending-legal-review`, indtil en
   navngivet fagperson har bekræftet de relevante krav. En registrering er ikke
   en fungerende applikation.
