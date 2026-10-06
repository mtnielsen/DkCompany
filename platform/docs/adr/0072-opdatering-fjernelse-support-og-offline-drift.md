# Opdatering, fjernelse, support og offline-drift

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), Cecilia Christensen (Security Owner)
- **Dato:** 2026-10-06
- **Beslutningsdrev:** DKC-061 kræver, at en nem installation også har en sikker fuld livscyklus: signerede releases/kataloger med kompatibilitetslås, supportvindue og EOL-status; modulopdatering med påvirkningsplan, migrationskontrol, rollback og godkendelse; fjernelse adskilt fra datasletning med reverse-dependency-kontrol; redigerede supportbundles uden skjult fjernadgang; og cloud-uafhængig drift med en valgfri offlinepakke.

## Kontekst og problemstilling

Platformen kan installeres reproducerbart (DKC-053/DKC-054), migreres
(DKC-031), skifte providere (DKC-059) og sikres med backup (DKC-057). Men selve
**livscyklussen** efter installationen mangler en samlet kontrakt: Hvordan
opdages det, at en release er udgået eller tilbagekaldt? Hvordan opdateres et
modul uden at tabe data, og hvordan genoptages en afbrudt opdatering? Hvordan
fjernes et modul uden at slette data, og hvordan afvises fjernelse af en delt
database eller IAM? Hvordan bygges en supportbundle uden hemmeligheder eller
ikke-godkendt HR-indhold, og uden skjult fjernadgang? Og hvad sker der med de
lokale kerneflows, når internettet eller en model-API falder ud?

Uden en fælles kontrakt ville en opdatering blive en usigneret pakke, en
fjernelse ville blive en datasletning, en supportbundle ville lække
hemmeligheder eller personalesager, og et internetudfald ville give en tavs
fejl i stedet for en synlig, lokal kerneflow.

## Beslutningskriterier

- Signér releasekataloget, lås hele den testede closure, og gør supportvindue,
  EOL-status og vedtaget håndtering synlig.
- Afvis enhver kørsel af en EOL- eller tilbagekaldt release, og bind
  sikkerhedsopdateringer til en advisory og en procedure.
- Giv hver modulopdatering en påvirkningsplan, en migrationskontrol, en
  rollback/gendannelsesvej og en menneskelig godkendelse; gør den resumabel.
- Hold fjernelse adskilt fra datasletning. Afvis fjernelse af en delt database
  eller IAM mens aktive moduler kræver den, bevar data og recoverymetadata ved
  almindelig afinstallering, og kræv eksport/backup og to-personers-kontrol for
  datasletning.
- Redigér supportbundlen, afvis hemmeligheder og HR-indhold, og tillad aldrig
  skjult fjernadgang: fjernadgang er default-deny og kræver menneskeligt
  samtykke med en TTL.
- Bevar de lokale kerneflows ved internetudfald, og vis hver ekstern
  afhængighed med en eksplicit status — ingen tavs fallback.

## Overvejede muligheder

- **A:** Opdatér og fjern manuelt pr. modul, og stol på at operatøren husker
  backup og godkendelse.
- **B:** Byg livscyklussen som en del af det eksisterende installer- og
  kataloglag: `catalog/releases.json`, `support/policy.json` og
  `catalog/offline-package.json` med beslutningssemantik og deterministiske
  checks i `installer/src/lifecycle-*.mjs`.
- **C:** Løs det pr. applikation uden en fælles kontrakt.

## Beslutning

Vi vælger **B**.

- `catalog/releases.json` er et **signeret** releasekatalog. Hver release har
  `channel` (`stable`, `security`, `eol`, `revoked`), `supportWindow`, `eolAt`,
  `handling`, en `compatibilityLock` pr. komponent og signerede artefakter.
  Kun `stable` og `security` må køres; `eol` og `revoked` afvises af
  opdateringsplanens preflight.
- `installer/src/lifecycle-update.mjs` bygger en deterministisk, signeret
  opdateringsplan med påvirkningsplan (tilføjede/fjernede/opgraderede/
  nedgraderede komponenter og berørte delte datatjenester), migrationskontrol,
  read-only preflight, rollback/gendannelse og menneskelig godkendelse.
  `executeUpdate`/`resumeUpdate` er resumable, og `rollbackUpdate` gendanner et
  snapshot taget før første mutation.
- `installer/src/lifecycle-remove.mjs` holder fjernelse adskilt fra
  datasletning. `reverseDependencies` afviser fjernelse af en delt afhængighed,
  og `buildRemovalPlan` kræver for datasletning en eksport eller en verificeret
  backup og to forskellige navngivne personer.
- `support/policy.json` og `installer/src/lifecycle-support.mjs` bygger
  redigerede supportbundles ud fra en allowlist, afviser hemmeligheder og
  HR-indhold (fail-closed) og erklærer, at der ikke findes skjult fjernadgang.
  Fjernadgang er default-deny og kræver menneskeligt samtykke med en TTL.
- `catalog/offline-package.json` og `installer/src/lifecycle-offline.mjs`
  bevarer de lokale kerneflows ved internetudfald og markerer hver ekstern
  afhængighed med en eksplicit offline-adfærd; enhver gateway-rute skal være
  markeret.
- `installer/src/lifecycle-permissions.mjs` gør adgangen default-deny,
  tenantadskilt og rollebeskyttet; en auditor må læse, men ikke opdatere eller
  fjerne.
- `installer/src/lifecycle-store.mjs` er en holdbar, filbaseret butik med
  epochs og snapshot/restore, så en genstart ikke mister release, komponenter
  eller records.
- Kontrakterne er `release-catalog`, `lifecycle-update-plan`,
  `lifecycle-removal-plan`, `support-bundle-policy`, `support-bundle` og
  `offline-package`; semantikken ligger i `conformance/src/lifecycle.mjs` og
  `installer/src/lifecycle-model.mjs`.

## Konsekvenser

- En opdatering, der ikke er signeret, ikke er låst, ikke har rollback eller
  ikke er godkendt, afvises før mutation.
- En EOL- eller tilbagekaldt release kan ikke vælges som opdateringsmål, og dens
  vedtagne håndtering er synlig.
- En afbrudt opdatering kan genoptages idempotent eller rulles tilbage til det
  dokumenterede snapshot.
- Fjernelse af en delt database eller IAM afvises, og almindelig afinstallering
  bevarer data og recoverymetadata.
- En supportbundle kan ikke indeholde hemmeligheder eller ikke-godkendt
  HR-indhold, og skjult fjernadgang er forbudt.
- Lokale kerneflows består ved et internetudfald; eksterne funktioner vises med
  en eksplicit status.
- En faktisk målt opdatering eller fjernelse på en levende installation kræver
  ekstern infrastruktur og er fortsat NOT RUN.
