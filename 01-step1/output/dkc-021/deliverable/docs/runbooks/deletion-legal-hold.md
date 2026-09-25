# Runbook — sletning og legal hold (DKC-021)

Denne runbook beskriver, hvad en operatør og en sagsbehandler gør, når en
registreret beder om sletning, eller når en sag kræver, at data bevares.

## 1. Anmod om sletning

```bash
make retention-demo          # demonstrerer hele forløbet offline
```

I produktion kaldes slette­tjenesten gennem den autoriserede API/CLI. En
sletteanmodning kræver en principal med en sletterolle fra
`retention/deletion-policy.json` (`privacy-officer` eller
`data-protection-officer`). AI-principaler afvises altid.

Tjenesten returnerer en `DeletionReceipt`. Læs `status`:

- `full` — alle flader kunne slette (eller havde ingen data).
- `partial` — mindst én flade kunne ikke slette alt. Læs `results[].reason` og
  `results[].remainingCopies[]` (hver med `reason` og `expiresAt`).
- `unsupported` — ingen flade kunne slette. Kontrollér databehandleraftalen for
  den eksterne leverandør.
- `blocked-by-hold` — et aktivt hold blokerer. Intet blev slettet; se afsnit 3.

## 2. Resterende kopier

En `partial` kvittering er **ikke** en fejl, men en ærlig erklæring. Typiske
resterende kopier:

| Kilde | Hvorfor | Hvad gør vi |
| --- | --- | --- |
| `backup` | Historisk kopi er WORM-låst | Slettebeslutningen ligger i suppressionsjournalen og genanvendes ved restore. Kopien udløber med backupretentionen. |
| `upstream` | Leverandøren har ingen slette-API | Følg op gennem databehandleraftalen. Dækningen forbliver `unsupported` indtil leverandøren kan slette. |
| `primary` | En version er WORM-låst | Undersøg hvorfor. En COMPLIANCE-lås kan ikke brydes; afvent udløb eller eskalér til Security Owner. |

Følg `expiresAt` op. En resterende kopi uden et udløb er en fejl i politikken.

## 3. Læg et hold (bevaringspligt)

Et hold lægges af en principal med en hold-rolle og skal godkendes af en
**anden** navngivet person (fx `legal-counsel`). Begrundelsen er obligatorisk.

```text
holdId:    hold:acme:9f2c1a3b4d5e
subjekt:   <digest>
klasser:   personal, pseudonymised
grund:     Verserende retssag kræver at subjektets poster bevares.
lagt af:   Pia Privat (privacy-officer)
godkendt:  Lars Lov (legal-counsel)
```

Et aktivt hold blokerer enhver sletning i sin scope — også en gendannelse. Frigiv
først holdet, når bevaringsgrunden er bortfaldet, med en begrundelse.

## 4. Gendan efter et tab

1. Gendan backupen til et **isoleret** miljø (se
   `docs/runbooks/immutable-data-recovery.md` og `docs/runbooks/backup-restore.md`).
2. Åbn en releasegate på restorepunktet. Miljøet er nu i **karantæne**.
3. Genanvend slettebeslutninger (`applyDecisions`). Gaten opdager en brudt eller
   trunkeret suppressionsjournal.
4. Frigiv (`release`) **kun** når gaten siger `decisions-applied`, journalen ikke
   er vokset siden, og ingen aktivt hold dækker et subjekt i karantænen.

**Frigiv aldrig et gendannet miljø direkte.** En backup fra før en sletning
genindfører ellers persondata, som en registreret med rette har fået slettet.

## 5. Bevis og revision

Sletteforsøg og resultat bevares som revisionsintent + -udfald og som en
`DeletionReceipt`. Revisionssporet indeholder kun subjektets digest, flade-id'er
og status — aldrig de slettede data, passwords eller tokens. Brug kvitteringen
som svar til den registrerede og til tilsynet.

## 6. Kendte begrænsninger

- Et levende modelleverandør-API og et rigtigt objektlager er ikke tilgængeligt i
  udviklingsmiljøet; `integration-retention-live` er **NOT RUN**.
- Backupfladen kan ikke håndhæve et fysisk hold i den WORM-låste kopi; den
  genanvender i stedet slettebeslutningen ved restore.
