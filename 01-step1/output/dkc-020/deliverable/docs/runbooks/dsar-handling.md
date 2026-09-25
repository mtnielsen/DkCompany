# Runbook: håndtering af en DSAR (indsigt, eksport, sletning)

> DKC-020. Gælder `privacy/` og de apps der erklærer privacy-verber.
> Behandling af en DSAR er en autoriseret, sporet proces — ikke et manuelt
> databaseindgreb.

## Roller og adgang

- Kun et **verificeret menneske** i sagens tenant med rollen `dpo` eller
  `privacy-officer` (eller gruppen `dpo-approvers`) kan åbne, køre, eksportere
  og indløse en sag.
- **Selvbetjening er forbudt**: en sagsbehandler kan ikke behandle sin egen sag.
- En agent eller service kan ikke behandle en sag. Demo-identiteter afvises.

## Trin

1. **Opret sagen** med tenant, verbum (`subject.locate`/`export`/`erase`/
   `legal_hold`/`retention.policy`) og subjektets identifikatorer. Brug en
   idempotency-key, så et gentaget kald ikke giver to sager.

   ```bash
   make privacy-run   # demonstration af hele forløbet offline
   ```

2. **Kør eller genoptag** sagen. Kun ikke-terminale moduler kaldes, så en
   afbrudt kørsel kan genoptages uden dobbeltarbejde.

3. **Læs per-modul status**. `found`/`full` betyder fundet/fuldført; `partial`
   og `unsupported` har en begrundelse; `failed`/`unknown` har en fejl. En
   timeout eller en uopnåelig app er **ikke** en fuld succes.

4. **Udsted eksporten** for en afsluttet sag. Eksporten er bundet til tenant,
   modtager og et udløbstidspunkt og bærer et artefakt med SHA-256.

5. **Indløs eksporten** som den navngivne modtager. Et udløbet link afvises og
   markeres `expired`; et link til en anden modtager afvises. Indløsningen
   verificerer artefaktets digest.

6. **Tilbagekald** en eksport hvis den er udstedt ved en fejl. Et tilbagekaldt
   link kan ikke indløses.

## Fejl og eskalation

- **Timeout / app nede**: lad statussen stå som `failed`/`unknown`. Gentag
  kørslen senere; de afsluttede moduler kaldes ikke igen. Rapporter aldrig
  delresultatet som fuldt.
- **Sletning blokeret af opbevaringspligt**: rapporter `unsupported`/`partial`
  med begrundelsen fra modulet. Et aktivt hold må ikke fjernes ved en transition.
- **Gendannelse efter backup**: en restore kan genindføre slettede
  personoplysninger. Rekonsumér slettefrister og DSAR-status efter en restore.
- **Fremmed tenant**: et forsøg på at hente en andens data afvises af
  tenant-bindingen og af identitetsmatchningen. Del aldrig en eksport på tværs af
  tenants.

## Audit

Hver åbning, kørsel, eksport, indløsning og afvisning efterlader et
revisionsspor (`privacy.case.*`/`privacy.export.*`). Eksportens `auditRef` binder
metadata til revisionen. Persondata ligger i artefaktet, ikke i registeret.
