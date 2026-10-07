# Menneskestyret change og runbookgodkendelse

DKC-045. Forhåndsgodkendt selvreparation skal være **lige så præcist
autoriseret** som en enkelt ændring. En runbook er ikke en fri vejledning: den
er den kontrakt, en forhåndsgodkendt handling må udføre inden for, og den
menneskelige godkendelse bindes til præcis den version og det scope, der
faktisk eksekveres.

## Runbooken

En runbook (`contracts/runbook.schema.json`) indeholder:

| Felt | Betydning |
| --- | --- |
| `scope` | Hvilke verber, mål, miljøer og kunder der er dækket. Lukket matchning. |
| `parameters.schema` + `parameters.limits` | Lukket JSON-skema for parametre samt eksplicitte maksima. |
| `preconditions` | Checks der skal være opfyldt, før noget planlægges. |
| `maxImpact` | Blast radius, maks. antal mål, kundesynlighed og maks. varighed. |
| `expiry` | Hvornår godkendelsen blev givet, udløber, og hvor gammel den må blive. |
| `attempts` | Maks. antal forsøg inden for et tidsvindue. |
| `rollback` | Metode og om den er testet. `tested` skal være `true`. |
| `postchecks` | Checks efter handlingen; fejl ruller tilbage eller eskalerer. |
| `approval` | Flow (`standard`/`normal`/`emergency`), godkendelseskrav og grupper. |
| `signature` | HMAC-SHA256 over det kanoniske indhold undtagen signaturfeltet. |

Signaturen beregnes af `approvals/src/runbook.mjs`. En manglende, ukendt eller
tilbagekaldt nøgle afvises, og en runbook uden gyldig signatur må ikke
eksekveres. I produktion leveres nøglen af KMS/HSM; i test og demo af et
injiceret nøglesæt (`runbooks/dev-keyring.json`, syntetisk).

## De tre flows

| Flow | Autorisation | Hvornår |
| --- | --- | --- |
| `standard` | Én menneskelig **pre-approval** bundet til runbook-digesten. | Kendte, lave ændringer inden for et lukket scope. |
| `normal` | En konkret, ændringsbundet **godkendelse pr. mutation**. | Alt uden en gyldig pre-approval. |
| `emergency` | En **særskilt**, tidsbegrænset menneskelig autorisation. | Incidenter hvor ventetid er uacceptabel. |

Fælles for alle tre:

- En pre-approval oprettes kun, hvis en rigtig godkendelsesanmodning er
  `approved`, mergeable og bundet til **netop** runbook-digesten. En `pending`,
  `expired` eller `no-objection`-beslutning bliver aldrig en pre-approval.
- En ny runbookversion eller et større scope har en ny digest og kræver derfor
  en ny godkendelse.
- Emergency kan ikke ophæve A4 eller AI-immutable: runtimens uafhængige
  klassifikation og beskyttelsesguard kører, før runbook-resolveren overhovedet
  kaldes.

## Server-side resolver

Runtimen kalder `createChangeService().resolve(...)` med `runbookRef`, verbum,
mål, miljø, kunde og parametre. Resolveren:

1. slår den registrerede, signerede runbookversion op,
2. verificerer signaturen og de semantiske krav,
3. håndhæver scope, parametre og forudsætninger,
4. tjekker vedligeholdelsesvindue og konflikter,
5. afgør flowet og om der kræves en godkendelse,
6. sætter **digesten server-side** — en klientmedsendt digest ignoreres.

For en dækket standard-change tages låsen med det samme. For en normal/emergency
tages låsen først i `commit`, efter den menneskelige autorisation er verificeret,
så en afvist godkendelse ikke holder låsen.

## Change-kalender og låse

`approvals/src/change-calendar.mjs` rummer vedligeholdelsesvinduer,
konfliktregistrering og en atomisk lås pr. mål. Låsen kan holdes i hukommelsen
(én resolver-proces) eller i et filbaseret lager, hvor `open(..., 'wx')` giver
gensidig udelukkelse mellem processer. To samtidige changes på samme ressource
kan derfor ikke begge komme forbi.

## Postchecks og rollback

Efter handlingen kører `finalize(...)` runbookens postchecks. En fejlende
postcheck med `onFailure: "rollback"` udfører den testede rollback og markerer
changen `rolled_back`; ellers eskaleres den. Låsen frigives altid.

## Grænser

- En rigtig KMS/HSM-signeringsnøgle er en ekstern integration (NOT RUN).
- En fler-node, distribueret låsetjeneste er en ekstern integration; den
  filbaserede lås er sand mod flere processer på samme host.
- Runbook-resolveren erstatter ikke PDP'en: en forhåndsgodkendt runbook fjerner
  kun *den menneskelige godkendelse pr. mutation*, ikke policykontrollen.

## Checks

```bash
make runbook-check   # skema + signatur + flow-semantik
make runbook-test    # approver + runtime + konformans
```
