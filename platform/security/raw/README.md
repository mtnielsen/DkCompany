# Rå scanningsdata (samples)

Filerne her er **repræsentative samples** af Trivy-, Falco- og Wazuh-output. De bruges til at teste normaliseringen deterministisk og til at bygge den committede pakke `security/generated/security-findings.json`.

I CI kører Trivy rigtigt mod repoet, og rapporten uploades som artefakt. I produktion erstatter live-rapporter samplet, og den normaliserede pakke går videre til OSCAL-evidenspakken (3.1). Samplet er ikke en påstand om, at repoet aktuelt har disse fund.

| Fil | Scanner | Format |
| --- | --- | --- |
| `trivy-app.json` | Trivy | Trivy JSON (vulnerabilities + misconfigurations) |
| `falco-events.json` | Falco | JSON-array af Falco-hændelser |
| `wazuh-alerts.json` | Wazuh | JSON-array af Wazuh-alerts |
