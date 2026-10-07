# Drift: sikker host- og OS-administration (DKC-058)

Host-styring er **slået fra som standard**. Denne side beskriver den
dokumenterede vej fra enrollment til en udført operation.

## 0. Forudsætninger

- Et enrollment i `host-management/enrollments/` med navngivet, menneskelig
  bootstrap og verificeret trust.
- En host-profil i `host-management/profiles/` på en understøttet
  Linux-LTS-platform (`catalog/platforms.json`).
- En signeret host-runbook (`runbooks/host-*.runbook.json`) og en menneskelig
  godkendelse bundet til dens digest.
- En allowlistet, signeret pakkekilde i `host-management/package-allowlist.json`.

## 1. Validér enrollment og styringstilstand

```sh
make host-management-check
make host-management-status
```

`status` viser inventory, platform og at `management.enabled` er `false`, indtil
et menneske aktiverer styring.

## 2. Aktivér host-styring (menneske)

```sh
node host-management/src/cli.mjs enable --actor oidc|anna.andersen --role platform-owner
```

Kun `platform-owner`, `platform-admin` eller `security-owner` kan aktivere.
Uden en begrundelse afvises aktiveringen.

## 3. Planlæg operationen (dry-run)

```sh
node host-management/src/cli.mjs plan acme-prod-node1 --verb reboot
```

Planen er deterministisk: preflight, verificeret backup, canary, selve effekten
og en postcheck. En muterende operation skal altid køres som dry-run først.

## 4. Godkend og udfør

Operationen skal være:

- signeret og bundet til en registreret runbook-digest,
- godkendt af et navngivet menneske,
- inden for et annonceret vedligeholdelsesvindue,
- med en canary, der er observeret sund, og opfyldte stopkriterier,
- inden for pakkekildens allowlist (for `package-update`).

Brokeren udsteder kun et kortlivet operationsticket til executor-rollen.
Planner/implementer får aldrig et host-credential.

## 5. Kapacitetsalarmer

```sh
node host-management/src/cli.mjs capacity acme-prod-node1 --cpu 0.95 --memory 0.5 --disk 0.8
```

En kapacitetsalarm er read-only og foreslår kun en operation, der skal
godkendes menneskeligt. Se [`docs/runbooks/host-capacity.md`](../runbooks/host-capacity.md).

## Forventet adfærd ved fejl

- **Ikke-understøttet OS:** enrollmentet afvises; der rettes platform — ikke
  kontrakten.
- **Canary usund eller stopkriterium udløst:** forløbet stopper; ingen videre
  mutation.
- **SSH/firewallændring der lukker den eneste recoveryvej:** kræver en særskilt
  beslutning fra et andet menneske.
- **En levende værtsmaskine i produktion:** kræver ekstern infrastruktur og et
  navngivet menneskes godkendelse (`integration-host-management-live`, NOT RUN
  her).
