# Pilotforløb og readiness

Pilotforløbet (DKC-033) beviser den fælles kerne for tre virksomhedsprofiler og
afgør, om platformen er klar til at gå videre. Det er en særskilt kontrol oven på
installations- og releaseacceptancen (DKC-062): acceptancen svarer på, om en
installation kan gennemføres; piloten svarer på, om de faktiske virksomhedstyper
kan gennemføre deres kritiske arbejdsgange, og om den nødvendige evidens faktisk
findes.

## Virksomhedsprofiler

`pilot/business-profiles.json` definerer tre repræsentative, syntetiske profiler:

| Profil | Segment | Medarbejdere | Installation | Tenant |
| --- | --- | ---: | --- | --- |
| `smv` | `smv` | 18 | `small-vps` | `globex` |
| `it-service` | `service` | 120 | `ha-cluster` | `acme` |
| `enterprise` | `enterprise` | 900 | `enterprise-dedicated` | `initech` |

Hver profil har roller (menneskelige, tjeneste- og agentroller), et
integrationsbehov med en ærlig tilgængelighed (`included`, `opt-in`,
`unavailable`) og de seks kritiske arbejdsgange. En utilgængelig integration —
fx et dansk økonomimodul før DKC-035 — skal have en begrundelse og må ikke
fremstilles som fungerende.

## Kritiske arbejdsgange

`pilot/pilot-scenarios.json` har 18 scenarier (tre profiler × seks
arbejdsgange). Hvert scenarie har et forventet udfald, en kørende `runner` og en
navngivet menneskelig ejer:

| Arbejdsgang | Runner | Faktisk mekanisme |
| --- | --- | --- |
| `login-offboarding` | `login-offboarding` | `identity`-tenantkontekst og `feature-access`-offboarding af alle fem rettighedsklasser |
| `daily-work` | `daily-work` | `feature-access`-feltadgang, tenant-scoped ressource og `approvals`-binding |
| `restore` | `restore` | `backup` krypteret backup og isoleret gendannelse med målt RPO/RTO |
| `privacy-case` | `privacy-case` | `privacy` holdbar DSAR-sag, fan-out, sikret eksport og indløsning |
| `upgrade` | `upgrade` | `installer` livscyklus med signeret opdateringsplan og menneskelig godkendelse |
| `exit` | `exit` | `migration` selvbeskrivende exit-eksport der kan læses uden platformen |

Scenarierne muterer kun i midlertidige arbejdstræer. Opgraderingen bruger den
profilscopede del af release-låsen (de komponenter profilen faktisk kører), så
en profils valgfrie apps ikke tvinges ind.

## Readiness-aggregatoren

`pilot/readiness-policy.json` definerer de krævede gates. Hver gate angiver sine
evidenskilder og fejler lukket:

| Gate | Slags | Evidens |
| --- | --- | --- |
| `security` | fælles | sikkerhedsvurderingens gate (DKC-065) og uafhængige vurderinger |
| `quality` | fælles | de kørebare pilotscenarier og testmatricen |
| `recovery` | fælles | recovery-rapporten og restore-arbejdsgangene |
| `human-assessment` | fælles | uafhængige vurderinger og kundeaccept-registeret |
| `ha` | profil | HA-plan og serviceklasser; kun aktiv for den erklærede HA-profil |
| `cost` | fælles | omkostningsrapporten |
| `observation` | fælles | 30-dages observationsregisteret |

Reglerne er:

- **`ready`** kræver, at hver aktiv, obligatorisk gate er `passed`. En enkelt
  `pending`, `not-run` eller `failed` giver `not-ready`.
- En **manglende** evidenskilde giver `not-run`; en **udestående** giver
  `pending`; en fejlende arbejdsgang giver `failed`.
- HA-målet gælder **kun** den erklærede HA-profil. En single-server-profil
  markerer gaten `not-applicable`.
- Den **30-dages observation** og **kundeaccepten** er særskilt registrerede
  begivenheder. En deterministisk kørsel kan hverken forkorte eller simulere
  dem.

## Abuse- og belastningsprober

`pilot/src/scenarios.mjs` indeholder:

- en **approval-bypass**-probe: en ændret parameter eller et nyt mål efter
  godkendelsen ændrer bindingen og afvises,
- en **tenant-isolation**-probe: krydskunde-kontekst og klientleverede
  tenant-headere afvises,
- en **injection**-probe: ubetroet indhold scannes og adskilles, så det ikke
  bliver til en handling, og
- en **afgrænset belastningstest**: et fast antal iterationer med en fast
  samtidighedsgrad, der tæller fejl og omgåelser. Det er ikke en målt
  produktionsbelastning.

## Rapport og evidens

- `pilot/report/pilot-readiness-report.json` er den maskinlæsbare rapport.
- `docs/pilot/readiness-report.md` er den menneskelæsbare gengivelse.
- Rapporten er deterministisk (`generatedAt` er fast) og skrives af
  `make pilot-render`; `make pilot-check` afviser en rapport ude af trit.

## Grænser og ærlighed

Den committede rapport er `not-ready`, fordi sikkerhedsvurderingen er
udestående, kundeaccepten er tom, og observationen er 0/30 dage. RPO/RTO og
omkostning er målt/modelleret pr. profil, men `measured` er `false`: der findes
ingen levende serviceprofil i dette miljø. `integration-pilot-live` er NOT RUN.
