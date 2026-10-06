# ADR-0023: Ubetroet indhold adskilles fra servervaliderede, typede værktøjskald

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-011. Runtimen erklærede allerede, at et ukendt verbum betød "ingen fri shell", men beskyttelsen mod prompt-injection var et lille regex, der eskalerede når det matchede. Et ondsindet input, der formulerede sig uden om mønstret — eller som gyldig JSON — kunne derfor i princippet nå en executor. Der manglede en arkitektonisk grænse mellem *ubetroet data* og *eksekverbare værktøjskald*, og der manglede servériske typed tools med parametre, størrelsesgrænser og udgående netværksregler.

## Kontekst og problemstilling

Runtimens sikkerhedsmodel havde to sammenblandede lag:

- **Detektion.** `runtime/src/injection.mjs` scannede fritekst med seks engelske regex'er. Regex er hverken nødvendigt eller tilstrækkeligt: det fanger kendte formuleringer og overser kodede, danske og indirekte instruktioner — og et negativt svar blev behandlet som en tilladelse til at fortsætte.
- **Grænsen.** Der fandtes ikke et deklarativt, typet værktøjslag. Enhver executor fungerede som et ops-verbum uden validerede parametre, uden størrelsesgrænse og uden egress-regler. `action.parameters` blev sendt videre ufortolket.

Samtidig behandlede intet lag model-output systematisk som ubetroet: modellen kunne returnere gyldig JSON med et felt der lignede et værktøjskald, og det blev læst som om det var en betroet kommando.

## Beslutningskriterier

- Ubetroet indhold (logs, dokumenter, mails, tool-output, model-output) er data og kan **aldrig** selv blive et eksekverbart kald.
- Et værktøjskald skal servervalideres: allowlist, verbum-binding, parametertyper, størrelsesgrænse og udgående netværksregler.
- Regex/decoding er kun et **ekstra signal**, ikke en adgangskontrol. Sikkerheden må ikke afhænge af at et mønster matches.
- Danske, engelske, kodede og indirekte instruktioner må ikke kunne udvide rettigheder.
- Secret-hentning, fri shell, uautoriserede URL'er og cross-tenant datamovering afvises.
- Revieweren kan ikke godkende eller hæve autonomi.
- Model-output behandles som ubetroet, også når JSON er gyldig.

## Overvejede muligheder

- **Flere/bedre regex'er.** Skalerer ikke; overser kodninger og nye sprog, og et negativt svar ville stadig være en tilladelse.
- **Kun PDP/A4.** Fanger privilegieændringer, men ikke fri shell, uautoriserede URL'er eller cross-tenant datamovering i parametre.
- **Arkitektonisk adskillelse + typet værktøjsgrænse + korpus som signal.** Kræver nye moduler og kontrakter, men gør sikkerheden uafhængig af detektion.

## Beslutning

1. **Ubetroet indhold er en konvolut.** `runtime/src/untrusted.mjs` pakker alt ikke-betroet indhold i et fryset `{ __untrusted: true, executable: false, kind, source, text, encoding, sha256, … }`. `separateUntrusted(action)` returnerer den eksekverbare kerne og konvolutterne hver for sig; indholdet kan ikke overskrive verbum, mål eller parametre. `parseModelOutput` markerer model-output som ubetroet uanset om JSON er gyldig.
2. **Servervaliderede, typede værktøjer.** `runtime/src/tools.mjs` er en allowlist af typede værktøjer (`observe.read`, `propose`, `upgrade.dry-run`, `upgrade.apply`, `credential.rotate`, `backup.restore`, `subject.privacy`). `validateToolCall` kræver at værktøjet er på listen, at verbet er bundet til netop det værktøj, at parametrene matcher typeskemaet, at den serialiserede størrelse er under grænsen, at farlige parameternavne (`shell`, `command`, `token`, `password`, …) ikke optræder, og at udgående netværk følger egress-allowlisten. Shell-/eval-verber og secret-hentende verber afvises uanset manifest.
3. **Udgående netværk og tenant-adskillelse.** `validateEgress` afviser netværksløse værktøjers URL-parametre og afviser uautoriserede værter, `http`, metadata-adresser (`169.254.169.254`, `metadata.google.internal`), loopback og private net. Et tenant-felt i parametrene må ikke pege på en anden kunde end den aktive.
4. **Runtimen kalder kun validerede værktøjer.** `createAgentRuntime` bygger en `toolBoundary` (default hele allowlisten) og validerer hvert kald efter A4/scope/rolle og før executor. `runProposedTask` tager model-output, markerer det ubetroet og lader kun `actions` blive et *forslag*, som møder den fulde grænse. Identitet, kunde og agentRef kommer fra serveren.
5. **Flersproget angrebskorpus som signal.** `runtime/src/injection.mjs` scanner dansk, engelsk, kodede (base64, hex, rot13, unicode-escape, HTML-entities, procent) og indirekte instruktioner fra logs, dokumenter, mails, tool-output og model-output. Resultatet er et signal der eskalerer til et menneske, ikke en tilladelse. `runtime/test/fixtures/injection-corpus.json` er den vedvarende korpus, `runtime/src/tool-check.mjs` validerer dens dækning.
6. **Kontrakt.** `contracts/tool-call.schema.json` beskriver det typede kald; `agent-task`- og `agent-manifest`-skemaerne får `tool`/`untrustedContext`.

## Konsekvenser

- **Positive:** Et injektionsforsøg kan ikke udvide rettigheder, uanset formulering, sprog eller kodning, fordi grænsen er strukturel. Fri shell, secret-hentning, uautoriserede URL'er og cross-tenant trafik afvises i selve kaldet. Model-output er ubetroet pr. konstruktion.
- **Negative:** Eksisterende ops-verber uden et typet værktøj falder tilbage til en konservativ generisk værktøjstype uden egress. Nye verber bør få et typet værktøj i allowlisten.
- **Neutrale:** `injection.mjs` skifter fra `scanUntrusted(string)` til også at eksponere `scanAll`/`decodeVariants`, men bevarer den gamle signatur. Runtimen får en `toolBoundary`-option og `runProposedTask`.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| Flere regex'er | Lille ændring | Overser kodninger/sprog; negativt svar = tilladelse |
| Kun PDP/A4 | Genbruger eksisterende kontrol | Fanger ikke shell, egress eller cross-tenant |
| Arkitektonisk grænse + typede værktøjer + korpus | Uafhængig af detektion; dækker alle acceptkrav | Nye moduler, kontrakt og check |

## Mere information

- [`docs/spec/tool-boundary.md`](../spec/tool-boundary.md)
- [`runtime/src/tools.mjs`](../../runtime/src/tools.mjs), [`runtime/src/untrusted.mjs`](../../runtime/src/untrusted.mjs), [`runtime/src/injection.mjs`](../../runtime/src/injection.mjs)
- [`runtime/test/fixtures/injection-corpus.json`](../../runtime/test/fixtures/injection-corpus.json), [`runtime/src/tool-check.mjs`](../../runtime/src/tool-check.mjs)
- [`contracts/tool-call.schema.json`](../../contracts/tool-call.schema.json)
- [ADR-0007](0007-evidens-og-prosa-adskilt.md), [ADR-0018](0018-stram-policy-scope-og-evidenkontrol.md), [ADR-0020](0020-en-rolle-pr-agent.md), [ADR-0022](0022-rettigheder-og-noedstop.md)
