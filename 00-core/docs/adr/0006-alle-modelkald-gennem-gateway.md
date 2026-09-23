# ADR-0006: Alle modelkald gennem én gateway

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2025-09-01
- **Beslutningsdrev:** Uden et kontrolpunkt mellem agenter og modeller kan vi hverken budgettere, logge eller skifte leverandør — og ikke svare på, hvilken model der traf en beslutning.

## Kontekst og problemstilling

Agenter kalder sprogmodeller. Hvis hver agent taler direkte med en leverandør, spredes API-nøgler, omkostninger og modelvalg ud over systemet. Så kan man ikke besvare tre spørgsmål, som både drift og AI Act kræver: Hvad koster det? Hvilken model og version blev brugt? Kan vi skifte leverandør uden at ændre agenterne?

Samtidig er en agent per definition en principal, der skal begrænses. Et direkte leverandørkald er en kanal uden om governance.

## Beslutningskriterier

- Ét sted at håndhæve budget, logging og modelversionering.
- En agent uden tildelt modeladgang må ikke kunne nå en model.
- Leverandørskifte må ikke kræve ændringer i agenterne.
- Kontrakten skal kunne testes uden en rigtig leverandør.

## Overvejede muligheder

- **Direkte leverandørkald fra hver agent.** Enkelt, men ingen kontrol; API-nøgler spredes.
- **Bibliotek der wrapper leverandører i hver agent.** Fælles kode, men ingen central håndhævelse; kan omgås.
- **Central AI-gateway.** Ét kontrolpunkt, der kan afvise kald uden route.
- **Kun konvention (ingen håndhævelse).** Ingen garanti.

## Beslutning

Vi indfører en central AI-gateway bag en route-tabel (`gateway/routes.json`, valideret mod `gateway-route.schema.json`):

- En route binder en `agentRef` til provider, model og modelversion.
- Manglende eller deaktiveret route → `403`. Agenten kan ikke nå en model.
- Budgetter håndhæves pr. agent; overskridelse → `429` med eskalering.
- Hvert kald logges med provider, model og modelversion.

Konformanscheck `A-003` kræver, at enhver agent har `model.gatewayRef` og en aktiv route. Runtimen får kun en gateway-klient; leverandøren er injiceret i gatewayen.

## Konsekvenser

- **Positive:** Én flade for budget, log, modelversion og leverandørskifte. Direkte leverandørkald er både forbudt og ubrugeligt uden route.
- **Negative:** Gatewayen bliver et kritisk punkt; den skal selv være højt tilgængelig. Et kald mere i stien.
- **Neutrale:** Kontrakten er OpenAI-agtig, så en anden gateway (fx LiteLLM) kan tage over uden at ændre agenterne.

## Mere information

- [`docs/spec/ai-gateway.md`](../spec/ai-gateway.md) (2.2) og [`docs/spec/agent-runtime.md`](../spec/agent-runtime.md) (2.3)
- [`gateway/`](../../gateway), [`runtime/`](../../runtime)
- Check `A-003` i [`conformance/src/checks/agents.mjs`](../../conformance/src/checks/agents.mjs)
