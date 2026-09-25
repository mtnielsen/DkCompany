<!-- Genereret af `logging/src/cli.mjs write` fra logging/logging-policy.json — rediger ikke manuelt. -->
# Logdækning (DKC-049)

> Kanonisk politik: `platform-logging` version `1.0.0`.

## Fælles korrelationsfelter

Hver logpost bærer disse felter, så et forløb kan samles på tværs af servere:

- `correlationId`
- `executionId`
- `tenantId`
- `resource`
- `incidentId`
- `changeId`
- `traceId`

## Provenance (adskilt)

Klasser: `sensor`, `model`, `verified`, `human`, `system`. Adskilte: `true`.

Et modeludsagn kan ikke optræde i samme post som en sensorobservation eller et verificeret resultat.

## Retention og arkiv pr. dataklasse

| Dataklasse | Retention (dage) | Immutabelt krav | Arkivmål (fejldomæne) |
| --- | --- | --- | --- |
| Operationel | 365 | nej | `primary` (fsn1), `worm-external` (hel1, WORM) |
| Personhenførbar | 90 | ja | `primary` (fsn1), `worm-external` (hel1, WORM), `worm-offline` (ash1, WORM) |
| Sikkerhed | 730 | ja | `primary` (fsn1), `worm-external` (hel1, WORM), `worm-offline` (ash1, WORM) |

Mindste antal uafhængige fejldomæner: **3**.

## Læseadgang

Default-deny: `true`. Læseroller: `auditor`, `security-owner`, `platform-admin`.
Logadgang logges selv: `true`.

## Tidsynkronisering og redaktion

Maksimal tidsforskydning: **300 s**. Monotone sekvenser: `true`.

Persondatapolitik: `minimize-and-digest`. Skjulte ræsonneringsfelter fjernes: `chainOfThought`, `reasoning`, `internalThoughts`, `scratchpad`.
