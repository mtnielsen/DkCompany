# DKC-028 — Integrér vidensbase og rettighedsbevidst søgning

Kumulativ overlay oven på stak-tippet **DKC-034**. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-034/apply.sh` → `dkc-052/apply.sh` →
  `dkc-032/apply.sh` → `dkc-051/apply.sh` → … → `dkc-001/apply.sh`. DKC-028
  afhænger formelt af **DKC-011** (værktøjsgrænse og injektionssignal),
  **DKC-012** (modelgateway og budgetter), **DKC-021** (sletning, legal hold og
  gendannelsesregler), **DKC-023** (fælles adapter-SDK) og **DKC-025** (portal
  og kundens livscyklus). Alle er verificeret i den anvendte stak (se
  `evidence/prerequisites.txt`). Den genbruger desuden **DKC-006**
  (tenant-kontekst) og **DKC-048** (beskyttede dataklasser).
- **Miljø:** Node v22.22.1. Ingen levende BookStack-installation, intet rigtigt
  API-token og ingen rigtig permission-/slettehændelse. Adapteren, indekset,
  filtreringen og invalideringen er efterprøvet mod en mock-upstream; den målte
  slettefrist er NOT RUN (`docs/search/bookstack-live.md`).

## Implementeret adfærd

1. **Read-only videnskilde** (`search/sources.json`,
   `contracts/knowledge-source.schema.json`): BookStack som første kandidat,
   tenantbundet, `readOnly`, `aclMode: source` og med en **secretreference**
   (aldrig en rå hemmelighed). `search/src/bookstack.mjs` er en rigtig
   read-only klient, der mapper sider og deres content-permissions til et
   `KnowledgeDocument`.
2. **Holdbart filindeks** (`search/src/index-store.mjs`): dokumenter gemmes på
   disk med tenant, klassifikation og ACL; hver indholds- eller ACL-ændring
   hæver en **epoch**, og en sletning er en tombstone. Indekset genindlæses fra
   disk (efterprøvet).
3. **Tenant + kilde-ACL før scoring** (`search/src/permissions.mjs`,
   `search/src/retrieval.mjs`): tenanten udledes af den verificerede principal,
   dokumenter filtreres på tenant og ACL *før* den leksikalske og
   embedding-baserede scoring, og et fortroligt/særligt følsomt dokument kræver
   en tilsvarende klarering. En privat HR-side kan derfor ikke nå svar, snippets,
   embedding-søgning eller citationsliste for uvedkommende.
4. **Revalidering ved læsning** (`search/src/ingest.mjs`,
   `search/src/invalidation.mjs`): en `aclResolver` læser den aktuelle ACL fra
   kilden ved hver søgning, så en tilbagekaldt rettighed også rammer allerede
   indekseret indhold; er resolveren utilgængelig, nægtes dokumentet
   (fail-closed). `reconcilePermissions` opdaterer indeksets ACL og fjerner
   slettede sider.
5. **Cache-invalidering og slettefrist** (`search/src/invalidation.mjs`): en
   cachepost er bundet til indeksets epoch og invalideres ved rettighedsændring
   og sletning. Slettefristen (`search/index-policy.json`,
   `deletion.deadlineSeconds`) måles deterministisk.
6. **Svar med kildehenvisning, usikkerhed og ubetroet indhold**
   (`search/src/answer.mjs`, `contracts/retrieval-answer.schema.json`): hvert
   snippet pakkes som ubetroet indhold gennem runtimens grænse (DKC-011) og
   scannes for injektion. Et forfalsket værktøjskald i en artikel bliver aldrig
   et kald: `toolProposals` er tom, og `toolActivationDenied` er altid sand.
7. **Konformans og negativ kontrol** (`conformance/src/search.mjs`,
   `conformance/test/search-conformance.test.mjs`): skema + beslutningssemantik,
   med afvisning af en ikke-read-only kilde, en rå hemmelighed, en politik uden
   ACL-før-scoring og et svar der aktiverer et værktøj.
8. **Releasebinding**: nyt krav `REQ-KNOWLEDGE-001` og trussel
   `THREAT-KNOWLEDGE-001` (matrixversion **1.36.0**), registreret i
   `tools/baseline/registry.mjs` som komponenten `knowledge-search` med
   `search-check`, `search-test`, `search-run`, `search-report` og
   `integration-bookstack-live` (sidstnævnte NOT RUN).

## Ændrede og nye filer

Se `deliverable/`. Filerne er beregnet ved at diffe arbejdsklonen mod en frisk
klon med kun `dkc-034/apply.sh` anvendt (47 filer, ekskl. `node_modules`,
`.conformance-out`, `.git`, `evidence/generated`). De vigtigste:

- Nye: `search/` (kilder, politik, korpus, kilde, tests, package.json, rapport),
  `conformance/src/search.mjs`,
  `conformance/test/search-conformance.test.mjs`,
  `contracts/{knowledge-source,knowledge-document,retrieval-answer}.schema.json`
  + eksempler, `docs/spec/knowledge-search.md`,
  `docs/search/{knowledge-search-report,bookstack-live}.md`,
  `docs/operations/knowledge-search.md`,
  `docs/adr/0067-rettighedsbevidst-videnssoegning.md`.
- Ændrede: `Makefile` (7 targets + `ci`), `conformance/src/schemas.mjs`,
  `conformance/src/validate-schemas.mjs`, `tools/baseline/registry.mjs`,
  `release/matrix/{test-matrix,threats}.json`, genererede
  `docs/status/implementation-matrix.md`, `docs/status/supply-chain.md`,
  `docs/testing/test-matrix.md`, `docs/security/threat-model.md`,
  `release/{artifacts.json,sbom/platform-sbom.cdx.json}` (nyt
  `search/package.json`).

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make validate` | PASS (3 nye kontrakter + 3 eksempler valideret) |
| `make lint` | PASS (702 JSON-filer, 1820 filer) |
| `make search-check` | PASS (kilder, politik, dokumenter og 7 scenarier) |
| `make search-run` | PASS (7 scenarier + slettefrist 0 ms / 300000 ms) |
| `make search-test` | PASS (15 enhedstests + 8 konformanstests) |
| `make search-sync` | PASS (synkroniserer 9 dokumenter til et filindeks) |
| `make search-render` / `make search-report` | PASS (deterministisk rapport) |
| `make release-check` | PASS (59 krav; matrixversion 1.36.0) |
| `make release-test` | PASS |
| `make supply-chain-check` | PASS (SBOM opdateret for nyt `package.json`) |
| `make test` | PASS |
| `make conform-all` | PASS |
| `make baseline-test` | PASS |
| `make baseline` | 229 checks: **178 PASS, 1 FAIL, 50 NOT RUN**. Det ene FAIL er det kendte, forudgående `changelog-check` (manglende DCO sign-off, også i `83ad91a`); det er ikke "rettet". |

