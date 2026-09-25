# Evidens- og risikoregister

DKC-022. Registeret knytter hvert krav til en faktisk kontrol, en ansvarlig
person og verificeret evidens. Det samler desuden de juridiske og
organisatoriske beslutninger, som en pilot med persondata afhænger af, og gør
dem til maskinlæsbare, ejerbesluttede poster frem for prosa.

- **Kanonisk register:** [`compliance/assurance-register.json`](../../compliance/assurance-register.json)
- **Genereret tabel:** [`docs/compliance/assurance.md`](../compliance/assurance.md)
- **Kontrakter:** [`contracts/assurance-register.schema.json`](../../contracts/assurance-register.schema.json), [`contracts/evidence-package.schema.json`](../../contracts/evidence-package.schema.json)
- **ADR:** [ADR-0053](../adr/0053-evidens-og-risikoregister.md)

## Hvad registeret dækker

1. **Kravregister.** Hvert krav har kilde, kildedato, ansvarligt menneske,
   status, en kontrolreference og et eller flere evidenslinks. Et krav uden
   evidens skal stå som `missing-evidence` — det må ikke se verificeret ud.
2. **DPIA-screening, databehandleraftaler, underdatabehandlere og
   overførselsvurdering.** En screening har et resultat
   (`required`/`not-required`/`pending`); en udestående screening markeres som
   blokerende. Underdatabehandlere krydsrefereres mod dataregisteret.
3. **AI Act- og NIS2-anvendelighed** vurderet efter brug, rolle og sektor af et
   navngivet menneske.
4. **Incidentproces, adgangsrevision, informationspligt og kundens
   exitprocedure** med navngivne ejere og refererede procedurer.
5. **Risici og beslutninger.** En åben høj/kritisk risiko der er material
   blokerer en pilot med persondata. En åben juridisk/organisatorisk beslutning
   har altid en ansvarlig person.

## Evidenspakken

`make assurance-export` samler `evidence/generated/assurance-package.json`. For
hvert krav vurderes hver evidensreference med
[`conformance/src/evidence-mode.mjs`](../../conformance/src/evidence-mode.mjs):

- **automatiseret evidens** — `fixture`, `contract`, `integration` eller
  `runtime`; kun de to sidste kan bære et produktionsbadge,
- **manglende vurderinger** — åbne beslutninger, udestående DPIA/overførsel og
  krav uden evidens,
- **menneskelige beslutninger** — de ejerbesluttede afgørelser med navn, rolle,
  dato og dokumentreference.

En post der er udløbet, bundet til det forkerte commit/image/miljø eller ændret
manuelt efter forsegling afvises med en stabil årsag. Et badge er ikke en
certificering: `notACertification` forbliver sand, `complianceStatus` forbliver
`not-certified`, og en eksport erklærer aldrig `productionReady`. En accept er
en separat, menneskelig handling.

## Accepter og adskillelse af ansvar

`compliance/src/assurance-service.mjs` er default-deny:

- læsning kræver en verificeret principal med en læserolle,
- accepter kræver et verificeret menneske med en accept-rolle, en begrundelse
  og et andet subject end kravets ejer,
- hver accept bevares i en hash-kædet append-only journal
  (`compliance/src/assurance-ledger.mjs`), så en efterfølgende ændring opdages.

En eksport er ikke en accept, og en accept er ikke en certificering.

## Kommandoer

```
make assurance-write    # genskab docs/compliance/assurance.md
make assurance-check    # validér register, krydsreferencer og dokumentsync
make assurance-test     # register, evidenspakke, friskhed/binding, accept og journal
make assurance-export   # saml evidenspakken
```

## Grænser

Registeret er en påstand om mekanismer og beslutninger. Det er ikke en
certificering og ikke en juridisk vurdering. En faktisk DPIA, en faktisk
overførselsvurdering, en gennemført brudøvelse og en målt produktionsevidence
kræver et navngivet menneske eller et eksternt system og er **NOT RUN** i dette
miljø. Repoet er ikke «compliant software».
