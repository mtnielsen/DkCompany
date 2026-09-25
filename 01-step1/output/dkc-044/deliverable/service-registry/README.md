# Service-registry (DKC-044)

Den autoritative servicekatalog og on-call-rotation for serviceprocessen.
Adapteren (`modules/itsm-adapter/`) og conformance-valideringen læser herfra.

| Fil | Indhold |
| --- | --- |
| `services.json` | `ServiceCatalog`: tjenester med menneskelig ejer, on-call-rotation, kommunikationskanal, runbook, SLA (sev1–sev4), OLA, CI-relationer og vidensartikler. |
| `oncall.json` | `OnCallRotationSet`: primær/sekundær/manager og en strengt stigende eskalationskæde af navngivne mennesker. |
| `src/catalog.mjs` | Ren fortolkning: transitive afhængigheder, ejer-/rotationsopslag, eskalationsmål og kvitteringsfrister. |
| `test/catalog.test.mjs` | Enhedstests for fortolkningen. |

Principper:

- En tjeneste har altid et **navngivet menneske** som ejer og en runbook.
- Den vagthavende og hvert eskalationstrin er mennesker; en AI er aldrig
  on-call eller eskalationspunkt.
- Eskalationskæden er strengt stigende, og første trin matcher
  kvitteringsfristen.
- Kataloget valideres semantisk af `conformance/src/itsm.mjs` (kør
  `make itsm-adapter-test`).
