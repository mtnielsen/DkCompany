# Runbook: ren installation og genoptagelse (DKC-054)

Formålet er at gennemføre en ren installation ud fra dokumentationen — uden
manuelle database- eller manifestredigeringer — og at genoptage en afbrudt
installation sikkert.

## 0. Forudsætninger

- En værtsmaskine med en OS-version fra den navngivne Linux-LTS-matrix
  (`catalog/platforms.json`).
- Et eksplicit host-scope i `configuration/host-scope.json` med navngivet ejer.
- Den ønskede tilstand i `configuration/desired-state.json`, autoriseret af et
  navngivet menneske.
- `configuration/dev-keyring.json` erstattet af en rigtig KMS/HSM-nøgle
  (udviklingsnøglen er en offentlig testfixture).

## 1. Validér konfigurationen

```sh
make configuration-check
make configuration-preview      # ønsket vs. faktisk tilstand og drift
```

En valideringsfejl stopper installationen før mutation. Hemmeligheder optræder
aldrig i previewet.

## 2. Kør preflight

```sh
make installer-preflight
```

Preflighten er read-only. Den afviser ikke-understøttede OS-versioner,
diskformatering, overtagelse af et eksisterende databaseskema, host-OS-ændring
uden konkret scope, fri root til agenter og en manglende recoverykonsol. Er
`ok: false`, rettes scopet — ikke preflighten.

## 3. Byg og signér planen

```sh
make installer-plan
```

Planen viser preflight-resultatet, de idempotente trin, restriktionerne
(`formatDisks`, `adoptExistingSchema`, `changeHostOs` = `false`) og
diagnostikken. Signaturen dækker hele indholdet; en ændret plan afvises.

## 4. Udfør og genoptag

Hvert muterende trin kræver et scoped, menneskeligt godkendt operationsticket.
Tilstanden skrives atomisk efter hvert trin. Afbrydes installationen:

```sh
# status viser sidste fuldførte trin og de resterende
node installer/src/cli.mjs status
# genoptagelse springer fuldførte trin over og kræver samme plan-digest
node installer/src/cli.mjs plan        # samme digest
# ... godkend de resterende muterende trin og genoptag gennem den valgte executor
```

En genoptagelse med en **anden** plan-digest nægtes; en ændret plan må ikke køre
oven på et gammelt forløb.

## 5. Verificér

Installationen er først færdig, når `verify`-trinnet er fuldført, og den
faktiske tilstand matcher den ønskede (`make configuration-preview` viser ingen
drift). En grøn preflight eller signatur er ikke en gennemført installation.

## Forventet adfærd ved fejl

- **Preflight-fejl:** intet muteres; scopet eller OS-versionen rettes.
- **Afbrudt kørsel:** genoptagelse er idempotent; fuldførte trin gentages ikke.
- **Diagnostik med hemmelighedssignatur:** bundlen nægtes (`SECRET_LEAK`) og
  redigeres — den skjules ikke.
- **En levende værtsmaskine i produktion:** kræver ekstern infrastruktur og et
  navngivet menneskes godkendelse (`integration-installer-live`, NOT RUN her).
