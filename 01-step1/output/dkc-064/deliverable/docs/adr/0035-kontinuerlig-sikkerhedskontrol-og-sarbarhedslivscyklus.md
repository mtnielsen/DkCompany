# ADR-0035: Kontinuerlig sikkerhedskontrol og en sporet sårbarhedslivscyklus

- **Status:** accepteret
- **Beslutningstagere:** Cecilia Christensen (Security Owner), med Anna Andersen (Platform Owner) som stedfortræder
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-064. En enkelt Trivy-kørsel i CI er ikke en sårbarhedsproces. Risici fra kode, afhængigheder, secrets, images, infrastruktur og en kørende installation skal findes, normaliseres, dedupliseres, ejes og lukkes — og et fravær af fund på en gammel image må ikke frikende en anden deployeret version.

## Kontekst og problemstilling

- **Siloer.** DKC-014 normaliserede npm-advisories, og DKC-003's security-pakke normaliserede Trivy/Falco/Wazuh, men der fandtes ingen fælles beholdning med ejer, frist og livscyklus.
- **Dedup uden tab.** Samme CVE kan dukke op i flere scannere. Kilden skal bevares, ikke overskrives.
- **Prioritet.** Alvor alene siger ikke nok; interneteksponering, multi-tenant blast radius, forretningspåvirkning og aktivt udnyttelsesbevis (KEV/EPSS) ændrer rækkefølgen.
- **AI-undertrykkelse.** En agent må ikke kunne erklære et fund mitigeret eller falsk-positivt uden et navngivet menneske.
- **Restriance.** Kun et navngivet menneske kan acceptere restriance, og udløb skal genåbne fundet.
- **Verifikation.** En rettelse er først lukket, når en uafhængig identitet har verificeret den på det deployede artefakt (DKC-055's rolleadskillelse).
- **Dækning.** En scannerfejl, et forældet advisory-feed eller et ukendt inventar er `unknown`, ikke `pass`.
- **Miljøet.** Trivy, OSV-scanner, Semgrep, Gitleaks og en isoleret stagingklynge er ikke installeret/tilgængelig her. Beholdningen bygges fra committede, repræsentative scannerfixtures; de rigtige scannere er NOT RUN.

## Beslutningskriterier

- Én versioneret kontrakt for den normaliserede beholdning.
- Dedup på tværs af scannere med bevaret proveniens.
- Deterministisk, forklarlig prioritet fra alvor + eksponering + påvirkning + udnyttelse.
- Menneskelig livscyklus: mitigated/false-positive/fixed/accepted/accepted-udløb.
- Dæknings- og rekonsiliationsrapport, hvor ukendt aldrig er grøn.
- Syntetiske fixtures, herunder en falsk secret-canary, uden rigtige hemmeligheder.
- Genbrug af vedligeholdte scannere; rigtige kørsler i CI, fixtures offline.

## Overvejede muligheder

- **Kun DKC-014's npm-scanning.** Dækker ikke images, IaC, kode eller secrets.
- **Kun DKC-003's SecurityFindings.** Har ikke dedup, ejer, frist, livscyklus eller dekning.
- **Normaliseret beholdning + dedup + livscyklus + dækningsrekonsiliation.** Kræver vedligeholdelse, men gør risikoen sporet og efterprøvelig i dag og ærlig i CI.

## Beslutning

Vi indfører en sporet sårbarhedslivscyklus, håndhævet i
`contracts/vulnerability-inventory.schema.json`,
`conformance/src/vulnerability.mjs` og `vulnerability-management/`:

1. **Beholdning.** `VulnerabilityInventory` med scannerkørsler, komponenter, fund, undtagelser, dækning og rekonsiliation.
2. **Normalisering og genbrug.** `vulnerability-management/src/scanners.mjs` genbruger Trivy (image/IaC), OSV-scanner (afhængigheder), Semgrep (statisk kode) og Gitleaks (secrets). En scanner uden output registreres `unsupported` med `0/1` dækning.
3. **Dedup.** `dedupFindings()` fletter samme advisory på samme asset+version og bevarer alle `sources`.
4. **Prioritet.** `computePriority()` vægter alvor, interneteksponering, multi-tenant, forretningspåvirkning, KEV og EPSS.
5. **Livscyklus.** `effectiveStatus()` kræver menneske for mitigated/false-positive, uafhængig menneskelig verifikation for fixed, og en gyldig menneskelig undtagelse for accepted. Udløb genåbner.
6. **Dækning og rekonsiliation.** `coverageReport()` og `reconcileInventory()`; den erklærede dækning skal matche den beregnede, og en image-komponent uden matchende scannerdigest er `unknown`.
7. **Fixtures.** Syntetiske Trivy/OSV/Semgrep/Gitleaks-rapporter og en bevidst falsk canary; ingen rigtige hemmeligheder.
8. **Release-gate.** `REQ-VULN-001` kræver `vulnerability-check`, `vulnerability-test` og den eksterne `integration-vulnerability-scan`.

Resultatet valideres i `make vulnerability-write`, `make vulnerability-check` og
`make vulnerability-test`; de rigtige scannere kører via `make vulnerability-scan`
(NOT RUN her).

## Konsekvenser

- **Positive:** Risici er normaliseret, deduplikeret og ejet; prioritet er forklarlig; AI kan ikke undertrykke; menneskelig restriance udløber; ukendt dækning er aldrig grøn.
- **Negative:** Beholdningen skal holdes i sync med fixtures/politik, og en fuld dækning kræver de rigtige scannere og en stagingklynge.
- **Neutrale:** De eksisterende security- og supply-chain-pakker bevares; den nye beholdning er den samlende livscyklus oven på dem.

## Mere information

- [`docs/spec/vulnerability-management.md`](../spec/vulnerability-management.md)
- [`docs/runbooks/vulnerability-response.md`](../runbooks/vulnerability-response.md)
- [`contracts/vulnerability-inventory.schema.json`](../../contracts/vulnerability-inventory.schema.json),
  [`conformance/src/vulnerability.mjs`](../../conformance/src/vulnerability.mjs),
  [`vulnerability-management/`](../../vulnerability-management)
- [ADR-0011](0011-sikkerhedsfund-i-evidensplanen.md), [ADR-0018](0018-stram-policy-scope-og-evidenkontrol.md), [ADR-0020](0020-en-rolle-pr-agent.md), [ADR-0028](0028-testmatrix-og-releasegates.md), [ADR-0032](0032-reproducerbare-artefakter-og-releasevej.md), [ADR-0034](0034-adskil-kontrakt-og-driftsbevis.md)
