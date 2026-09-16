# Sikkerhedsplan: Trivy, Falco og Wazuh

**Kode:** [`security/`](../../security)
**Kontrakt:** [`contracts/security-findings.schema.json`](../../contracts/security-findings.schema.json)
**Evidens:** indgår i [`evidence/`](../../evidence) og dermed OSCAL-pakken
**Backlog:** 3.4 (afhænger af 3.1)

> Trivy (CI), Falco (runtime), Wazuh (SIEM) — koblet ind i evidensplanen, ikke som separat silo.

## Formål

Tre scannere dækker tre lag: Trivy finder sårbarheder og fejlkonfigurationer i koden og manifesterne før deploy; Falco opdager runtime-afvigelser i klyngen; Wazuh korrelerer logs og alarmerer. Uden en fælles form ville de tre ligge i hver sin silo, og en revisor skulle læse tre formater. 3.4 normaliserer dem til **SecurityFindings** og lægger dem ind i den OSCAL-evidenspakke, som 3.1 allerede emitterer.

## Normalisering

`security/src/normalize.mjs` oversætter hver scanners format til samme struktur:

| Scanner | Kilde | Severitetsmapping |
| --- | --- | --- |
| **Trivy** | `Results[].Vulnerabilities` og `Results[].Misconfigurations` | CRITICAL/HIGH/MEDIUM/LOW/UNKNOWN → critical/high/medium/low |
| **Falco** | JSON-array af hændelser med `priority` | Emergency/Alert/Critical → critical, Error → high, Warning → medium, Notice/Informational/Debug → low |
| **Wazuh** | JSON-array af alerts med `rule.level` | ≥12 critical, ≥7 high, ≥4 medium, ellers low |

Status er konservativ og følger [ADR-0003](../adr/0003-partial-conformance.md):

| Fund | Status |
| --- | --- |
| Ingen | `pass` |
| Kun medium/low | `partial` |
| Mindst ét critical/high | `fail` |

Et `pass` fra Falco betyder, at der ikke var hændelser i vinduet — ikke at der aldrig kan komme nogen. Et `partial` fra Trivy betyder medium/low-fund, som skal vurderes; det skjules ikke som grønt.

```
security/raw/*.json ──normalize──▶ security/generated/security-findings.json
        │                                   │
        │                                   ├── valideres mod kontrakten
        │                                   └── evidence/ → OSCAL observation + SEC-* finding
        └── samples; i CI kører Trivy rigtigt og uploader rapporten
```

## Koblingen til evidensplanen

`evidence/src/collect.mjs` læser den normaliserede pakke, og `evidence/src/oscal.mjs` tilføjer et resultat **Sikkerhed (Trivy/Falco/Wazuh)** med:

- én observation pr. scanner med rårapporten som `relevant-evidence` og dens sha256,
- ét finding pr. scanner (`SEC-trivy`, `SEC-falco`, `SEC-wazuh`) med `satisfied`/`not-satisfied` og begrundelse,
- `reviewed-controls` med `ra-5` og `si-4`, som er kontrolmappingens sårbarheds- og overvågningskontroller (3.2).

Dermed bæres sikkerhedsfundene af den samme pakke, som gives til revisoren — ikke af en separat rapport.

## Scannernes rolle

| Værktøj | Hvor | Konfiguration |
| --- | --- | --- |
| **Trivy** | CI (`.github/workflows/ci.yml`) | Filesystem-scan, JSON-rapport uploades som artefakt |
| **Falco** | Runtime | [`security/falco/platform-rules.yaml`](../../security/falco/platform-rules.yaml) — audit-log-skrivning, shell i container, læsning af signeringsnøgle |
| **Wazuh** | SIEM | [`security/wazuh/local_rules.xml`](../../security/wazuh/local_rules.xml) — agenthandling, PDP-afvisning, budgetoverskridelse, gateway-bypass |

## Sådan køres det

```bash
make security-ingest   # normalisér rådata til security/generated/security-findings.json
make security-check    # validér mod kontrakten og fejl ved drift
make security-test     # normaliseringens tests (4 tests)
make oscal-evidence    # sikkerhedsfundene indgår nu i OSCAL-pakken
```

## Acceptkriterier (3.4)

- [x] Trivy (CI), Falco (runtime) og Wazuh (SIEM) er konfigureret og findes i repoet.
- [x] Fundene normaliseres til én kontrakt og valideres i CI.
- [x] Fundene kobles ind i OSCAL-evidensplanen som observationer og findings.
- [x] Kontrolmappingen peger på scanningsfundene (`ra-5`, `si-4`).

## Grænser

- De committede rå filer er samples; CI kører Trivy rigtigt, og en produktion erstatter samplet med live-rapporter. Falco og Wazuh kræver en klynge at køre i og er derfor konfiguration, ikke kørende tjenester i dette repo.
- `exit-code: "0"` på Trivy i CI betyder, at et fund ikke fejler bygget, men registreres i evidensen. Det er et bevidst valg: evidens skal være ærlig, ikke grøn. En organisation kan stramme til `exit-code: "1"` for critical/high.
