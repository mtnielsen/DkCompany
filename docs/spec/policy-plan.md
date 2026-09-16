# Policy-planen (PDP)

**Kontrakter:** [`policy-input.schema.json`](../../contracts/policy-input.schema.json), [`policy-decision.schema.json`](../../contracts/policy-decision.schema.json), [`policy-bundle.schema.json`](../../contracts/policy-bundle.schema.json), [`policy.schema.json`](../../contracts/policy.schema.json) (modulblok)
**Kode:** [`policy/pdp`](../../policy/pdp), [`policy/bundles`](../../policy/bundles)
**Backlog:** 1.1

## Formål

Moduler og agenter **spørger**; de beslutter ikke selv. Al privilegeret handling går gennem én central beslutningsmotor, så regler kan ændres ét sted, versioneres, signeres og efterprøves.

## To dele

1. **PDP'en** — en tjeneste der modtager et `PolicyInput` og returnerer en `PolicyDecision`.
2. **Bundlen** — et versionsstyret, signeret regelsæt som PDP'en nægter at indlæse, hvis signaturen ikke kan verificeres.

## Beslutningskontrakten

Inputtet beskriver principal, handling og kontekst:

```json
{
  "principal": { "kind": "agent", "id": "spiffe://…", "autonomyClass": "A3" },
  "action": { "verb": "upgrade", "target": "dummy-ok", "environment": "staging" },
  "context": { "evidence": ["policy-allow", "dry-run-clean"], "untrustedInput": false }
}
```

Svaret er bindende og bærer den bundle-version, det blev truffet med:

```json
{
  "decision": "allow-with-approval",
  "pdp": { "name": "platform-pdp", "bundleVersion": "1.0.0", "bundleSha256": "baeeeb…" },
  "matchedRules": ["ops.upgrade.requires-approval"],
  "requiredApprovals": 2,
  "requiredEvidence": ["policy-allow", "tests-pass", "dry-run-clean", "rollback-tested"],
  "obligations": [{ "type": "audit-event" }, { "type": "auto-rollback" }]
}
```

## Fail-closed

`default` i en bundle er altid `deny`. Matcher ingen regel, afvises handlingen med en begrundelse. Et modul erklærer `policy.failMode: "closed"`: kan PDP'en ikke nås, fortsætter modulet **ikke**. Dødemandsgrebet er det samme princip på runtime-niveau (backlog 2.3).

## Guardrails kan ikke overrules

Regler med høj prioritet kan ikke tilsidesættes af lavere allow-regler. `guardrails.policy-integrity` nægter enhver ændring af policy-bundles, audit-loggen og egne rettigheder — også for en agent med menneskelig godkendelse. Det er A4: handlinger ingen agent må udføre.

## Betingelses-DSL

Deterministisk og sideeffektfri:

- `{all: [...]}`, `{any: [...]}`, `{not: {...}}`
- `{field, eq|neq|in|nin|matches|gte|lte|exists|containsAll|containsAny}`

Feltstier som `principal.kind` og `context.blastRadius.personalDataRecords`. Manglende felt: `in` er false, `nin` er true, øvrige false.

## Bundle-versionering og signering

- En bundle ligger i `policy/bundles/<navn>/<version>/bundle.json`.
- Signaturen ligger **separat** i `bundle.sig.json` (Ed25519), så indholdet kan hashes uden cirkularitet.
- `policy/keys/trusted.json` indeholder de offentlige nøgler, PDP'en stoler på.
- Et modul pinner `policy.bundle.{name,version,sha256}`. Konformanssuiten (`C-009`) verificerer, at den pinnede digest er den faktisk signerede bundle.

Den private nøgle er bevidst ikke i git (`policy/keys/signing-key.json` er ignoreret). I produktion ligger den i KMS/HSM. `make policy-keygen` og `make policy-sign` bruges ved regelændringer.

## OPA-kompatibilitet

PDP'en taler OPA's data-API-form: `POST /v1/data/platform/ops/decision` med `{ "input": … }` og svar `{ "result": … }`. Kontrakten er derfor OPA-kompatibel; den nuværende evaluator er en letvægtsimplementering uden eksterne afhængigheder (se [ADR-0004](../adr/0004-letvaegts-pdp.md)). En senere udskiftning til OPA/Rego kræver ikke ændringer i modulerne.

## Konformans

- `C-009` — modulet er bundet til central PDP: fail-closed, HTTPS-endpoint, alle muterende verber gatede, pinnet bundle verificeret, og et **faktisk** beslutningsbevis (ikke en påstand).
- `C-010` — den aktive bundle er skemagyldig, `default: deny` og signeret.

Et modul uden PDP-kald fejler altså konformans. Det er hensigten.

## Acceptkriterier (1.1)

- [x] PDP implementeret og testet (`make policy-test`, `make policy-verify`, `make policy-decide`).
- [x] Modul uden PDP-kald fejler konformans (`C-009`, verificeret mod `dummy-broken`).
- [ ] PDP deployet i klynge via GitOps — afhænger af 1.2.
