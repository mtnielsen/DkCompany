# Runbook: kapacitetsalarmer på en host (DKC-058)

Kapacitet er en **read-only** observation. En alarm udløser en vurdering og et
forslag til en menneskeligt godkendt operation — aldrig en automatisk mutation.

## 1. Læs alarmen

```sh
node host-management/src/cli.mjs capacity acme-prod-node1 --cpu 0.95 --memory 0.5 --disk 0.8
```

Alarmen bærer host, signal (`cpu`/`memory`/`disk`), måling, tærskel, alvor,
ejer og en runbook-reference. Standardtærskler: advarsel ved 75 % (CPU/disk) og
80 % (hukommelse), kritisk ved 90 %/92 %.

## 2. Vurdér

- Er stigningen forbigående eller strukturel?
- Er der en anden host i HA-gruppen med ledig kapacitet?
- Kræver afhjælpningen en mutation (fx `drain`, `package-update` eller en
  ressourceændring), eller er den read-only?

## 3. Foreslå en operation

En mutation er kun tilladt gennem `host-operation.schema.json` med:

- en signeret runbook og en menneskelig godkendelse bundet til dens digest,
- et annonceret vedligeholdelsesvindue,
- en sund canary og opfyldte stopkriterier,
- et scoped operationsticket til executor-rollen.

Kapacitetsalarmen selv ændrer intet. Hvis et stopkriterium udløses undervejs,
stoppes forløbet og eskaleres til et menneske.

## 4. VPS vs. dedikeret

På en VPS kan CPU/hukommelse/disk kun ændres gennem udbyderens kontrolplan.
Platformen styrer kun gæste-OS'et og lover **ikke** styring af udbyderens
hypervisor eller hardware.
