# Én rolle pr. agent (DKC-055)

En agent må aldrig kombinere planlægning, implementering, uafhængig kontrol og
eksekvering. Rollen er en uforanderlig egenskab ved **agentidentiteten**, ikke
ved opgaven, og håndhæves i manifest, register, runtime, reviewer og
approval-binding. Godkendelse er og forbliver menneskelig.

Arkitekturvalget er dokumenteret i [ADR-0020](../adr/0020-en-rolle-pr-agent.md).

## Roller

| Rolle | Producerer | Må modtage | Må deploye | Typiske verber |
| --- | --- | --- | --- | --- |
| `observer` | observation, diagnosis | — | nej | observe.read, observe.correlate, diagnose |
| `planner` | plan | observation, diagnosis | nej | observe.*, diagnose, propose |
| `implementer` | diff, implementation, runbook | plan | nej | observe.*, diagnose, propose, upgrade.dry-run |
| `verifier` | verification | diff, implementation, runbook | nej | observe.*, diagnose, upgrade.dry-run, verify-restore |
| `executor` | execution | verification, runbook | ja | alle eksekveringsverber + kontrolverber |
| `auditor` | audit-report | audit-events | nej | observe.read, observe.correlate, subject.locate, retention.policy |

- **En AI kan ikke godkende** (`roleMayApprove` er altid falsk). En rolle som
  `approver`, `admin` eller `human-approver` afvises.
- Et nyt, ukendt ops-verbum kan kun deklareres af `executor`; det mødes fortsat
  af A4-klassifikationen og PDP'en.

## Manifest og validering

`contracts/agent-manifest.schema.json` kræver `role`. `runtime/src/boundary.mjs`
kalder `validateRoleManifest`, som afviser:

- et `roles`-felt eller en liste af roller (kun én rolle pr. identitet),
- en ukendt eller forbudt rolle,
- en capability hvis verbum ikke er tilladt for rollen.

`make agent-registry-check` validerer hvert agent-manifest i repoet, og
`runtime/src/runtime.mjs` kalder desuden `guardRoleAction` før hver handling.

## Register og lifecycle

`agent-registry/src/registry.mjs`:

- Kun et **verificeret menneske** med rollen `platform-admin`, `agent-owner`
  eller `security-officer` kan oprette, tilbagetrække eller reprovisionere en
  agent. En AI-principal afvises (ingen selvoprettelse).
- **Rollen er uforanderlig.** Registrering af samme `spiffeId` med en anden
  rolle afvises. En rolleændring kræver `retire` efterfulgt af `reprovision`
  til en **ny** identitet; den nye registrering bærer `previousIdentity`.
- Et agentnavn kan ikke genbruges som alias for en anden identitet.
- Hver agent får separate, per-opgave credentials med rollens verbs og tools.
  Der findes ingen fælles token, og en tilbagetrukket agent kan ikke få et nyt.

## Handoff

`agent-registry/src/handoff.mjs` håndhæver den asymmetriske graf:

```
plan         planner      → implementer
diff         implementer  → verifier
runbook      implementer  → verifier | executor
verification verifier     → executor
```

Hver overdragelse bærer `changeId`, `artifactDigest`, `inputDigest`, den
rolle bundne producent og den tilladte modtager, og et digest over sig selv.
`verifyHandoff` opdager en ændret overdragelse. En agent kan ikke overdrage til
sig selv.

Den menneskelige godkendelse binder den **endelige** plan/diff/runbook via
`createChangeApprovalBinding`. `verifyChangeApprovalBinding` afviser genbrug,
hvis planen, diffen eller runbooken er ændret. Samme binding indgår i
`approvals/src/binding.mjs`, så executoren kun kan eksekvere den godkendte
digest/parametre.

## Uafhængig verifikation

`assertIndependentVerification` og `guardIndependentVerification` afviser at
verifikationen udføres af:

- samme identitet som producenten,
- samme rolle som producenten,
- samme model som producenten — selv i en anden isoleret identitet tæller det
  ikke som uafhængig modelkvalitet.

`reviewer/src/reviewer.mjs` kræver rollen `verifier` og en anden model end
forfatteren.

## Scheduler

`agent-registry/src/scheduler.mjs` router en opgave til én agent og udsteder kun
dennes rollebundne credential. Den har bevidst ingen metode der returnerer alle
agenters credentials (`allCredentials` kaster).

## Kontrol

- `make agent-registry-test` — rollepolitik, register, handoff, scheduler,
  runtime-vagt og den rigtige runtime-integration.
- `make agent-registry-check` — hvert agent-manifest har præcis én gyldig rolle.
- `make test` — conformance-testen `role-conformance.test.mjs` spejler de syv
  acceptkriterier.

## Begrænsninger

- Registret er in-memory i denne leverance. I drift skal det ligge i den
  holdbare database fra DKC-008; kontrakten (`AgentRegistration`) og
  lifecycle-reglerne er de samme.
- En ekstern IAM-udstedelse af rollebundne credentials (fx SPIFFE-bundles eller
  OIDC-scopes pr. rolle) er **ikke** koblet på i dette miljø (NOT RUN);
  registeret udsteder de rollebundne scopes, som en IAM-adapter kan oversætte.
- Håndhævelsen af at en agent ikke kan delegere til en subagent bygger på at
  kun registret udsteder credentials; en subagent skal registreres som sin egen
  identitet med sin egen rolle.
