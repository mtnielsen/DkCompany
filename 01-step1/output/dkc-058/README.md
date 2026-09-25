# DKC-058 — Valgfri sikker server- og OS-administration

Overlay til `00-core/` oven på stak-tip **DKC-054**. Implementerer en valgfri,
sikker host- og OS-administration: et eksplicit enrollment med menneskelig
out-of-band bootstrap og verificeret trust, en begrænset deterministisk
privilegeret broker, lukkede signerede operationer, sikkerhedsporte omkring
recoveryvejen og et separat sikkerhedsdomæne for immutable-nøgler.

- **Review-base:** `5f9fa73`
- **Checkout:** `83ad91a`
- **Forudsætninger:** DKC-010, DKC-014, DKC-045, DKC-048, DKC-053, DKC-055 (se
  `evidence/prerequisites.txt`)
- **Stak-kæde:** `dkc-054/apply.sh` → `dkc-046/apply.sh` → … → `dkc-001/apply.sh`
- **Miljø:** Node v22.22.1. Ingen levende værtsmaskine, hypervisor eller ekstern
  KMS.

## Implementeret adfærd

### 1. Eksplicit host-enrollment

`host-management/src/enrollment.mjs` kræver en navngivet menneskelig ejer og en
menneskelig, interaktiv out-of-band bootstrap samt verificeret trust (CA- og
SSH-hostkey-fingeraftryk), inventory og et separat sikkerhedsdomæne.
Host-styring er **slået fra som standard** og kan kun aktiveres af et navngivet
menneske med rollen `platform-owner`, `platform-admin` eller `security-owner`.
Et ikke-understøttet OS afvises af ejeren.

### 2. Begrænset privilegeret broker

`host-management/src/broker.mjs` accepterer kun en HMAC-signeret operation med en
menneskelig godkendelse og en registreret runbook-digest. Brokeren afviser
ændringer af broker/policy/pakkekilde/payload, og udsteder kun et kortlivet,
scope-bundet `operationsticket` til rollen `executor` via DKC-010. Planner og
implementer har ingen host-credentials.

### 3. Lukkede, deterministiske operationer

`host-management/src/operations.mjs` mapper hvert verbum til præcis én indbygget
effekt. Adapteren er lukket: en effekt, der erklærer `immutable-write`,
`external-key-destroy` eller `arbitrary-exec`, afvises ved registrering. Første
profil dækker `diagnose`, `package-update`, `drain`, `reboot`,
`certificate-renew` og `capacity-alert` på `linux-amd64-node22`.

### 4. Sikkerhedsporte og recoveryvej

`safety.mjs` kræver, at en SSH-/firewallændring, der kan lukke den eneste
recoveryvej, har en særskilt beslutning fra et **andet** menneske. Mutationer
kræver et annonceret vedligeholdelsesvindue, en sund canary og opfyldte
stopkriterier. Single-server kræver annonceret nedetid; HA kræver ≥3 noder og
reboot én node ad gangen. VPS-profilen styrer kun gæste-OS'et.

### 5. Separat sikkerhedsdomæne

`security-domain.mjs` tillader kun mål af formen `host/<id>`, afviser enhver
reference til KMS/nøgler/immutable/policy/trust, og afviser en operation, der
skriver immutable data eller destruerer eksterne nøgler.

### 6. Integrationer

- Tre nye signerede runbooks (`runbooks/host-*.runbook.json`) i
  `runbooks/registry.json`.
- GitOps-manifest `gitops/manifests/dev/host-management-policy.json`
  (slået fra som standard, opt-in).
- Katalogkomponenten `host-management` er nu `implemented` med
  `moduleRef: host-management/` (operationslisten er udvidet tilsvarende).
- Kontrakterne `host-enrollment`, `host-profile` og `host-operation` + eksempler.

## Ændrede filer

44 filer under `00-core/` (alle i `deliverable/`) plus denne `README.md` og
`apply.sh` i pakken:

