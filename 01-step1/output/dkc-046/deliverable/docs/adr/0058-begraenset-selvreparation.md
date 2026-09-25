# ADR-0058 — Begrænset selvreparation med sikker fallback

- **Status:** accepteret
- **Beslutningstagere:** Platform Owner, Security Owner
- **Dato:** 2026-09-24
- **Beslutningsdrev:** DKC-046. DKC-005/007/011 gav en runtime med
  godkendelsesverifikation, grænsevalidering og en typet værktøjsgrænse.
  DKC-010 gav nødstop, DKC-013 klassificerede handlinger, DKC-017 gav
  overvågning, DKC-038 gav HA, DKC-045 gav signerede runbooks og DKC-048/055
  gav immutable data og én rolle pr. agent. Det mangler en måde at lade en AI
  *reparere* inden for menneskegodkendte rammer og standse sikkert.

## Kontekst og problemstilling

En selvhelende platform skal kunne genoprette service hurtigt. Tre risici:

- **Ubegrænset auto-reparation.** En agent gentager en handling i det uendelige
  eller udfører en handling uden for den godkendte runbook.
- **Kollision.** To agenter reparerer samme ressource samtidigt.
- **Blind kørsel ved fejl.** Model-, PDP- eller audit-tab får agenten til at
  fortsætte en mutation i stedet for at stoppe.

## Beslutningskriterier

- Genbrug af runtimes, change-servicen og approval-servicen — ingen ny motor.
- Kun to initiale runbooks (`stateless-restart`, `bounded-scale`); alt andet
  kræver særskilt evidens.
- Ressourcelease med fencing og cooldown; et samlet budget på tværs af agenter.
- Healthchecks af brugerflow over tid; forværring stopper og ruller tilbage.
- Foruddefinerede fallback-handlinger, der kun reducerer adgang.
- Irreversible handlinger beskrives og behandles som irreversible.
- Deterministisk orkestrator; rollerne er adskilte identiteter.

## Overvejede muligheder

- **A: Fri auto-reparation.** Hurtig, men uden grænser og uden rolleadskillelse.
- **B: Ingen auto-reparation.** Sikkert, men langsomt og uden de ønskede
  gevinster.
- **C: Deterministisk state machine over den eksisterende stack med lease,
  budget, health og sikker fallback.** Flere bevægelige dele, men hvert
  acceptkriterium bliver efterprøveligt.

## Beslutning

Vi vælger **C**. `runtime/src/remediation.mjs` implementerer:

1. **State machine** (`detect → correlate → diagnose → propose →
   policy/approval → durable intent → execute → verify → recovered |
   rolled_back | escalate | halt`). Overgangene er eksplicitte og afvises, hvis
   de er ulovlige.
2. **To initiale runbooks** (`stateless-restart@1.0.0`,
   `bounded-scale@1.0.0`), signeret og registreret i `runbooks/`. Andre
   handlinger kræver særskilt evidens.
3. **Ressourcelease** med monotonisk fencing-token og cooldown samt et samlet
   forsøgs-/fejl-/ændringsbudget på tværs af agenter.
4. **Healthchecks af brugerflow** over en observationstid; en degraderet måling
   stopper forløbet.
5. **Sikker fallback** (`pause`, `read-only`, `isolation`) foruddefineret og
   autoriseret af et menneske; de kan køre uden model.
6. **Rolleadskillelse**: detect, plan, implement, uafhængig verifikation,
   menneskelig approval og eksekvering er adskilte identiteter. Orkestratoren
   er en deterministisk koordinator, ikke én flerrolleagent.

## Konsekvenser

- Kun en godkendt runbook med verificerede parametergrænser udføres; resolvere
  og approval håndhæves i den rigtige runtime.
- To agenter kan ikke reparere samme ressource samtidigt.
- En fejlet postcheck udløser kun en autoriseret rollback; ellers stoppes der
  ved et menneske.
- Tab af audit/PDP/approval stopper nye agentmutationer, mens foruddefinerede
  sikre fallback-handlinger kan fortsætte.
- Irreversibel migration/restore beskrives ikke som generelt reversibel.
- En distribueret låsetjeneste, en rigtig model og en rigtig health-probe er
  separate integrationer (NOT RUN).

## Referencer

- `docs/spec/remediation.md`
- `docs/runbooks/self-remediation.md`
- `runtime/src/remediation.mjs`, `contracts/remediation-plan.schema.json`
- `runbooks/stateless-restart.runbook.json`, `runbooks/bounded-scale.runbook.json`
