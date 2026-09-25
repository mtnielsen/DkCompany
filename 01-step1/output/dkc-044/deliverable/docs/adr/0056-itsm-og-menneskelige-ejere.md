# ADR-0056 — Sammenhængende ITSM med menneskelige ejere

- **Status:** accepteret
- **Beslutningstagere:** Platform Owner, Security Owner
- **Dato:** 2026-09-24
- **Beslutningsdrev:** DKC-044. DKC-017 gav reel overvågning og alarmer, DKC-025
  gav kunden en portal, og DKC-037 gav serviceklasser og recoverymål. Det
  mangler en sporbar serviceproces, hvor alarmer bliver incidents med en
  menneskelig ejer, hvor manglende kvittering eskalerer og stopper risikofyldt
  handling, og hvor en AI aldrig står alene med ansvaret.

## Kontekst og problemstilling

En serviceproces forbinder mennesker, AI-agenter og flere systemer. Tre konkrete
risici:

- **Manglende ejerskab.** En alarm bliver støj uden en navngivet menneskelig
  ejer og en eskalationskæde, så en fejl kan ligge ubemærket.
- **AI uden menneske i loopet.** En AI, der selv lukker en major incident på et
  grønt healthcheck eller fortsætter en risikofyldt ændring uden kvittering,
  fjerner det menneskelige eskalationspunkt.
- **Rolle-sammenblanding.** Én agent, der både observerer, planlægger og
  eksekverer, kan omgå den uafhængige kontrol.

## Beslutningskriterier

- Et nyt adapter-modul oven på den fælles SDK (DKC-023), ikke en ny platform.
- Et autoritativt servicekatalog og en menneskelig on-call-rotation i
  `service-registry/`.
- Default-deny tenantgrænse, verificeret identitet og fail-closed PDP.
- Eskalation ved manglende menneskelig kvittering; risikofyldt handling stoppes.
- En AI må ikke lukke en major incident; gentagne incidents kræver menneskelig
  problemvalidering.
- Én uforanderlig rolle pr. agent (DKC-055), også på tværs af en serviceproces.

## Overvejede muligheder

- **A: Bruge GLPI direkte uden adapter.** Enkelt, men omgår platformens
  identitet, tenant, PDP, audit og verber.
- **B: Kun et servicekatalog uden sagshåndtering.** Giver ejerskab, men ingen
  sporbar incident-/problem-/change-kæde.
- **C: Et `itsm-adapter`-modul oven på SDK'en med servicekatalog, menneskelig
  on-call, menneskeligt ejerskab og ærlig partial-deklaration.** Flere
  bevægelige dele, men hvert acceptkriterium bliver efterprøveligt.

## Beslutning

Vi vælger **C**. `modules/itsm-adapter/` wrapper GLPI bag den fælles SDK:

1. **Servicekatalog og on-call** (`service-registry/`): hver tjeneste har et
   navngivet menneske som ejer, en on-call-rotation, en kommunikationskanal, en
   runbook og en fuld SLA. Eskalationskæden er strengt stigende.
2. **Én incident pr. alarm** (`service/src/serviceregistry.mjs`):
   `correlateAlarm` er idempotent pr. `alertId` og korrelerer på
   `serviceId` + `ruleId` + `signal`.
3. **Menneskelig kvittering og eskalation**: `acknowledgementState` og
   `riskyActionAllowed` stopper risikofyldt handling indtil et menneske har
   kvitteret, og peger på næste menneske.
4. **Problem/ændring med menneskelig kontrol**: et problem kræver menneskelig
   validering; et change kræver runbook, godkendelse og incidentkobling.
5. **Major incident**: `majorIncidentCloseProblems` nægter AI-lukning og kræver
   menneskelig kvittering og godkendelse.
6. **Enkeltroller**: `serviceProcessProblems` afviser en agent med flere roller
   og en forbudt AI-rolle.
7. **Kundevisning**: `customerCases` er default-deny og fjerner interne felter.
8. **Ærlig deklaration**: backup/restore og privacy er `partial`/`unsupported`,
   hvor de ikke kan opfyldes fuldt.

## Konsekvenser

- GLPI forbliver upstream; platformen oversætter sine verber gennem adapteren.
- Servicekatalog og on-call er data, der valideres af en semantisk validator, så
  et menneske altid kan findes.
- En levende GLPI er registreret som `integration-glpi` og er NOT RUN i dette
  miljø; kandidaten er bevidst ikke godkendt, fordi en testet gendannelse
  mangler.
- `changelog-check` forbliver den ene kendte FAIL (manglende DCO sign-off).
