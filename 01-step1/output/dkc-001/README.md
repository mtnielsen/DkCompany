# DKC-001 — Reproducerbar baselinekontrol (leverance)

Implementering af **DKC-001** for repositoryet `mtnielsen/DkCompany`.

`00-core/` er den undersøgte checkout og er **ikke ændret**. Alt, hvad denne
opgave har frembragt, ligger under `01-step1/output/`. Overlayen i
`deliverable/` spejler repositoryets stier og kan lægges oven på en ren checkout
med [`apply.sh`](apply.sh).

## Hvad der er implementeret

1. **Et repository-nativt baseline-/check-kommando** (`tools/baseline/baseline.mjs`)
   med tilhørende `make baseline`, `make baseline-render` og `make baseline-test`.
   Den kalder de **eksisterende** checks (ingen nye tests opfundet), og udsender pr.
   check: status, exitkode, varighed, commit, miljø og evidensplacering. Resultatet
   skrives struktureret til JSON og som fulde logs.
2. **En genereret modenhedsmatrix** (`docs/status/implementation-matrix.md`) fra
   **faktiske observationer**, der skelner mellem `real`, `mock`, `fixture`,
   `contract` og `integration`, og som viser fejl og `NOT RUN` i særskilte afsnit.
3. **Rettede modenhedspåstande** i `README.md`, `docs/spec/security-plan.md` og
   `docs/spec/reference-module.md` — uden at omskrive historiske backlog-bølger.
   Korrektionerne er dokumenteret i [`DOCUMENTATION-CORRECTIONS.md`](DOCUMENTATION-CORRECTIONS.md).

## Layout

```
01-step1/output/
  README.md                          ← denne leverancerapport
  DOCUMENTATION-CORRECTIONS.md       ← påstand → problem → korrektion
  apply.sh                           ← læg overlayen på en ren checkout
  deliverable/                       ← overlay (spejler repo-stier)
    Makefile                         ← + baseline-targets
    README.md                        ← rettet
    docs/spec/security-plan.md       ← rettet
    docs/spec/reference-module.md    ← rettet
    docs/status/implementation-matrix.md
    tools/baseline/{baseline,registry,matrix,environment}.mjs + test/
  evidence/
    baseline/latest.json             ← struktureret kørsel (miljø + alle checks)
    baseline/runs/<tid>-<commit>.json
    baseline/logs/<check>.log        ← fuld stdout/stderr
    baseline/artifacts/              ← .conformance-out (OSCAL/report/badge/changelog)
```

## Reproduktion

Kravene er Node 22 og `make`. Kør i en **ren checkout** (så `00-core/` ikke røres):

```bash
# 1. Klon base-committet til et disposable sted
git clone --no-hardlinks <repo> /tmp/dkc-baseline

# 2. Læg overlayen på den checkout, der indeholder repo-indholdet (00-core)
/path/to/01-step1/output/apply.sh /tmp/dkc-baseline/00-core

# 3. Dokumenteret opsætning + kørsel
cd /tmp/dkc-baseline/00-core
make install        # npm ci i conformance/
make baseline-test  # værktøjets egne tests (8 tests)
make baseline       # alle checks + docs/status/implementation-matrix.md + evidens
```

`make baseline` returnerer non-zero, når en check fejler. Det er tilsigtet.

### Sådan blev evidensen i denne pakke skabt

```bash
git clone --no-hardlinks /mnt/c/projects/DkCompany /tmp/dkc-baseline-clone
cd /tmp/dkc-baseline-clone/00-core && make install        # exit 0
# og den native vej (overlay lagt på 00-core): `make baseline-test` (8 pass) + `make baseline`
node 01-step1/output/deliverable/tools/baseline/baseline.mjs run \
  --repo /tmp/dkc-baseline-clone/00-core \
  --matrix 01-step1/output/deliverable/docs/status/implementation-matrix.md \
  --evidence-dir 01-step1/output/evidence/baseline
```

## Resultat (commit `83ad91a`, Node v22.22.1)

**37 pass · 1 fail · 0 error · 9 NOT RUN** af 47 checks.

### Fejl (surfacet, ikke skjult)

