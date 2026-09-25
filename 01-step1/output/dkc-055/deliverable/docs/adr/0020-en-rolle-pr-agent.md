# ADR-0020: Præcis én uforanderlig rolle pr. agent

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-055. En agent kunne i princippet både planlægge, implementere, kontrollere og eksekvere den samme ændring, og der fandtes ingen uforanderlig rollebinding mellem agentidentitet og beføjelser. Dermed kunne samme agent (eller samme model i to hattene) optræde som sin egen uafhængige kontrol.

## Kontekst og problemstilling

Platformens arbejdsgang er plan → implementering → uafhængig verifikation → menneskelig godkendelse → eksekvering. Uden en håndhævet rolle pr. agentidentitet kan en agent:

- skrive den kode den selv har planlagt og derefter erklære den verificeret,
- godkende sin egen ændring,
- ændre det godkendte scope eller generere en ny plan, når eksekveringen fejler,
- genbruge et bredt credential på tværs af roller,
- skifte hat via et alias, en ny session eller en delegeret subagent.

Manifestet deklarerede capabilities og autonomiklasse, men ikke en rolle, og `validateManifest` håndhævede ikke at capabilities passede til en rolle.

## Beslutningskriterier

- En agent må have præcis én rolle: observer, planner, implementer, verifier, executor eller auditor.
- Rollen skal være uforanderlig pr. identitet og håndhæves i runtime, register og reviewer.
- Godkendelse er og forbliver menneskelig; en AI må ikke være godkender.
- Credentials, tools, input/output-kontrakter og artifact-provenance skal være rollebundne.
- En uafhængig verifikation må ikke kunne udføres af producenten, dens rolle eller dens model.

## Overvejede muligheder

- **Blot dokumentere roller i manifestet.** Ingen håndhævelse; en agent kan ignorere dem.
- **Lade rollen være en egenskab ved opgaven.** Samme identitet kan skifte hat pr. opgave.
- **Uforanderlig rolle pr. identitet med rollebundne credentials, handoff-graf og runtime-vagt.** Kræver et register og kontraktændringer, men lukker alle omgåelser.

## Beslutning

1. **Rollen er obligatorisk og entydig.** `agent-manifest.schema.json` kræver `role` med de seks værdier, og `runtime/src/boundary.mjs` kalder `validateRoleManifest`. Et `roles`-felt eller en liste af roller afvises; en godkender-/administratorrolle kan ikke tildeles en AI.
2. **Rolle-verbum- og artifact-politik.** `agent-registry/src/roles.mjs` er den ene kilde: hvilke verber en rolle må deklarere, hvilke artefakter den må producere/modtage, og hvilke tools den får. Planner/observer/auditor må ikke eksekvere; executor må ikke planlægge; kun verifier må udstede et verifikationsresultat.
3. **Rollebaseret register.** `agent-registry/src/registry.mjs` opretter agenter udelukkende på vegne af et verificeret menneske med en platformrolle. Rollen er uforanderlig; en rolleændring kræver retire + reprovision til en **ny** identitet. Et agentnavn kan ikke genbruges som alias. Hver agent får separate, per-opgave credentials.
4. **Asymmetrisk handoff.** `agent-registry/src/handoff.mjs` tillader kun plan (planner→implementer), diff (implementer→verifier), runbook (implementer→verifier/executor) og verification (verifier→executor). Den menneskelige godkendelse binder den endelige plan/diff/runbook; ændres ét af dem, ugyldiggøres godkendelsen.
5. **Scheduler uden alle credentials.** `agent-registry/src/scheduler.mjs` router til én rolle og udsteder kun den valgte agents credential. Den har bevidst ingen metode der samler alle credentials.
6. **Runtime-vagt.** `guardRoleAction` afviser en handling uden for rollen, at implementøren ændrer et godkendt scope eller godkender, og at executoren genererer ny plan/kode ved fejl. `reviewer/src/reviewer.mjs` kræver verifier-rollen og en anden model end forfatteren.
7. **Approval-bindingen udvides.** `approvals/src/binding.mjs` binder nu også `plan`, `runbook` og den rollebundne `producer`, så en executor kun kan eksekvere den godkendte digest/parametre.

## Konsekvenser

- **Positive:** En agent kan ikke længere kombinere planlægning, implementering, uafhængig kontrol og eksekvering. Selvoprettelse, shared tokens, impersonation og delegation afvises ved registeret og ved runtime. Godkendelsen bindes til den præcise plan/diff/runbook.
- **Negative:** Agent-manifestet får et påkrævet `role`-felt, og eksisterende agenter skal tildeles én rolle (referencen `dummy-ok-upgrader` er `executor`). En rolleændring kræver ny identitet.
- **Neutrale:** Et nyt, ukendt ops-verbum kan kun deklareres af `executor`; det mødes fortsat af A4-klassifikationen og PDP'en (DKC-007).

## Mere information

- [`docs/spec/agent-registry.md`](../spec/agent-registry.md)
- [`agent-registry/src/roles.mjs`](../../agent-registry/src/roles.mjs), [`agent-registry/src/registry.mjs`](../../agent-registry/src/registry.mjs), [`agent-registry/src/handoff.mjs`](../../agent-registry/src/handoff.mjs)
- [`contracts/agent-manifest.schema.json`](../../contracts/agent-manifest.schema.json), [`contracts/agent-registration.schema.json`](../../contracts/agent-registration.schema.json), [`contracts/agent-handoff.schema.json`](../../contracts/agent-handoff.schema.json)
- [ADR-0015](0015-autentiske-godkendelser.md), [ADR-0018](0018-stram-policy-scope-og-evidenkontrol.md)