| Område | Filer |
| --- | --- |
| Kerne | `host-management/src/{model,enrollment,broker,operations,safety,security-domain,capacity,cli}.mjs` |
| Data | `host-management/{enrollments/acme-prod-node1,profiles/linux-lts,package-allowlist,dev-keyring}.json` |
| Test | `host-management/test/host-management.test.mjs` |
| Runbooks | `runbooks/host-{package-update,drain-reboot,certificate-renew}.runbook.json`, `runbooks/registry.json` |
| Kontrakter | `contracts/host-{enrollment,profile,operation}.schema.json` + 3 eksempler, `contracts/component-manifest.schema.json` |
| Konformans | `conformance/src/{host-management,host-management-check}.mjs`, `conformance/src/{schemas,validate-schemas}.mjs`, `conformance/test/host-management-conformance.test.mjs` |
| Katalog | `catalog/components/host-management.component.json` |
| GitOps | `gitops/manifests/dev/host-management-policy.json` |
| Register/Make | `Makefile`, `tools/baseline/registry.mjs` |
| Docs | `docs/adr/0060-…`, `docs/adr/README.md`, `docs/spec/host-management.md`, `docs/spec/README.md`, `docs/operations/host-management.md`, `docs/runbooks/host-capacity.md`, `docs/testing/test-matrix.md`, `docs/security/threat-model.md`, `docs/status/implementation-matrix.md`, `release/matrix/{test-matrix,threats}.json` |

## Testkommandoer og -resultater

| Kommando | Resultat |
| --- | --- |
| `make host-management-check` | PASS — skema + semantik + brokerafvisninger + recoveryvej + sikkerhedsdomæne |
| `make host-management-test` | PASS — 14 (modul) + 11 (konformans) tests |
| `make host-management-status` | PASS — inventory, styringstilstand (slået fra) og platform |
| `make runbook-check` / `make runbook-test` | PASS |
| `make distribution-check` / `make distribution-test` | PASS (katalogkomponent nu `implemented`) |
| `make release-check` (`matrixversion 1.29.0`) | PASS — 52 krav, 52 obligatoriske |
| `make gitops-verify` / `make gitops-reconcile` | PASS |
| `make configuration-check` / `make remediation-check` | PASS |
| `make validate` / `make lint` | PASS |
| `make test` | PASS — 363 konformanstests |
| `make baseline` | 151 pass, 1 fail, 0 error, 43 not run af 195 (den kendte `changelog-check`-fejl) |

Den præcise kørsel ligger i `evidence/focused-tests.log` og
`evidence/baseline.log`.

## Acceptkriterier

| # | Kriterium | Status | Bevis |
| --- | --- | --- | --- |
| 1 | Host management slået fra som standard; ejer afviser ikke-understøttede OS | PASS | `enrollment.mjs`, `host-management-test`, `host-management-status` |
| 2 | Implementer/planner har ingen hostcredentials; executor får kun scoped operationsticket | PASS | `broker.mjs` + `host-management-test` (`EXECUTOR_REQUIRED`, `HOST_CREDENTIALS_FORBIDDEN`) |
| 3 | Arbitrær shell, uploadet script, usigneret pakke og brokerændring afvises | PASS | `operations.mjs`, `broker.mjs`, `host-management-check`, `host-management-test` |
| 4 | SSH/firewallændring kan ikke lukke eneste recoveryvej uden særskilt menneskelig beslutning | PASS | `safety.mjs` (`guardRecoveryPath`) + tests |
| 5 | Reboot/drain for single-server med annonceret nedetid og separat for HA | PASS (deterministisk) | `operations.mjs`/`safety.mjs` + tests; selve kørslen er `integration-host-management-live` = NOT RUN |
| 6 | VPS-profil lover ikke hypervisor-/hardwarestyring | PASS | `host-profile.schema.json`, `profileProblems`, `host-management-test` |
| 7 | Tilladt OS-operation kan ikke skrive immutable-data eller destruere eksterne nøgler | PASS | `security-domain.mjs`, `operations.mjs` (forbudte capabilities) + tests |

## Kendte fejl og begrænsninger

- **`changelog-check`:** kendt, præeksisterende FAIL (manglende DCO sign-off,
  også i `83ad91a`). Registreret ærligt; ikke "rettet".
- **`integration-host-management-live`:** NOT RUN. Der findes ingen levende
  værtsmaskine, hypervisor eller ekstern KMS i dette miljø. Enrollment, broker,
  operationer, recoveryvej og sikkerhedsdomæne er efterprøvet deterministisk.
- **Signeringsnøglerne** i `host-management/dev-keyring.json` og
  `runbooks/dev-keyring.json` er offentlige testfixtures. Produktion kræver
  KMS/HSM i et separat sikkerhedsdomæne (ekstern integration).
- Den faktiske OS-effekt er injiceret i tests (adapterens `run`-funktion); der
  er ingen rigtig SSH/systemd/apt-integration i dette miljø.

## Review

- Base: `5f9fa73457d22583b9948611d5cc3afffec4ae38`
- Checkout: `83ad91a963d8055f77c29fb4361455689df95acb`
- Base + diff: hele `deliverable/`-træet oven på stak-tippet DKC-054.