E2e: pakkens `apply.sh` blev lagt på en frisk klon, `make install` kørt, og de
fokuserede checks passerer. Træet er byte-identisk med arbejdsklonen
(`evidence/e2e-tree-diff.txt`: 1820 filer, 0 forskelle).

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Privat HR-side optræder ikke i svar, snippets, embeddingsøgning eller citationsliste for uvedkommende | **PASS** | `search/src/retrieval.mjs` (tenant/ACL før scoring) + `search/src/answer.mjs`; scenariet `hr-private-hidden` og `search/test/retrieval.test.mjs`/`answer.test.mjs` afviser tre HR-dokumenter i retrieval, embedding og citationer. |
| Tilbagekaldt adgang håndhæves også på tidligere indeksindhold | **PASS** | `aclResolver` revaliderer ved læsning + `reconcilePermissions`; scenariet `revoked-access`, `search/test/retrieval.test.mjs` og `invalidation.test.mjs`. |
| Prompt injection i en artikel kan ikke aktivere privilegerede tools | **PASS** | `search/src/answer.mjs` bruger `createUntrustedContent` + `scanUntrusted` (DKC-011); `toolProposals` er tom, `toolActivationDenied` sand; scenariet `prompt-injection` og `answer.test.mjs`. |
| Slettet dokument forsvinder efter fastsat og målt frist | **PASS** (implementeret kontrol) | `search/src/invalidation.mjs` tombstone + `measureDeletionDeadline`; scenariet `deleted-document` rapporterer 0 ms af 300000 ms. Den faktiske måling på en levende BookStack er **NOT RUN**. |

## Tilknyttede krav/checks og hvad der er NOT RUN

- `REQ-KNOWLEDGE-001` binder `search-check`, `search-test`, `search-run` og
  `integration-bookstack-live`; `THREAT-KNOWLEDGE-001` (lækage via søgning,
  indeks, cache eller citationer samt injektionsdrevet værktøjskald) er tilføjet.
- **NOT RUN:** `integration-bookstack-live` (`make search-live`) — kræver en
  levende BookStack, et rigtigt token og en rigtig permission-/slettehændelse.
  Se `docs/search/bookstack-live.md`.

## Resterende begrænsninger

- Retrieval bruger en deterministisk hash-embedding i stedet for en rigtig
  embedding-model; grænsen og filtreringen er den samme, men en målt
  semantisk kvalitet mangler.
- Slettefristen er målt i indeks og cache; en afledt AI-visning og en ekstern
  backup følger DKC-021/DKC-042.
- BookStack-adapteren er implementeret som en read-only kilde i `search/`; et
  selvstændigt `modules/bookstack-adapter/` med modulmanifest, GitOps-Application
  og serviceklasse er ikke oprettet i denne opgave.
- Kilden, klassifikationen og slettefristen skal vedligeholdes.

## Godkendelse

Implementeringen er ikke produktionsklar, og agenten godkender ikke sin egen
indsats. En målt slettefrist og en rigtig BookStack-hændelse kræver ekstern
infrastruktur; uafhængig verifikation og menneskelig release-godkendelse er
separate skridt.
