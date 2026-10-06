# Sikker host- og OS-administration (DKC-058)

**Kode:** [`host-management/`](../../host-management)
**Kontrakter:** [`host-enrollment.schema.json`](../../contracts/host-enrollment.schema.json), [`host-profile.schema.json`](../../contracts/host-profile.schema.json), [`host-operation.schema.json`](../../contracts/host-operation.schema.json)
**Driftsdokument:** [`docs/operations/host-management.md`](../operations/host-management.md)
**ADR:** [ADR-0060](../adr/0060-host-management.md)

## Formål

Et understøttet host-OS kan administreres uden at give en agent fri root-
eller hypervisoradgang. Host-styring er **slået fra som standard**, kræver et
eksplicit enrollment med menneskelig out-of-band bootstrap og udfører kun
lukkede, signerede operationer.

## Enrollment

`host-management/src/enrollment.mjs` kræver:

- en navngivet menneskelig ejer og et navngivet menneske bag bootstrap,
- verificeret trust (CA- og SSH-hostkey-fingeraftryk),
- et konkret inventory og en platform fra den navngivne Linux-LTS-matrix,
- en testet recoverykonsol uden for platformen,
- et separat sikkerhedsdomæne for immutable-nøgler og autoritative kopier.

Et ikke-understøttet OS afvises af ejeren. Aktivering (`enableManagement`)
kræver et navngivet menneske med rollen `platform-owner`, `platform-admin`
eller `security-owner`.

## Den privilegerede broker

`host-management/src/broker.mjs` accepterer kun en signeret operation med en
menneskelig godkendelse og en registreret runbook-digest. Brokeren:

- afviser arbitrær shell, uploadede scripts og usignerede pakker,
- afviser ændringer af brokerens/policyens/pakkekildens/payloadens felter,
- udsteder kun et kortlivet, scope-bundet `operationsticket` til rollen
  `executor` via DKC-010. Planner og implementer har ingen host-credentials.

## De lukkede operationer

`host-management/src/operations.mjs` mapper hvert verbum til præcis én indbygget
effekt. Adapteren er lukket: en effekt, der erklærer en forbudt capability
(`immutable-write`, `external-key-destroy`, `arbitrary-exec`), afvises, før den
registreres. Første profil dækker `diagnose`, `package-update`, `drain`,
`reboot`, `certificate-renew` og `capacity-alert` på `linux-amd64-node22`.

## Sikkerhedsporte

- `safety.mjs` — en SSH-/firewallændring, der kan lukke den eneste recoveryvej,
  kræver en særskilt beslutning fra et **andet** menneske; mutationer kræver et
  annonceret vedligeholdelsesvindue, en sund canary og opfyldte stopkriterier.
- `security-domain.mjs` — host-brokeren må kun pege på `host/<id>`. KMS, nøgler,
  immutable-lager, policy og trust-konfiguration ligger i et separat
  sikkerhedsdomæne, og en operation må aldrig skrive immutable data eller
  destruere eksterne nøgler.
- `capacity.mjs` — kapacitetsalarmer er read-only og foreslår kun en
  menneskeligt godkendt operation.

## Single-server vs. HA

En single-server-operation kræver annonceret nedetid og en eksplicit
nedetidsgodkendelse; en HA-operation kræver mindst tre noder, sund canary og at
reboot sker én node ad gangen. En VPS-profil styrer kun gæste-OS'et — aldrig
udbyderens hypervisor eller hardware.

## Test og kontrol

| Kommando | Dækning |
| --- | --- |
| `make host-management-check` | Skema + semantik + brokerafvisninger + recoveryvej + sikkerhedsdomæne. |
| `make host-management-test` | Enrollment, broker, lukkede operationer, recoveryvej og sikkerhedsdomæne. |
| `make host-management-status` | Host-inventory, styringstilstand (slået fra) og platform. |

En grøn check er **ikke** en udført OS-operation. `integration-host-management-live`
kræver en levende værtsmaskine, hypervisor og ekstern KMS og er NOT RUN her.
