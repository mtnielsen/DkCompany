# Runbook: rekonstruktion af et logforløb (DKC-049)

Brug denne runbook, når et forløb fra alarm til fallback skal rekonstrueres —
fx ved en hændelse, en tvivl om en AI-handling, eller en revisionsanmodning.

## Forudsætninger

- Du har en verificeret principal med en af politikens læseroller (`auditor`,
  `security-owner` eller `platform-admin`). Se
  [`logging/logging-policy.json`](../../logging/logging-policy.json).
- Du kender `correlationId` (og eventuelt `executionId`) for forløbet.

## Trin

1. **Læs forløbet tenant-scopet.** Tenant udledes af din verificerede principal;
   en fremmed tenant afvises. Brug `createLogAccess().read(...)` eller et
   tilsvarende autoriseret udtræk. Hver læsning efterlader selv en
   `LogAccessDecision`-post.

2. **Rekonstruér.** Kør `reconstructFlow(records, { correlationId, executionId })`.
   Resultatet indeholder:
   - `servers`: de tjenester forløbet spænder over,
   - `timeline`: posterne i sekvensrækkefølge med provenance,
   - `artifacts`: verificerede artefakter og om de er korroboreret,
   - `approvals`: de menneskelige godkendelser med digest,
   - `gaps`: manglende kvittering, manglende/umatchet godkendelse, ukendt
     artefakt, manglende verificering eller ikke-monotone sekvenser.

3. **Tolk hullerne.** Er `complete` falsk, er forløbet ikke fuldt rekonstrueret.
   Typiske huller:
   - `missing-receipt` — en muterende handling uden holdbar kvittering. Skal
     behandles som en hændelse; mutationen kan ikke bekræftes.
   - `missing-approval` / `unmatched-approval` — en muterende modelhandling
     uden en matchende menneskelig godkendelse.
   - `unmatched-artifact` — et verificeret resultat hvis artefakt ikke kan
     korreleres til en sensorobservation eller et modeludsagn.
   - `missing-verification` — en muterende handling uden et verificeret,
     bestået outcome.
   - `non-monotonic-sequence` — loggen er ændret eller trunkeret.

4. **Verificér loggen.** Kør ledgerens `verify(tenantId)` for hash-kæden og de
   monotone sekvenser, og arkivets `verify(post)` for WORM-lås og digest. Et
   brud betyder, at historikken er ændret — eskalér til Security Owner.

5. **Ved logsvigt.** Hvis en muterende handling viser sig ikke at have en
   holdbar kvittering, må den ikke genudføres ukritisk. Brug den to-fasede
   journals `reconcile` til at afgøre den faktiske udfald mod den eksterne
   ressource, eller markér den `unknown`.

## Stopklodser

- En utilgængelig WORM-arkivtjeneste er fail-closed: muterende handlinger for
  beskyttede dataklasser udføres ikke, før arkivet er tilgængeligt.
- Skjulte ræsonneringsfelter er fjernet fra loggen. Kan du ikke se modellens
  fulde tankestrøm, er det med vilje: revisionssporet må ikke bære skjult
  intern ræsonnering.
- En sag der kræver uafhængig driftsverifikation (fx en målt strøm fra
  produktion) kan ikke lukkes med de lokale tests alene; se
  `integration-logging-live`.
