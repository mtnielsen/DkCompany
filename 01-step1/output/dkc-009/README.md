# DKC-009 — Gør audit holdbar og stop handlinger ved logsvigt (leverance)

Implementering af **DKC-009** for `mtnielsen/DkCompany`. Bygger på
DKC-001 .. DKC-008 og DKC-055. `00-core/` er fortsat **ikke ændret**; alt ligger
under `01-step1/output/dkc-009/`.

## Forudsætninger og valg

DKC-009 afhænger formelt kun af **DKC-007** (grænsevalidering) og **DKC-008**
(holdbar tilstand). Begge er lagt. Derudover er **DKC-055** lagt som
forudsætning, fordi:

- DKC-009's krav om **separat audit-skrive-/læserolle** genbruger DKC-055's
  fælles rollesystem i stedet for at opfinde et parallelt rollemodel, og
- DKC-009 bygger oven på den aktuelle stak-spids, så efterfølgende opgaver
  (DKC-010 m.fl.) kan lægge deres overlay oven på DKC-009 uden konflikt.

`apply.sh` kæder derfor `dkc-055/apply.sh` (DKC-001 .. DKC-008 + DKC-055) og
lægger derefter denne overlay.

## Hvad der er implementeret

1. **Holdbar action-journal med intent/outcome (to-faset, fail-closed).**
   `persistence/src/adapters/audit-journal.mjs` skriver og committer et
   **intent** med idempotency-ID i `audit_intents` (og en `*.intent`-begivenhed i
   den hash-kædede log) **før** nogen ekstern ændring. Først når kvitteringen er
   holdbar, må handlingen udføres. Bagefter skrives **outcome** bundet til samme
   ID. Er journalen utilgængelig, kaster `begin()`, og der sker intet.

2. **Idempotens, `unknown` og reconciliation.**
   Primærnøglen `(tenant_id, idempotency_id)` gør et gentaget intent til en
   `duplicate`. Et intent uden outcome er `pending`/`unknown`; `reconcile()`
   afgør den faktiske tilstand via den eksterne ressource. Der genudføres
   **aldrig** ukritisk. `runtime/src/reconcile.mjs` batcher reconciliation.

3. **Eksternt forankret checkpoint.**
   `persistence/src/checkpoint.mjs` skriver et HMAC-signeret checkpoint
   (kædehoved + antal begivenheder) til en mappe **uden for** databasefilen.
   `verify` opdager `truncated`, `deleted`, `changed` og `forged`; nye
   begivenheder efter checkpointet er tilladte, men det forankrede præfiks skal
   være intakt.

4. **Adskilte audit-skrive-/læserroller.**
   `persistence/src/audit-roles.mjs` åbner `audit-writer` (append/intent/outcome/
   anchor) og `audit-reader` (skrivebeskyttet SELECT/verifikation, ingen
   skrive-metode). SQLite håndhæver `readOnly`; i produktion svarer det til
   separate PostgreSQL-roller med GRANTs.

5. **Minimering, secret-redaktion og retention.**
   `persistence/src/redact.mjs` fjerner hemmeligheder på feltnavn og
   værdimønster (PEM, JWT, Bearer, AWS-/GitHub-/`sk-`-nøgler) før noget skrives.
   Personhenførbare felter udskilles til `audit_personal` med egen `retain_until`;
   kun digesten indgår i den hash-kædede begivenhed, så `eraseExpiredPersonal`
   kan slette persondata uden at brække kæden.

6. **Runtime er fail-closed.** `runtime/src/runtime.mjs` tager en valgfri
   `actionJournal`. Er den sat, skrives intent før executor og outcome efter.
   Fejler intent → `halted` (nul eksterne ændringer); findes intent uden outcome
   → `unknown`; fejler outcome efter udførelse → `unknown`, aldrig success.
   Runtimen udleder et stabilt idempotency-ID pr. handling
   (`sha256({taskId,index,verb,target,changeDigest})`).

7. **Audit-servicen bruger journalen.** `modules/audit-service/service/src/server.mjs`
   tager `journal`, skriver intent før handleren og svarer
   `503 { failMode: "closed", status: "halted" }` hvis journalen er utilgængelig.
   HTTP-endpointene `/v1/audit/intents` (POST), `/v1/audit/intents/:id` (GET) og
   `/v1/audit/intents/:id/outcome` (POST) eksponerer journalen for
   `createHttpActionJournal` i runtimen. CLI'en kan starte med `--audit-dir`.

