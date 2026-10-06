# ADR-0014: OIDC til mennesker, verificeret workload-identitet til tjenester og lokalt skygge-ID uden passwords

- **Status:** accepteret
- **Beslutningstagere:** Gitte Gundersen (Security Owner)
- **Dato:** 2026-09-23
- **Beslutningsdrev:** Identitet er den kontrol, alle andre kontroller hviler på. Uden én tillidsmodel opfinder hvert modul sin egen brugerdatabase og sit eget token-format.

## Kontekst og problemstilling

Platformen har mennesker (brugere, godkendere, operatører) og tjenester (agenter, moduler, job). Nogle upstreams (fx Mattermost eller en ældre app) kræver en lokal brugerrække, selv om den centrale identitet er OIDC. Hvis svaret er "en lokal database med passwords", er identitetsplanens hårde regel brudt, og offboarding kan ikke bevises.

Samtidig er et token uden tenantbinding tvetydigt: hvilken kunde handler aktøren for? Et ukendt trust root må ikke accepteres, bare fordi et system præsenterer et gyldigt-udseende token.

## Beslutningskriterier

- Mennesker autentificeres gennem OIDC med MFA og PKCE.
- Tjenester autentificeres med verificeret workload-identitet og kortlivede credentials.
- Lokale skygge-ID'er må ikke eje et password.
- Ukendte trust roots og tvetydig identitet skal afvises, ikke gættes.
- Nødadgang skal virke, når IAM/kontrolplanen er nede, og være auditeret.

## Overvejede muligheder

- **Lokale brugere og passwords i hvert modul.** Enkelt pr. modul, men bryder identitetsplanen og gør offboarding ubeviseligt.
- **Ét delt servicekonto-token på tværs af tjenester.** Nemt, men ophæver workload-identitet og mindste privilegium.
- **OIDC + SPIFFE + passwordfrit skygge-ID, med eksplicit trust-root-liste og afvisning af tvetydighed.** Flere komponenter, men hver grænse kan testes.

## Beslutning

Vi gør følgende, og håndhæver det i `identity-trust.schema.json` og `conformance/src/architecture.mjs`:

1. `userAuthentication.protocol` er `oidc`, `mfa` er `required` eller `risk-based`, og `pkceRequired` er `true`.
2. `workloadIdentity.protocol` er `spiffe`, `credentialMode` er `just-in-time`, og TTL er afgrænset (60–3600 sekunder).
3. `shadowIdentity` må kun være aktiveret med `passwordMode: "none"`, `localPasswordStore: false`, navngivne `upstreams`, en begrundelse og en livscyklus. Et skygge-ID med password afvises.
4. `trustRoots` er den udtømmende liste. Den OIDC-issuer og det SPIFFE trust domain, der bruges, skal stå på listen med en navngivet menneskelig ejer. Ukendt root afvises.
5. `tenantBinding` kræver et tenant-claim, som ikke må være identisk med subject-claimet, og `clientSelectable` er `false`. `ambiguityPolicy` er `reject`.
6. `breakGlass` er en auditeret, navngiven menneskelig procedure med offline-instruktioner.

Kontrakten er versioneret (`apiVersion: contracts.platform/v1alpha1`) og valideres i `make validate`/`make architecture-test`.

### Konsekvenser

- **Positive:** Offboarding kan følges fra centrale identitet til hvert upstreams skygge-ID. Ukendte og tvetydige identiteter stopper i CI, ikke i produktion.
- **Negative:** Adaptere til upstreams uden SCIM/OIDC kræver mere arbejde, fordi skygge-ID'ets livscyklus skal bygges. Nødadgang skal vedligeholdes og øves.
- **Neutrale:** Selve OIDC-udbyderen og SPIFFE-implementeringen er ikke valgt her; det afgøres af senere opgaver.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| Lokale passwords pr. modul | Enkelt | Bryder identitetsplanen, ubeviselig offboarding |
| Delt servicekonto-token | Nemt | Ingen workload-identitet, ingen mindste privilegium |
| OIDC + SPIFFE + passwordfrit skygge-ID | Testbare grænser | Flere komponenter og adapterarbejde |

## Mere information

- `contracts/identity-trust.schema.json`
- `conformance/src/architecture.mjs` (`identityTrustProblems`)
- `conformance/test/architecture.test.mjs` og negative fixtures i `conformance/test/fixtures/architecture/`
- [ADR-0013 — deployment- og tenantmodel](0013-deployment-og-tenantmodel.md)
