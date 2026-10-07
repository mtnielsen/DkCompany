# Enterprise- og branchepakker med fælles sikkerhedskontrakter

- **Status:** accepteret
- **Beslutningstagere:** Cecilia Christensen (Service Owner), Hans Hansen (Solution Architect), Anna Andersen (Platform Owner)
- **Dato:** 2026-10-20
- **Beslutningsdrev:** DKC-036 kræver, at platformen udvides til forskellige brancher uden at forke kontrolplanet eller love universel dækning. DKC-035 registrerede de første forretningsmodulfamilier; DKC-033 gav pilotvirksomhedsprofiler, og DKC-034 gav en dokumenteret TCO-model.

## Kontekst og problemstilling

De tre størrelsesprofiler (`small-vps`, `ha-cluster`, `enterprise-dedicated`)
deler den samme sikkerhedskerne og de samme obligatoriske acceptgates. Når
platformen skal udvides til handel, produktion, feltservice og regulerede
brancher, opstår to modsatrettede fristelser:

1. at bygge en separat kontrolplan pr. branche, så hver branche får sine egne
   sikkerheds- og adgangsregler, eller
2. at erklære en katalogpost for en fungerende brancheløsning og lade en
   teknisk grøn check erstatte en faglig, juridisk eller sikkerhedsmæssig
   vurdering.

Begge ville bryde de eksisterende kontrakter. Den første forker sikkerheden; den
anden gør en uafklaret sektorregel eller højrisiko-AI til en standardværdi.

## Beslutningskriterier

- Alle tre størrelsesprofiler deler de samme sikkerhedskontrakter, og en pakke
  arver dem uden at kunne ændre dem.
- Hver pakke har en navngivet produktejer og en navngivet testkundekontakt med
  en ærlig status.
- Faglige krav, sektorregler og højrisiko-AI er særskilte, uafklarede inputs;
  et ubekræftet krav blokerer implementering.
- En katalogpost bliver ikke automatisk til en bestilt byggeopgave.
- Pakkerne skal kunne løses gennem den faktiske dependency-resolver, og
  prioriteringen skal bygge på dokumenteret efterspørgsel og TCO.
- En ny branchepakke skal kunne oprettes med en scaffold uden at forke
  kontrolplanet.

## Beslutning

Vi indfører et `enterprise/`-modul og én ny kontrakt:

1. **Pakkekatalog** (`enterprise/packages.json`,
   `contracts/enterprise-package.schema.json`). Hver pakke bygger på en
   størrelsesprofil og beskriver apps, kapabilitetskrav, dataejerskab, ekstra
   isolation, integrationer, faglige krav, sektorregler, højrisiko-AI,
   produktejer, testkunde, implementeringsstatus, TCO-reference og fravalg.
2. **Kapabilitetsregister** (`enterprise/capabilities.json`). Det kanoniske
   register over komponenternes kapabiliteter, valideret mod de faktiske
   manifester. `controlPlane`-kapabiliteter skal udbydes af
   sikkerhedskerne-komponenter.
3. **Fælles sikkerhedskontrakter.** `enterprise/packages.json` gentager de fire
   fælles obligatoriske gates fra `distribution/acceptance/gate-policy.json` med
   de samme `requirementRefs`. `enterprise-check` fejler, hvis de tre profiler
   ikke har den samme sikkerhedskerne, eller hvis en gate afviger.
4. **Resolver-integration** (`enterprise/src/resolver.mjs`). Hver pakke løses
   gennem `distribution/src/resolver.mjs`; kapabilitetskravene kontrolleres mod
   den valgte closure. En kapabilitet, kataloget endnu ikke udstiller, er en
   ærlig blokering — ikke en skemafejl.
5. **Fail-closed gate** (`enterprise/src/gate.mjs`). Ingen pakke er
   implementerbar uden en underskrevet testkundeaftale, bekræftede faglige
   vurderinger og en bekræftet højrisiko-AI-vurdering. `buildBacklog` udledes
   kun af en eksplicit, menneskeligt godkendt ordre.
6. **Scaffold og fixtures** (`enterprise/scaffold/package.template.json`,
   `enterprise/src/scaffold.mjs`, `enterprise/fixtures/`). Nye branchepakker
   oprettes med arvede sikkerhedskontrakter og valideres, før de skrives.
7. **Prioritering** (`enterprise/src/priority.mjs`). Deterministisk rækkefølge
   efter efterspørgsel og dokumenteret TCO.
8. **Releasebinding.** `REQ-ENTERPRISE-001` og `THREAT-ENTERPRISE-001`
   registreres i release-matricen, og `enterprise-profiles` bliver en komponent
   i baseline-registeret.

## Konsekvenser

- En ny branche kan tilføjes som en sammen sat pakke uden at ændre
  kontrolplanet. Den arver sikkerhedskontrakterne og blokerer ærligt, når en
  faglig afgørelse eller en kapabilitet mangler.
- En katalogpost kan ikke forveksles med en bestilt byggeopgave; byggeopgaver
  kræver en menneskelig ordre.
- `field-service` og `manufacturing` er bevidst blokeret, indtil kataloget
  udstiller de nødvendige kapabiliteter. Det er den ærlige pris for ikke at love
  universel dækning.
- En underskrevet testkundeaftale og en bekræftet faglig/sektor-/AI-vurdering
  forbliver NOT RUN og kan ikke udledes af en grøn teknisk check.
