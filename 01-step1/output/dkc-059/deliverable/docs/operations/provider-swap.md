# Drift: providerudskiftning

Denne driftsvejledning beskriver, hvordan en provider udskiftes kontrolleret.

## Før cutover

1. **Vælg kandidat.** Slå skiftet op i
   `provider-registry/support-matrix.json`. Findes der ingen række, må skiftet
   ikke antages.
2. **Kør preflight:**
   `make provider-check` eller
   `node migration/src/provider-cli.mjs preflight <from> <to>`.
   En `allowed: false` betyder stop. En manglende obligatorisk capability eller
   en sikkerhedskritisk nedgradering kan ikke omgås af en forbindelsesstreng.
3. **Vis funktionstab.** For en appmigration viser
   `node migration/src/provider-cli.mjs plan <fixtureId>` det tabte.
4. **Indhent godkendelse.** Et navngivet menneske i kundens tenant godkender
   både indhold og adgangsrettigheder. Den der udfører skiftet kan ikke selv
   godkende.
5. **Tag et snapshot.** Cutover tager selv et snapshot før ændringen; en
   rollback gendanner det.

## Cutover

```sh
make provider-run                 # deterministisk kontrol
node migration/src/provider-cli.mjs execute <fixtureId>
```

Cutover mapper poster, id'er, ACL, links og stabile referencer, afstemmer antal,
checksums, links, autorisation og referencespor, sætter den gamle provider
read-only og tilbagekalder dens aktive credentials.

## Efter cutover

- Bekræft at `reconciliation.checksums.match === true` og at alle
  `preserved`-flag er sande.
- Bekræft at den gamle provider er read-only, og at ingen aktive credentials
  består.
- Bevar kvitteringen og referencesporet som evidens. Evidensen slettes ikke ved
  offboarding.

## Rollback

`rollbackSwap` gendanner snapshottet fra før cutover, genåbner den gamle
provider og gendanner id-mapping og rettigheder. En rollback skal registreres
med grund i revisionssporet.

## Målt udskiftning (NOT RUN)

`make provider-live` er NOT RUN i dette miljø: der findes ingen levende
upstream-provider, intet rigtigt credential og ingen menneskelig godkendelse. En
målt udskiftning kræver ekstern infrastruktur.
