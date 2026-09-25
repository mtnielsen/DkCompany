# Runbook — sikkerhedsvurdering og assessment-gate (DKC-065)

Denne runbook beskriver den konkrete rækkefølge for at forberede og køre en
sikkerhedsvurdering. Den autoriserer **ikke** levende penetrationstest.

## 0. Forudsætninger

- [ ] `security-assessment/rules-of-engagement.json` er opdateret og ejet af et
      navngivet menneske.
- [ ] Kun `local-loopback` er `authorized: true` i den forberedte tilstand.
- [ ] Tidsvinduet er åbent, og stopbetingelser/nødkontakter er kendte.

## 1. Kør den isolerede harness

```bash
make security-assessment-run
```

Forventet: 17/17 sonder bestået mod `local-loopback`. Ingen eksterne kald.

## 2. Byg og validér

```bash
make security-assessment-write
make security-assessment-check
```

Forventet: dækningen er komplet og gaten er `blocked`/`outstanding`.

## 3. Importér assessorfund (når en uafhængig assessor findes)

```bash
node security-assessment/src/cli.mjs import \
  --findings <raw-findings.json> \
  --retests <raw-retests.json> \
  --out security-assessment/assessment.json
make security-assessment-check
```

- [ ] Secrets/persondata er redigeret væk i evidensen.
- [ ] Retest peger på det rettede artefakt.
- [ ] Et ændret artefakt har en `impactReview`.

## 4. Registrér den uafhængige vurdering og beslutningen

- [ ] `independentAssessment` udfyldt af en assessor, der ikke er implementer.
- [ ] `releaseDecision` godkendt af et navngivet menneske.
- [ ] `status: complete`.

## 5. Evaluer gaten

```bash
make security-assessment-gate
```

- [ ] `eligible` **kun** når alle dækningskategorier består, ingen blokerende
      fund er åbne, en frisk uafhængig vurdering findes, og et navngivet menneske
      har godkendt.
- [ ] Ellers: stop. Opret ikke en release.

## 6. Efter release

- [ ] Enhver ændring af en trust-boundary udløser en ny vurdering eller en
      dokumenteret impact review.
- [ ] `make baseline` og `make release-check` skal bestå.

## Nødstop

Ved uventet mutation, krydskunde-lækage eller kørsel uden for vinduet: afbryd,
bevar evidens, og kontakt Platform Owner/Security Owner.