8. **Kontrakter, migration, checks og docs.** Migration `0003_audit_durability.sql`
   (additiv, bagudkompatibel). Nye kontrakter `audit-intent`,
   `audit-outcome`, `audit-checkpoint` med eksempler. `make audit-durability-test`
   og `make audit-durability-check` samt komponenten `audit-durability` er
   registreret i `tools/baseline/registry.mjs`. ADR-0021 og
   `docs/spec/audit-durability.md` beskriver protokollen.

## Ændrede/nye filer (overlay, relativt til `00-core/`)

```
persistence/migrations/0003_audit_durability.sql (ny: intent/personal-tabeller + v3-kolonner)
persistence/src/db.mjs                    (+ 2 tenant-tabeller/views)
persistence/src/adapters/audit.mjs        (+ intent/outcome/retention-felter i hash-kæden)
persistence/src/adapters/audit-journal.mjs (ny: intent/outcome/idempotens/reconciliation)
persistence/src/checkpoint.mjs            (ny: eksternt HMAC-checkpoint + verify)
persistence/src/redact.mjs                (ny: secret-redaktion, personal-split, retention)
persistence/src/audit-roles.mjs           (ny: audit-writer/audit-reader)
persistence/src/audit-check.mjs           (ny: fokuseret DKC-009-kontrol)
persistence/src/check.mjs                 (+ audit-tabeller, roller, intent/checkpoint)
persistence/src/index.mjs                 (nye eksporter)
persistence/test/audit-journal.test.mjs   (ny: 8 tests)
persistence/test/checkpoint.test.mjs      (ny: 6 tests)
persistence/test/migrations.test.mjs      (+ v3-opgradering)
runtime/src/runtime.mjs                   (+ actionJournal, intent/outcome, unknown, reconcile)
runtime/src/clients.mjs                   (+ memory-/HTTP-action-journal)
runtime/src/reconcile.mjs                 (ny: batch-reconciliation)
runtime/test/audit-durability-runtime.test.mjs (ny: 6 tests)
modules/audit-service/service/src/server.mjs (+ journal, intent før handler, HTTP-endpoints)
modules/audit-service/service/src/cli.mjs    (+ --audit-dir/--anchor-dir/--anchor-secret)
modules/audit-service/service/test/audit-durability.test.mjs (ny: 4 tests)
contracts/audit-intent.schema.json        (ny)
contracts/audit-outcome.schema.json       (ny)
contracts/audit-checkpoint.schema.json    (ny)
contracts/examples/audit-{intent,outcome,checkpoint}.example.json (nye)
conformance/src/validate-schemas.mjs      (+ 3 eksempel-mappings)
conformance/test/audit-durability-conformance.test.mjs (ny: 4 accept-tests)
Makefile                                  (+ audit-durability-check/-test, + i ci)
tools/baseline/registry.mjs               (+ 2 checks, komponent audit-durability)
docs/adr/0021-holdbar-audit-og-fail-closed.md (ny ADR)
docs/adr/README.md, docs/spec/README.md   (indeks)
docs/spec/audit-durability.md             (ny spec)
docs/spec/reference-module.md             (+ holdbar audit-sektion)
docs/status/implementation-matrix.md      (regenereret)
```

## Testkommandoer og resultater (checkout `83ad91a` + DKC-001..008 + DKC-055, Node v22.22.1)

| Kommando | Resultat |
| --- | --- |
| `make audit-durability-test` | **28 pass / 0 fail** (14 journal/checkpoint + 6 runtime + 4 service + 4 konformans) |
| `make audit-durability-check` | **OK** (3 migrationer, intent/outcome, idempotens, checkpoint, redaktion, 2 roller) |
| `make persistence-test` | **39 pass / 0 fail** |
| `make persistence-check` | **OK** (3 migrationer, 3 databaseidentiteter, 7 tenant-views) |
| `make runtime-test` | **52 pass / 0 fail** |
| `make boundary-test` | **21 pass / 0 fail** |
| `make test` (conformance) | **73 pass / 0 fail** (inkl. 4 nye DKC-009-accept-tests) |
| `make audit-service-test` | **30 pass / 0 fail** |
| `make approval-test` | **11 pass / 0 fail** + **20 pass / 0 fail** |
| `make agent-registry-test` | **33 pass / 0 fail** |
| `make agent-conformance-test` | **10 pass / 0 fail** |
| `make validate` | 28 skemaer, 27 eksempler, 5 arkitektur/identitet, 1 godkendelse, 1 tenant |
| `make lint` | OK (182 JSON-filer, 442 filer) |
| `make baseline` | 60 checks: **50 pass, 1 fail, 0 error, 9 NOT RUN**; `audit-durability-test` og `audit-durability-check` **PASS** |

