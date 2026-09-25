# Baselinekontrol

Et lille, repository-nativt værktøj, der kører repoets **eksisterende** checks og
skriver et struktureret resultat pr. check plus en ærlig
[`docs/status/implementation-matrix.md`](../../docs/status/implementation-matrix.md).

Værktøjet opfinder ikke nye tests og erstatter ikke konformanssuiten. Det
orkestrerer dem, der allerede findes, og gør forskellen mellem dokumentation,
mock-tests, fixtures og dokumenteret drift eksplicit.

## Brug

```bash
make baseline          # kør alle checks, skriv evidens + matrix
make baseline-render   # genskab matrix fra seneste evidens (kører ingen checks)
make baseline-test     # værktøjets egne tests
```

Eller direkte:

```bash
node tools/baseline/baseline.mjs run \
  --repo . \
  --matrix docs/status/implementation-matrix.md \
  --evidence-dir .conformance-out/baseline
```

| Flag | Betydning |
| --- | --- |
| `--repo <sti>` | Repo-rod (default: to niveauer over scriptet) |
| `--matrix <sti>` | Matrix-fil (default: `<repo>/docs/status/implementation-matrix.md`) |
| `--evidence-dir <sti>` | Evidensmappe (default: `<repo>/.conformance-out/baseline`) |
| `--only <id,id>` | Kør kun udvalgte checks |
| `--skip <id,id>` | Spring checks over |
| `--timeout <sek>` | Timeout pr. check (default: 300) |
| `--no-fail` | Returnér 0 selv hvis en check fejler |
| `--json` | Udskriv den strukturerede kørsel |

## Hvad der registreres pr. check

- `status`: `pass`, `fail`, `error` eller `not-run`
- `exitCode`, `signal`, `durationMs`, `startedAt`, `finishedAt`
- `level`: `real`, `mock`, `fixture`, `contract` eller `integration`
- `command`, `component`, `evidence` (deklarerede bevisstier)
- `log`: stien til den fulde stdout/stderr for kørslen
- `reason` for `not-run` (fx manglende eksternt system)

Miljøet (commit, branch, dirty-status, Node/npm, platform, CI) fanges én gang pr.
kørsel og følger evidensfilen. Kørslen tjekker også, om checkene ændrer sporede
filer, og markerer det som et reproducerbarhedsproblem — et grønt resultat må
ikke kræve, at en ren checkout bliver beskidt.

## Evidens

```
<evidence-dir>/
  latest.json                 # seneste strukturerede kørsel
  runs/<tid>-<commit>.json    # hver kørsel gemmes
  logs/<check-id>.log         # fuld stdout/stderr pr. check
  artifacts/                  # kopi af .conformance-out (OSCAL, changelog, badge ...)
```

## Niveauer

`real` er førstepartskode efterprøvet deterministisk. `mock` og `fixture` er
ægte tests, men deres bevis dækker ikke en rigtig ekstern installation.
`integration` er checks, der kræver et levende system; de forsøges ikke kørt og
registreres som `NOT RUN`. En `NOT RUN`-linje er **aldrig** det samme som PASS.

## Tilføj en check

Tilføj en post i [`registry.mjs`](registry.mjs) og, hvis den hører til en
komponent, referer dens id i `COMPONENTS`. En check skal have en `level` og en
`command`. Eksterne checks markeres med `external: true` og en `reason`.
