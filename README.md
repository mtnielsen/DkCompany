# DkCompany — platformskontrakter og vedligeholdt platformskilde

Dette repository er arbejdspladsen omkring **DkCompany-platformen**. Den
vedligeholdte kildekode ligger i `platform/` efter S1-01; de historiske input
bevares uændret:

| Mappe | Hvad det er |
| --- | --- |
| [`platform/`](platform) | **Den vedligeholdte platformskilde**: kontrakter, konformanssuite, policy, agent-runtime, evidensmaskineri m.m. Fremtidige ændringer sker her. Træet er deterministisk samlet fra `00-core/` og de 66 historiske overlays og bærer [`platform/PROVENANCE.json`](platform/PROVENANCE.json). |
| [`tools/`](tools) | Deterministisk assembler (S1-01), stakdefinition og assemblerens tests. |
| [`00-core/`](00-core) | Historisk baseline før overlay-stakken. **Frosset input**; ændres ikke. |
| [`01-step1/`](01-step1) | Historisk opgavepakke *«Direkte kodeprompts — revision 5»*: 66 kodeprompts og de kumulative implementeringer i `output/`. **Frosset input**; ændres ikke. |
| [`02-stabilization/`](02-stabilization) | Stabiliseringssprintene med opgaver, verifier-prompts, evidens og ADR'er. |

`node_modules/` i roden er en ikke-sporet cache af JSON-Schema-værktøj (ajv m.fl.)
og er ikke en del af det tracked indhold (se [`.gitignore`](.gitignore)).

---

## Aktuel fortsættelse: stabilisering og første testinstallation

Start med [`02-stabilization/README.md`](02-stabilization/README.md) og
[`START-IMPLEMENTER.md`](02-stabilization/START-IMPLEMENTER.md). Pakken indeholder
tre sprints med konkrete kodeopgaver, separate verifier-prompts, afhængigheder
og acceptkriterier. Første opgave er **S1-01**: saml implementeringen i `platform/`.
Det nye kildekodetræ er nu oprettet i `platform/` af S1-01. Opgaven er
**implementeret på en opgavebranch og afventer uafhængig verifikation**; intet er
godkendt, merget eller deployet. Beslutningen bag `platform/` er registreret i
[`02-stabilization/adr/0001-platform-source-tree.md`](02-stabilization/adr/0001-platform-source-tree.md).
Træets integritet kan efterprøves fra roden:

```bash
make assemble-check   # byte-identisk med en frisk deterministisk samling
make install          # npm ci i platform/conformance
make validate         # samling + kontraktskemaer + lint
make test             # assembler-, sikkerheds- og konformanstests
make probes PROBE_OUT=probe-results.json   # 2026-10-06-reviewets lokale prober
```

1. Sikkerhedsrettelser og samlet kildekode.
2. Reproducerbar Linux-installation, CI og adgangskontrol ved merge.
3. Autoriseret VPS-staging med syntetiske data, backup/restore og rollback.

`00-core/` og `01-step1/` er historiske input til denne fortsættelse. Ny kode
vedligeholdes direkte i `platform/` efter S1-01. Ingen af sprintopgaverne er
erklæret færdige ved publicering af pakken; teknisk verifikation og menneskelig
accept skal registreres særskilt. HA og kundeproduktion kræver senere live-tests.

## 1. `00-core/` — platformen

Et monorepo for de kontrakter, der gør en fler-modul-platform styrbar og
beviselig — og den konformanssuite, der afgør, om et modul må kalde sig
kompatibelt. Princippet er **kontrakt før implementering, test før moduler, to
beviste adaptere før skalering, agenter før dashboards.**

> `00-core/` er ikke «compliant software». Det er kontrakter, tests og
> evidensmaskineri. Ansvaret ligger hos den, der deployer og driver platformen.

Læs den fulde beskrivelse, status pr. bølge og alle `make`-mål i
[`00-core/README.md`](00-core/README.md) og baggrunden i
[`00-core/BACKLOG.md`](00-core/BACKLOG.md).

Kom hurtigt i gang (inde i `00-core/`):

```bash
cd 00-core
make install                 # npm ci i conformance/
make ci                      # validate + lint + test + conform-all + conform-negative
```

Bidrag: se [`00-core/CONTRIBUTING.md`](00-core/CONTRIBUTING.md). Alle commits skal
være DCO-signeret (`git commit -s`).

---

## 2. `01-step1/` — opgavepakken

Opdeler platformens backlog i 66 direkte kodeprompts. En kodeagent skal kunne
implementere den enkelte opgave uden at skifte til en formel planlægningsrolle.

```
01-step1/
├── README.md                     # pakkens egen læsevejledning
├── START-CODING.md               # første tildeling (DKC-001)
├── tasks.json                    # 66 opgaver med leverancer og acceptkriterier
├── SHA256SUMS.json               # integritet for pakkens input
├── data/
│   ├── requirements.json         # krav koblet til opgaver
│   ├── execution-waves.json      # afhængighedsrækkefølge
│   └── applikationer.json        # 169 modulbeskrivelser og kandidater
├── prompts/                      # DKC-001.md … DKC-066.md
├── reference/                    # sikkerheds-, drifts-, installations- og testkrav
└── output/                       # færdige, kumulative implementeringer
    ├── dkc-001/ … dkc-066/       # én mappe pr. opgave
    └── DOCUMENTATION-CORRECTIONS.md
```

Læs [`01-step1/README.md`](01-step1/README.md) for brugen af pakken.

---

## 3. `01-step1/output/` — kumulative overlays

Hver opgave er implementeret som en **overlay** oven på den foregående. En pakke
indeholder:

