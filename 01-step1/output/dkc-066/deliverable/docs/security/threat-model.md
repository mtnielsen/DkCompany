# Trusselmodel (DKC-063)

> Genereret fra `release/matrix/threats.json` (version 1.0.0). Trusselmodellen er bundet til de testede grænser og til kravene i testmatricen.

**Ejer:** Anna Andersen · **Sidst revideret:** 2026-09-23

Trusselmodel for de testede grænser: tenantgrænser, identiteter, agent-handoffs, privilegerede host-operationer, uforanderligt lager, telemetri og eksterne kilder.

## Grænser

| Grænse | Beskrivelse | Krav |
| --- | --- | --- |
| Tenantgrænser (`tenant-boundary`) | En tenant må ikke kunne læse, skrive eller udlede en anden tenants data gennem nogen kontrolplansflade. | `REQ-TENANT-001`, `REQ-POLICY-001` |
| Identiteter (`identity`) | Mennesker og tjenester skal have verificerede identiteter; ingen uverificeret eller tvetydig identitet må give adgang. | `REQ-IDENTITY-001`, `REQ-CREDENTIALS-001` |
| Agent-handoffs (`agent-handoff`) | Et handoff mellem agenter må ikke ændre rolle eller eskalere privilegier. | `REQ-AGENT-ROLE-001`, `REQ-AGENT-HANDOFF-001` |
| Privilegerede host-operationer (`privileged-host-operations`) | Host-/OS-styring er separat opt-in, afgrænset og godkendt; den må ikke fjerne den eneste recoveryvej. | `REQ-INSTALL-001`, `REQ-APPROVAL-001`, `REQ-POLICY-001` |
| Uforanderligt lager (`immutable-storage`) | Audit og WORM-data må ikke kunne ændres eller deaktiveres for at opnå en grøn gate. | `REQ-AUDIT-001`, `REQ-PERSIST-001` |
| Telemetri (`telemetry`) | Telemetri må ikke bære hemmeligheder eller persondata uden formål og retention. | `REQ-OBSERVABILITY-001`, `REQ-COMPLIANCE-001`, `REQ-MONITORING-001`, `REQ-TELEMETRY-API-001` |
| Eksterne kilder (`external-sources`) | Ubetroet indhold fra eksterne kilder må ikke blive instruktioner, værktøjskald eller modelinput. | `REQ-TOOL-001`, `REQ-GATEWAY-001`, `REQ-GOVERNANCE-001` |

## Trusler

| Trussel | Grænse | Beskrivelse | STRIDE | Krav | Restrisiko |
| --- | --- | --- | --- | --- | --- |
| `THREAT-TENANT-001` Tenant-hop gennem manglende kontekst | tenant-boundary | En kaldende part udgiver en anden tenants identifikator og får adgang, fordi grænsen håndhæves i applikationen i stedet for i databasen. | elevation-of-privilege, information-disclosure | `REQ-TENANT-001` | low |
| `THREAT-IDENTITY-001` Forfalsket workload-identitet | identity | En kompromitteret pod udgiver sig for en anden tjeneste og kalder PDP eller et modul uden gyldig SPIFFE-identitet. | spoofing | `REQ-IDENTITY-001`, `REQ-CREDENTIALS-001` | low |
| `THREAT-HANDOFF-001` Rolleeskalering gennem handoff | agent-handoff | En agent videresender en opgave til en agent med højere rettigheder og udfører derved en handling den ikke selv måtte. | elevation-of-privilege | `REQ-AGENT-ROLE-001`, `REQ-AGENT-HANDOFF-001` | low |
| `THREAT-HOST-001` Uautoriseret host-styring | privileged-host-operations | Host-brokeren aktiveres implicit eller misbruges til at slette logs eller installere bagdøre. | tampering, elevation-of-privilege | `REQ-INSTALL-001`, `REQ-APPROVAL-001`, `REQ-POLICY-001` | medium |
| `THREAT-AUDIT-001` Audit deaktiveres for at skjule handling | immutable-storage | En operatør eller agent deaktiverer audit eller ændrer journalen for at få en grøn gate. | tampering, repudiation | `REQ-AUDIT-001`, `REQ-PERSIST-001` | low |
| `THREAT-TELEMETRY-001` Persondata lækker gennem telemetri | telemetry | Logs eller metrics bærer persondata eller credentials videre til et system uden formål og retention. | information-disclosure | `REQ-OBSERVABILITY-001`, `REQ-COMPLIANCE-001` | medium |
| `THREAT-TELEMETRY-002` Forældet eller manglende sensordata vises som grøn sikkerhedsstatus | telemetry | En gammel scannerrapport eller en manglende runtime-sensor arver et grønt lys, så et reelt sårbarheds- eller driftsproblem skjules bag et tidligere pass. | repudiation, information-disclosure | `REQ-MONITORING-001` | medium |
| `THREAT-TELEMETRY-003` Alarm uden ejer, eskalation eller med rå persondata i bred kanal | telemetry | En alarm leveres uden en navngivet ejer, en eskalationsstige eller en runbook, eller notifikationen bærer rå persondata til en bred kanal. | repudiation, information-disclosure | `REQ-MONITORING-001` | medium |
| `THREAT-TELEMETRY-004` Krydskunde-telemetri gennem API, cache, link eller AI-værktøj | telemetry | En principal indtager under en fremmed tenant eller læser/eksporterer en andens telemetri gennem en view-forespørgsel, et cachehit, et ressource-link eller et AI-værktøj. | information-disclosure, elevation-of-privilege | `REQ-TELEMETRY-API-001` | medium |
| `THREAT-TELEMETRY-005` Forfalsket pass, godkendelse eller healthy status gennem telemetri | telemetry | En sen, dubleret, replayet, malformet eller utroværdig hændelse indtages og får et view til at vise pass/healthy eller en godkendelse, den ikke har grundlag for. | spoofing, tampering, repudiation | `REQ-TELEMETRY-API-001` | medium |
| `THREAT-EXTERNAL-001` Prompt-injection fra ekstern kilde | external-sources | Ubetroet indhold fra en ekstern kilde fortolkes som instruktion og udløser et privilegeret værktøjskald eller modelkald. | tampering, elevation-of-privilege | `REQ-TOOL-001`, `REQ-GATEWAY-001` | low |
| `THREAT-GATE-001` Grøn gate på svagt grundlag | external-sources | En grøn enhedstest eller en implementørproduceret evidens bruges til at erklære produktions-, HA- eller compliance-status. | repudiation | `REQ-GOVERNANCE-001`, `REQ-SECURITY-001` | medium |

---

En resterende risiko er ikke det samme som et fravær af trussel. Uafklarede risici ("unassessed") blokerer release indtil et navngivet menneske har vurderet dem.
