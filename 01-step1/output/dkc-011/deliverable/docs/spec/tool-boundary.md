# Værktøjsgrænse og injection-forsvar (DKC-011)

Reglen: **sikkerheden holder, selv når modellen følger en ondsindet instruktion.**
Det gør den, fordi ubetroet indhold er data, og fordi den eneste eksekverbare
enhed er et servervalideret, typet værktøjskald. Regex og decoding er et
*ekstra signal* — ikke en adgangskontrol.

## To adskilte lag

| Fil | Ansvar |
| --- | --- |
| `runtime/src/untrusted.mjs` | Pak ubetroet indhold i fryset konvolutter; adskil det fra den eksekverbare kerne; marker model-output som ubetroet uanset gyldig JSON |
| `runtime/src/tools.mjs` | Allowlist af typede værktøjer; servervalidering af verbum, parametre, størrelsesgrænse, forbudte navne og udgående netværk |
| `runtime/src/injection.mjs` | Flersproget signal-scanner med decoding (dansk, engelsk, base64, hex, rot13, unicode, HTML, procent) |
| `runtime/src/runtime.mjs` | Kalder kun validerede værktøjer; `runProposedTask` behandler model-output som et forslag |
| `runtime/test/fixtures/injection-corpus.json` | Vedvarende angrebskorpus fra logs, dokumenter, mails, tool-output og model-output |
| `runtime/src/tool-check.mjs` | `make tool-boundary-check`: validerer allowlist, egress og korpusdækning |

## Ubetroet indhold er data

`createUntrustedContent({ kind, source, text, encoding, tenantId, modelRef })`
returnerer et fryset objekt med `__untrusted: true` og `executable: false`.
`separateUntrusted(action)` læser den eksekverbare kerne (`verb`, `target`,
`environment`, `parameters`, `tool`, …) og de ubetroede konvolutter hver for
sig. Fordi de læses fra hver sit sted, kan indholdet ikke overskrive kaldyten.

`parseModelOutput(raw)` parser model-output og **markerer det altid som
ubetroet** — også når JSON er gyldig. `buildTaskFromProposal` kopierer kun
`actions` ind i et task-forslag; identitet, kunde, `agentRef` og opgavens id
kommer fra serveren. Runtimen validerer derefter hvert kald. `runProposedTask`
er indgangen.

## Servervaliderede typed tools

`TOOL_REGISTRY` er allowlisten. Hvert værktøj har:

- `name` — stabilt værktøjsnavn,
- `verbs` — de ops-verber værktøjet må udføre,
- `params` — et deklarativt typeskema (type, `enum`, `pattern`, længder,
  intervaller, `required`, `additionalProperties`, `maxProperties`, `maxBytes`),
- `maxInputBytes` — grænse for de serialiserede parametre,
- `egress` — `{ network, allowedSchemes, allowedHosts }`.

`validateToolCall({ verb, tool, params, target, tenantId })` afviser:

- værktøjer uden for allowlisten og verber uden et typet værktøj,
- shell-/eval-verber (`shell.exec`, `bash`, `os.system`, `subprocess.spawn`, `eval`),
- secret-hentende verber (`fetch-secret`, `get.token`, `read-credential`, `export.apikey`) — men ikke `rotate-credential`,
- parametre der ikke matcher typeskemaet,
- farlige parameternavne rekursivt (`shell`, `command`, `cmd`, `exec`, `eval`, `token`, `secret`, `password`, `private_key`, …),
- parametre over størrelsesgrænsen,
- URL-parametre i netværksløse værktøjer.

Et deklareret, men ukendt ops-verbum får en konservativ generisk type uden
egress. Nye verber bør få et rigtigt typet værktøj.

## Udgående netværk

`validateEgress` gælder kun netværksskemaer (`http(s)`, `ftp(s)`, `ws(s)`,
`gopher`, `file`). `kms://`, `spiffe://` og `res://` er interne referencer.
Den afviser:

- skemaer uden for værktøjets `allowedSchemes` (fx `http`),
- værter uden for `allowedHosts` (eksakt eller `*.suffix`),
- metadata-adresser (`169.254.169.254`, `metadata.google.internal`, `fd00:ec2::254`),
- loopback (`localhost`, `127.0.0.1`, `::1`) og private net (`10.`, `172.16-31.`, `192.168.`, `100.64-127.`, `fc00::/7`, `fe80::/10`).

Et tenant-felt i parametrene (`tenantId`, `tenant`, `customerId`,
`destinationTenant`, …) må ikke pege på en anden kunde end den aktive, og
`crossTenant: true` afvises.

## Angrebskorpus

`runtime/test/fixtures/injection-corpus.json` indeholder tilfælde med
`language` (`da`, `en`, `mixed`, `encoded`), `vector` (`log`, `document`,
`email`, `tool-output`, `model-output`), `encoding`, `category`, `expect` og
`text`. Kategorierne er `ignore-instructions`, `role-override`,
`autonomy-change`, `self-approve`, `secret-exfiltration`, `shell-execution`,
`destructive`, `unauthorized-egress`, `cross-tenant`, `indirect` og
`tool-call-forgery`.

`make tool-boundary-check` kræver dækning af sprog, vektorer, kodninger og
kategorier, og at hvert tilfælde klassificeres som forventet.

## Reviewer og autonomi

Revieweren er en `verifier`-rolle. Den kan kun returnere `no-objection`,
`flag` eller `reject`; et `approve` eller et `autonomyClass`-felt afvises, og
`reviewerMayApprove` er altid `false` (se ADR-0007 og ADR-0020). DKC-011
gentester det i `conformance/test/tool-boundary-conformance.test.mjs`.

## Acceptkriterier

- [x] Danske, engelske, kodede og indirekte instruktioner kan ikke udvide rettigheder.
- [x] Secret-hentning, fri shell, uautoriserede URL'er og cross-tenant datamovering afvises.
- [x] Revieweren kan ikke godkende eller hæve autonomi.
- [x] Model-output behandles som ubetroet, også ved korrekt JSON.

## Kør

```bash
make tool-boundary-check   # allowlist, parametre, egress og korpusdækning
make tool-boundary-test    # typed tools, injection-korpus, model-output, konformans
make runtime-test          # hele runtimen
make validate              # kontraktskemaer og eksempler, inkl. tool-call
```

Verifikation skal udføres af en separat verifier; lokale tests er ikke
uafhængig verifikation.
