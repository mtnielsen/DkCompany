# Runbook: begrænset selvreparation

Denne runbook beskriver, hvordan en afgrænset selvreparation kører, og hvordan
en operatør håndterer de situationer, hvor den stopper.

## 1. Forudsætninger

- Den relevante runbook (`stateless-restart@1.0.0` eller
  `bounded-scale@1.0.0`) er registreret og forhåndsgodkendt; se
  [`runbook-approval.md`](runbook-approval.md).
- PDP, audit og approval er tilgængelige. Er de ikke, stopper agenten
  fail-closed.
- Der er et ledigt forsøgsbudget på ressourcen, og ressourcen er ikke i cooldown.

## 2. Forløbet

1. **Detect/correlate.** Hændelsen korreleres med aktive forløb. Holdes
   ressourcen allerede af en anden agent, stoppes forløbet (`cooldown`).
2. **Diagnose/propose.** AI'en foreslår en af de to runbooks. Et modeludfald
   stopper AI-ændringerne.
3. **Policy/approval.** PDP og runbook-resolver verificerer verbum, mål, miljø,
   parametre og pre-approval. Mangler godkendelsen, eskaleres til et menneske.
4. **Durable intent.** Intentionen skrives, før nogen ekstern ændring.
5. **Execute.** Runtimen udfører den godkendte handling.
6. **Verify.** En uafhængig verifier og et brugerflows-healthcheck observerer
   resultatet over observationsvinduet.

## 3. Når det går galt

| Situation | Handling |
| --- | --- |
| Forværring, reversibel handling | Autoriseret rollback køres; forløbet ender `rolled_back`. |
| Forværring, irreversibel handling | Stop og menneske (`escalated`); der er ingen generel rollback. |
| Rollback ikke autoriseret | Stop og menneske; sikker fallback kan køre. |
| Modeludfald/PDP-tab | AI-ændringer stopper (`halted`); fallback (`pause`/`read-only`/`isolation`) kan køre. |
| Budgettet er opbrugt | Stop og menneske; undersøg den underliggende årsag. |
| Ressourcen er låst/cooldown | Afvent; reparér ikke parallelt. |

## 4. Manuelle indgreb

- **Pause:** stop nye reparationer på ressourcen.
- **Read-only:** sæt tjenesten i læsetilstand.
- **Isolation:** isolér ressourcen fra afhængigheder.
- **Nødstop:** aktivér agent-/kunde-/globalt nødstop (DKC-010) ved mistanke om
  misbrug.

## 5. Efter forløbet

- Kontrollér `remediation-plan`-posten: state machine, budget og lease.
- Er forløbet `halted` eller `escalated`, skal et menneske beslutte det næste
  skridt. En AI må ikke genoptage af sig selv.
- En permanent rettelse af årsagen kræver en ny, godkendt runbook/change.

## Fejlsøgning

```bash
make remediation-check   # valider plan/lease/health + signerede runbooks
make remediation-test    # kør orkestrator-testene
```
