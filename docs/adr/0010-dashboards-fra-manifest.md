# ADR-0010: Dashboards og SLO-regler genereres fra modulmanifestet

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2025-09-01
- **Beslutningsdrev:** Et SLO, der står i to formater — manifestet og dashboardet — driver fra hinanden, og så måler drift og aftale ikke det samme.

## Kontekst og problemstilling

3.3 kræver Prometheus-regler og Grafana-dashboards med SLO pr. modul fra manifestet og et førsteklasses view for agenthandlinger. Skrives dashboards i hånden, opstår der to sandheder: `slo.availability` i `module-manifest.json` og tærsklen i dashboardet. En ændring i manifestet opdaterer ikke grafen, og en alert kan komme til at måle en forældet aftale. Samtidig skal ændringer gå gennem git (ADR-0005), så dashboardet kan ikke redigeres i Grafanas UI og overleve.

## Beslutningskriterier

- SLO skal have én kilde: modulmanifestet.
- Dashboards og alerts skal rulles ud gennem git, ikke klikkes sammen.
- Drift mellem manifest og dashboard skal fanges i CI.
- Agenthandlinger skal kunne ses uden at kende et panel-id.
- Løsningen må ikke tilføje runtime-afhængigheder.

## Overvejede muligheder

- **Håndskrevne dashboards og alerts.** Fleksibelt, men to sandheder og ingen håndhævelse.
- **Grafana-løsningen med en JSON-datasource, der læser manifesterne ved runtime.** Kræver en ekstra tjeneste og gør mappingen svær at gennemskue.
- **Generator: manifest → regler/dashboards → committede GitOps-ConfigMaps.** Vores valg.
- **Ingen dashboards; kun alerts.** Så kan deployeren ikke se agentlaget, kun mærke det.

## Beslutning

1. `observability/` læser `modules/*/module-manifest.json` og genererer Prometheus-regler og Grafana-dashboards som rene funktioner.
2. De genererede artefakter committes som ConfigMaps under `gitops/manifests/dev/observability-*`, så Argo CD ruller dem ud som alt andet.
3. `make observability-check` fejler, hvis de committede filer er ude af trit med manifestet.
4. Agenthandlinger får et eget dashboard med eskaleringer, budgetoverskridelser, gateway-bypass og et Loki-logpanel. `platform_agent_gateway_bypass_total` er en `critical`-alert, der skal være 0.
5. Metrikkontrakten (serienavne og labels) dokumenteres i specen som dashboardets input.

## Konsekvenser

- **Positive:** Ét SLO, én tærskel. Alarmer og grafer kan genskabes fra git. Agentlaget er synligt for både drift og revisor. Ingen nye afhængigheder.
- **Negative:** Generator og dashboards skal vedligeholdes, når Grafanas panelformat ændres. En ny metrik kræver en ændring i generatoren, ikke et klik.
- **Neutrale:** Stackens images er pladsholdere med digest; en rigtig klon udskifter dem. Dashboards virker først, når telemetrien eksporterer de deklarerede serier.

## Mere information

- [`docs/spec/observability.md`](../spec/observability.md)
- [`observability/src/generate.mjs`](../../observability/src/generate.mjs)
- [ADR-0005](0005-git-eneste-aendringskanal.md), [ADR-0006](0006-alle-modelkald-gennem-gateway.md)
