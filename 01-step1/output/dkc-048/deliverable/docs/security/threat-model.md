# Trusselmodel (DKC-063)

> Genereret fra `release/matrix/threats.json` (version 1.0.0). Trusselmodellen er bundet til de testede grænser og til kravene i testmatricen.

**Ejer:** Anna Andersen · **Sidst revideret:** 2026-09-23

Trusselmodel for de testede grænser: tenantgrænser, identiteter, agent-handoffs, privilegerede host-operationer, uforanderligt lager, telemetri og eksterne kilder.

## Grænser

| Grænse | Beskrivelse | Krav |
| --- | --- | --- |
| Tenantgrænser (`tenant-boundary`) | En tenant må ikke kunne læse, skrive eller udlede en anden tenants data gennem nogen kontrolplansflade. | `REQ-TENANT-001`, `REQ-POLICY-001`, `REQ-FEATURE-ACCESS-001`, `REQ-HA-001`, `REQ-MSG-001` |
| Identiteter (`identity`) | Mennesker og tjenester skal have verificerede identiteter; ingen uverificeret eller tvetydig identitet må give adgang. | `REQ-IDENTITY-001`, `REQ-CREDENTIALS-001`, `REQ-FEATURE-ACCESS-001` |
| Agent-handoffs (`agent-handoff`) | Et handoff mellem agenter må ikke ændre rolle eller eskalere privilegier. | `REQ-AGENT-ROLE-001`, `REQ-AGENT-HANDOFF-001` |
| Privilegerede host-operationer (`privileged-host-operations`) | Host-/OS-styring er separat opt-in, afgrænset og godkendt; den må ikke fjerne den eneste recoveryvej. | `REQ-INSTALL-001`, `REQ-APPROVAL-001`, `REQ-POLICY-001`, `REQ-HA-001`, `REQ-DBHA-001` |
| Uforanderligt lager (`immutable-storage`) | Audit og WORM-data må ikke kunne ændres eller deaktiveres for at opnå en grøn gate. | `REQ-AUDIT-001`, `REQ-PERSIST-001`, `REQ-DBHA-001` |
| Telemetri (`telemetry`) | Telemetri må ikke bære hemmeligheder eller persondata uden formål og retention. | `REQ-OBSERVABILITY-001`, `REQ-COMPLIANCE-001`, `REQ-MONITORING-001`, `REQ-TELEMETRY-API-001` |
| Eksterne kilder (`external-sources`) | Ubetroet indhold fra eksterne kilder må ikke blive instruktioner, værktøjskald eller modelinput. | `REQ-TOOL-001`, `REQ-GATEWAY-001`, `REQ-GOVERNANCE-001`, `REQ-FEATURE-ACCESS-001`, `REQ-MSG-001` |

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
| `THREAT-FEATURE-001` Krydskunde-dataadgang gennem en funktionsflade | tenant-boundary | En BI-, søge-, eksport-, cache- eller AI-værktøjsflade omgår funktionsprofilens default-deny og læser en anden tenants eller et ikke-bevilget HR-felt (fx løn eller helbred). | information-disclosure, elevation-of-privilege | `REQ-FEATURE-ACCESS-001` | medium |
| `THREAT-FEATURE-002` Forældet token eller ufuldstændig offboarding giver fortsat adgang | identity | Et SSO-login eller et gemt creator-token accepteres som downstream-autorisation, eller en afviklet identitet beholder sessioner, API-tokens, delinger, planlagte workflows eller AI-værktøjsbevillinger efter fristen. | spoofing, repudiation, elevation-of-privilege | `REQ-FEATURE-ACCESS-001` | medium |
| `THREAT-FEATURE-003` Vilkårlig forespørgsel med administratorcredentials gennem en connector | external-sources | En connector bruger admin-/root-credentials eller rå SQL til at læse uden for det aftalte scope, i stedet for en godkendt parameteriseret skabelon på en afgrænset tjenestekonto. | tampering, information-disclosure | `REQ-FEATURE-ACCESS-001` | medium |
| `THREAT-HA-001` Krydskunde-trafik omgår netværkspolitikken | tenant-boundary | Et workload i én tenant når en anden tenants tjeneste, fordi en NetworkPolicy mangler, tillader et wildcard-selector, eller fordi den faktiske netværksplugin ikke håndhæver politikken. | information-disclosure, elevation-of-privilege | `REQ-HA-001` | medium |
| `THREAT-HA-002` Split-brain eller totalt udfald efter server-/quorumtab | privileged-host-operations | Et quorumtab tillader to konkurrerende ledere eller usikre writes, eller tabet af én ingress-/DNS-instans giver et totalt udfald, fordi redundans og fencing kun er konfigurationsetiketter. | tampering, denial-of-service, repudiation | `REQ-HA-001` | medium |
| `THREAT-MSG-001` Begivenhed krydser tenantgrænsen eller forfalskes | tenant-boundary | En begivenhed uden tenantbinding eller med en påstået tenant-id læses eller behandles af en anden tenant, eller en angriber forfalsker et event-ID og udløser en utilsigtet sideeffekt. | spoofing, information-disclosure | `REQ-MSG-001` | medium |
| `THREAT-MSG-002` Duplikat eller ombyttet begivenhed giver dobbelt effekt | external-sources | En genleveret, forsinket eller ombyttet begivenhed behandles to gange eller i forkert rækkefølge, så en irreversibel ændring sker flere gange eller i en ugyldig orden. | tampering, repudiation | `REQ-MSG-001` | medium |
| `THREAT-DBHA-001` Split-brain eller tab af bekræftede writes ved database-failover | privileged-host-operations | En netværkspartition eller en lang pause giver to konkurrerende primary'er, eller en promotion sker uden at den gamle primary er fenced, så to autoritative skrivere opstår og data forgrener sig. | tampering, denial-of-service | `REQ-DBHA-001` | high |
| `THREAT-DBHA-002` Forældet replica læser godkendelser eller taber en bekræftet transaktion | immutable-storage | Godkendelser eller policy-læsning betjenes fra en replica der endnu ikke har set den seneste commit, eller en write bekræftes selv om den nødvendige sync-replika er tabt, så en bekræftet transaktion forsvinder. | information-disclosure, repudiation | `REQ-DBHA-001` | medium |
| `THREAT-STORAGE-001` Silent corruption eller tabt replika giver forældede eller manglende kundedata | immutable-storage | En diskfejl eller en bit-flip ændrer et objekt uden at nogen opdager det, eller en replika forsvinder, så en læsning returnerer forældede eller korrupte kundedata uden at checksummen fanger det. | tampering, repudiation | `REQ-STORAGE-001` | high |
| `THREAT-STORAGE-002` Quorumtab tillader usikre writes eller dobbelt autoritativ skriver | privileged-host-operations | En host- eller netværksfejl efterlader færre end skrive-quorum nåbare, men en write bekræftes alligevel, så to hosts kan komme til at holde hver sin autoritative version af samme objekt. | tampering, denial-of-service | `REQ-STORAGE-001` | high |
| `THREAT-IMMUTABLE-001` Kompromitteret agent eller appkonto ødelægger beskyttede data eller nøgler | immutable-storage | En kompromitteret AI-agent eller app-konto sletter, overskriver eller forkorter retention på beskyttede data, skifter current-pointer eller sletter en KMS-nøgle, så audit- og WORM-data ikke længere kan bruges som bevis. | tampering, repudiation | `REQ-IMMUTABLE-001` | high |
| `THREAT-IMMUTABLE-002` Indirekte adminvej eller governance-bypass omgår WORM | privileged-host-operations | En AI-agent bruger en indirekte adminvej (RBAC, bucket-policy, KMS-politik, serviceaccount-token) eller en menneskelig godkendelse bruges til at bryde en låst retention, så beskyttelsen omgås uden to-personers kontrol. | elevation-of-privilege, tampering | `REQ-IMMUTABLE-001` | high |

---

En resterende risiko er ikke det samme som et fravær af trussel. Uafklarede risici ("unassessed") blokerer release indtil et navngivet menneske har vurderet dem.
