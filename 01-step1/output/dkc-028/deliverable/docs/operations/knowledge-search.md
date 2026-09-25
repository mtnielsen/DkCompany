# Runbook — rettighedsbevidst videnssøgning

Denne runbook beskriver den menneskelige drift af videnssøgningen. Søgelaget
filtrerer selv på tenant og ACL, men en dataejer skal vedligeholde kilden,
klassifikationen og den fastsatte slettefrist.

## Roller

| Rolle | Ansvar | Kilde |
| --- | --- | --- |
| Platform Owner | Kilder, indekspolitik, slettefrist | `search/sources.json`, `search/index-policy.json` |
| Vidensejer (fx HR) | Sidens klassifikation og kilde-ACL | BookStack-content-permissions |
| Sikkerhedsansvarlig | Injagt om lækage og injektionsfund | `docs/security/threat-model.md` |
| Den enkelte medarbejder | Læseadgang via grupper og klarering | Identitetsudbyderen |

## Drift

1. **Kilder.** Bekræft at hver kilde er `readOnly`, tenantbundet og bruger en
   secretreference. `make search-check` afviser en rå hemmelighed.
2. **Klassifikation.** En side med person- eller særligt-følsomt indhold skal
   klassificeres tilsvarende. Klassifikationsloftet nægter en bred gruppe at
   åbne den, selv hvis ACL'en er løs.
3. **Synkronisering.** Kør `make search-sync` (sæt `SEARCH_INDEX_DIR` til den
   vedvarende indeksmappe). En ændret ACL eller et slettet dokument hæver
   indeksets epoch og invaliderer cachen.
4. **Slettefrist.** Ved en DSAR-sletning skal siden fjernes fra kilden,
   synkroniseres, og slettes fra indeks og cache. `make search-run` måler
   deterministisk, at den er væk inden for `deletion.deadlineSeconds`. Den
   endeligt målte frist på en levende BookStack er `make search-live` (NOT RUN).
5. **Injektion.** Et injektionsfund i en artikel markeres i svarets
   `injectionFindings`, indholdet neutraliseres, og der oprettes intet
   værktøjsforslag. Eskalér til den sikkerhedsansvarlige, hvis en artikel
   gentagne gange indeholder forfalskede værktøjskald.

## Kontrolpunkter

- En privat HR-side må ikke optræde for en uautoriseret medarbejder i svar,
  snippets, embedding-søgning eller citationsliste.
- Tilbagekaldt adgang skal håndhæves på allerede indekseret indhold.
- En slettet side skal forsvinde inden for fristen.
- Et svar skal have kildehenvisning og usikkerhed.

## Noter

- Rapporten er en deterministisk model (`measured: false`). En målt frist og en
  rigtig permission-/slettehændelse er `make search-live` og er **NOT RUN**.
