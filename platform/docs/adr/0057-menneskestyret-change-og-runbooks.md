# ADR-0057 — Menneskestyret change og runbookgodkendelse

- **Status:** accepteret
- **Beslutningstagere:** Platform Owner, Security Owner
- **Dato:** 2026-09-24
- **Beslutningsdrev:** DKC-045. DKC-004 og DKC-005 gav autentiske,
  ændringsbundne godkendelser og lukkede runtime-bypass. DKC-014 gav
  signerede releaseartefakter, DKC-044 gav en sporbar serviceproces og
  DKC-055 gav én uforanderlig rolle pr. agent. Det mangler en måde at
  forhåndsgodkende en selvreparation, så den er *lige så præcist autoriseret*
  som en enkelt ændring.

## Kontekst og problemstilling

En forhåndsgodkendt runbook er et kompromis: den giver hurtig, automatisk
reparation uden en menneskelig godkendelse pr. mutation, men den må ikke blive
et smuthul.

- **Scope-glidning.** En ny runbookversion eller et større scope genbruger en
  gammel godkendelse, så agenten udfører noget mennesket aldrig godkendte.
- **Standard-godkendelse som gummistempel.** En `pending`-, `expired`- eller
  no-objection-beslutning behandles som approval.
- **Emergency som bagvej.** Emergency-flowet bruges til at ændre policy, audit
  eller egne rettigheder (A4/AI-immutable).
- **Samtidige ændringer.** To changes på samme ressource implementeres
  samtidigt og omgår hinandens låse.

## Beslutningskriterier

- Genbrug af den eksisterende approval-service (DKC-004/005) — ingen ny
  godkendelsesmotor.
- Versioneret og signeret runbook med lukket scope, parameterrammer,
  forudsætninger, maksimal påvirkning, udløb, forsøgsgrænse, testet rollback og
  postchecks.
- Tre eksplicitte flows: `standard`, `normal`, `emergency`.
- Server-side resolver: klienten kan ikke medsende runbook-digesten.
- Change-kalender med vedligeholdelsesvindue, konflikter og atomisk lås.
- Ingen ændring af A4- eller AI-immutable-grænsen.

## Overvejede muligheder

- **A: Godkend hver mutation.** Sikkert, men fjerner hele idéen med en
  forhåndsgodkendt selvreparation.
- **B: Fri runbook uden signatur og scope.** Enkelt, men runbook-teksten kan
  ændres efter godkendelsen, og en agent kan pege på en hvilken som helst
  version.
- **C: Signeret runbook, server-side resolver og binding til digest.** Flere
  bevægelige dele, men hvert acceptkriterium bliver efterprøveligt og en
  version-/scopeændring kræver en ny menneskelig godkendelse.

## Beslutning

Vi vælger **C**.

1. **Signeret, versioneret runbook** (`approvals/src/runbook.mjs`,
   `contracts/runbook.schema.json`): kanonisk indhold hashes og signeres med
   HMAC-SHA256 over hele indholdet undtagen signaturfeltet. En manglende,
   ukendt eller tilbagekaldt nøgle afvises; en runbook uden gyldig signatur må
   ikke eksekveres. Nøglen leveres i produktion af KMS/HSM (ekstern), i test af
   et injiceret nøglesæt.
2. **Server-side resolver** (`approvals/src/change-service.mjs`): runtimen
   sender `runbookRef`, verbum, mål, miljø, kunde og parametre; resolveren slår
   den registrerede, signerede version op, håndhæver scope, parameterramme,
   forudsætninger, udløb og forsøgsgrænse og sætter digesten server-side.
   `runtime/src/runtime.mjs` overskriver enhver klientpåstand.
3. **Tre flows**: `standard` kræver en menneskelig pre-approval bundet til
   runbook-digesten; `normal` kræver en konkret godkendelse pr. mutation;
   `emergency` kræver en særskilt, tidsbegrænset autorisation.
4. **Change-kalender** (`approvals/src/change-calendar.mjs`):
   vedligeholdelsesvinduer, konfliktregistrering og en atomisk lås pr. mål
   (hukommelse eller filbaseret `wx`). En normal/emergency-change tager først
   låsen efter godkendelsen.
5. **A4 og AI-immutable røres ikke.** Runtimens uafhængige A4-klassifikation og
   beskyttelsesguard kører før resolveren; emergency kan ikke slå dem fra.

## Konsekvenser

- En ny version eller et større scope har en ny digest og kræver derfor en ny
  menneskelig godkendelse.
- Timeout, manglende svar og no-objection bliver aldrig approval: kun en
  eksplicit `approve` fra en verificeret menneskelig identitet tæller.
- To samtidige changes på samme ressource koordineres gennem kalenderen og
  låsen.
- Runbooks og change-requests valideres i CI (`make runbook-check`,
  `make runbook-test`), og registreres i baseline-registeret.
- En rigtig KMS/HSM-signeringsnøgle og en fler-node låsetjeneste er separate
  integrationer og rapporteres ærligt som NOT RUN.

## Referencer

- `docs/spec/change-and-runbooks.md`
- `docs/runbooks/runbook-approval.md`
- `contracts/runbook.schema.json`, `contracts/change-request.schema.json`
- `approvals/src/runbook.mjs`, `approvals/src/change-service.mjs`
