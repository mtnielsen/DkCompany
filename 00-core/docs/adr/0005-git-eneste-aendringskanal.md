# ADR-0005: Git er den eneste ændringskanal

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2025-09-01
- **Beslutningsdrev:** NIS2 kræver en komplet, uforfalsket change log, og agenter må ikke have en genvej uden om governance.

## Kontekst og problemstilling

Når både mennesker og agenter ændrer produktion, er spørgsmålet ikke om ændringer sker, men om de kan føres tilbage til en beslutning. Hvis en agent (eller et menneske) kan ændre klyngen direkte med `kubectl`, findes ændringen ikke i nogen log, og der er ingen forskel på en lovlig ændring og drift.

Samtidig skal en agent ikke have en anden vej end mennesket. "Alt går gennem git" er kun sandt, hvis det gælder begge.

## Beslutningskriterier

- Enhver ændring skal kunne føres tilbage til en commit og en beslutning.
- Ændringer uden om git skal aktivt fjernes, ikke bare registreres.
- Historikken skal kunne udtrækkes maskinlæsbart til revision (NIS2).
- Løsningen må kunne testes uden en klynge i CI.

## Overvejede muligheder

- **Push-baseret deploy (`kubectl apply` fra CI).** Simpelt, men ingen løbende håndhævelse; drift opdages ikke.
- **Argo CD uden selfHeal.** Registrerer drift, men lader den bestå.
- **Argo CD med selfHeal + prune.** Git er sandheden; drift føres tilbage.
- **Ingen GitOps; agenten kalder API'er direkte.** Uforeneligt med governance.

## Beslutning

Vi vælger Argo CD med `selfHeal` og `prune`, og repræsenterer ønsket tilstand som Kubernetes-ressourcer i JSON under `gitops/manifests/<env>/`. CI håndhæver at:

- hvert modul har en Application og en Deployment i git (`G-001`),
- images er pinnet på digest (`G-002`),
- hardening og labels er på plads (`G-003`, `G-005`),
- PDP'en kører fail-closed på den signerede bundle (`G-006`).

Et reconcile-værktøj demonstrerer i CI, at drift uden om git (`revert`/`create`/`delete`) opdages og føres tilbage. Git-historikken udtrækkes som maskinlæsbar change log med DCO-sign-off.

## Konsekvenser

- **Positive:** Samme vej for mennesker og agenter. Drift er en fejl, ikke en tilstand. Historikken kan revideres maskinelt.
- **Negative:** Flere trin for en hurtig hotfix. Vi accepterer det: en hotfix uden om git er præcis det, NIS2 og governance ikke tillader.
- **Neutrale:** Testene kører uden en klynge, fordi ønsket og observeret tilstand er data. En rigtig Argo CD-installation er en deployment-opgave, ikke en kontraktændring.

## Mere information

- [`docs/spec/gitops.md`](../spec/gitops.md)
- [`gitops/`](../../gitops)
- [ADR-0002](0002-monorepo-og-raekkefoelge.md)
