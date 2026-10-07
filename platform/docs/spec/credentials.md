# Kortlivede rettigheder og nødstop (DKC-010)

Agent-runtimens just-in-time-credentials er ikke længere et lokalt UUID. De er
kryptografisk signerede, scope-bundne tokens med TTL, og de kan tilbagekaldes og
nødstoppes. Se [ADR-0022](../adr/0022-rettigheder-og-noedstop.md).

## Signerer (KMS/secret-broker)

```
KMS/secret-broker                 Runtime (udsteder)              Executor (modtager)
  privat nøgle (ikke-eksport.) ──► sign(header.payload) ──► token ──► JWKS ──► verify()
```

- `credentials/src/keys.mjs` — signerer-abstraktion (Ed25519/EdDSA), JWKS.
- `createLocalSigner` er udviklingsimplementeringen. Produktion bruger en
  cloud-KMS (fx AWS KMS/Entra) eller HashiCorp Vault Transit, hvor nøglen aldrig
  forlader KMS'en og hver signatur er revideret. Grænsefladen er `sign()`,
  `publicJwk()`, `kid`, `alg`.
- Verifikationssiden (`verifier.mjs`) har kun JWKS og kan derfor ikke udstede.

## Token-format

Kompakt JWS: `base64url(header).base64url(claims).base64url(signatur)`.

| Claim | Betydning |
| --- | --- |
| `iss` | Udsteder (credential-broker) |
| `sub` | Agentens SPIFFE-identitet |
| `aud` | Tilsigtede executor-tjenester (audience) |
| `jti` | Unikt token-ID (til tilbagekaldelse) |
| `iat`/`nbf`/`exp` | Udstedt / ikke før / udløber (epoch-sekunder) |
| `tenant_id` | Kunden |
| `agent_ref`, `role` | Agent og dens uforanderlige rolle (DKC-055) |
| `task_id` | Opgaven |
| `scope.verb`, `scope.resource`, `scope.environment` | Den tilladte handling |

`scope.resource` er en præfiks-tilladelse: ressource og børn er dækket,
forældre ikke (ensrettet scope, som i DKC-007).

## Udstedelse

`credentials/src/broker.mjs`:

1. afviser hvis et nødstop er aktivt for agenten/kunden (fail-closed),
2. afviser A4-beskyttede ressourcer og verber rollen ikke må (`scope.mjs`),
3. kræver kunde, ressource, verbum, miljø, audience og TTL,
4. klemmer TTL til `[minTtlSeconds, maxTtlSeconds]`,
5. signerer i KMS-signereren og journalfører udstedelsen (jti + scope).

Runtimen udsteder **ét token pr. handling** lige før eksekvering. Audience er
`capability.executor` (manifestet) eller udledt `module:<target>`.

## Verifikation og receiver-vagt

`credentials/src/verifier.mjs` afviser fail-closed hvis:

- signaturen, `alg`, `kid` eller tidsclaims er ugyldige,
- `iss`/`aud`/`sub` ikke matcher,
- kunden, verbet, ressourcen eller miljøet falder uden for `scope`,
- `jti`/agenten/kunden er tilbagekaldt,
- et nødstop er aktivt.

`credentials/src/receiver.mjs` (`createExecutorGuard`) er executor-vagten. Den
kaldes af modtageren før handlingen; et afvist credential giver
`CredentialRejected` og ingen eksekvering. Audit-servicen bruger samme verifier
på hver privilegeret rute (`x-platform-credential`-headeren).

## Tilbagekaldelse

`credentials/src/revocation.mjs` + `persistence/src/adapters/revocations.mjs`:

| Scope | Nøgle | Virkning |
| --- | --- | --- |
| `credential` | `jti` | Ét token afvises |
| `agent` | `spiffeId` | Alle agentens tokens afvises |
| `tenant` | `tenantId` | Alle kundens tokens afvises |

Listen er holdbar og slås op ved hver modtagelse, så et tilbagekaldt token
afvises selvom signaturen og TTL stadig er gyldige.

## Nødstop

`credentials/src/kill-switch.mjs` + `persistence/src/adapters/stops.mjs`:

| Scope | Aktivér | Ophæv |
| --- | --- | --- |
| `agent` | agent-owner, platform-admin, security-officer | samme |
| `tenant` | tenant-admin, platform-admin, security-officer | samme |
| `global` | platform-admin, security-officer | platform-admin, security-officer |

Kun et verificeret menneske kan betjene et nødstop; agent-/demo-identiteter
afvises. Verifikationssiden cacher højst `cacheTtlMs` (≤ 5000 ms), så et stop
slår igennem inden for fem sekunder i staging — også på tværs af processer/
noder, fordi tilstanden er holdbar. Runtimen kalder `assertAllowed` før hver
handling og stopper med `halted`/`emergencyStop: true`.

## Kontrolplans-isolation

`runtime/src/classification.mjs` udvider A4 med agentregistrering, GitOps og
nødstop/broker/KMS-rødder. Dermed:

- afviser runtimen enhver agenthandling mod policy, audit, credentials, egen
  registrering eller GitOps-manifester, og
- nægter brokeren at udstede et credential til de samme ressourcer.

GitOps-gaten `G-009` afviser desuden RBAC der giver en agent-ServiceAccount
privilegeret adgang til kontrolplanet.

## Checks

- `make credentials-test` — credentials-modulet, runtime-integration,
  audit-service-modtageren, GitOps-gaten og konformanstesten.
- `make credentials-check` — signerer/JWKS, holdbar tilbagekaldelse/nødstop og
  A4-afvisning.
- `conformance/test/credentials-conformance.test.mjs` spejler de fire
  acceptkriterier i `make test`.

## Begrænsninger

- Den lokale signerer er en udviklingsimplementering; en rigtig KMS/Vault er en
  driftsopsætning og er **ikke** afprøvet her (NOT RUN).
- Nødstoppets fem-sekunders-grænse er bevist in-process med en cache på 500 ms.
  Tværnodepropagering afhænger af, hvor hurtigt den holdbare tilstand læses
  (cachegrænsen), og er ikke afprøvet i en klynge.
- Tilbagekaldelseslisten vokser; produktion bør prune udløbne poster
  (`prune()` understøtter det).
