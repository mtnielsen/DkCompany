# Verificerbar identitet (DKC-003)

Reglen: **en klientleveret header eller et JSON-felt beviser aldrig identitet.**
Identitet kommer fra et verificeret OIDC-token, en mTLS-SVID eller en signeret
assertion fra en betroet proxy. Den fælles implementering ligger i
[`identity/`](../../identity) og bruges af alle moduler; modulernes gamle
`auth.mjs` er nu kun et tynd delegat.

## Komponenter

| Fil | Ansvar |
| --- | --- |
| `identity/src/jwt.mjs` | OIDC/JWT: signatur (RS256/ES256/HS256), issuer, audience, exp/nbf, tenantbinding og JWKS med nøglerotation |
| `identity/src/identity.mjs` | Workload-identitet (mTLS-SVID eller betroet proxy), header-stripping, principal-assertion og demo-gating |
| `identity/src/session.mjs` | Signerede sessioner, CSRF, rate limits, inputgrænser og cookie-flag |
| `identity/src/server.mjs` | Sikker request-pipeline: rate limit → CSRF/origin → strip headers → verificér → body-loft |
| `identity/src/compat.mjs` | Modulernes kompatibilitets-API |
| `gateway/src/ingress.mjs` | Ingress: verificér token, fjern klientheadere, videresend signeret principal |

## Regler der håndhæves

- **Ingen rå identitetsheader.** `x-spiffe-id`, `x-forwarded-user` m.fl. fjernes
  ved ingress og ignoreres af tjenesten. Forfalskning giver 401.
- **Workload-identitet** kræver et mTLS-SVID i trust domain eller en
  HMAC-signeret assertion fra en betroet proxy-adresse.
- **Ingen direkte adgang uden om gatewayen.** En tjeneste konfigureret uden OIDC
  afviser et direkte `Authorization: Bearer`-token; den accepterer kun gatewayens
  signerede principal-assertion.
- **Nøglerotation.** Et ukendt `kid` udløser et JWKS-genindlæs; en nøgle, der
  stadig er ukendt, afvises.
- **Sessioner** er signerede cookies med `HttpOnly; Secure; SameSite=Strict`.
  Cookie-baserede writes kræver et CSRF-token bundet til sessionen.
- **Inputgrænser og rate limits.** For store bodies giver 413; for mange requests
  giver 429; cross-origin writes giver 403.
- **Demo-shim** kræver `profile: "test"` og kan ikke starte i produktionsprofil.

## Operatørnoter

- Sæt `--profile production` (standard). Brug kun `--profile test --demo <id>` i
  isolerede tests.
- Angiv betroede proxy-adresser med `--trusted-proxy <ip>` og del hemmeligheden
  med `--proxy-secret` (læs den fra en secret, ikke fra kommandolinjen i drift).
- OIDC konfigureres med `--issuer`, `--audience`, `--jwks` og `--tenant`.

## Kør

```bash
make identity-test   # tests: JWT, workload, session, HTTP-pipeline
make gateway-test    # inkl. ingress-test
```

Verifikation skal udføres af en separat verifier; lokale tests er ikke uafhængig
verifikation.
