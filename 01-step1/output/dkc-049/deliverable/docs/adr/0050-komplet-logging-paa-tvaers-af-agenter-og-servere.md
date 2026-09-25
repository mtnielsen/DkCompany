# ADR-0050 — Komplet, korreleret logging på tværs af agenter og servere

- **Status:** accepteret
- **Beslutningstagere:** Platform Owner, Security Owner, Data Protection Officer
- **Dato:** 2026-09-28
- **Beslutningsdrev:** DKC-049. ADR-0021 (DKC-009) gjorde audit holdbar med intent/outcome og fail-closed handlinger, ADR-0041/0042 gav tenantadskilt telemetri og et autoriseret telemetri-API, ADR-0045 gav holdbar beskedudveksling, og ADR-0048 gjorde WORM fysisk. Det mangler at gøre **hele** forløbet fra alarm til fallback rekonstruerbart uden at stole på agentens egen forklaring.

## Kontekst og problemstilling

Platformen har stærke enkeltdele, men de er ikke bundet sammen til ét revisionsspor:

- hændelser fra forskellige servere bærer ikke et fælles sæt af korrelations-,
  incident-, change-, execution-, tenant- og ressource-ID'er,
- et modeludsagn, en sensorobservation og et verificeret resultat kan blandes,
  så et modeludsagn læses som et faktum,
- en muterende AI-handling kan i princippet udføres, før dens holdbare
  kvittering er skrevet, og et logsvigt kan efterlade handlingen ulogget,
- drifts-loggen er ikke beskyttet mod, at agenten selv omskriver eller sletter
  sin historik,
- frie logpayloads kan bære rå hemmeligheder, unødige persondata eller skjult
  modelræsonnering, og
- der mangler en uafhængig, append-only/WORM kopi pr. dataklasse, så en slettet
  eller ændret primærlog kan opdages.

Et revisionsspor, der ikke kan genopbygges uden den agent, det beskriver, er
ikke et bevis.

## Beslutningskriterier

- Fælles korrelations-ID'er på hver post, så et forløb kan samles på tværs af
  servere.
- Sensorobservationer, modeludsagn og verificerede resultater skal være
  tydeligt adskilte og må ikke blandes i samme post.
- En muterende handling må ikke kunne udføres, før dens holdbare
  auditkvittering er skrevet; et logsvigt må ikke give en ulogget mutation.
- Agenten må ikke kunne omskrive eller slette sin egen historik.
- Loggen skal være komplet som revisionsspor uden passwords, tokens eller
  skjult intern modelræsonnering.
- Loggen skal arkiveres redundans- og WORM-beskyttet pr. dataklasse i flere
  uafhængige fejldomæner.
- Logadgang skal være default-deny og selv sporet, og tenanten udledes
  server-side af den verificerede principal.

## Overvejede muligheder

- **A: Læg alle felter i den eksisterende audit-payload.** Genbruger DKC-009,
  men giver ikke provenance-adskillelse, WORM-arkiv eller en læseflade, og en
  fri payload kan bære hemmeligheder og skjult ræsonnering.
- **B: Byg et parallelt log-lager ved siden af audit.** Giver rigere felter,
  men skaber to sandheder og en ny flade der kan komme ud af trit med den
  obligatoriske audit — netop det ADR-0021 advarede imod.
- **C: Et log-modul oven på den holdbare audit-ledger med en komplet post, en
  append-only læseflade, et uafhængigt WORM-arkiv og en holdbar
  mutationskvittering.** Flere komponenter, men hver egenskab er efterprøvelig,
  og den obligatoriske audit forbliver den ene holdbare skrivevej.

## Beslutning

Vi vælger **C**. `logging/logging-policy.json` er den kanoniske politik, og
`logging/src/` implementerer:

1. **Korrelation** (`correlation.mjs`): `correlationId`, `executionId`,
   `incidentId`, `changeId`, `traceId` og `parentId` på hver post; tenant og
   ressource er stabile `res://`-ID'er inden for samme tenant.
2. **Adskilt provenance** (`provenance.mjs`, `record.mjs`): hver post har
   præcis én provenance (`sensor`, `model`, `verified`, `human`, `system`) og
   præcis den tilhørende blok. En post der blander blokke afvises.
3. **Redaktion** (`redact.mjs`): hemmeligheder fjernes på feltnavn og
   værdimønster, skjulte ræsonneringsfelter (chain-of-thought m.m.) fjernes
   helt, og unødige persondata i de frie datablokke minimeres med en bevaret
   digest. `assertNoSecrets` og `assertNoHiddenReasoning` er fail-closed.
4. **Holdbar ledger** (`ledger.mjs`): poster skrives til den hash-kædede
   audit-log (ADR-0021) og læses tenant-scopet. Der findes ingen update- eller
   delete-metode, så agenten kan ikke omskrive sin historik.
5. **WORM-arkiv** (`archive.mjs`): posten spejles til flere arkivmål i
   forskellige fejldomæner og WORM-låses (COMPLIANCE) for de beskyttede
   klasser. Arkivet har ingen update/delete-metode.
6. **Holdbar mutationskvittering** (`receipt.mjs`): `recordMutation` skriver og
   arkiverer intent-posten, skriver den to-fasede auditkvittering og udfører
   **først derefter** mutationen. Fejler et af logtrinnene, kastes der, og
   mutationen udføres ikke.
7. **Logadgang** (`access.mjs`): default-deny; tenanten udledes af den
   verificerede principal via DKC-006, en læserrolle kræves, og selve
   læsningen (også en nægtet) efterlader en post.
8. **Rekonstruktion** (`reconstruct.mjs`): et forløb samles på
   korrelations-ID, provenance adskilles, hver muterende handling bindes til en
   menneskelig godkendelse med matchende digest, og huller rapporteres frem for
   at påstå et komplet forløb.

### Konsekvenser

- **Positive:** hele forløbet kan rekonstrueres uden agentens forklaring; et
  modeludsagn kan ikke forveksles med et verificeret resultat; et logsvigt
  giver ingen ulogget mutation; historikken er uomskrivelig og
  WORM-beskyttet pr. dataklasse; logadgang er default-deny og sporet.
- **Negative:** logning bliver en afhængighed for muterende handlinger, og de
  beskyttede dataklasser kræver et tilgængeligt WORM-arkiv før mutationen.
  En utilgængelig arkivtjeneste er fail-closed. Skjulte ræsonneringsfelter kan
  ikke længere gemmes i loggen.
- **Neutrale:** DKC-009's minimale kvittering består som den obligatoriske
  skrivevej; log-modulet tilføjer den rige, rekonstruerbare post oven på den.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Mindst kode; genbruger audit | Ingen provenance-adskillelse, intet WORM-arkiv, fri payload |
| B | Rige felter | To sandheder; kan glide fra den obligatoriske audit |
| C | Efterprøvelig, adskilt provenance, fail-closed, WORM, sporet adgang | Flere komponenter; muterende handlinger afhænger af logvejen |

## Mere information

- [Spec: komplet logging](../spec/logging.md)
- [Runbook: rekonstruktion af et logforløb](../runbooks/log-reconstruction.md)
- [Logdækning](../compliance/log-coverage.md)
- ADR-0021, ADR-0041, ADR-0042, ADR-0045, ADR-0048
