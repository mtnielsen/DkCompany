# DKC-003 — Verificerbar autentifikation (leverance)

Implementering af **DKC-003** for `mtnielsen/DkCompany`. Bygger på DKC-001 og
DKC-002. `00-core/` er fortsat **ikke ændret**; alt ligger under
`01-step1/output/dkc-003/`.

## Hvad der er implementeret

1. **Fælles OIDC/JWT-validering** (`identity/src/jwt.mjs`): signatur (RS256/ES256/
   HS256), issuer, audience, exp/nbf, tenantbinding og **JWKS med nøglerotation**.
   Ukendt `kid` genindlæser sættet én gang; en nøgle, der stadig er ukendt,
   afvises. `alg: none` afvises.
2. **Workload-identitet** (`identity/src/identity.mjs`): kun mTLS-SVID i trust
   domain eller en HMAC-signeret assertion/principal fra en **betroet proxy**.
   Rå `x-spiffe-id` ignoreres og fjernes. `stripIdentityHeaders` +
   `gateway/src/ingress.mjs` fjerner klientleverede identitetsheadere ved ingress.
3. **Sessioner, CSRF, inputgrænser og rate limits** (`identity/src/session.mjs`):
   signerede `HttpOnly; Secure; SameSite=Strict`-cookies, CSRF-token bundet til
   sessionen, 413 ved for store bodies, 429 ved rate limit, 403 ved cross-origin
   writes. Den samlede pipeline ligger i `identity/src/server.mjs`.
4. **Demo-shim kræver testprofil** (`identity/src/compat.mjs`,
   `createPlatformAuthenticator`): `profile: "test"` er nødvendig, og
   `profile: "production"` med `demo.enabled` kaster ved konstruktion.
5. **Ingen lokal identity-shim:** modulernes `auth.mjs` er nu tynde delegater til
   den fælles implementering. Audit-servicen og de to adaptere awaiter
   autentificering og sender mTLS-certifikat/remote-adresse med.
6. **Gateway som eneste indgang:** `gateway/src/ingress.mjs` verificerer tokenet,
   fjerner klientheadere og videresender en signeret principal-assertion (uden
   tokenet). Downstream accepterer kun den signerede assertion fra en betroet
   adresse.

## Ændrede/nye filer (overlay, relativt til `00-core/`)

```
identity/                                   (ny pakke: jwt, identity, session, server, compat + 4 testfiler)
gateway/src/ingress.mjs                     (ny)
gateway/test/ingress.test.mjs               (ny)
modules/audit-service/service/src/auth.mjs  (delegat)
modules/audit-service/service/src/server.mjs (+ await + authContext)
modules/audit-service/service/src/cli.mjs   (+ profile/trusted-proxy/proxy-secret/demo)
modules/audit-service/service/test/auth.test.mjs
modules/mattermost-adapter/service/src/{auth,server,cli}.mjs
modules/mattermost-adapter/service/test/adapter.test.mjs
modules/keycloak-adapter/service/src/{auth,server,cli}.mjs
modules/keycloak-adapter/service/test/adapter.test.mjs
Makefile                                    (+ identity-test, i ci)
tools/baseline/registry.mjs                 (+ identity-test, ny komponent)
docs/spec/identity-verification.md          (ny operatør-/spec-doc)
docs/spec/README.md                         (+ indeks)
```

## Testkommandoer og resultater (checkout `83ad91a` + DKC-001/002, Node v22.22.1)

| Kommando | Resultat |
| --- | --- |
| `make identity-test` | **32 pass / 0 fail** |
| `make gateway-test` | **11 pass / 0 fail** (inkl. ingress) |
| `make audit-service-test` | **21 pass / 0 fail** |
| `make adapter-test` | **7 pass / 0 fail** |
| `make iam-adapter-test` | **7 pass / 0 fail** |
| `make validate` | exit 0 |
| `make conform-all` | PASS (12 pass, 3 skip, 0 fail) |
| `make agent-conformance-test` | 10 pass / 0 fail |
| `make runtime-test` | 10 pass / 0 fail |
| `make evidence-test` | 5 pass / 0 fail |
| `make baseline` | 49 checks: **39 pass, 1 fail, 0 error, 9 NOT RUN**; `identity-test` og `architecture-test` PASS |

Evidens: `evidence/logs/*.log` og `evidence/baseline/` (JSON + logs). Den ene
baseline-fejl er fortsat `changelog-check` (manglende DCO sign-off, DKC-001-fundet).

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Forfalsket `x-spiffe-id`, forkert audience, udløbet token og token fra anden kunde afvises | **PASS** | `identity/test/identity.test.mjs` (forfalsket header), `identity/test/jwt.test.mjs` (audience/exp/tenant), `identity/test/server.test.mjs`, `modules/audit-service/service/test/auth.test.mjs` |
| Direkte adgang uden om gateway/proxy afvises | **PASS** | `gateway/test/ingress.test.mjs` — direkte bearer uden OIDC/workload afvises; kun gatewayens signerede principal accepteres |
| Nøglerotation virker, og ukendt signeringsnøgle giver afvisning | **PASS** | `identity/test/jwt.test.mjs` ("ukendt nøgle afvises selv efter rotation …") |
| Serveren udleder subject og roller fra verificeret identitet | **PASS** | `identity/test/server.test.mjs` (principal id/roles fra token, header ignoreret), `gateway/test/ingress.test.mjs` |
| Uautoriserede cross-origin writes og overstore requests afvises | **PASS** | `identity/test/server.test.mjs` (403 cross-origin, 413 body, 429 rate, 403 CSRF) |

## Resterende begrænsninger

- **Ingen rigtig IdP/SPIRE i drift.** OIDC- og SVID-paths er implementeret og
  testet med genererede nøgler/certifikater, ikke mod en levende udbyder
  (DKC-024/DKC-003 opfølgning).
- **mTLS opsætning** (certifikatdistribution, rotation af SVID) er ikke
  automatiseret; kun verifikationslogikken findes.
- **`--proxy-secret` på kommandolinjen** bør i drift komme fra en secret-store.
- **HA/session-lagring** er in-memory signerede cookies; delt sessionslager er en
  senere opgave.
- **DKC-001's `changelog-check`-fejl består.**
- Overlay, ikke committed kode: `00-core/` er urørt.

## Til uafhængig gennemgang

- **Reviewets base-commit:** `5f9fa73457d22583b9948611d5cc3afffec4ae38`.
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb`.
- **Forudsætninger:** `01-step1/output/` (DKC-001) og `01-step1/output/dkc-002/`.
- **Ændringen:** `01-step1/output/dkc-003/deliverable/` (29 filer) plus evidens i
  `01-step1/output/dkc-003/evidence/`. SHA256 i `OVERLAY-MANIFEST.txt`.
