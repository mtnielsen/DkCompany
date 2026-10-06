# Runbook: projektstyring med OpenProject

> DKC-027. Denne runbook beskriver de daglige og sjældne operationer for
> `openproject-adapter`. En levende OpenProject og Enterprise-SSO er NOT RUN i
> dette miljø; afsnittene markerer hvor en rigtig installation kræves.

## 1. Tilføj eller fjern et projektmedlem

1. Kontrollér at principalen er verificeret, og at handlingen udføres af et
   navngivet menneske med rollen `project-admin` eller `tenant-admin`.
2. Vælg den mindste rolle der dækker behovet (`reader`, `member`,
   `project-admin`). En ekstern samarbejdspartner får `external-guest` og skal
   være tilladt af kundepolitikken (`guestAccess: own-projects-only`).
3. Udfør `project.member.add` / `project.member.remove`. Hver ændring auditeres
   og skubber en ny rettighedsprojektion.
4. Verificér at søgning/AI ikke længere svarer ud fra den gamle projektion
   (`project.search.scope` skal vise den nye version). En retrieval på en
   forældet projektion afvises med `stale_projection`.

## 2. Import og eksport af et projekt

1. Eksportér med `project.export` og gem `ProjectBundle`-JSON.
2. Redigér bundtet uden at ændre `externalId` på eksisterende projekter og
   arbejdspakker.
3. Udfør `project.import` med en navngiven godkendelse. Importen planlægges mod
   de kendte `externalId`-er og er idempotent ved retry.
4. Et bundt med en dubleret `externalId`, en ukendt afhængighed, en cyklus eller
   en fremmed tenant afvises; ret bundtet og prøv igen.

## 3. Rettighedsbevidst søgning og AI

1. Byg søge-/AI-filteret fra `project.search.scope`.
2. Ved hver retrieval: send den aktuelle projektion. Afvises den som forældet,
   genopbyg den og prøv igen.
3. Efter enhver medlemskabsændring skal indekset genopbygges, før det svarer.

## 4. Afvikling og sletning af et subjekt

1. Bekræft at der ikke er aktiv legal hold, og at retentionperioden er udløbet.
2. Udfør `subject.erase` med en dokumenteret begrundelse og en navngiven
   godkendelse. Adapteren fjerner medlemskaber og afknytter opgaver.
3. Læs kvitteringen: `remainingCopies` angiver de kopier (backup, søgeindeks,
   revisionsspor) som kræver en upstream-oprydning efter DKC-021.

## 5. Backup, restore og opgradering

- `backup` er `partial`: database og vedhæftninger kan sikkerhedskopieres, men
  et konsistent snapshot af alle plugins kan ikke garanteres gennem API'et.
- `restore`/`verify-restore` er `unsupported`.
- `upgrade.dry-run` rapporterer version og manglende migrationer; den faktiske
  opgradering og rollback sker uden for adapteren.

## 6. Version- og editionforhandling

- Adapteren forhandler `^14.0.0` og edition `Enterprise`. En ikke-understøttet
  version afvises før PDP (`version_unsupported`).
- Community-udgaven frigives ikke som kandidat, fordi platformen kræver central
  SSO. `project.edition.assess` rapporterer hver features status.
