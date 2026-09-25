# DKC-029 — Integrér support og sagsbehandling

Kumulativ overlay oven på stak-tippet **DKC-028**. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-028/apply.sh` → `dkc-034/apply.sh` →
  `dkc-052/apply.sh` → `dkc-032/apply.sh` → … → `dkc-001/apply.sh`. DKC-029
  afhænger formelt af **DKC-021** (sletning, legal hold og gendannelsesregler),
  **DKC-023** (fælles adapter-SDK) og **DKC-025** (portal og kundens
  livscyklus). Alle er verificeret i den anvendte stak (se
  `evidence/prerequisites.txt`). Den genbruger desuden **DKC-011**
  (værktøjsgrænse og injektionssignal), **DKC-006** (tenant-kontekst) og
  **DKC-007** (deterministisk digest).
- **Miljø:** Node v22.22.1. Ingen levende Zammad-installation, intet rigtigt
  API-token og ingen rigtig mail-/vedhæftningshændelse. Adapteren, indgangen,
  kø-routing, adgangsfiltreringen, vedhæftningsscanningen, godkendelsesgaten,
  retentionen og backup/gendannelsen er efterprøvet deterministisk mod en
  mock-upstream; den målte integration (`make helpdesk-live`) er NOT RUN
  (`docs/helpdesk/zammad-live.md`).

## Implementeret adfærd

1. **Zammad som system-of-record** (`helpdesk/sources.json`,
   `contracts/helpdesk-source.schema.json`): en tynd adapter
   (`helpdesk/src/zammad.mjs`) mod Zammads API med en testdobbel
   (`helpdesk/src/mock-zammad.mjs`). Kilden er `systemOfRecord: upstream`,
   tenantbundet og bruger en **secretreference** (aldrig en rå hemmelighed).
2. **Indgående testmail/webformular** (`helpdesk/src/intake.mjs`): en mail eller
   webformular bliver én sag. Et retry med samme message-id er idempotent og
   skaber ingen dublet, en kø skal være erklæret for kilden (ellers afvises
   posten), og sagen klassificeres og routes med en append-only historik.
3. **Køer, rettigheder og tenantadskillelse** (`helpdesk/src/permissions.mjs`):
   adgang er default-deny. En agent skal stå i køens ACL og have en
   tilstrækkelig klarering; en **ekstern kunde ser kun egne sager** og kun i
   eksternt synlige køer.
4. **Sikker vedhæftningshåndtering** (`helpdesk/src/attachments.mjs`): hvert
   bilag pakkes som ubetroet indhold gennem runtimens grænse (DKC-011), scannes
   for injektion og gemmes som en blob. `executable` og `mayChangePermissions`
   er altid `false`, og `attachToTicket` afviser enhver patch der forsøger at
   ændre `acl`, `queue` eller `classification`.
5. **AI-klassifikation og svarudkast** (`helpdesk/src/classification.mjs`):
   AI'en klassificerer og udkaster. Modeloutput parses som ubetroet
   (`parseModelOutput`), `toolProposals` er tom, og `toolActivationDenied` er
   altid sand. Udkastet bærer et `draftDigest`.
6. **Afsendelse er en separat, godkendt handling**
   (`helpdesk/src/approval-gate.mjs`, `contracts/reply-draft.schema.json`): et
   menneske godkender udkastet bundet til dets digest, tenant og en
   udløbsfrist. `sendReply` nægter at sende uden en gyldig godkendelse, og en
   ændring af udkastet gør den gamle godkendelse ugyldig. Lukning er ligeledes
   godkendelsespligtig.
7. **Eksport, sletning og retention** (`helpdesk/src/retention.mjs`): eksport
   samler mails, bilag og indeks for et subjekt. Sletning sker fladvis (mail,
   bilag, indeks), efterlader en tombstone, og blokeres af et legal hold
   (DKC-021's `holdCovers`). Butikken (`helpdesk/src/store.mjs`) kan snappes og
   gendannes, og en gendannelse bevarer sager og historik.
8. **Konformans og negativ kontrol** (`conformance/src/helpdesk.mjs`,
   `conformance/test/helpdesk-conformance.test.mjs`): skema +
   beslutningssemantik, med afvisning af en ikke-Zammad kilde, en rå
   hemmelighed, en politik uden godkendelseskrav og et udkast der aktiverer et
   værktøj.
9. **Releasebinding**: nyt krav `REQ-SUPPORT-001` og trussel
   `THREAT-HELPDESK-001` (matrixversion **1.37.0**), registreret i
   `tools/baseline/registry.mjs` som komponenten `helpdesk` med
   `helpdesk-check`, `helpdesk-test`, `helpdesk-run`, `helpdesk-report` og
   `integration-zammad-live` (sidstnævnte NOT RUN).

## Ændrede og nye filer

Se `deliverable/`. Filerne er beregnet ved at diffe arbejdsklonen mod en frisk
klon med kun `dkc-028/apply.sh` anvendt (49 filer, ekskl. `node_modules`,
`.conformance-out`, `.git`, `evidence/generated`). De vigtigste:

- Nye: `helpdesk/` (kilder, politik, korpus, kilde, tests, `package.json`,
  rapport), `conformance/src/helpdesk.mjs`,
  `conformance/test/helpdesk-conformance.test.mjs`,
  `contracts/{helpdesk-source,support-ticket,reply-draft}.schema.json` +
  eksempler, `docs/spec/support-helpdesk.md`,
  `docs/helpdesk/{helpdesk-report,zammad-live}.md`,
  `docs/operations/helpdesk.md`,
  `docs/adr/0068-support-og-sagsbehandling.md`.
- Ændrede: `Makefile` (6 targets + `ci`), `conformance/src/schemas.mjs`,
  `conformance/src/validate-schemas.mjs`, `tools/baseline/registry.mjs`,
  `release/matrix/{test-matrix,threats}.json`, genererede
  `docs/status/implementation-matrix.md`, `docs/status/supply-chain.md`,
  `docs/testing/test-matrix.md`, `docs/security/threat-model.md`,
  `release/{artifacts.json,sbom/platform-sbom.cdx.json}` (nyt
  `helpdesk/package.json`).

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make validate` | PASS (3 nye kontrakter + 3 eksempler valideret; 131 skemaer, 142 eksempler) |
| `make lint` | PASS (714 JSON-filer, 1858 filer) |
| `make helpdesk-check` | PASS (kilder, politik, sager og 6 scenarier) |
| `make helpdesk-run` | PASS (6 scenarier) |
| `make helpdesk-test` | PASS (21 enhedstests + 8 konformanstests) |
| `make helpdesk-render` / `make helpdesk-report` | PASS (deterministisk rapport) |
| `make release-check` | PASS (60 krav; matrixversion 1.37.0) |
| `make release-test` | PASS |
| `make supply-chain-check` | PASS (SBOM opdateret for nyt `package.json`) |
| `make test` | PASS (418 tests) |
| `make conform-all` | PASS |
| `make baseline-test` | PASS |
| `make baseline` | 234 checks: **182 PASS, 1 FAIL, 51 NOT RUN**. Det ene FAIL er det kendte, forudgående `changelog-check` (manglende DCO sign-off, også i `83ad91a`); det er ikke "rettet". |

