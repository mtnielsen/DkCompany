# ADR-0048 — Immutable data uden for agentens kontrol

- **Status:** accepteret
- **Beslutningstagere:** Platform Owner, Security Owner
- **Dato:** 2026-09-26
- **Beslutningsdrev:** DKC-048. ADR-0030 indførte AI-immutable dataklasser som adgangs- og transitionskontrol og erklærede ærligt, at den fysiske lager-/nøglehåndhævelse manglede. DKC-041 gav et holdbart objektlager, og ADR-0047 valgte et S3-kompatibelt produkt med object-lock. Det mangler at gøre beskyttelsen fysisk: en kompromitteret agent eller appkonto må ikke kunne ødelægge beskyttede data eller deres nøgler.

## Kontekst og problemstilling

Uden fysisk håndhævelse kan en kompromitteret AI-agent eller app-konto:

- slette eller overskrive en beskyttet post og dermed audit-sporet,
- forkorte eller fjerne en WORM-retention,
- skifte current-pointeren, så en ny version skjuler den autoritative låste,
- slette eller rotere en KMS-/signeringsnøgle, så tidligere signaturer ikke kan
  verificeres,
- bruge en indirekte adminvej (RBAC, bucket-policy, KMS-politik,
  serviceaccount-token, trust-config), og
- få en menneskelig godkendelse til at bryde en COMPLIANCE-lås.

En adgangs-/transitionsguard alene er ikke nok: den kan omgås hvis selve lageret
tillader mutationen.

## Beslutningskriterier

- Et verificeret storage-produkt med object-lock i GOVERNANCE og COMPLIANCE.
- AI og app-konti kan ikke skrive, slette, forkorte retention, skifte pointer,
  slette nøgle eller bruge en indirekte adminvej.
- Audit-ingest er en separat append-only rolle.
- KMS, key-deletion, lifecycle, backups, serviceaccounts og trust-config er
  beskyttede.
- GOVERNANCE-bypass kræver et navngivet menneske og to-personers godkendelse;
  COMPLIANCE kan aldrig omgås.
- En ny version skjuler ikke den autoritative låste version.
- Backup/restore bevarer versioner, låse og adgangsregler.
- S3-kompatibilitet alene er ikke et WORM-bevis.

## Overvejede muligheder

- **A:** Stol på adgangs-/transitionsguarden fra DKC-047 og S3-kompatibilitet.
- **B:** Lås alt i GOVERNANCE og tillad menneskelig bypass ved behov.
- **C:** Fysisk object-lock i GOVERNANCE og COMPLIANCE, en rollematrix der
  nægter AI og app-konti alle muterende operationer, en beskyttet nøglebutik,
  append-only audit-ingest og to-personers kontrol — verificeret med negative
  håndhævelsestests.

## Beslutning

Vi indfører (C). `data-protection/enforcement/immutable-policy.json` er den
kanoniske politik, `contracts/immutable-enforcement.schema.json` beskriver
formen, og `data-protection/src/enforcement.mjs` håndhæver beslutningerne.
`storage/src/object-store.mjs` håndhæver object-lock mekanisk (låse kan kun
forlænges, COMPLIANCE kan ikke brydes), og `data-protection/src/key-protection.mjs`
beskytter KMS-nøgler. `data-protection/src/render.mjs`-familien genererer
`gitops/manifests/data-protection/` med object-lock-, RBAC-/Kyverno-nægtelse,
append-only audit-ingest, KMS-nøglepolitik og to-personers politik.

### Konsekvenser

- **Positive:** AI og app-konti kan ikke mutere beskyttede data eller nøgler;
  COMPLIANCE kan ikke omgås; en ny version skjuler ikke den låste; audit-ingest
  er append-only; backup/restore bevarer låse.
- **Negative:** Der findes ingen levende S3-/objektlager-instans i dette miljø.
  En målt WORM-verifikation (`integration-immutable-live`) er NOT RUN.
- **Neutrale:** Selvtesten er deterministisk og mærket `verifiedByHuman: false`.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Ingen ekstra konfiguration | En kompromitteret agent kan slette data og nøgler |
| B | Menneskelig fleksibilitet | En godkendelse kan bryde en COMPLIANCE-lås |
| C | Fysisk og testbar beskyttelse | Kræver et vedligeholdt storage-produkt med object-lock |

## Mere information

- [ADR-0030 — AI-immutable som håndhævede dataklasser](0030-ai-immutable-dataklasser.md)
- [ADR-0047 — Holdbart fil- og objektlager med quorum, checksums og scrub/repair](0047-holdbart-fil-og-objektlager.md)
- [Spec: immutable data uden for agentens kontrol](../spec/immutable-enforcement.md)
- [Compliance: immutable storage](../compliance/immutable-storage.md)
- [Runbook: gendannelse af immutable data](../runbooks/immutable-data-recovery.md)
