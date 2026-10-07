# Valgfri sikker server- og OS-administration

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), Cecilia Christensen (Security Owner)
- **Dato:** 2026-09-24
- **Beslutningsdrev:** DKC-058 kræver, at et understøttet host-OS kan administreres uden at give en agent fri root- eller hypervisoradgang.

## Kontekst og problemstilling

En host med høje privilegier kan formatere diske, ændre SSH/firewall, installere usignerede pakker eller skrive til immutable-lageret og dermed omgå kontrolplanet. Samtidig er host-styring nødvendig for pakkeopdateringer, drain/reboot og certifikatfornyelse. Uden et eksplicit enrollment, en lukket operation og et separat sikkerhedsdomæne bliver "host-administration" en åben root-adgang.

## Beslutningskriterier

- Host-styring slået fra som standard; kun et navngivet menneske kan slå den til.
- Kun lukkede, forhåndsdefinerede operationer; ingen arbitrær shell eller uploadet payload.
- Kun signerede, allowlistede pakker.
- Menneskeligt godkendte, signerede operationer; agenten kan ikke ændre broker/policy/pakkekilde/payload.
- Planner/implementer har ingen host-credentials; kun executor får et scoped operationsticket.
- Recoveryvejen kan ikke lukkes uden en særskilt menneskelig beslutning.
- Immutable-nøgler og autoritative kopier i et separat sikkerhedsdomæne.

## Overvejede muligheder

- **A:** SSH med en delt root-nøgle og et script pr. operation.
- **B:** En lukket, signeret host-broker med et scoped operationsticket og et separat sikkerhedsdomæne.
- **C:** Ingen host-styring; alle opdateringer gøres manuelt af en operatør.

## Beslutning

Vi vælger **B**. `host-management/` ejer det eksplicitte enrollment, den begrænsede privilegerede broker, de lukkede operationer, sikkerhedsportene og sikkerhedsdomæne-guarden. Operationer er versionsstyrede og signerede (`host-operation.schema.json`), bundet til en menneskelig godkendelse og en registreret runbook-digest, og udstedes kun som et kortlivet, scope-bundet credential til executor-rollen via DKC-010.

### Konsekvenser

- **Positive:** Ingen fri root; host-operationer er deterministiske og reviderbare; pakker er signerede; immutable-nøgler beskyttes.
- **Negative:** Nye host-operationer kræver en ny lukket effekt og en ny signeret runbook; en platformejer skal aktivere styring pr. host.
- **Neutrale:** Host-styring er fortsat et separat opt-in i alle installationsprofiler.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Hurtigt | Delt root, ingen lukket payload, svær at revidere |
| B | Lukket, signeret, mindst privilegium | Mere formel; kræver vedligeholdte kontrakter |
| C | Ingen ny angrebsflade | Ingen automatiseret patch/reboot/certifikatfornyelse |

## Mere information

- [`docs/spec/host-management.md`](../spec/host-management.md), [`docs/operations/host-management.md`](../operations/host-management.md)
- DKC-010 (scoped credentials), DKC-045 (runbooks), DKC-048 (immutable), DKC-053 (platformmatrix)
