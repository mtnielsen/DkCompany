# ADR-0026: Mindst tre uafhængige fejldomæner, N+1 og særskilt recovery-lokation i HA-profilen

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), med Bo Bertelsen som stedfortræder
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-037. ADR-0013 fastlagde, at `multiple-servers` kræver HA og mindst to failure domains. Men to domæner er ikke HA: et samtidigt tab af ét domæne under en planlagt opgradering efterlader nul kapacitet, og en "HA"-påstand uden en særskilt recovery-lokation er kun en ekstra kopi i samme fejlzone. Uden et eksplicit minimum bliver HA til en konfigurationsetikette i stedet for en målt egenskab.

## Kontekst og problemstilling

- **To domæner er ikke nok.** Med N+1 mener vi, at tjenesten kan miste ét helt fejldomæne (inkl. planlagt vedligeholdelse) og stadig have fuld kapacitet i de resterende.
- **Backup i samme fejlzone er ikke recovery.** Et regionsnedbrud eller en korruption rammer primær og kopi samtidigt.
- **Single-server er en ægte produktionsprofil,** men den kan ikke kaldes HA. Hvis den får HA-badge, mister badgen sin betydning for alle andre.
- **Delt skriveadgang er en antagelse, ikke en egenskab.** Mange upstream-apps kan ikke køre flere aktive skrivere; det skal være eksplicit, ikke antaget.

## Beslutningskriterier

- En HA-profil skal have mindst tre uafhængige server-/fejldomæner.
- Der skal være N+1-kapacitet, så ét domæne kan tages ud uden kapacitetstab.
- Recovery skal ske til en særskilt lokation uden for det primære fejldomæne.
- Split-brain skal være forbudt; en partition må ikke give to aktive skrivere.
- Single-server kan være en understøttet non-HA-produktionsprofil, men kan ikke få HA-badge.
- Mål skal være vedtaget af et navngivet menneske før produktion, og en konfiguration må ikke certificere et målt niveau.

## Overvejede muligheder

- **Behold to domæner og kald det HA.** Billigere, men tåler ikke et tab under vedligeholdelse og er ikke N+1.
- **Antag at alle apps kan multi-writer.** Giver højere teoretisk tilgængelighed, men bryder dataintegriteten for apps uden støtte.
- **Tre domæner + N+1 + særskilt recovery-lokation, med eksplicit non-HA single-server og single-writer som standard.** Dyrere, men målbart og ærligt.

## Beslutning

Vi gør følgende, og håndhæver det i `service-class.schema.json`,
`conformance/src/service-classes.mjs` og `continuity/`:

1. **Mindst tre fejldomæner.** En serviceklasse med `haEligible: true` skal have
   `deploymentProfileCompatibility.failureDomains >= 3` og mindst tre replikaer.
2. **N+1.** `nPlusOne: true` er påkrævet for HA. Et domæne kan tages ud
   (planlagt eller uplanlagt) uden kapacitetstab.
3. **Særskilt recovery-lokation.** `recoveryLocation` skal være udpeget og
   forskellig fra den primære fejldomæne, og backup skal være ekstern, offsite
   og krypteret.
4. **Ingen split-brain.** Ved netværkspartition skal adfærden være eksplicit.
   En ikke-`fail-closed` adfærd der forbyder split-brain kræver quorum.
   Single-writer er standard; flere aktive skrivere kræver
   `upstreamSupportsMultiWriter: true`.
5. **Single-server er non-HA.** En serviceklasse der peger på `single-server`
   må ikke være `haEligible`, skal have `acceptedDowntime: true` og ekstern
   offsite backup. HA-badgen sættes kun på en vedtaget klasse med frisk
   failover-måling.
6. **Adskilte holdbarhedsmål.** Bekræftede writes, regionsnedbrud og korruption
   er tre separate RPO-mål. De må ikke slås sammen til ét tal.
7. **Menneskelig vedtagelse.** `serviceCommitment.state` er `proposed` indtil et
   navngivet menneske har vedtaget målene (`accepted` + `acceptedBy` +
   `acceptedAt` + `measured.evidenceRef`).

Kontrakten er versioneret (`apiVersion: contracts.platform/v1alpha1`,
`metadata.version`) og valideres i `make validate`, `make continuity-check` og
`make continuity-test`.

## Konsekvenser

- **Positive:** HA er nu et mål, ikke en etikette. Fejldomæner, N+1 og
  recovery-lokation er eksplicitte og testbare. Single-server er en ærlig
  non-HA-profil. Multi-writer kan ikke snige sig ind som en antagelse.
- **Negative:** Tre domæner og en særskilt recovery-lokation koster mere end to
  og end en enkelt server. Flere miljøer skal driftes.
- **Neutrale:** Den præcise klyngeprodukt-/regionsteknologi er stadig åben;
  ADR'en fastlægger antallet og egenskaberne, ikke leverandøren.

## Mere information

- [`docs/spec/service-classes.md`](../spec/service-classes.md)
- [`docs/continuity/bia.md`](../continuity/bia.md)
- [`contracts/service-class.schema.json`](../../contracts/service-class.schema.json)
- [`conformance/src/service-classes.mjs`](../../conformance/src/service-classes.mjs),
  [`continuity/src/recovery.mjs`](../../continuity/src/recovery.mjs),
  [`continuity/src/profile-check.mjs`](../../continuity/src/profile-check.mjs)
- [ADR-0013](0013-deployment-og-tenantmodel.md), [ADR-0019](0019-holdbar-tilstand-og-migrationer.md)