| Check | Exit | Betydning |
| --- | --- | --- |
| `make changelog-check` | 2 | 4 commits mangler DCO sign-off (`83ad91a`, `76e4782`, `5f9fa73`, `87768da`). `make ci` er derfor **ikke** grønt i en ren checkout. |

### NOT RUN (manglende bevis ≠ PASS)

- `integration-trivy`, `integration-falco`, `integration-wazuh` — ingen scanner/værktøj installeret; kun committede samples normaliseres.
- `integration-mattermost`, `integration-keycloak` — kun mock-instanser er efterprøvet.
- `integration-llm` — kun echo-provider; ingen rigtig modelleverandør.
- `integration-oidc` — identitet er kontraktvalideret, ikke koblet på en rigtig IdP.
- `integration-github-actions` — workflowet er fjernet i `76e4782`; Actions er slået fra.
- `reviewer-metrics` — starter en HTTP-server på `127.0.0.1:8484` og terminerer ikke. Det er ikke en afsluttende test; funktionaliteten er dækket af `reviewer-test` (som indeholder `reviewer/test/metrics.test.mjs`). Den er derfor markeret NOT RUN, ikke PASS — og er ikke deaktiveret for at opnå grøn status.

### Reproducerbarhedsfund

Kørslen ændrede **30 sporede filer**. `make audit-service-evidence`,
`adapter-evidence` og `iam-adapter-evidence` skriver `capturedAt`/`durationMs` og
dermed nye sha256-værdier ind i committede fixtures. En ren checkout forbliver
altså ikke ren efter `make baseline`. Fundet fremgår af matrixens
reproducerbarhedsafsnit med de præcise filer. Det bør løses ved at gøre
generatorerne deterministiske eller ved at skrive fixtures til et ignoreret
outputområde.

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| En ren checkout kan gentage de dokumenterede checks | **PASS** | `make install` + `make baseline` kørt i `git clone --no-hardlinks`; 38 af 47 checks kørte (1 fejlede), 9 er NOT RUN; `evidence/baseline/latest.json` + logs |
| Ingen mock eller fixture er mærket som bevis for produktion | **PASS** | `docs/status/implementation-matrix.md` mærker `mock`/`fixture`/`integration`; README/security-plan/reference-module rettet |
| Fejl og ikke-kørte tests fremgår særskilt; ingen tests deaktiveres for at få grøn status | **PASS** | Særskilte afsnit "Fejl" og "NOT RUN"; `changelog-check` fejler åbent; ingen test fjernet fra registret |

Verifikation skal udføres af en separat verifier; denne rapport er
implementerens egen redegørelse og er ikke uafhængig verifikation.

## Resterende begrænsninger

- **Ingen rigtig CI.** GitHub Actions-workflowet er fjernet. Baselinekørslen er
  lokal (eller kan kaldes fra enhver ekstern runner).
- **Eksterne integrationer er ikke efterprøvet.** Mattermost, Keycloak, en rigtig
  IdP, en rigtig modelleverandør og Trivy/Falco/Wazuh mangler alle live-bevis.
- **Ikke-idempotente evidensgeneratorer.** Se reproducerbarhedsfundet ovenfor.
- **DCO-fejlen kræver en menneskelig/git-historisk beslutning** (nye signerede
  commits eller en dokumenteret undtagelse). Den er ikke løst her.
- **Andre modenhedspåstande end de tre rettede filer** er bevidst ikke omskrevet;
  matrixen supplerer dem i stedet. Se `DOCUMENTATION-CORRECTIONS.md` afsnit 6.
- Baselinekørslen blev foretaget i WSL2 på Node v22.22.1; en anden platform kan
  give andre varigheder og dermed andre fixture-hashes.

## Til uafhængig gennemgang

- **Reviewets base-commit:** `5f9fa73457d22583b9948611d5cc3afffec4ae38`.
- **Checkout, der er undersøgt:** `83ad91a963d8055f77c29fb4361455689df95acb` (`main`), ren arbejdskopi.
- **Ændringen:** overlayen under `01-step1/output/deliverable/` plus evidensen under `01-step1/output/evidence/`. `00-core/` er bit-for-bit urørt (`git status --porcelain -- 00-core` er tom).
