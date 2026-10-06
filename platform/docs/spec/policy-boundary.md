# Policy-, scope- og evidenskontrol ved runtimegrænsen (DKC-007)

Reglen: **ugyldigt eller tvetydigt input afvises, før en executor kan køre.**
Runtimen er den sidste kode, der ser et manifest, en task og et PDP-svar. Den
må ikke gætte.

## Grænsevalidering

| Fil | Ansvar |
| --- | --- |
| `runtime/src/boundary.mjs` | Validér manifestets form, taskens form og PDP-svaret; håndhæv miljø/scope/datakategori |
| `runtime/src/classification.mjs` | Fælles klassifikation af muterende verber og beskyttede A4-ressourcer; normalisering og ensrettet scope |
| `runtime/src/evidence.mjs` | Slå evidensreferencer op og bind dem til digest/commit |
| `runtime/src/digest.mjs` | Kanonisk digest, identisk med PDP'ens `inputSha256` |

Et manifest valideres ved `createAgentRuntime`. En A4-autonomiklasse,
manglende SPIFFE-ID eller et tomt `ownedComponents` afvises med en
`RuntimeBoundaryError`. En task valideres ved `runTask`; manglende `tenantId`,
ukendt miljø eller et `agentRef` der ikke matcher manifestet afvises.

## PDP-svaret

Et svar accepteres kun når:

- `decision` er `allow`, `allow-with-approval` eller `deny` (ikke tom/ukendt),
- `pdp.{name,version,bundleVersion}` og `matchedRules` findes,
- `inputSha256 === digestOf(input)` — svaret gælder præcis det input, runtimen
  sendte,
- `allow-with-approval` har `requiredApprovals >= 1`, og `deny` har en
  begrundelse.

Ellers stoppes handlingen som en dødemandsgreb-hændelse.

## Fælles klassifikation

- **Muterende verber** er default: alle verber undtagen en udtømmende liste
  over læsende (`observe.*`, `diagnose`, `propose`, `upgrade.dry-run`,
  `verify-restore`, `health`, `slo`, `subject.locate`, `retention.policy`,
  `backup`). Et nyt verbum (`upgrade.hotfix`, `config.rollback`) er derfor
  muterende og kan ikke omgå A4.
- **Beskyttede A4-ressourcer** matches på normaliserede segmenter: Unicode
  NFKC, gentagen procent-decode, `\` → `/`, kollaps af separatorer og `.`/`..`,
  små bogstaver, og aliaser hvor `-`/`_`/`.` fjernes. `POLICY/Bundles`,
  `policy%2Fbundles`, `policy/./bundles`, `audit_service` og
  `res://acme/policy/7` rammer alle A4.
- **Ensrettet scope:** `withinScope(target, scope)` dækker scope og dets børn,
  aldrig forælderen. `dummy-ok/child` giver ikke adgang til `dummy-ok`.

## Miljø, komponenter og datakategori

Pr. handling håndhæves:

- `action.environment ∈ manifest.scope.environments` (en staging-agent kan ikke
  operere i prod),
- capability-scope inden for `manifest.scope.ownedComponents`,
- `action.target` inden for capability-scope og `ownedComponents`,
- `action.dataCategories ⊆ manifest.scope.dataCategories`.

## Evidens bundet til digest

`action.evidence` er labels. Alle labels undtagen `policy-allow` skal slås op i
en `evidenceIndex` (task- eller handlingsniveau, eller `--evidence-index` i
CLI'en) med `{ uri, sha256, commit?, digest?, status? }`. Runtimen læser
artefaktet, genberegner SHA-256 og kræver match; `tests-pass` kræver
`status: "pass"`. En bar `"tests-pass"`-streng uden reference afvises. De
verificerede digester følger med i policy-inputtet som `context.evidenceSha256`.

## Kør

```bash
make boundary-test     # grænse + klassifikation
make runtime-test      # hele runtimen inkl. godkendelser og tenant
make agent-conformance-test
```

Verifikation skal udføres af en separat verifier; lokale tests er ikke
uafhængig verifikation.
