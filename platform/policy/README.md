# Policy

Policy-laget for bølge 1. Moduler og agenter **spørger**; de beslutter ikke selv.

```
policy/
  bundles/platform/1.0.0/   bundle.json + bundle.sig.json (signeret regelsæt)
  keys/trusted.json         offentlige nøgler PDP'en stoler på
  keys/signing-key.json     privat nøgle (IKKE i git)
  pdp/                      beslutningsmotoren (Node, ingen runtime-afhængigheder)
```

## Kom i gang

```bash
make policy-verify   # verificér bundle-signaturen
make policy-test     # kør PDP'ens tests
make policy-decide   # træf en eksempelbeslutning
```

Start PDP'en:

```bash
node policy/pdp/src/cli.mjs serve --port 8181
curl -s localhost:8181/v1/data/platform/ops/decision \
  -H 'content-type: application/json' \
  -d '{"input":{"principal":{"kind":"agent","id":"spiffe://x","autonomyClass":"A3"},"action":{"verb":"upgrade","target":"dummy-ok","environment":"staging"}}}'
```

## Regler, versionering og signering

- En bundle ligger i `bundles/<navn>/<version>/bundle.json` og validerer mod [`contracts/policy-bundle.schema.json`](../contracts/policy-bundle.schema.json).
- `default` er altid `deny`. Højere prioritet vinder; guardrails kan ikke overrules.
- Signaturen ligger separat i `bundle.sig.json` (Ed25519 over et kanonisk digest).
- Et modul pinner `policy.bundle.{name,version,sha256}`, og `C-009` verificerer at den pinnede digest er den signerede bundle.

### Ændre regler

1. Redigér `bundles/<navn>/<version>/bundle.json` (eller opret en ny version).
2. `make policy-keygen` hvis du mangler en lokal signeringsnøgle (kun første gang).
3. `make policy-sign` — skriver ny `bundle.sig.json` og udskriver digest.
4. Opdatér `policy.bundle.sha256` i de manifester, der pinner bundlen.
5. `make ci`.

Den private nøgle er ignoreret af git. I produktion hører den hjemme i KMS/HSM.

## Fejler sikkert

`failMode: closed` betyder, at kan PDP'en ikke nås, afvises handlingen. Modulet fortsætter aldrig uden governance.

Læs mere i [`docs/spec/policy-plan.md`](../docs/spec/policy-plan.md) og [ADR-0004](../docs/adr/0004-letvaegts-pdp.md).
