# Supportbundle og diagnostik

Supportbundlen bygges ud fra `support/policy.json`s allowlist. Formålet er at
kunne diagnosticere uden at flytte hemmeligheder, personalesager eller
kontrol over installationen ud af kundens domæne.

## Regler

- **Redigering:** alle kendte følsomme feltnavne erstattes med `[REDACTED]`.
- **Hemmelighedsscanning:** rå nøgler/tokens (`sk-…`, `ghp_…`, private nøgler,
  JWT'er) blokerer bundlen (fail-closed).
- **HR-scanning:** løn, sygefravær, fagforeningsforhold, personalesager og
  helbredsoplysninger er forbudte indholdsklassser og blokerer bundlen.
- **Ingen skjult fjernadgang:** `hiddenAccess` er altid `false`. Fjernadgang er
  default-deny og kræver et navngivent menneskes samtykke med en TTL og et
  revisionsspor.
- **Allowlist:** kun kilder i `support/policy.json` må indsamles.

## Byg en bundle

```bash
node installer/src/lifecycle-cli.mjs support
```

Bundlen indeholder kun allowlistede kilder, er redigeret, har bestået
hemmeligheds- og HR-scanningen og erklærer eksplicit, at der ikke findes skjult
fjernadgang. Diagnostik afvises, hvis den indeholder en hemmelighedssignatur.
