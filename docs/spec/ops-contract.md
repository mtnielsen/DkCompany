# Ops-kontrakten (module manifest + verber)

**Kontrakt:** [`contracts/module-manifest.schema.json`](../../contracts/module-manifest.schema.json)
**Backlog:** 0.4

## Formål

Ethvert modul skal kunne drives ens: sikkerhedskopieres, opgraderes, rulles tilbage og overvåges gennem det samme verbsæt. Forskellen mellem moduler ligger i, *hvad* de kan, ikke i *hvordan* man kalder dem.

## Verbsættet

| Verbum | Betydning |
| --- | --- |
| `backup` | Tag sikkerhedskopi |
| `restore` | Gendan fra sikkerhedskopi |
| `verify-restore` | Bevis at en gendannelse faktisk virker |
| `drain` | Tøm for trafik før indgreb |
| `upgrade.dry-run` | Vis hvad en opgradering ville gøre |
| `upgrade` | Udfør opgradering |
| `migrate` | Kør skema-/datamigration |
| `rollback` | Rul tilbage |
| `health` | Løbende sundhedstjek |
| `slo` | Rapporter SLO-status |

Alle ti skal være deklareret i `verbs`. Manglende deklaration er en fejl — orkestratoren skal kunne se forskel på "kan ikke" og "glemte at nævne".

## Conformance pr. verbum

Se [ADR-0003](../adr/0003-partial-conformance.md). Kort:

```json
"restore": {
  "conformance": "partial",
  "reason": "Gendannelse tager 6 timer og kræver manuel indgriben; SLO er ikke opfyldt.",
  "endpoint": "https://modul.example.org/ops/restore",
  "evidence": { "kind": "declared", "ref": "docs/restore.md" }
}
```

- `full` kræver `endpoint` og et `evidence` af typen `fixture` eller `probe`.
- `partial` og `unsupported` kræver en `reason` på mindst 10 tegn.

## Blast radius

Hvert verbum kan erklære en `maxBlastRadius` (tenants, services, personalDataRecords). Den bruges af policy- og approval-lagene til at afgøre, om handlingen må udføres autonomt.

## Hvorfor delvis conformance ikke er en svaghed

Uden `partial` ville hvert manifest enten overdrive eller underdrive. Et modul, der ærligt kan sige "jeg kan eksportere, men ikke slette", er mere brugbart end et, der påstår fuld dækning og fejler i produktion. Det er præcis den ærlighed, DSAR-orkestratoren bygger på.

## Acceptkriterier (0.4)

- [x] `module-manifest.schema.json` findes.
- [x] Partial conformance er repræsenterbar uden at lyve (`dummy-ok` erklærer `partial` på `subject.legal_hold`, `dummy-broken` afvises for tomme begrundelser).
