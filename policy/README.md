# Policy

Tomt i bølge 0. Her lander policy-bundles i bølge 1 (punkterne 1.1 og 1.2).

Princippet, der allerede nu styrer kontrakterne: **moduler og agenter spørger; de beslutter ikke selv.** Et modul uden PDP-kald skal fejle konformans. Derfor findes `policy-allow` allerede som påkrævet bevis i `agent-manifest.schema.json`, og approval-payloaden har en `evidence.policyEvaluation` med `pdp`, `bundleVersion` og `decision`.

Når bølge 1 begynder:

- `policy/bundles/` — versionsstyrede og signerede OPA-bundles.
- `policy/tests/` — regeltests, der kører i CI før bundlen publiceres.
- `policy/README.md` — hvordan en bundle bygges, signeres og rulles ud.
