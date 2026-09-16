<!-- GENERERET af compliance/src/cli.mjs fra compliance/control-mapping.json. Redigér registry, ikke denne fil. -->

# Kontrolmapping: NIS2, GDPR og AI Act

Kortlægger platformens tekniske kontroller mod NIS2 (art. 21 og 23), GDPR (art. 5–35) og AI Act (art. 9–15). Kortlægningen er den maskinlæsbare kilde; docs/compliance/mapping.md genereres herfra.

Version 1.0.0 · sidst gennemgået 2025-09-01.

## Rollefordeling: udgiver og deployer

- **Udgiver (platformen):** Stiller mekanismen til rådighed og beviser den i CI: kontrakter, konformanstests, signerede policy-bundles og OSCAL-evidens.
- **Deployer (organisationen):** Konfigurerer, driver og overvåger mekanismen for sine egne systemer og bærer det juridiske ansvar.
- **Delt ansvar:** Platformen leverer mekanismen, men den virker kun, hvis deployeren aktiverer den, fører tilsyn og reagerer på signalerne.

Kortlægningen er en påstand om mekanismer, ikke om juridisk compliance. Repoet er ikke «compliant software».

## Kontroller

| Kontrol | Titel | Rolle | Opfylder | Evidens |
| --- | --- | --- | --- | --- |
| `ac-2` | Account management (identitet og adgang) | shared | nis2-art21-2i, gdpr-art32, ai-act-art14 | C-005, A-002 |
| `au-2` | Audit events (sporbarhed) | issuer | nis2-art21-2b, gdpr-art30, ai-act-art12 | C-006, C-007 |
| `au-9` | Protection of audit information (integritet) | issuer | nis2-art21-2h, gdpr-art32, ai-act-art15 | C-009, C-010, modules/audit-service/service/test/store.test.mjs |
| `cp-9` | System backup (kontinuitet) | shared | nis2-art21-2c | C-004 |
| `si-12` | Information handling and retention (datastyring) | shared | gdpr-art5, gdpr-art15-17, ai-act-art12 | C-008, modules/audit-service/conformance/evidence/subject.erase.json |
| `cm-2` | Baseline configuration (git som ændringskanal) | issuer | nis2-art21-2d, nis2-art21-2f | G-001, G-002, G-004, gitops/src/verify.mjs |
| `ra-5` | Vulnerability monitoring and scanning | shared | nis2-art21-2e | SEC-trivy, G-002, security/generated/security-findings.json |
| `si-4` | Information system monitoring (runtime og SIEM) | shared | nis2-art21-2b, nis2-art23, ai-act-art15 | SEC-falco, SEC-wazuh, security/falco/platform-rules.yaml, security/wazuh/local_rules.xml |

## Krav pr. framework

### NIS2 (direktiv (EU) 2022/2555)

Krav til cyber- og informationssikkerhed for væsentlige og vigtige enheder.

| Krav | Titel | Rolle |
| --- | --- | --- |
| `nis2-art21-2a` | Risikoanalyse og sikkerhedspolitik | shared |
| `nis2-art21-2b` | Håndtering af sikkerhedshændelser | deployer |
| `nis2-art21-2c` | Forretningskontinuitet og backup | shared |
| `nis2-art21-2d` | Sikkerhed i forsyningskæden | issuer |
| `nis2-art21-2e` | Sårbarhedshåndtering | shared |
| `nis2-art21-2f` | Effektivitetsvurdering | issuer |
| `nis2-art21-2g` | Cyberhygiejne og træning | deployer |
| `nis2-art21-2h` | Kryptografi | issuer |
| `nis2-art21-2i` | Adgangskontrol | shared |
| `nis2-art21-2j` | Multifaktorautentificering | deployer |
| `nis2-art23` | Indberetning af hændelser | deployer |

### GDPR (forordning (EU) 2016/679)

Krav til behandling af personoplysninger og den registreredes rettigheder.

| Krav | Titel | Rolle |
| --- | --- | --- |
| `gdpr-art5` | Principper for behandling | shared |
| `gdpr-art15-17` | Den registreredes rettigheder | deployer |
| `gdpr-art25` | Indbygget databeskyttelse | issuer |
| `gdpr-art30` | Fortegnelse over behandlinger | deployer |
| `gdpr-art32` | Sikkerhed i behandlingen | shared |
| `gdpr-art33` | Anmeldelse af brud | deployer |
| `gdpr-art35` | Konsekvensanalyse (DPIA) | deployer |

### AI Act (forordning (EU) 2024/1689)

Forpligtelser for udbydere og deployere af AI-systemer med relevans for agentlaget.

| Krav | Titel | Rolle |
| --- | --- | --- |
| `ai-act-art9` | Risikostyringssystem | shared |
| `ai-act-art12` | Logning | issuer |
| `ai-act-art13` | Transparens | issuer |
| `ai-act-art14` | Menneskeligt tilsyn | issuer |
| `ai-act-art15` | Nøjagtighed, robusthed og cybersikkerhed | shared |