```
01-step1/output/dkc-XXX/
├── README.md                     # opgave, forudsætninger, verificeret adfærd
├── apply.sh                      # lægger stak-tippet + denne overlay
├── deliverable/                  # de faktiske filer, der kopieres ind i 00-core
├── evidence/                     # logs, exitkoder, baseline-summer, manifest-verifikation
└── OVERLAY-MANIFEST.txt          # SHA256 for alle pakkefiler
```

`apply.sh` kæder sig baglæns gennem hele stakken, så én kommando genskaber den
fulde tilstand. **Den aktuelle stak-tip er DKC-036**
(`01-step1/output/dkc-036/apply.sh`), som kæder
`dkc-035 → dkc-033 → dkc-065 → … → dkc-001`.

Anvend stakken på en ren checkout:

```bash
# Fra dette arbejdsområde
01-step1/output/dkc-036/apply.sh /sti/til/checkout/00-core

# I målet
cd /sti/til/checkout/00-core
make install
make ci
```

Verificér en pakkes integritet:

```bash
cd 01-step1/output/dkc-036
sha256sum -c OVERLAY-MANIFEST.txt     # forventet: 79/79 OK, exit 0
```

---

## Status

| | |
| --- | --- |
| Opgaver i `tasks.json` | **66** |
| Opgaver med `output/dkc-XXX/` | **66** (0 mangler, 0 klar-til-start) |
| Stak-tip | **DKC-036** — enterprise- og brancheprofiler |
| Kanonisk kildetræ | **`platform/`** — 2176 filer + `PROVENANCE.json` |
| Trædigest (pre-fix, ekskl. `PROVENANCE.json`) | `f940d3000c27ce73c8971352b778d4e1dcccfeee0a82a4868b04fc8ff5fb7293` |
| S1-01-status | **implementeret, afventer uafhængig verifikation** (ikke accepteret) |
| Seneste ADR i platformen | **0077** |
| `matrixVersion` / `metadata.version` | 1.46.0 / 1.24.0 |
| Krav i matrixen | **69** |

**Baseline ved stak-tippen (DKC-036):** 279 checks → **218 PASS**, **1 FAIL**
(forudbestående `changelog-check`), **60 NOT RUN**.

---

## Historisk arbejdsmetode for 01-step1

Følgende metode beskriver de eksisterende overlays i `01-step1/`. Ny stabilisering
følger [`02-stabilization/`](02-stabilization/README.md): S1-01 har samlet
`platform/` som vedligeholdt kildekode. `00-core/` og de historiske overlays
bevares uændret. Metoden nedenfor gælder kun ved reproduktion af de historiske
leverancer:

1. **`00-core/` må ikke ændres.** `git status --porcelain -- 00-core` skal være tom.
2. **Disposable klon:** `git clone --no-hardlinks /mnt/c/projects/DkCompany /tmp/dkc-XXX`,
   `git checkout 83ad91a`, læg **stak-tippens** `apply.sh` fra den originale
   `01-step1/output/` på `<clone>/00-core`, og kør `make install`.
3. **Reference-klon** med kun stak-tippen anvendt, til diff.
4. **Implementér for real**, kør fokuserede tests, og **nulstil
   runtime-muterede fixtures** (snapshot alle `modules/*/conformance` fra en
   ren reference-klon før `make baseline`, gendan efter, og verificér med
   `diff -rq`).
5. **Pak som `01-step1/output/dkc-XXX/`** med `README.md`, `apply.sh`,
   `deliverable/`, `evidence/` og `OVERLAY-MANIFEST.txt` (SHA256 relativ til
   pakkeroden, verificeret med `sha256sum -c`).
6. **Ryd op:** ingen `/tmp/dkc*` eller `/tmp/e2e-*`-kataloger må efterlades.

---

## Kendte begrænsninger

Disse punkter er bevidst ærligt rapporteret og skal ikke «fikses» uden en
eksplicit anmodning:

- **`changelog-check` fejler** i baseline på grund af manglende DCO-sign-off
  (bl.a. commit `83ad91a`). Der er ikke fabrikeret nogen sign-off.
- **S1-01 er hverken verificeret eller accepteret.** GitHub CI er fortsat
  NOT RUN (opgave S2-03), og fundene R1-R4 fra 2026-10-06 er reproducerbare mod
  `platform/`, indtil S1-02-S1-05 lukker dem. Ændringer til `platform/` efter
  S1-01 skal vedligeholdes direkte i træet, ikke gennem nye overlays.
- **Eksterne/live-vurderinger er NOT RUN:** ingen underskrevet
  testkundeaftale, ingen bekræftet faglig/sektor-/højrisiko-AI-vurdering, ingen
  uafhængig assessor, og intet Docker/cosign/syft/trivy/PostgreSQL/kubectl/
  tofu/terraform/helm/kustomize/GitHub Actions/live-scannere/live-hosts i
  miljøet. Detaljer findes i den enkelte pakkes `README.md` og `evidence/`.
- Miljø: **Node v22.22.1**. Reviewets base er `5f9fa73`, den undersøgte
  checkout er `83ad91a`.

---

## Repositorieoversigt

```
.
├── platform/         # vedligeholdt kildetræ (S1-01) + PROVENANCE.json
├── tools/            # deterministisk assembler + negative tests
├── 00-core/          # historisk baseline — frosset input
├── 01-step1/         # 66 kodeprompts + historiske overlays — frosset input
├── 02-stabilization/ # sprintopgaver, verifier-prompts, evidens og ADR'er
├── Makefile          # assemble, assemble-check, validate, test, probes
├── node_modules/     # ikke-sporet JSON-Schema-cache
└── README.md         # denne fil
```

Remote: <https://github.com/mtnielsen/DkCompany>
