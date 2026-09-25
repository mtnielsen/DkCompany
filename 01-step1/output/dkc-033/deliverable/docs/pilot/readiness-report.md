# Pilotforløb og readiness — rapport

> Genereret af `make pilot-render` som en deterministisk kontrol. **Målt:** nej — en rigtig 30-dages observation og den menneskelige kundcaccept er særskilt NOT RUN.

- **Genereret:** 2026-03-01T00:00:00Z
- **Readiness:** `not-ready`
- **Virksomhedsprofiler:** 3
- **Åbne omgåelser (abuse):** 0
- **Belastning (bundet):** 64 iterationer, 8 samtidige, 0 fejl, 0 omgåelser

## Virksomhedsprofiler og kritiske arbejdsgange

| Profil | Segment | Installation | Medarbejdere | Alle seks | RPO (min) | RTO (min) | Omkostning (EUR/md.) |
| --- | --- | --- | ---: | :---: | ---: | ---: | ---: |
| smv | smv | small-vps | 18 | ✔ | 0.033 | 0.017 | 106.1 |
| it-service | service | ha-cluster | 120 | ✔ | 0.033 | 0.017 | 761.3 |
| enterprise | enterprise | enterprise-dedicated | 900 | ✔ | 0.033 | 0.017 | 2243.6 |

## Arbejdsgange pr. profil

| Profil | Arbejdsgang | Status | Træk |
| --- | --- | :---: | --- |
| smv | login-offboarding | ✔ | {"subject":"oidc\|medarbejder.smv","targets":5} |
| smv | daily-work | ✔ | {"bindingDigest":"5bc801643c5ce49bf98dfbb7f5880255e2ddcb606a2623a6f25dcb665e814219"} |
| smv | restore | ✔ | {"rpoMinutes":0.033,"rtoMinutes":0.017} |
| smv | privacy-case | ✔ | {"records":0} |
| smv | upgrade | ✔ | {"from":"1.3.0","to":"1.4.0","activeRelease":"1.4.0","deploymentProfileRef":"small-vps","components":6} |
| smv | exit | ✔ | {"tenantId":"globex","recordCount":2} |
| it-service | login-offboarding | ✔ | {"subject":"oidc\|medarbejder.it-service","targets":5} |
| it-service | daily-work | ✔ | {"bindingDigest":"f3c6db2a8b9a46f00385c3a2902522b7703ade19c5320ca5d26f6f0ae77cd461"} |
| it-service | restore | ✔ | {"rpoMinutes":0.033,"rtoMinutes":0.017} |
| it-service | privacy-case | ✔ | {"records":0} |
| it-service | upgrade | ✔ | {"from":"1.3.0","to":"1.4.0","activeRelease":"1.4.0","deploymentProfileRef":"ha-cluster","components":6} |
| it-service | exit | ✔ | {"tenantId":"acme","recordCount":2} |
| enterprise | login-offboarding | ✔ | {"subject":"oidc\|medarbejder.enterprise","targets":5} |
| enterprise | daily-work | ✔ | {"bindingDigest":"25bc4373b3006aeb40820244f8cf916dfa152133c14e976aab1b74899c6c51c6"} |
| enterprise | restore | ✔ | {"rpoMinutes":0.033,"rtoMinutes":0.017} |
| enterprise | privacy-case | ✔ | {"records":0} |
| enterprise | upgrade | ✔ | {"from":"1.3.0","to":"1.4.0","activeRelease":"1.4.0","deploymentProfileRef":"enterprise-dedicated","components":6} |
| enterprise | exit | ✔ | {"tenantId":"initech","recordCount":2} |

## Readiness-gates

| Gate | Slags | Anvendelig | Status | Årsager |
| --- | --- | :---: | :---: | --- |
| security | common | ja | … pending | security-assessment: no-independent-assessment, no-release-decision, assessment-outstanding; independent-assessment: ingen registreret uafhængig vurdering |
| quality | common | ja | ✔ passed |  |
| recovery | common | ja | ✔ passed |  |
| human-assessment | common | ja | … pending | independent-assessment: ingen registreret uafhængig vurdering; customer-acceptance: ingen registreret kundcaccept |
| ha | profile | ja | ✔ passed |  |
| cost | common | ja | ✔ passed |  |
| observation | common | ja | … pending | observation-period: status 'outstanding' (0/30 dage) |

## Abuse-prober

- approval-bypass
- tenant-isolation
- injection

Ingen kendte åbne omgåelser af godkendelser eller kundeisolering.

## Observation og kundcaccept

- **30-dages observation:** `outstanding` (0/30 dage)
- **Kundcaccept:** `pending`
