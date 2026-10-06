# OSCAL-evidens-emitteren

**Kode:** [`evidence/`](../../evidence)
**Kontrakt:** [`contracts/oscal-assessment-results.schema.json`](../../contracts/oscal-assessment-results.schema.json)
**Backlog:** 3.1

> Moduler og agenter emitterer maskinlæsbar evidens for de kontroller, de påstår at opfylde.

Prosa kan overbevise en revisor om noget, der ikke er sandt. Evidenspakken gør det modsatte: den samler de rå artefakter, platformen allerede producerer, i ét dokument, hvor hvert fund peger på en fil, der kan verificeres. Emitteren dømmer ikke — den registrerer, også når et fund ikke er opfyldt.

## Hvad den læser

| Kilde | Artefakt | Bliver til |
| --- | --- | --- |
| Konformans | `.conformance-out/report.json` | Ét OSCAL-resultat pr. modul med ét finding pr. tjek (`C-*`, `A-*`) |
| Verbums-beviser | `modules/*/conformance/evidence/*.json` | Observationer med `verb-evidence`-fixturen som `relevant-evidence` |
| Policy | `modules/*/conformance/evidence/policy-decision.json` | Observation for den faktiske PDP-beslutning |
| Audit | `modules/*/conformance/events/*.json` | Observationer for CloudEvent-hændelser (menneske og agent) |
| Change control | git-historikken + `.conformance-out/CHANGELOG.jsonl` | Finding for DCO-signering og observation for change loggen |
| GitOps | `gitops/src/verify.mjs` (G-001…G-008) | Findings i resultatet «GitOps og change control» |

## Hvordan mappingen er ærlig

- `pass` → `satisfied`. Alt andet — også `skip` — bliver `not-satisfied` med den rå begrundelse. Et tjek, der ikke kunne afgøres, må ikke se ud som et, der bestod. Det følger [ADR-0003](../adr/0003-partial-conformance.md) og suitens regel om at `skip` ikke tæller som `pass`.
- Findnings bærer tjekkets id som `target.target-id` og linker til de observationer, der underbygger det (`related-observations`). Kontrolpåstandene fra modulets `compliance.controlRefs` står i `reviewed-controls`; selve kortlægningen tjek→kontrol er 3.2.
- Mangler konformansrapporten, nægter emitteren at køre. Et evidensdokument uden konformansresultater er værre end intet dokument.

## OSCAL-profilen

Dokumentet er en bevidst afgrænset profil af OSCAL 1.1 `assessment-results`. Feltnavnene følger OSCALs kebab-case (`assessment-results`, `last-modified`, `import-ap`, `reviewed-controls`, `relevant-evidence`, `target-id`), så en revisor kan læse pakken med standardværktøjer. Vi udfylder kun de felter, vi kan udfylde maskinelt, og `contracts/oscal-assessment-results.schema.json` er den kontrakt, CI håndhæver. Baggrunden for valget står i [ADR-0008](../adr/0008-oscal-evidensprofil.md).

Id'er er deterministiske: `uuidFor(navnerum:nøgle)` udleder en UUID i RFC 4122-format fra en SHA-256-hash. Samme artefakter giver samme id'er, så to kørsler kan diffes.

```
assessment-results
├── metadata          titel, version, oscal-version, roller, parter
├── import-ap         peger på platformens assessment-plan (kontrakterne + suiten)
└── results[]
    ├── <modul>                 reviewed-controls + observations + findings
    └── GitOps og change control  G-001…G-008 + DCO
```

## Sådan køres den

```bash
make conform-all        # skriver .conformance-out/report.json
make oscal-evidence     # skriver .conformance-out/oscal-assessment-results.json
make evidence-test      # validerer pakken mod kontrakten (4 tests)
```

`make oscal-evidence` har `conform-all` og `changelog` som forudsætninger, så de refererede artefakter altid findes. CLI'en exit'er 0 som standard: evidens skal registrere sandheden, også når et fund ikke er opfyldt. Brug `--strict` for at gøre manglende opfyldelse til exit 1.

## Acceptkriterier (3.1)

- [x] OSCAL-assessment-results genereres automatisk fra konformanskørsler (`make oscal-evidence`).
- [x] Alle fem kilder indgår: konformans, policy, audit, git change log og GitOps-gates.
- [x] Dokumentet validerer mod en kontrakt i `/contracts` og er med i `make ci`.
- [x] `skip` og `fail` bliver `not-satisfied` med begrundelse — ingen grøn vask.

## Grænser

- Profilen dækker ikke hele OSCAL. Kataloger, SSP og POA&M er uden for scope indtil videre.
- Kontrol-kortlægningen (3.2) og sikkerhedsplanen (3.4) bygger oven på pakken. Indtil da er `target-id` tjekkets id, ikke en NIS2-/GDPR-kontrol.
