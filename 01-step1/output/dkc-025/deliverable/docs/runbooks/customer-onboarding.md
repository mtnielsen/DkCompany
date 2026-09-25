# Runbook: kunde-onboarding (DKC-025)

Formålet er at oprette en kunde og provisionere den bestilte servicepakke
kontrolleret og sporbart. Alle trin kræver en **verificeret identitet**; ingen
handling udføres af en agent alene.

## Forudsætninger

- En platformoperatør med rollen `platform-operator` (eller `platform-admin`)
  har en eksplicit tenant-scope for den nye kunde.
- Servicepakken er bestillingsbar og findes i `portal/service-packages/`.
- Kunden har set pris og konsekvenser (`make portal-preview PACKAGE=<pakke>`).

## Trin

1. **Opret kunden.** Operatøren opretter kunden med et unikt tenant-id.
   Handlingen kræver platformrollen og skriver `customer.created` i
   revisionssporet.
2. **Bestil servicepakken.** Kundeadministratoren (`customer-admin`) opretter
   ordren og kvitterer for alle væsentlige konsekvenser. Nægtes det, afvises
   ordren. Prisen beregnes server-side.
3. **Godkend.** En `platform-approver` med scope for kunden godkender ordren.
   Bestilleren kan ikke selv godkende (to-personers-kontrol). Godkendelsen
   starter provisioneringen.
4. **Provisionér.** Provisioneringen kører deterministiske trin med
   idempotency-keys. Fejler et trin, sættes ordren til `partial`, og forløbet
   kan genoptages:
   - `make portal-demo` viser et komplet forløb med en genoptaget provisionering
     og dokumenterer, at der ikke opstår dobbeltressourcer.
   - I en rigtig installation genoptages forløbet af driften; de allerede
     oprettede ressourcer genbruges.
5. **Bekræft.** Kunden bliver `active`, og appoversigten, driftsstatussen og
   forbruget vises i portalen.

## Efterlevelse

- Kontrollér revisionssporet: hver hændelse har en sekvens, en aktør, en
  begrundelse og en gyldig hash-kæde.
- Kontrollér at ingen ressource er oprettet mere end én gang.

## Fejlsøgning

| Symptom | Årsag | Handling |
| --- | --- | --- |
| `portal_platform_scope_missing` | Platformrolle uden tenant-scope | Tildel en scope (`platform-operator:<tenant>`) |
| `portal_tenant_forbidden` | Principalen tilhører en anden kunde | Brug en principal med den rette kundebinding |
| `acknowledgment_required` | Væsentlig konsekvens er ikke kvitteret | Lad kunden kvittere i bestillingsoversigten |
| `two_person_required` | Bestilleren prøver selv at godkende | Lad en anden godkender godkende |
| Ordre i `partial` | Et provisioneringstrin fejlede | Genoptag forløbet; ressourcer genbruges |
