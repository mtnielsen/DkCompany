# Identitetsplanen

**Kontrakt:** [`contracts/identity.schema.json`](../../contracts/identity.schema.json)
**Backlog:** 0.2

## Formål

Enhver principal — menneske, service eller agent — skal have én identitet, der kan føres tilbage til en kilde uden for modulet. Moduler er *forbrugere* af identitet, ikke ejere af den.

## Den hårde regel

> Intet modul har egen brugerdatabase.

Reglen er ikke en retningslinje. Den håndhæves i skemaet:

```json
"userStore": { "const": "none" }
```

Enhver anden værdi (`"local"`, `"embedded"`, `"sqlite"`, …) får `make validate` og `make conform` til at fejle. Se `modules/dummy-broken/module-manifest.json` for et eksempel på et manifest, der afvises.

## De tre protokoller

| Protokol | Rolle | Krav |
| --- | --- | --- |
| OIDC | Autentifikation af mennesker og tjenester | HTTPS issuer, PKCE, eksplicit claim-mapping |
| SCIM 2.0 | Provisionering af brugere og grupper | version `2.0`, endpoint, `mode` (`provider`/`consumer`) |
| SPIFFE | Workload-identitet | `spiffe://`-ID, trust domain, just-in-time credentials |

### OIDC

- `issuer` skal være HTTPS.
- `claimMapping` binder `sub`, `email`, `groups` og `tenant` til de claims, IAM-udstederen faktisk sender.
- `tokenAudience` sættes, så et token udstedt til ét modul ikke kan bruges mod et andet.

### SCIM 2.0

- `mode: consumer` betyder, at modulet modtager brugere fra central IAM.
- `mode: provider` er forbeholdt IAM-moduler, der selv er kilde.
- Modulet må ikke opfinde sit eget bruger-API ud over SCIM.

### SPIFFE

- `credentialMode` er låst til `just-in-time`. Stående rettigheder er forbudt.
- `maxCredentialTtlSeconds` er højst 3600; default 900.
- `trustDomain` skal matche `spiffeId`. Konformanssuiten kontrollerer det eksplicit.

## Acceptkriterier (0.2)

- [x] Spec (dette dokument) og JSON Schema for `identity`-blokken.
- [x] Konformanstest afviser modul med lokal user store (`C-005`, verificeret mod `dummy-broken`).
