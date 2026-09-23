# Pitch

**Deck:** [`deck.md`](deck.md)
**LinkedIn:** [`linkedin.md`](linkedin.md)
**Backlog:** 4.3 (afhænger af 1.4 og 2.6)

> Ét deck med én fungerende adapter og kørende konformanstest slår tolv tomme repos.

## Princippet

Hver slide har én pointe og én **Bevis**-linje. `make pitch-check` læser decket og efterprøver, at hvert bevis peger på en `make`-kommando og en fil, der faktisk findes. Et løfte uden bevis må ikke stå i decket.

```bash
make pitch-check   # hvert bevis skal findes i Makefile eller på disken
make pitch-test    # tester checkeren
```

## Reproducér på fem minutter

```bash
make install
make ci
```

Det kører kontrakter, policy, GitOps, referencemodulet, adapterne, agentlaget, curriculumet, compliance-mappingen, dashboards, sikkerhedsnormaliseringen og til sidst OSCAL-emitteren. Undervejs består de rigtige moduler, og den bevidst brudte fixture fejler med vilje (`make conform-negative`).

Vil du se det vigtigste først:

```bash
make conform MODULE=mattermost-adapter   # ærlig partial
make conform-negative                    # suiten fanger en løgn
make agent-conformance-test              # agenten inden for sin grænse
make oscal-evidence                      # evidenspakken til revisoren
```

## Hvad der gør den troværdig

- [ADR-0003](../adr/0003-partial-conformance.md): partial conformance frem for binær.
- [ADR-0006](../adr/0006-alle-modelkald-gennem-gateway.md): alle modelkald gennem gateway.
- [ADR-0007](../adr/0007-evidens-og-prosa-adskilt.md): evidens og prosa adskilt.
- [ADR-0008](../adr/0008-oscal-evidensprofil.md): OSCAL-evidensprofilen.
