# ADR-0009: Kontrolmapping som maskinlæsbar registry med udgiver/deployer-roller

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2025-09-01
- **Beslutningsdrev:** En mapping-tabel i prosa driver fra koden og slører, hvem der faktisk bærer hvilke pligter.

## Kontekst og problemstilling

3.2 kræver, at platformens tekniske kontroller kortlægges mod NIS2, GDPR og AI Act, og at det står klart, hvem der er udgiver, og hvem der er deployer. Skrives mappingen kun som en Markdown-tabel, kan den ikke læses af OSCAL-emitteren, den kan ikke håndhæves i CI, og den driver fra modulets `compliance.controlRefs`, så snart nogen tilføjer en kontrol. Samtidig må kortlægningen ikke fremstille repoet som «compliant software» — det ville være en juridisk påstand, platformen ikke kan bære.

## Beslutningskriterier

- Mappingen skal være maskinlæsbar og kunne læses af 3.1's evidenspakke.
- Den menneskelæste tabel skal kunne genskabes, så den ikke driver.
- Hvert krav skal have en rolle: udgiver, deployer eller delt.
- Repoets begrænsning som ikke-compliant software skal stå eksplicit.
- Nye kontroller må ikke kunne påstås uden at være kortlagt.

## Overvejede muligheder

- **Kun en Markdown-tabel i `/docs/compliance`.** Læsbar, men ikke maskinlæsbar og ikke håndhævbar.
- **Mapping direkte i hvert modul-manifest.** Tæt på modulet, men duplikerer krav på tværs af moduler og gør et framework-skift dyrt.
- **Én kanonisk registry + genereret tabel + konformanstjek.** Vores valg.
- **Ingen mapping; overlad til deployeren.** Så kan platformen ikke forklare, hvad dens egne kontroller tjener.

## Beslutning

1. `compliance/control-mapping.json` er den kanoniske kilde og valideres mod `contracts/control-mapping.schema.json`. Den indeholder frameworks, krav og kontroller samt en `roleStatement`.
2. Hvert krav og hver kontrol mærkes med rollen `issuer`, `deployer` eller `shared`. Prosaen forklarer, at platformen bærer mekanismen, mens deployeren bærer det juridiske ansvar.
3. `docs/compliance/mapping.md` genereres fra registry. `make compliance-check` fejler, hvis de to er ude af trit.
4. Konformanstjek `C-012` fejler, hvis et moduls `compliance.controlRefs` peger på en kontrol, der ikke findes i registry.
5. README og `docs/compliance/README.md` siger eksplicit, at repoet ikke er «compliant software».

## Konsekvenser

- **Positive:** Én kilde til sandhed. Evidenspakken og mappingen taler samme kontrol-id'er. Nye kontroller kan ikke indføres uden at blive kortlagt. Rollen er synlig per krav.
- **Negative:** Mappingen skal vedligeholdes, når regulatorikken ændres; `lastReviewed` gør det synligt, men det er stadig manuelt arbejde. Registry-formatet er endnu en kontrakt at versionere.
- **Neutrale:** Mappingen er en teknisk påstand, ikke en juridisk vurdering. Den skal valideres af organisationens DPO.

## Mere information

- [`docs/spec/control-mapping.md`](../spec/control-mapping.md), [`docs/compliance/README.md`](../compliance/README.md)
- [`contracts/control-mapping.schema.json`](../../contracts/control-mapping.schema.json)
- [ADR-0008](0008-oscal-evidensprofil.md)
