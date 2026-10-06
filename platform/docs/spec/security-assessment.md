# Specifikation — pentest-harness og assessment-gates (DKC-065)

Platformen skal vurderes **uafhængigt** før den første kundeproduktionsrelease og
igen efter væsentlige ændringer af en trust-boundary. Denne specifikation
beskriver de kontrakter og beslutninger, der gør vurderingen forberedt,
sporbar og **fail-closed**, uden at forberedelsen selv autoriserer levende test.

## 1. Rules of engagement (`RulesOfEngagement`)

`contracts/rules-of-engagement.schema.json` beskriver et engagement ejet af et
navngivet menneske:

- **`preparationOnly`** — sand når dokumentet kun forbereder vurderingen.
  Et forberedelsesdokument må ikke samtidig være en godkendt levende
  autorisation.
- **`authorization`** — `approved` med navngivet `approvedBy`, `approvedAt` og
  `reference` for levende test; ellers uden godkender og tidspunkt.
- **`targets`** — hvert mål har en `kind` (`loopback`, `staging`, `external`),
  et scope, miljø, tenant, `authorized` og `syntheticOnly`. Kun et **lokalt,
  syntetisk loopback-mål** kan autoriseres af et forberedt engagement; et
  eksternt mål kræver en særskilt, navngivet scope-godkendelse. Produktionsmål
  er altid udelukket her.
- **`identities`** — assessor, implementer og observatør. Assessor og
  implementer må ikke være samme aktør.
- **`techniques`** — tilladte og destruktive teknikker. Et forberedt engagement
  må ikke tillade destruktive teknikker.
- **`window`** — tidsinterval og status. En `open` status uden for intervallet
  afvises, og en udløbet scope afvises.
- **`exclusions`, `rateLimits`, `stopConditions`, `emergencyContacts`** —
  udelukkelser, ikke-destruktiv rate, stopbetingelser og nødkontakter.
- **`evidenceHandling`** — klassifikation, adgangskontrol, påkrævet redaktion,
  secret-håndtering, proveniens, retention og lagerreference.

## 2. Sikkerhedsvurdering (`SecurityAssessment`)

`contracts/security-assessment.schema.json` beskriver den versionerede
vurdering:

- **`artifactBinding`** — `targetCommit`, `artifactDigest` og en
  `profileInventory` pr. komponent. Et fund, et retest eller en vurdering der
  er bundet til et andet commit/artefakt er ikke et bevis for denne version.
- **`coverage`** — de ni versionerede kategorier `auth`, `direct-apis`,
  `cross-tenant-access`, `injection`, `agent-role-approval-bypass`,
  `host-broker`, `connectors`, `telemetry-leaks` og `immutable-bypass`, hver med
  status og evidens-/sonde-reference.
- **`harnessRuns`** — kun autoriserede kørsler. Hver sonde har et resultat og en
  påstand.
- **`findings`** — kilde, kategori, alvor, påvirkning, reproducerbarhed,
  evidens, artefakt-digest, afhjælpningsejer og status.
- **`retests`** — performer, tidspunkt, `fixedArtifactDigest` og resultat.
- **`impactReview`** — påkrævet når artefaktet er ændret efter den uafhængige
  vurdering.
- **`independentAssessment`** — assessor (navngivet menneske), metode,
  gyldighedsvindue, commit/artefaktbinding og evidensreference. En implementør
  kan ikke levere den.
- **`releaseDecision`** — `decidedBy` (navngivet menneske), `decision`,
  betingelser og evidens.
- **`status`** — `outstanding`, `complete` eller `failed`.

## 3. Isoleret regressionsharness

`security-assessment/src/harness.mjs` starter den faktiske telemetri-API på
loopback og kører 17 ikke-destruktive sonder mod de rigtige førstepartsværn:

| Kategori | Eksempel på påstand |
| --- | --- |
| auth | Manglende/forkert audience-token afvises med 401 |
| direct-apis | Ingen udførelsesrute findes (404) |
| cross-tenant-access | Fremmed tenant/link afvises med 403 |
| injection | Malformet/oversized payload afvises; prompt-injektion flagges |
| agent-role-approval-bypass | Samme identitet/rolle som verifier afvises |
| host-broker | Usigneret/manipuleret operation afvises |
| connectors | Demo-identitet giver ikke adgang i produktion |
| telemetry-leaks | Følsomme felter redigeres; view-scope håndhæves |
| immutable-bypass | COMPLIANCE-låst version kan ikke slettes |

Harnessen kører **kun** på et autoriseret, lokalt, syntetisk mål. Uden for
tidsvinduet eller uden autorisation udføres ingen sonder.

## 4. Produktionsgaten

`security-assessment/src/model.mjs` evaluerer gaten rent og fail-closed. Gaten
er `blocked` (og `outstanding`) når:

- engagementet er ugyldigt eller scope udløbet,
- artefaktet er ændret, eller den uafhængige vurdering er bundet til et andet
  artefakt uden en impact review,
- en obligatorisk dækningskategori mangler eller ikke består,
- et fund af høj/kritisk alvor er åbent (medmindre det er rettet, en
  menneskelig accepteret undtagelse eller en verificeret falsk positiv),
- der ikke findes en frisk, artefaktbundet **uafhængig** vurdering,
- der ikke findes en navngivet menneskelig `approved` releasebeslutning.

Kun når alle betingelser er opfyldt, bliver beslutningen `eligible`. En
implementørkørsel, en scanner eller en AI-selvvurdering tæller ikke.

## 5. Autorisation, adgang og redaktion

- Vurderingen er `measured: false` indtil en uafhængig aktør har udført den.
- Rapporten (`docs/release/security-assessment.md` og
  `security-assessment/report/security-assessment-report.json`) er
  klassificeret `confidential`, adgangskontrolleret og redigeret: kun
  dækning, tællinger og gate-blokkere — aldrig rå evidens, tokens eller
  persondata.
- Importen redigerer secrets/persondata og bevarer proveniens.

## 6. Status

Den committede vurdering er `outstanding`: den lokale harness og dækningen er
efterprøvet deterministisk, men den uafhængige vurdering og den menneskelige
releasebeslutning er **NOT RUN**. Produktionsgaten er derfor `blocked`. Det er
den ærlige tilstand, ikke en fejl.

Se også `docs/operations/security-assessment.md`,
`docs/runbooks/security-assessment.md` og
`docs/adr/0074-pentest-harness-og-assessment-gates.md`.
