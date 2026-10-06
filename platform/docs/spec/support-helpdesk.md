# Support og sagsbehandling

DKC-029 leverer tickets, prioritet, SLA og kundehistorik med **Zammad** som
første kandidat og system-of-record. Platformen spejler sager, køer, rettigheder
og historik og læser alt sags- og bilagsindhold som **ubetroet data**. En
ekstern kunde ser kun egne sager, og en AI må kun klassificere og udkaste — en
afsendelse er en separat, godkendt handling.

## Dataflyt

```
helpdesk/sources.json        (Zammad-kilder, køer med ACL, vedhæftningspolitik)
        │  helpdesk/src/zammad.mjs  (mapper Zammad-sager)
        ▼
helpdesk/src/intake.mjs  →  helpdesk/src/store.mjs  (filbutik, epoch, append-only historik)
        │  helpdesk/src/permissions.mjs (tenant + kø-ACL, default-deny)
        ▼
helpdesk/src/classification.mjs  (AI-klassifikation, svarudkast)
        │  helpdesk/src/approval-gate.mjs (menneskelig, ændringsbunden godkendelse)
        ▼
helpdesk/report/helpdesk-report.json  +  docs/helpdesk/helpdesk-report.md
```

## Beslutningssemantik

- **Zammad er system-of-record.** Kilden er `systemOfRecord: upstream` og
  `writeMode: adapter-mediated`. Der skrives kun gennem adapteren, og et retry
  bærer en idempotency-nøgle (message-id), så det ikke skaber en dublet.
- **Kø-routing og rettigheder.** En kø skal være erklæret for kilden, ellers
  afvises posten (`unknown_queue`). Adgang er default-deny: tenant skal matche,
  en agent skal stå i køens ACL og have en tilstrækkelig klarering, og en
  ekstern kunde ser kun sager hvor rekvirenten er principalen selv og kun i
  eksternt synlige køer.
- **Sikker vedhæftning.** Hvert bilag pakkes som ubetroet indhold
  (`createUntrustedContent`), scannes for injektion (`scanUntrusted`) og gemmes
  som en blob. `executable` er altid `false`, `mayChangePermissions` er altid
  `false`, og `attachToTicket` afviser enhver patch der forsøger at ændre `acl`,
  `queue` eller `classification`.
- **AI klassificerer og udkaster.** `classifyTicket` og `draftReply` bruger en
  injicerbar model. Modeloutput parses med `parseModelOutput` og behandles som
  ubetroet. `toolProposals` er tom, og `toolActivationDenied` er altid sand.
- **Afsendelse er en separat handling.** `recordReplyApproval` registrerer en
  menneskelig godkendelse bundet til udkastets `draftDigest`, tenant og en
  udløbsfrist. `sendReply` nægter at sende uden en gyldig godkendelse, og en
  ændring af udkastet gør den gamle godkendelse ugyldig. Lukning er også
  godkendelsespligtig.
- **Historik og retention.** Butikken fører en append-only, uforanderlig
  historik. `exportSubject` samler mails, bilag og indeks for et subjekt, og
  `deleteSubject` sletter fladvis (mail, bilag, indeks) og efterlader en
  tombstone. Et legal hold (DKC-021's `holdCovers`) blokerer sletning. En
  backup/gendannelse bevarer sager og historik.

## Grænser og ærlighed

Kilderne, politikken, indgangen, adgangsfiltreringen, vedhæftningsscanningen,
godkendelsesgaten, retentionen og backup/gendannelsen er efterprøvet
deterministisk mod en mock-upstream (`measured: false`). En faktisk målt
integration mod en levende Zammad kræver en ekstern installation og et rigtigt
API-token og er **NOT RUN** (`make helpdesk-live`).

Se [`docs/helpdesk/zammad-live.md`](../helpdesk/zammad-live.md) for hvad der
udestår, og [`docs/operations/helpdesk.md`](../operations/helpdesk.md) for drift.
