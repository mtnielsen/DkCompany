# Holdbar DSAR-sag og sikret eksport

- **Status:** accepteret
- **Beslutningstagere:** Platform Owner, DPO
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-0.5's DSAR-orkestrator var en tynd, offline fan-out uden holdbar tilstand, autorisation eller en sikret eksport. En DSAR er en følsom, langvarig og autoriseret proces der skal kunne genoptages og dokumenteres.

## Kontekst og problemstilling

En DSAR fan-out'er til flere apps. Uden holdbar tilstand ville et genstart eller
en timeout give et ufuldstændigt aggregat; uden per-modul status ville et delvist
svar kunne forveksles med et fuldt; uden autorisation ville en agent eller en
fremmed sagsbehandler kunne læse andres data; og en eksport ville ikke kunne
bindes til modtager, udløb og revisionsspor. Samtidig må registeret ikke selv
blive et nyt personregister.

## Beslutningskriterier

- En DSAR skal være autoriseret og default-deny.
- En afbrudt kørsel skal kunne genoptages uden at kalde afsluttede moduler igen.
- Timeout og nedetid må aldrig give et fuldt svar.
- Andre personers data og fremmede tenants må ikke udleveres.
- En eksport skal udløbe, bindes til en modtager og kunne revideres.

## Overvejede muligheder

- **A:** Udvide den eksisterende, statsløse orkestrator.
- **B:** Gemme hele DSAR-svaret (inkl. persondata) i databasen.
- **C:** En holdbar sag med per-modul resultater, autorisation, fail-closed
  identitetsmatchning og en eksport hvis payload ligger i et artefakt.

## Beslutning

Vi indfører (C): en holdbar sag i `dsar_cases`/`dsar_module_results`/`dsar_exports`
(migration v10), en default-deny sagsbehandler-autorisator, fail-closed
identitetsmatchning og en eksport med tenant-/modtagerbinding, udløb, digest og
`auditRef`. Den rå payload gemmes i et artefakt, ikke i registeret. Per-modul
status er `full`/`found`/`partial`/`unsupported`/`failed`/`unknown`, og en
timeout/uopnåelig app er `failed`/`unknown`.

### Konsekvenser

- **Positive:** Processen bliver autoriseret, genoptagelig, ærlig og sporbar;
  registeret forbliver metadata.
- **Negative:** Kræver en artefaktbutik i deployment; live-tredjepartsapps er
  stadig nødvendige for fuldt driftsbevis.
- **Neutrale:** Den tynde `conformance/src/dsar.mjs` bevares til offline demo og
  udvides med timeout-/statusklassifikation.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Lille ændring | Ingen holdbarhed, autorisation eller eksportbinding |
| B | Simpelt | Gør registeret til et personregister |
| C | Autoriseret, holdbar, ærlig og privatlivsbevarende | Kræver artefaktbutik og migrering |

## Mere information

- `docs/spec/privacy-process.md`
- `docs/spec/privacy-verbs.md`
- `docs/runbooks/dsar-handling.md`
- `privacy/`, `persistence/migrations/0010_dsar_cases.sql`
- `contracts/privacy-export.schema.json`
- ADR-0034 (evidensmodes), ADR-0017 (tenant-kontekst), ADR-0029 (dataregister)
