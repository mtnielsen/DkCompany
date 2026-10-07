# ADR-0011: Sikkerhedsfund normaliseres ind i OSCAL-evidensplanen

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2025-09-01
- **Beslutningsdrev:** Tre scannere i tre formater bliver tre rapporter, ingen læser. En revisor skal møde ét bevis, ikke en værktøjskasse.

## Kontekst og problemstilling

3.4 kræver Trivy (CI), Falco (runtime) og Wazuh (SIEM) koblet ind i evidensplanen, ikke som separat silo. De tre værktøjer har hvert sit outputformat og hver sin severity-skala. Hvis hver scanner får sin egen rapport, duplikeres evidensindsamlingen, og OSCAL-pakken fra 3.1 dækker ikke sikkerhedstilstanden. Samtidig må et rent scan ikke fremstilles som et grønt lys, hvis det kun betyder "ingen kritiske fund".

## Beslutningskriterier

- Fundene skal kunne læses af OSCAL-emitteren og indgå i den samme pakke.
- Severity og status skal normaliseres konservativt og ens på tværs af værktøjer.
- Rårapporten skal kunne spores (sti og hash), så et fund kan verificeres.
- Et fund må ikke fejle bygget alene; evidens skal registrere, ikke skjule.
- Nye scannere skal kunne tilføjes uden at ændre kontrakten.

## Overvejede muligheder

- **Tre separate rapporter.** Enkelt pr. værktøj, men ingen samlet evidens og tre formater for revisoren.
- **Lad OSCAL-emitteren forstå hvert scannerformat.** Ingen mellemled, men emitteren vokser med hver scanner.
- **Normalisér til én SecurityFindings-kontrakt, og lad OSCAL læse den.** Vores valg.
- **Kun Trivy i CI.** Dækker ikke runtime og SIEM, som backloggen kræver.

## Beslutning

1. `contracts/security-findings.schema.json` definerer én pakke af normaliserede rapporter med scanner, target, severity-optælling, status og de enkelte fund.
2. `security/src/normalize.mjs` oversætter Trivy, Falco og Wazuh til den kontrakt. Severity mappes til critical/high/medium/low; status er `fail` ved critical/high, `partial` ved medium/low og `pass` ved ingen fund.
3. `security/src/cli.mjs` skriver `security/generated/security-findings.json`, validerer den mod kontrakten og fejler i `make security-check`, hvis den er ude af trit med rådata.
4. `evidence/src/oscal.mjs` tilføjer resultatet **Sikkerhed (Trivy/Falco/Wazuh)** med én observation pr. scanner (rårapport + sha256 som `relevant-evidence`) og ét finding pr. scanner (`SEC-trivy`, `SEC-falco`, `SEC-wazuh`).
5. Trivy kører i CI med `exit-code: 0`; fundet registreres i evidensen frem for at fejle bygget. En organisation kan stramme det.

## Konsekvenser

- **Positive:** Ét bevis for kode-, runtime- og SIEM-laget. Samme statusregler som resten af platformen. Rårapporten kan spores. Nye scannere kræver kun en normaliseringsfunktion.
- **Negative:** Normaliseringen skal vedligeholdes, når scannernes formater ændres. Samples i repoet kan ikke erstatte et rigtigt scan; CI kører Trivy, men Falco og Wazuh kræver en klynge.
- **Neutrale:** `exit-code: 0` er et bevidst valg om ærlig evidens frem for et grønt byggeri.

## Mere information

- [`docs/spec/security-plan.md`](../spec/security-plan.md)
- [`contracts/security-findings.schema.json`](../../contracts/security-findings.schema.json)
- [ADR-0008](0008-oscal-evidensprofil.md), [ADR-0009](0009-kontrolmapping-roller.md)
