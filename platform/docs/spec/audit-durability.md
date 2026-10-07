# Holdbar audit og fail-closed handlinger (DKC-009)

Audit-sporet skal dokumentere **forsøget før** en ekstern ændring og
**resultatet bagefter** — og det skal være holdbart, manipuleringssynligt og
frit for hemmeligheder og unødig persondata. Denne spec beskriver kontrakten,
der implementerer [ADR-0021](../adr/0021-holdbar-audit-og-fail-closed.md).

## Protokol: intent → handling → outcome

```
 begin(idempotencyId) ──► intents row committed (state=pending)
        │
        ├─ audit utilgængelig ──► ingen handling (fail-closed)
        │
        ▼
   ekstern ændring (executor)
        │
        ▼
 complete(idempotencyId, outcome) ──► intents state=succeeded|failed
```

1. **`begin`** skriver et intent i `audit_intents` og en `*.intent`-begivenhed i
   den hash-kædede log, alt i én `BEGIN IMMEDIATE`-transaktion. Først når
   kvitteringen er returneret og committet, må kalderen udføre handlingen.
2. **`complete`** skriver outcome (`succeeded`/`failed`/`unknown`) og en
   `*.outcome`-begivenhed bundet til samme idempotency-ID.
3. **`markUnknown`/`reconcile`** håndterer et intent uden outcome. Der
   genudføres intet; en resolver spørger den eksterne ressource og fastslår
   tilstanden.

### Idempotens

`(tenant_id, idempotency_id)` er primærnøglen. Et gentaget `begin`:

| Eksisterende state | Returneres | Effekt |
| --- | --- | --- |
| `succeeded`/`failed` | `{ duplicate: true, state, outcome }` | Handling afspilles, udføres ikke igen |
| `pending` | `{ duplicate: true, state: "pending" }` | `unknown` indtil reconciliation |
| `unknown` | `{ duplicate: true, state: "unknown" }` | `unknown` indtil reconciliation |

Runtimen udleder et stabilt ID pr. handling:
`sha256({ taskId, index, verb, target, changeDigest }).slice(0, 32)`, medmindre
handlingen selv angiver `idempotencyId`.

## Eksternt forankret checkpoint

`persistence/src/checkpoint.mjs` skriver et checkpoint til en mappe **uden for**
databasefilen (i produktion WORM/append-only eller en ekstern transparency-log):

```json
{ "version": 1, "tenantId": "acme", "eventCount": 42,
  "chainHash": "<kædehoved>", "lastEventId": "<uuid>",
  "anchoredAt": "…", "digest": "<HMAC>", "algorithm": "HMAC-SHA256" }
```

`digest` er en HMAC over checkpointets krop med en nøgle der **ikke** ligger i
databasen. `verify` opdager:

| Problem | Betydning |
| --- | --- |
| `truncated` | Der er færre begivenheder nu end ved forankringen |
| `deleted` | Et kædeled mangler eller peger på en slettet begivenhed |
| `changed` | En begivenheds hash matcher ikke indholdet |
| `forged` | Selve checkpoint-filen er ændret (HMAC matcher ikke) |

Nye begivenheder **efter** checkpointet er tilladte; det forankrede præfiks skal
være intakt.

## Skrive- og læserroller

`persistence/src/audit-roles.mjs`:

- **`openAuditWriter`** — append, intent, outcome, anchor. Ingen læse-eksport i
  API'et (kun den sidste hash læses internt for kæden).
- **`openAuditReader`** — `readOnly` håndhævet af SQLite, `events`,
  `verifyChain`, `verifyCheckpoint`, `readPersonal`. Ingen skrive-metode.

I PostgreSQL er den tilsvarende opsætning separate roller: `audit_reader` har
kun `SELECT`, `audit_writer` har `INSERT` (ikke `UPDATE`/`DELETE`).

## Minimering og retention

`persistence/src/redact.mjs` kører på **alt** payload før skrivning:

- **Hemmeligheder** fjernes på feltnavn (`password`, `token`, `apiKey`,
  `authorization`, `privateKey`, …) og på værdimønster (PEM, JWT, Bearer, AWS-,
  GitHub- og `sk-`-nøgler) og erstattes med `[REDACTED]`.
- **Persondata** (`email`, `subjectId`, `cpr`, …) udskilles til `audit_personal`
  med `retain_until`. Kun `personalDataDigest` indgår i den hash-kædede
  begivenhed, så `eraseExpiredPersonal` kan slette persondata uden at brække
  kæden.
- **Størrelser** begrænses (strenglængde, array-længde, dybde).

## Integration

- **Runtime:** `runtime/src/runtime.mjs` tager `actionJournal`. Er den sat,
  skrives intent før executor og outcome efter. Fejler intent → `halted`;
  findes intent uden outcome → `unknown`; fejler outcome efter udførelse →
  `unknown` (aldrig success). `runtime/src/reconcile.mjs` batcher reconciliation.
- **Audit-service:** `modules/audit-service/service/src/server.mjs` tager
  `journal` og skriver intent før handleren. Er journalen utilgængelig, svarer
  tjenesten `503 { failMode: "closed", status: "halted" }` og kalder aldrig
  handleren. HTTP-endpointene `/v1/audit/intents` (POST),
  `/v1/audit/intents/:id` (GET) og `/v1/audit/intents/:id/outcome` (POST) gør
  journalen tilgængelig for `createHttpActionJournal`.

## Checks

- `make audit-durability-test` — journal, checkpoint, runtime, audit-service og
  konformans.
- `make audit-durability-check` — migration, idempotens, checkpoint, redaktion
  og roller.
- `conformance/test/audit-durability-conformance.test.mjs` spejler de fire
  acceptkriterier i `make test`.

## Begrænsninger

- Checkpointet forankres i en **anden mappe** i dette repo. En rigtig
  WORM/append-only eller ekstern transparency-log er en driftsopsætning og er
  **ikke** afprøvet her.
- SQLite-rollerne er logiske; de tilsvarende PostgreSQL-GRANTs er dokumenteret,
  men ikke afprøvet mod en levende database.
- Audit-servicens privacy-verber bruger fortsat det in-memory subject-register
  for selve emneregistret; den hash-kædede begivenhedslog er holdbar.
