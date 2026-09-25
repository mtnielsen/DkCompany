<!-- GENERERET af data-protection/src/cli.mjs fra data-protection/records/register.json. Redigér registeret, ikke denne fil. -->

# Beskyttede dataklasser (AI-immutable)

Beskyttede dataklasser for platformen. Adskiller AI-ændringsforbud, WORM-retention og AI-læseforbud; erklærer ærligt at fysisk lager-/nøglehåndhævelse leveres af DKC-048.

Version 1.0.0 · sidst gennemgået 2025-09-01.

Tre forbud holdes adskilt: AI må ikke **ændre** beskyttede data, WORM-retention kræver en vurderet og endelig frist, og **no-AI-access** er et selvstændigt adgangsflag der også udelukker retrieval, prompts, logs og trænings-/analyseflows.

## Register

| Post | Klasse | No-AI-access | Ejer | Nøgledomæne | Retention | Lagerhåndhævelse |
| --- | --- | --- | --- | --- | --- | --- |
| `policy-bundle` | retention-locked | nej | Anna Andersen | policy-signing | 3650 dage (Revisionsspor for policy-versioner) | full (DKC-048) |
| `signing-keys` | retention-locked | ja | Anna Andersen | kms-root | 3650 dage (Nøglehistorik til verifikation af tidligere signaturer) | full (DKC-048) |
| `audit-log` | append-only | nej | Anna Andersen | audit-integrity | 1825 dage (Sporbarhed og hændelseshåndtering (NIS2)) | full (DKC-048) |
| `audit-evidence` | append-only | nej | Anna Andersen | evidence-integrity | 1825 dage (Dokumentation af kontroller og verber) | full (DKC-048) |
| `data-register` | retention-locked | ja | Bo Bertelsen | compliance-records | 1825 dage (GDPR art. 30-fortegnelse) | full (DKC-048) |
| `tenant-records` | ai-read-only | nej | Anna Andersen | platform-data | — | full (DKC-048) |

## AI-adgang pr. klasse

| Klasse | AI-operationer tilladt |
| --- | --- |
| ordinary | read, retrieve, prompt, train, analyze, log-access, append, update, delete, copy, export, restore, reclassify, pointer-update, key-rotate |
| ai-read-only | read, retrieve, prompt, train, analyze, log-access |
| append-only | read, retrieve, prompt, analyze, log-access, append |
| retention-locked | read, retrieve, log-access |

No-AI-access udelukker alle AI-operationer for en post. AI-forbudte operationer uanset klasse: reclassify, pointer-update, key-rotate, delete.

## Ærlig lagerhåndhævelse

| Post | Status | Leveres af | Begrundelse |
| --- | --- | --- | --- |
| `policy-bundle` | full | DKC-048 | DKC-048 håndhæver fysisk WORM: object-lock i GOVERNANCE og COMPLIANCE, en rollematrix hvor AI/app-konti er nægtet alle muterende operationer, beskyttet nøglebutik og to-personers kontrol. Efterprøvet deterministisk af data-protection/src/storage-semantics.mjs, data-protection/test/worm-store.test.mjs og data-protection/test/enforcement.test.mjs. |
| `signing-keys` | full | DKC-048 | DKC-048 håndhæver fysisk WORM: object-lock i GOVERNANCE og COMPLIANCE, en rollematrix hvor AI/app-konti er nægtet alle muterende operationer, beskyttet nøglebutik og to-personers kontrol. Efterprøvet deterministisk af data-protection/src/storage-semantics.mjs, data-protection/test/worm-store.test.mjs og data-protection/test/enforcement.test.mjs. |
| `audit-log` | full | DKC-048 | DKC-048 håndhæver fysisk WORM: object-lock i GOVERNANCE og COMPLIANCE, en rollematrix hvor AI/app-konti er nægtet alle muterende operationer, beskyttet nøglebutik og to-personers kontrol. Efterprøvet deterministisk af data-protection/src/storage-semantics.mjs, data-protection/test/worm-store.test.mjs og data-protection/test/enforcement.test.mjs. |
| `audit-evidence` | full | DKC-048 | DKC-048 håndhæver fysisk WORM: object-lock i GOVERNANCE og COMPLIANCE, en rollematrix hvor AI/app-konti er nægtet alle muterende operationer, beskyttet nøglebutik og to-personers kontrol. Efterprøvet deterministisk af data-protection/src/storage-semantics.mjs, data-protection/test/worm-store.test.mjs og data-protection/test/enforcement.test.mjs. |
| `data-register` | full | DKC-048 | DKC-048 håndhæver fysisk WORM: object-lock i GOVERNANCE og COMPLIANCE, en rollematrix hvor AI/app-konti er nægtet alle muterende operationer, beskyttet nøglebutik og to-personers kontrol. Efterprøvet deterministisk af data-protection/src/storage-semantics.mjs, data-protection/test/worm-store.test.mjs og data-protection/test/enforcement.test.mjs. |
| `tenant-records` | full | DKC-048 | DKC-048 håndhæver fysisk WORM: object-lock i GOVERNANCE og COMPLIANCE, en rollematrix hvor AI/app-konti er nægtet alle muterende operationer, beskyttet nøglebutik og to-personers kontrol. Efterprøvet deterministisk af data-protection/src/storage-semantics.mjs, data-protection/test/worm-store.test.mjs og data-protection/test/enforcement.test.mjs. |

## Forbrugere

| Post | Moduler/routes |
| --- | --- |
| `policy-bundle` | dummy-ok, audit-service, keycloak-adapter, mattermost-adapter |
| `signing-keys` | audit-service |
| `audit-log` | audit-service |
| `audit-evidence` | audit-service, mattermost-adapter, keycloak-adapter |
| `data-register` | audit-service |
| `tenant-records` | dummy-ok, audit-service, keycloak-adapter, mattermost-adapter |