Evidens: `evidence/logs/*.log` og `evidence/baseline/` (log + JSON). Den ene
baseline-fejl er fortsat `changelog-check` (manglende DCO sign-off, DKC-001-fundet).
Baselinekørslen ændrede de sporede `modules/*/conformance`-fixtures
(ikke-idempotente `*-evidence`-generatorer); de er nulstillet efter kørslen.

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Audit utilgængelig før handling giver nul eksterne ændringer | **PASS** | `runtime/test/audit-durability-runtime.test.mjs` ("utilgængeligt audit … nul eksterne ændringer"), `modules/audit-service/service/test/audit-durability.test.mjs` (`503 failMode=closed`, ingen `completed`), `conformance/test/audit-durability-conformance.test.mjs` |
| Crash efter ændring skaber ikke falsk success eller ukritisk genudførelse | **PASS** | `persistence/test/audit-journal.test.mjs` (pending→unknown, reconciliation, gentaget intent afvises), `runtime/test/audit-durability-runtime.test.mjs` (pending→`unknown`, manglende outcome→`unknown`, afsluttet intent afspilles) |
| Ændring, sletning og trunkering kan påvises mod checkpoint | **PASS** | `persistence/test/checkpoint.test.mjs` (changed/deleted/truncated/forged samt tilladte tilføjelser), `persistence/src/audit-check.mjs` |
| Audit overlever genstart; hemmeligheder optræder ikke i loggen | **PASS** | `persistence/test/audit-journal.test.mjs` (genstart + secret-redaktion inkl. databasefilens bytes), `conformance/test/audit-durability-conformance.test.mjs` |

## Resterende begrænsninger

- **Checkpointet forankres i en anden mappe** i denne leverance. En rigtig
  WORM/append-only- eller ekstern transparency-log er en driftsopsætning og er
  **ikke** afprøvet her (NOT RUN). Kontrakten (`audit-checkpoint.schema.json`) og
  verifikationen er implementeret.
- **PostgreSQL-roller/RLS er ikke afprøvet.** SQLite håndhæver `readOnly` for
  læserrollen; de tilsvarende `GRANT`s er dokumenteret, men ikke kørt mod en
  levende database (NOT RUN).
- **Journalen er opt-in i runtime og audit-service.** Uden en `journal`
  bevares den gamle in-memory-adfærd for bagudkompatibilitet; den stærke
  fail-closed-garanti kræver at den holdbare journal gives ind.
- **Audit-servicens subject-register er fortsat in-memory.** Den hash-kædede
  begivenhedslog og persondata-tabellen er holdbare; selve emneregistret til
  privacy-verberne er ikke migreret.
- **SQLite er en enkelt-node-løsning.** Flere processer mod samme fil er
  understøttet; replikaer på tværs af noder kræver en netværksdatabase.
- **`node:sqlite` er eksperimentelt** i Node (≥ 22.5) og kan ændre API.
- **DKC-001's `changelog-check`-fejl består** (4 commits mangler DCO sign-off).
- Overlay, ikke committed kode: `00-core/` er urørt.

## Til uafhængig gennemgang

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (5f9fa73).
- **Undersøgt checkout:** `83ad91a`.
- **Forudsætnings-overlays:** DKC-001 .. DKC-008 samt DKC-055 (lægges via
  `apply.sh`, som kæder `dkc-055/apply.sh`).
- **Denne leverance:** `01-step1/output/dkc-009/` (36 filer i `deliverable/`,
  SHA256 i `OVERLAY-MANIFEST.txt`).
- Uafhængig verifikation, live-integrationer (WORM-lagring, rigtig PostgreSQL)
  og menneskelig release-godkendelse er separate handlinger og er **ikke** udført
  her.
