<!-- GENERERET af compliance/src/data-register-cli.mjs fra compliance/data-register.json. Redigér registeret, ikke denne fil. -->

# Dataregister og retention

Kanonisk dataregister for platformens pilotmoduler og modelroutes. Behandlingsgrundlag er ejerbesluttet; retention er formålsbestemt og versioneret; EU-hosting er ikke automatisk fravær af tredjelandsoverførsel.

Version 1.0.0 · sidst gennemgået 2025-09-01.

Registeret er en påstand om mekanismer, ikke en juridisk vurdering. Behandlingsgrundlaget er et ejerbesluttet felt; manglende beslutning eller aftale markeres som blocker for persondata.

## Blockere

Ingen aktive blockere. Alle persondataposter har ejerbesluttet grundlag, databehandleraftale og tredjelandsvurdering.

## Registerposter

| Post | Status | Ejer | Formål | Datakategorier | Retention | Placering | Tredjeland |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `audit-service` | approved | Anna Andersen | Revisionsspor og DSAR | operational, pseudonymised, personal | 1825 dage (1.0.0) | eu-eea | present |
| `dummy-ok` | approved | Anna Andersen | Vedligeholdelse af dummy-ok | operational, pseudonymised, personal | 365 dage (1.0.0) | eu-eea | present |
| `keycloak-adapter` | approved | Anna Andersen | Identitets- og adgangsstyring | operational, pseudonymised, personal | 1095 dage (1.0.0) | eu-eea | present |
| `mattermost-adapter` | approved | Anna Andersen | Teamkommunikation | operational, pseudonymised, personal | 730 dage (1.0.0) | eu-eea | present |
| `privacy-operator` | approved | Anna Andersen | Behandle rettighedsanmodninger | internal, personal | 365 dage (1.0.0) | eu-eea | present |
| `dummy-ok-reviewer` | approved | Bo Bertelsen | Adversarielt review | public, internal, confidential | 90 dage (1.0.0) | eu-eea | present |
| `nextcloud-adapter` | approved | Anna Andersen | Arbejdspladssamarbejde | operational, pseudonymised, personal | 730 dage (1.0.0) | eu-eea | present |
| `itsm-adapter` | approved | Anna Andersen | Serviceproces og hændelseshåndtering | operational, pseudonymised, personal | 1095 dage (1.0.0) | eu-eea | present |

## Retention pr. formål

| Post | Formål | Politik | Version | Maks. dage | Udløser | Sletning |
| --- | --- | --- | --- | --- | --- | --- |
| `audit-service` | Revisionsspor og DSAR | `audit-service-retention` | 1.0.0 | 1825 | legal-deadline | Fan-out subject.erase til moduler og crypto-shredding af backups. |
| `dummy-ok` | Vedligeholdelse af dummy-ok | `dummy-ok-retention` | 1.0.0 | 365 | purpose-fulfilled | Fan-out subject.erase til moduler og crypto-shredding af backups. |
| `keycloak-adapter` | Identitets- og adgangsstyring | `keycloak-adapter-retention` | 1.0.0 | 1095 | contract-end | Fan-out subject.erase til moduler og crypto-shredding af backups. |
| `mattermost-adapter` | Teamkommunikation | `mattermost-adapter-retention` | 1.0.0 | 730 | account-deletion | Fan-out subject.erase til moduler og crypto-shredding af backups. |
| `privacy-operator` | Behandle rettighedsanmodninger | `privacy-operator-retention` | 1.0.0 | 365 | purpose-fulfilled | Fan-out subject.erase til moduler og crypto-shredding af backups. |
| `dummy-ok-reviewer` | Adversarielt review | `dummy-ok-reviewer-retention` | 1.0.0 | 90 | event-age | Rulles automatisk med release-artefakterne. |
| `nextcloud-adapter` | Arbejdspladssamarbejde | `nextcloud-adapter-retention` | 1.0.0 | 730 | account-deletion | Fan-out subject.erase til moduler og crypto-shredding af backups. |
| `itsm-adapter` | Serviceproces og hændelseshåndtering | `itsm-adapter-retention` | 1.0.0 | 1095 | contract-end | Godkendt GLPI-sletteproces og crypto-shredding af backups. |

## Subprocessorer

| Subprocessor | Formål | Placering | Aftale | Tredjeland |
| --- | --- | --- | --- | --- |
| `anthropic-eu` (Anthropic EU) | model-inference | eu-eea | contracts/dpa/anthropic-eu.md | present |
| `openai-eu` (OpenAI EU) | model-inference | eu-eea | contracts/dpa/openai-eu.md | present |

## Databærende artefakter

| Post | Artefakter |
| --- | --- |
| `audit-service` | prompts, embeddings, support-access, logs, backups, model-provider-usage |
| `dummy-ok` | prompts, embeddings, support-access, logs, backups, model-provider-usage |
| `keycloak-adapter` | prompts, embeddings, support-access, logs, backups, model-provider-usage |
| `mattermost-adapter` | prompts, embeddings, support-access, logs, backups, model-provider-usage |
| `privacy-operator` | prompts, embeddings, support-access, logs, backups, model-provider-usage |
| `dummy-ok-reviewer` | prompts, logs, backups |
| `nextcloud-adapter` | prompts, embeddings, support-access, logs, backups, model-provider-usage |
| `itsm-adapter` | prompts, embeddings, support-access, logs, backups, model-provider-usage |
