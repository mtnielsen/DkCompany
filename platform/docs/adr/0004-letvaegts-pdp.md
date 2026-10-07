# ADR-0004: Egen letvægts-PDP bag en OPA-kompatibel kontrakt

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2025-09-01
- **Beslutningsdrev:** Policy skal være testbar i CI fra dag ét, uden at gøre en ekstern binær til en forudsætning for hele projektet.

## Kontekst og problemstilling

Backloggens 1.1 foreslår OPA som PDP. OPA er moden og velegnet, men kræver en ekstern binær eller et container-image i CI. I bølge 1 er det vigtigste ikke at vælge den endelige motor, men at fastfryse **beslutningskontrakten**: hvordan spørges der, hvad svarer PDP'en, hvordan versioneres og signeres reglerne, og hvordan fejler systemet sikkert.

Hvis kontrakten afhænger af OPA's specifikke input-form, bliver den sværere at erstatte senere. Hvis den ikke kan testes uden OPA, bliver den ikke testet.

## Beslutningskriterier

- Beslutningskontrakten skal kunne testes deterministisk i CI uden eksterne binærer.
- En senere udskiftning til OPA/Rego må ikke kræve ændringer i moduler eller agenter.
- Bundles skal kunne versioneres og signeres fra dag ét.
- Evaluatoren skal være sideeffektfri og let at ræsonnere om.

## Overvejede muligheder

- **OPA-binær i CI og produktion.** Mest korrekt på lang sigt, men tung forudsætning tidligt.
- **Rego-fortolker i Node.** For meget overflade at implementere og teste korrekt.
- **Letvægts-evaluator bag OPA's data-API-kontrakt.** Lille nok til at testes fuldt, og udskiftelig.
- **Ingen PDP nu; beslutninger i modulerne.** Bryder "moduler og agenter spørger; de beslutter ikke selv".

## Beslutning

Vi implementerer en letvægts-PDP i Node uden runtime-afhængigheder, men bag en **OPA-kompatibel kontrakt**:

- Endpoint: `POST /v1/data/platform/ops/decision`
- Request: `{ "input": { … } }`
- Response: `{ "result": { …decision… } }`

Beslutnings- og bundle-skemaerne ligger i `/contracts` og er motorens egentlige interface. Reglerne er et lille, deklarativt betingelses-DSL, der dækker de behov, vi faktisk har nu (principal, verbum, miljø, blast radius, evidens, untrusted input).

Bundle-signering sker med Ed25519 over et kanonisk JSON-digest. Den private nøgle er ikke i git.

## Konsekvenser

- **Positive:** Hele policy-laget kan testes i CI uden Docker eller OPA. Kontrakten er uafhængig af motoren, så en senere OPA/Rego-migrering er en implementeringsdetalje.
- **Negative:** Vi genopfinder en lille del af OPA. DSL'en er svagere end Rego (ingen funktioner, imports, datadokumenter). Vi accepterer det, indtil regelsættet bliver for komplekst — og har da en kontrakt at migrere bag.
- **Neutrale:** `policy-allow` optræder allerede som påkrævet evidens i agent-kontrakten, så forbindelsen til 2.x er forberedt.

## Mere information

- [`docs/spec/policy-plan.md`](../spec/policy-plan.md)
- [`policy/pdp`](../../policy/pdp), [`policy/bundles`](../../policy/bundles)
- Checks `C-009` og `C-010` i [`conformance/src/checks/policy.mjs`](../../conformance/src/checks/policy.mjs)
