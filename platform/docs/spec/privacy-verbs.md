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

Svaret indeholder altid ét element pr. modul. Status `partial` og `unsupported` kræver en begrundelse; `failed` og `unknown` kræver en fejl. Dermed kan en DPO se, at 17 poster blev slettet ét sted, mens et andet system holder dem tilbage på grund af bogføringspligt — i stedet for et aggregat, der skjuler forskellen.

Statusværdierne er:

| Status | Betydning |
| --- | --- |
| `full` | Verbet blev fuldt opfyldt (fx export/erase). |
| `found` | Subjektet blev fundet (locate); siger ikke om en efterfølgende handling lykkedes. |
| `partial` | Delvist opfyldt; kræver en begrundelse. |
| `unsupported` | Kan ikke opfyldes gennem modulets API; kræver en begrundelse. |
| `failed` | Forsøget fejlede (fx timeout eller HTTP-fejl); kræver en fejl. |
| `unknown` | Udfaldet kunne ikke afgøres (fx uopnåelig app); kræver en fejl. |

En timeout eller en uopnåelig app giver `failed`/`unknown` — aldrig `full`. Det er håndhævet i `conformance/src/dsar.mjs` og efterprøvet i `conformance/test/privacy-conformance.test.mjs`.

## Fra fan-out til holdbar sag (DKC-020)

`conformance/src/dsar.mjs` er den tynde, offline-demonstrerbare fan-out. Den fulde, autoriserede proces ligger i `privacy/`:

- en **holdbar sag** (`persistence/migrations/0010_dsar_cases.sql`) med den autoriserede sagsbehandler, deadline og idempotency-key,
- **genoptagelig fan-out**: et modul med terminal status kaldes ikke igen,
- **sikker identitetsmatchning** (fail-closed på tenant og ejer),
- **sikret eksport** med udløb, modtagerbinding, digest og revisionsspor,
- **default-deny autorisation** af sagsbehandlere (kun verificerede mennesker i sagens tenant; ingen selvbetjening).

Se [`privacy-process.md`](privacy-process.md) og [`docs/runbooks/dsar-handling.md`](../runbooks/dsar-handling.md).

## Acceptkriterier (0.5)

- [x] Schema + orkestrator-spec.
- [x] DSAR mod to dummy-moduler returnerer samlet resultat med per-modul status (`conformance/test/dsar.test.mjs`).
- [x] Holdbar sag, genoptagelig fan-out og sikret eksport (DKC-020, `make privacy-test`).
