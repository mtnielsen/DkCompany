# Komplet logging på tværs af agenter og servere (DKC-049)

Et forløb fra alarm til fallback skal kunne rekonstrueres **uden** at stole på
agentens egen forklaring. Denne spec beskriver den kanoniske logpost, den
holdbare ledger, WORM-arkivet, den holdbare mutationskvittering, logadgang og
rekonstruktionen. Politikken ligger i
[`logging/logging-policy.json`](../../logging/logging-policy.json), og
dækningstabellen genereres i
[`docs/compliance/log-coverage.md`](../compliance/log-coverage.md).

## 1. Den komplette logpost

Kontrakten er [`contracts/log-record.schema.json`](../../contracts/log-record.schema.json).
Hver post bærer:

- **Korrelation** (`correlation`): `correlationId` (hele forløbet),
  `executionId` (ét eksekveringsforsøg), samt `incidentId`, `changeId`,
  `traceId` og `parentId`.
- **Scope** (`scope`): `tenantId`, `environment`, `service` og en stabil
  `resource`-ID på formen `res://<tenant>/<type>/<lokal-id>` (DKC-006).
- **Provenance** (`provenance`): præcis én af `sensor`, `model`, `verified`,
  `human`, `system`, med præcis den tilhørende blok:
  - `sensor`/`system` → `observation` (kilde, friskhed, værdi),
  - `model` → `model` (leverandør, navn, modelversion, promptversion,
    beslutningsresumé, responseDigest),
  - `verified` → `verification` (verifier, metode, artifactDigest, resultat,
    tidspunkt),
  - `human` → `human` (subjekt, rolle, beslutning, tidspunkt).
- **Handling** (`action`): `mutating`, `tool` (navn, verb, target, redigerede
  parametre), `policy`, `policyDigest`, `approvalDigest`, `runbookDigest`,
  `before`/`after`, `retry` og `fallback`.
- **Kvittering** (`receipt`): `intentId`, `idempotencyId`, `state`,
  `auditEventId`, `anchored`.
- **Ledger** (`ledger`): `stream`, `seq`, `prevHash`, `hash` (tilføjet ved
  skrivning).
- **Arkiv** (`archive`): de mål posten er skrevet til, med fejldomæne, version,
  digest og WORM-status.
- **Klassifikation**: `dataClassification`, `retentionClass`, `minimized` og
  `redactions`.

`logging/src/record.mjs` afviser en post der blander provenance-blokke, mangler
en kvittering for en muterende handling, har tenant/ressource-mismatch, en
fremtidig tidsstempling, en hemmelighed eller skjult modelræsonnering.

## 2. Den holdbare ledger

`logging/src/ledger.mjs` bygger oven på den hash-kædede audit-log fra DKC-009
(ADR-0021) i stedet for at skabe en parallel sandhed. Ledgeren:

- skriver hver post som en `log.record`-begivenhed med tenant og `seq` fra
  databasen,
- læser tenant-scopet og filtrerer på korrelation, execution, ressource,
  provenance og tid,
- eksponerer **ingen** update- eller delete-metode, så agenten ikke kan
  omskrive eller slette sin historik, og
- verificerer hash-kæden og monotone sekvenser pr. strøm.

En audit-log der ikke returnerer en holdbar `seq` og `hash`, afvises
(`not_durable`), så en upålidelig skrivevej ikke kan give et falsk bevis.

## 3. Uafhængigt WORM-arkiv pr. dataklasse

`logging/src/archive.mjs` spejler posten til flere arkivmål i forskellige
fejldomæner. Et `immutable`-mål får en COMPLIANCE-lås på den skrevne version
(DKC-041/048), så hverken agenten eller primærklyngens driftscredentials kan
ændre eller slette den. Politikken afgør hvilke retention-klasser der SKAL have
et immutabelt arkiv, før en mutation må udføres. Arkivet har ingen
update/delete-metode; `verify()` læser tilbage og efterprøver digest og lås.

## 4. Holdbar kvittering før mutation

`logging/src/receipt.mjs` er den ene vej til en muterende handling:

1. intent-posten skrives til ledgeren og — for beskyttede klasser —
   WORM-arkiveres,
2. den to-fasede auditkvittering skrives og committes (DKC-009),
3. **først derefter** udføres mutationen,
4. outcome skrives bundet til samme idempotency-ID.

Fejler trin 1 eller 2, kastes der, og mutationen udføres ikke. Et crash mellem
2 og 3 efterlader et `pending`-intent, som skal reconciliere — ikke genudføres
ukritisk. Dermed giver et logsvigt ingen ulogget AI-mutation.

## 5. Logadgang

`logging/src/access.mjs` er default-deny. Tenant udledes altid af den
verificerede principal (aldrig af en klientpåstand), og principalen skal have
en af politikens læseroller. En scopet platformrolle (`platform-admin:<tenant>`)
kan læse en fremmed tenant. Selve læsningen — også en nægtet — efterlader en
`LogAccessDecision`-post, så et udtræk af historikken ikke kan ske ubemærket.
Kontrakten er
[`contracts/log-access-decision.schema.json`](../../contracts/log-access-decision.schema.json).

## 6. Rekonstruktion

`logging/src/reconstruct.mjs` samler et forløb på `correlationId` (og
eventuelt `executionId`), adskiller provenance, binder hver muterende
modelhandling til en menneskelig godkendelse med matchende digest
(`logging/src/record.mjs#approvalDigestOf`), kræver at hvert verificeret
resultat peger på et kendt artefakt, og at hver muterende handling har et
verificeret, bestået outcome. Huller rapporteres eksplicit frem for at påstå et
komplet forløb.

## Checks og evidens

- `make logging-check` — politik + genereret dækningsdokument.
- `make logging-test` — korrelation, redaktion, ledger, WORM-arkiv, kvittering,
  adgang, rekonstruktion, conformance og holdbar SQLite-persistens.
- `make logging-demo` — et fuldt tværserverforløb på den rigtige stak.

En målt strøm fra en levende agent-/serverflåde og rigtige OTel-/WORM-tjenester
er `integration-logging-live` og er **NOT RUN** i dette miljø.
