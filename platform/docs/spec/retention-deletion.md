# Sletning, legal hold og gendannelsesregler (DKC-021)

Sletning skal have dokumenteret dækning, og tilbageholdelse skal være begrundet.
Dette dokument beskriver den håndhævede proces og de kontrakter, den bygger på.
Se [ADR-0049](../adr/0049-sletning-legal-hold-og-gendannelsesregler.md) for
beslutningen og [docs/compliance/deletion-coverage.md](../compliance/deletion-coverage.md)
for den genererede dækningstabel.

## Datalag og dækning

Politikken `retention/deletion-policy.json` erklærer de fem obligatoriske datalag:

| Lag | Flade | Hvad den gør |
| --- | --- | --- |
| Primærlager | `primary-object-store` | Sletter alle versioner af subjektets objekter via et digest-indeks i lageret. |
| Indeks | `rebuildable-index` | Kaster det genopbyggelige indeks for tenanten; det genopbygges uden subjektet. |
| Cache | `ephemeral-cache` | Fjerner cacheposter for subjektet fysisk. |
| Afledte AI-data | `derived-ai-store` | Sletter den lokale kopi af prompts/embeddings; den eksterne leverandørkopi rapporteres som resterende. |
| Backups | `protected-backup` | Skriver en slettebeslutning til suppressionsjournalen; den WORM-låste historiske kopi slettes ikke fysisk. |

Hvert lag har en **dækning**: `full`, `partial` eller `unsupported`. En `partial`
eller `unsupported` flade **skal** have en præcis begrundelse og en navngivet
ejer. Et lag der ikke kan slette fysisk må aldrig stå som fuld.

## Sletningstjenesten

`retention/src/deletion-service.mjs` er den ene autoriserede vej. Rækkefølgen er
fast:

1. **Autorisation.** Tenant udledes af den verificerede principal. AI-principaler
   (`kind: agent` eller `ai: true`) afvises altid, og en rolle fra politikken
   kræves (default-deny).
2. **Hold-kontrol.** Aktive holds i subjektets scope slår op **før** enhver
   mutation. Et hold giver `blocked-by-hold` og `recordsAffected: 0`.
3. **Revisionsintent.** Der skrives et intent med kun subjektets digest,
   dataklasser og flade-id'er. `assertRedacted` afviser rå identifikatorer.
4. **Sletning pr. flade.** Hver flade kaldes og returnerer `full`, `partial`,
   `unsupported`, `not-found` eller `failed` med begrundelse og resterende
   kopier (begrundelse + forventet udløb).
5. **Kvittering.** Resultatet gemmes som en `DeletionReceipt`. Den samlede
   status er `full` kun hvis alle flader er `full`/`not-found`; ellers `partial`
   (eller `unsupported` hvis alle er det).

En kvittering er beviset. Den bærer subjektets digest og per-flade resultat — ikke
de slettede data.

## Legal hold

Et hold er en `LegalHold` med:

- en **dokumenteret begrundelse** (mindst 10 tegn),
- den der lagde holdet, og
- en **separat** navngivet godkender (den der lægger holdet må ikke godkende det
  selv),
- de dataklasser og det subjekt (digest) det dækker.

Et hold er aktivt, indtil det frigives med en begrundelse. Et aktivt hold
blokerer enhver sletning i sin scope, også en gendannelse (se nedenfor).

## Gendannelsesregler

En backup er et øjebliksbillede fra før sletningen. `retention/src/restore-gate.mjs`
holder derfor det gendannede miljø i **karantæne**:

1. `openGate` pinner suppressionsjournalens hoved på restorepunktet.
2. `applyDecisions` genanvender alle slettebeslutninger nyere end restorepunktet
   på karantænemiljøet og opdager en brudt eller trunkeret journal.
3. `release` nægter at frigive miljøet hvis beslutninger mangler, hvis journalen
   er vokset siden, eller hvis et aktivt hold dækker et subjekt i karantænen.

Dermed genanvendes slettebeslutninger, **før** systemet frigives.

## Kontrakter og checks

| Kontrakt | Formål |
| --- | --- |
| `contracts/retention-deletion-policy.schema.json` | Politikken og dens dækning. |
| `contracts/legal-hold.schema.json` | Et begrundet, godkendt hold. |
| `contracts/deletion-receipt.schema.json` | Beviset for et sletteforsøg. |

- `make retention-check` — politik, dækning, hold-blokering, ærlig partial og
  genanvendelse ved restore.
- `make retention-test` — slette-, hold-, kvitterings-, restoregate- og
  persistens-testene.
- `make retention-demo` — et fuldt gennemløb på den rigtige stak.

En målt sletning mod en levende modelleverandør og et rigtigt objektlager er
`integration-retention-live` og er **NOT RUN** i dette miljø.
