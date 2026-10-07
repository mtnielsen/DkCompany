# Pilotforløb og readiness-kontrol for tre virksomhedsprofiler

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), Sofia Sørensen (Service Delivery Owner), Erik Eriksen (Enterprise Delivery Owner)
- **Dato:** 2026-10-15
- **Beslutningsdrev:** DKC-033 kræver, at den fælles kerne bevises for SMV, IT/service og større virksomheder gennem kørebare pilotscenarier og en readiness-kontrol, og at en 30-dages observation samt kundens accept forbliver særskilte, ærlige begivenheder.

## Kontekst og problemstilling

Installations- og releaseacceptancen (DKC-062) dækker rene installationer,
afbrudte installationer, udvidelser, opgradering, provider-skift, recovery og
exit mod de understøttede profiler. Den svarer dog på et *platforms* spørgsmål:
kan installationen gennemføres? Den svarer ikke på *pilotens* spørgsmål: kan de
faktiske virksomhedstyper — en lille håndværksvirksomhed, en IT/service-
virksomhed og en større virksomhed — gennemføre deres kritiske arbejdsgange, og
er platformen klar til at gå videre?

Uden en samlet readiness-kontrol ville en grøn deterministisk kørsel kunne
forveksles med en tilendebragt pilot. En 30-dages observation er en faktisk
kalendertidsbegivenhed, og en kundeaccept er en navngivet menneskelig
beslutning. Begge skal kunne mangle uden at blokere den lokale udvikling, men
de må aldrig kunne erstattes af en grøn check.

## Beslutningskriterier

- Tre repræsentative, syntetiske virksomhedsprofiler med forskellig størrelse,
  segment, roller og integrationsbehov, hver bundet til en understøttet
  installationsprofil.
- Hver profil gennemfører de seks kritiske arbejdsgange: login/offboarding,
  dagligt arbejde, restore, privacy-sag, opgradering og exit.
- Abuse-prober skal vise nul kendte åbne omgåelser af godkendelser eller
  kundeisolering, og en afgrænset belastningstest skal være ren.
- En readiness-aggregator skal vurdere sikkerheds-, kvalitets-, recovery- og
  menneskelige gates fra faktisk evidens og fejle lukket.
- HA-mål gælder kun den erklærede HA-profil; en single-server-profil markerer
  HA-gaten ikke-anvendelig i stedet for at påstå HA.
- RPO/RTO og omkostning skal være målt eller modelleret pr. profil.
- Den 30-dages observation og kundeaccepten er særskilt registrerede
  begivenheder og forbliver NOT RUN, indtil et navngivet menneske gennemfører
  dem.

## Beslutning

Vi indfører et `pilot/`-modul med:

1. **Virksomhedsprofiler** (`pilot/business-profiles.json`): SMV, IT/service og
   enterprise med syntetiske tenants, roller og integrationer. Profilerne
   refererer til de eksisterende installationsprofiler og er den ene kilde til
   de kørebare scenarier.
2. **Pilotscenarier** (`pilot/pilot-scenarios.json`): 18 scenarier (tre
   profiler × seks arbejdsgange). Hvert scenarie kalder de faktiske
   førstepartsmoduler: `feature-access` (offboarding og feltadgang),
   `approvals`-bindingen, `backup` (krypteret restore med målt RPO/RTO),
   `privacy` (holdbar DSAR-sag og sikret eksport), `installer`s livscyklus
   (signeret opgradering) og `migration` (selvbeskrivende exit-eksport).
3. **Readiness-politik** (`pilot/readiness-policy.json`): de krævede gates
   `security`, `quality`, `recovery` og `human-assessment`, en profilbevidst
   `ha`-gate, `cost` og `observation`. Hver gate angiver sine evidenskilder og
   sine checks.
4. **Readiness-aggregator** (`pilot/src/readiness.mjs`): læser
   sikkerhedsvurderingens gate (DKC-065), testmatricen, recovery-rapporten,
   omkostningsrapporten, observationsregisteret og kundeaccept-registeret og
   udleder en status pr. gate. `ready` kræver, at hver aktiv, obligatorisk gate
   er bestået.
5. **Abuse- og belastningsprober** (`pilot/src/scenarios.mjs`): en ændret eller
   omdirigeret godkendelse afvises af bindingen, krydskunde-kontekst og
   tenant-headere afvises, ubetroet indhold bliver ikke til en handling, og en
   afgrænset belastningstest kører et fast antal iterationer.
6. **Særskilte registre** (`pilot/observation.json`,
   `pilot/customer-acceptance.json`): observationsperioden og kundeaccepten er
   tomme/udestående som standard og udledes aldrig af en kørsel.

## Konsekvenser

- `make pilot-run`/`make pilot-check` kører de 18 scenarier deterministisk mod
  den faktiske stak, og `make pilot-render` skriver rapporten.
- En ændring i et scenarie, en politik-gate eller en evidenskilde kan få en
  aktiv, obligatorisk gate til at skifte status og dermed ændre readiness.
- Den committede rapport er ærligt `not-ready`, fordi sikkerhedsvurderingen er
  udestående, kundeaccepten er tom, og observationen er 0/30 dage. Det er den
  korrekte tilstand — ikke en fejl.
- `integration-pilot-live` er NOT RUN med begrundelse, fordi der ikke findes en
  levende serviceprofil, en 30-dages driftsperiode eller en navngivet
  kundcaccept i dette miljø.
- To nye kontrakter er tilføjet: `pilot-business-profile`, `pilot-scenario`,
  `readiness-policy` og `pilot-readiness`; `REQ-PILOT-001` og
  `THREAT-PILOT-001` er tilføjet release-materialet.

## Alternativer overvejet

- **Genbrug af DKC-062-acceptancerapporten som readiness:** afvist, fordi
  acceptancen måler installationen, ikke virksomhedsprofilernes arbejdsgange,
  og fordi den ikke samler sikkerheds-, recovery-, omkostnings- og
  observationsgates.
- **En grøn pilotkørsel som bevis for klarmelding:** afvist, fordi en
  deterministisk kørsel hverken er en 30-dages observation eller en
  kundcaccept.
- **Kun mock-baserede scenarier:** afvist, fordi opgaven kræver kørebare
  scenarier mod den valgte installationsprofil.
