<!-- GENERERET af retention/src/cli.mjs fra retention/deletion-policy.json. Redigér politikken, ikke denne fil. -->

# Slette- og tilbageholdelsesdækning

Dokumenteret slette- og tilbageholdelsespolitik for platformens fem datalag plus eksterne modtagere.

Version 1.0.0 · sidst gennemgået 2025-09-24 · godkendt af Anna Andersen (2025-09-24).

Et hold kræver en dokumenteret begrundelse og en **separat** godkender, og AI-principaler kan hverken slette eller lægge hold. Sletning blokeres af aktive holds i scope. En flade der ikke kan slette fysisk står som `partial` eller `unsupported` med en præcis begrundelse — aldrig som fuld.

## Dækning pr. datalag

| Flade | Lag | Dækning | Klasser | Slettemekanisme | Ejerskab | Begrundelse |
| --- | --- | --- | --- | --- | --- | --- |
| `primary-object-store` | primary | full | personal, pseudonymised, operational | versionssletning i det autoritative objektlager efter subjektets digest-indeks | Anna Andersen | — |
| `rebuildable-index` | index | full | personal, pseudonymised | indekset kastes og genopbygges fra det autoritative lager uden subjektets poster | Anna Andersen | — |
| `ephemeral-cache` | cache | full | personal, pseudonymised, operational | cacheposter for subjektet fjernes og hele tenantcachen kan droppes uden at røre autoritative data | Anna Andersen | — |
| `derived-ai-store` | derived-ai | partial (ekstern) | personal, pseudonymised | lokale prompts/embeddings slettes; leverandørens trænings-/logkopi kan ikke slettes af platformen | Cecilia Christensen | Modelleverandøren eksponerer ingen slette-API for afledte kopier; platformen kan kun slette sin egen lokale kopi og dokumentere den resterende leverandørkopi med udløb. |
| `protected-backup` | backup | partial | personal, pseudonymised | slettebeslutningen skrives til den append-only suppressionsjournal og genanvendes ved gendannelse; den historiske, WORM-låste backup slettes ikke fysisk | Anna Andersen | Immutable backups må ikke kunne slettes af driftscredentials; i stedet filtreres subjektet ved restore via suppressionsjournalen, og kopien udløber med backupretentionen. |
| `upstream-model-provider` | upstream | unsupported (ekstern) | personal, pseudonymised | ingen; platformen kan hverken læse eller slette leverandørens kopi | Cecilia Christensen | Leverandøren udstiller ingen slette-API og ingen læsbar kopi; dækningen rapporteres ærligt som 'unsupported' og håndteres gennem databehandleraftalen. |

## Resterende kopier

| Flade | Lag | Forventet udløb | Begrundelse |
| --- | --- | --- | --- |
| `derived-ai-store` | derived-ai | 14 dage | Modelleverandøren eksponerer ingen slette-API for afledte kopier; platformen kan kun slette sin egen lokale kopi og dokumentere den resterende leverandørkopi med udløb. |
| `protected-backup` | backup | 365 dage | Immutable backups må ikke kunne slettes af driftscredentials; i stedet filtreres subjektet ved restore via suppressionsjournalen, og kopien udløber med backupretentionen. |
| `upstream-model-provider` | upstream | 30 dage | Leverandøren udstiller ingen slette-API og ingen læsbar kopi; dækningen rapporteres ærligt som 'unsupported' og håndteres gennem databehandleraftalen. |

## Ufravigelige regler

| Regel | Værdi |
| --- | --- |
| `defaultDeny` | true |
| `holdRequiresJustification` | true |
| `holdRequiresSeparateApprover` | true |
| `holdBlocksDeletion` | true |
| `restoreRequiresDeletionDecisions` | true |
| `auditReceiptBeforeMutation` | true |
| `receiptStoresSubjectDigestOnly` | true |

## Roller

- Sletning: privacy-officer, data-protection-officer
- Hold-godkendelse: legal-counsel, data-protection-officer
- AI nægtet: ja