E2e: pakkens `apply.sh` blev lagt på en frisk klon, `make install` kørt, og de
fokuserede checks passerer. Træet er byte-identisk med arbejdsklonen
(`evidence/e2e-tree-diff.txt`).

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| En sag går fra modtagelse til lukning med historik | **PASS** | `helpdesk/src/intake.mjs` + `helpdesk/src/approval-gate.mjs`; scenariet `intake-to-closure` bekræfter `ticket.received` → `ticket.classified` → `ticket.queued` → `ticket.reply_sent` → `ticket.closed` i rækkefølge, og at sagen får `status: closed` og `closedAt`. |
| AI-udkast sendes ikke uden den gældende godkendelse | **PASS** | `helpdesk/src/approval-gate.mjs`; scenariet `approval-required` afviser afsendelse uden godkendelse, afviser en genbrugt godkendelse på et ændret udkast (`binding-mismatch`) og sender kun med en gyldig godkendelse. `helpdesk/test/approval.test.mjs` dækker det samme. |
| Vedhæftning med skadelig instruktion kan ikke ændre rettigheder | **PASS** | `helpdesk/src/attachments.mjs` + `runtime/src/injection.mjs`; scenariet `attachment-injection-neutralized` bekræfter karantæne, at `executable`/`mayChangePermissions` er `false`, at sagens ACL er uændret, at et rettighedsændrende patch afvises, og at udkastet har tomme `toolProposals` og `toolActivationDenied: true`. |
| Ekstern kunde ser kun egne sager; backup/restore består | **PASS** | `helpdesk/src/permissions.mjs` + `helpdesk/src/store.mjs`; scenariet `external-customer-isolation` bekræfter kunde- og tenantisolation i begge retninger, og `retention-and-recovery` bekræfter at `store.snapshot`/`FileHelpdeskStore.restore` bevarer sager og historikdigest. |
| Eksport, sletning og retention for mails, bilag og indeks | **PASS** (implementeret kontrol) | `helpdesk/src/retention.mjs`; scenariet `retention-and-recovery` eksporterer og sletter fladvis (mail, bilag, indeks), blokerer ved legal hold og efterlader tombstones. Den faktisk målte retention mod en levende Zammad er **NOT RUN**. |

## Tilknyttede krav/checks og hvad der er NOT RUN

- `REQ-SUPPORT-001` binder `helpdesk-check`, `helpdesk-test`, `helpdesk-run` og
  `helpdesk-report`; `THREAT-HELPDESK-001` (grænsen `external-sources`) dækker
  vedhæftnings-/injektions- og godkendelsesrisikoen.
- `integration-zammad-live` er **NOT RUN**: der findes ingen levende Zammad, intet
  rigtigt token og ingen rigtig mail-/vedhæftningshændelse. Se
  `docs/helpdesk/zammad-live.md`.
- Den medfølgende klassifikations-/udkastmodel er en deterministisk,
  regelbaseret model til offline kørsel. En levende modelgateway (DKC-012) er en
  separat integration og er ikke kørt her.
- Rapporten erklærer `measured: false`.

## Gennemgå-identifikatorer

- Base: `5f9fa73457d22583b9948611d5cc3afffec4ae38`
- Checkout: `83ad91a963d8055f77c29fb4361455689df95acb`
- Stak-tip før dette overlay: `dkc-028/apply.sh`
- Denne ændring: denne pakkes `deliverable/` (49 filer) oven på stakken.
