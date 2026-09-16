# Privacy-verberne

**Kontrakter:** [`contracts/privacy-request.schema.json`](../../contracts/privacy-request.schema.json), [`contracts/privacy-response.schema.json`](../../contracts/privacy-response.schema.json)
**Backlog:** 0.5

## Formål

Ét fan-out-kald på tværs af alle moduler i stedet for tolv manuelle processer. En DSAR skal kunne besvares med ét samlet resultat, hvor hvert moduls bidrag er synligt — også når bidraget er "kan ikke".

## Verberne

| Verbum | Betydning |
| --- | --- |
| `subject.locate` | Find hvor subjektets data ligger |
| `subject.export` | Eksportér subjektets data (GDPR art. 15/20) |
| `subject.erase` | Slet subjektets data (GDPR art. 17) |
| `subject.legal_hold` | Sæt/ophæv opbevaringspligt (blokerer sletning) |
| `retention.policy` | Rapportér og anvend modulens opbevaringsregler |

Verberne erklæres pr. modul i `module-manifest.json` under `privacy` — med samme `full`/`partial`/`unsupported`-model som ops-verberne.

## Orkestratoren

[`conformance/src/dsar.mjs`](../../conformance/src/dsar.mjs) tager imod én anmodning, finder alle moduler (eller de angivne `targets`), kalder modulets `privacy.dsarEndpoint` og samler svaret.

- **Online:** kalder hvert moduls endpoint.
- **Offline:** bruger modulets deklarerede conformance som svar. Det gør flowet demonstrerbart i bølge 0, før nogen upstream er integreret.

```bash
make dsar-demo
# ✔ partially-completed: 1 full, 1 partial, 0 unsupported, 0 failed
```

## Per-modul status er pointe

Svaret indeholder altid ét element pr. modul. Status `partial` og `unsupported` kræver en begrundelse; `failed` kræver en fejl. Dermed kan en DPO se, at 17 poster blev slettet ét sted, mens et andet system holder dem tilbage på grund af bogføringspligt — i stedet for et aggregat, der skjuler forskellen.

## Acceptkriterier (0.5)

- [x] Schema + orkestrator-spec.
- [x] DSAR mod to dummy-moduler returnerer samlet resultat med per-modul status (`conformance/test/dsar.test.mjs`).
