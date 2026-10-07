# Runbook: kunde-afvikling (DKC-025)

Afvikling er en **irreversibel** handling. Den kræver dokumenteret eksport og
sletning samt en anden person end den, der startede afviklingen.

## Trin

1. **Start afvikling.** En kundeadministrator eller platformoperatør sætter
   kunden til `winding-down` med en begrundelse. Handlingen skriver
   `customer.winding-down` i revisionssporet og opretter en afviklingsplan.
2. **Eksportér data.** Kunden (eller driften på kundens vegne) gennemfører
   dataeksporten og markerer trin `export`. Handlingen kræver en begrundelse og
   skriver `customer.winddown-export`.
3. **Slet data.** Sletningen gennemføres og markeres som trin `deletion`.
   Handlingen skriver `customer.winddown-deletion`. Er der et aktivt legal hold
   eller en anden blokering, må sletningen ikke gennemføres; følg
   `docs/runbooks/deletion-legal-hold.md`.
4. **Luk kunden.** En **anden** platformoperatør lukker kunden, når både
   eksport og sletning er markeret. Er afviklingen ufuldstændig, afvises
   lukningen (`winddown_incomplete`); prøver den samme person at lukke, afvises
   den (`two_person_required`). Lukningen skriver `customer.closed`.

## Efterlevelse

- `verifyAuditTrail` skal være uden afvigelser for kunden.
- `make portal-check` skal være grøn.
- Bekræft at kunden ikke længere fremgår af appoversigten for aktive kunder.

## Fejlsøgning

| Symptom | Årsag | Handling |
| --- | --- | --- |
| `winddown_incomplete` | Eksport eller sletning er ikke markeret | Gennemfør og markér begge trin |
| `two_person_required` | Samme person starter og lukker | Lad en anden operatør lukke |
| `not_winding_down` | Kunden er ikke under afvikling | Start afviklingen først |
| `customer_not_orderable` | Kunden er suspenderet/under afvikling | Bestilling er ikke tilladt i denne tilstand |
