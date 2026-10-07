# Forretningskonsekvensanalyse (BIA) og kontinuitetsansvar

**Ejer:** Anna Andersen (Platform Owner) · **Stedfortræder:** Bo Bertelsen
**Menneskelig beredskabs-/kontinuitetsejer:** Bo Bertelsen (`oidc|bo.bertelsen`)
**Sidst opdateret:** 2026-09-23 · **Dækker:** DKC-037

BIA'en er grundlaget for hver serviceklasses mål. Den beskriver de kritiske
brugerflows, deres afhængigheder, hvem der ejer dataene, og hvem der bærer
beredskabsansvaret. Uden den er RPO/RTO-tal ikke andet end tal.

> **Vigtigt:** BIA'en fastlægger *hvilke* mål der giver mening. Målene er først
> en forpligtelse, når et navngivet menneske har vedtaget dem i serviceklassens
> `serviceCommitment`. En konfigurationspost eller denne tekst certificerer
> ikke et målt serviceniveau.

## Kritiske brugerflows

| Flow | Beskrivelse | Kritikalitet | Afhængigheder | Dataejer |
| --- | --- | --- | --- | --- |
| F1 | Logge ind og få adgang til platformen | Kritisk | IAM/Keycloak-adapter, portal, PDP | Anna Andersen |
| F2 | Se og handle på en godkendelsesanmodning | Kritisk | Approval-service, audit-log, PDP | Anna Andersen |
| F3 | Udføre et ops-verbum (backup, upgrade, restore) med fuld sporbarhed | Kritisk | Audit-service, dummy-ok, kø, storage | Anna Andersen |
| F4 | Sende og modtage en besked via Mattermost | Høj | Mattermost-adapter, Mattermost-instans | Cecilia Christensen |
| F5 | Behandle en DSAR (indsigt/sletning) | Høj | Audit-service, dummy-ok, PDP, kø | Anna Andersen |
| F6 | Læse drifts- og revisionssporet | Høj | Audit-service, observability | Anna Andersen |

## Afhængigheder og menneskelige ejere

| Komponent | Afhænger af | Kontinuitetsejer (menneske) |
| --- | --- | --- |
| `audit-service` | PostgreSQL, object storage, kø, PDP | Bo Bertelsen |
| `dummy-ok` | PostgreSQL, offsite backup | Bo Bertelsen |
| `mattermost-adapter` | PostgreSQL, Mattermost-instans (ekstern) | Cecilia Christensen |
| `keycloak-adapter` | PostgreSQL, IAM-instans (ekstern) | Anna Andersen |
| Platform (kontrolplan) | PDP, audit-log, portal, IAM | Anna Andersen |

Eksterne afhængigheder har en separat ansvarsaftale; hvis den mangler, er
afhængigheden ikke en del af vores recovery-kontrakt. Se
`deployment-profile.*.example.json` → `dataServices[].responsibilityAgreement`.

## Per-tjeneste begrundelse

### audit-service

Kritisk. Et tabt eller korrupt audit-spor gør alle efterfølgende beslutninger
uverificerbare, og myndighedskrav (NIS2/GDPR) kan ikke opfyldes. Et bekræftet
audit-intent må derfor ikke kunne forsvinde efter svar til kalderen
(`confirmedWrites.rpoMinutes = 0`). Et regionsnedbrud kan tabe op til 15
minutters hændelser, hvis de replikeres kontinuerligt til en anden region. Et
korrupt snapshot opdages via hash-kæden og gendannes fra seneste verificerede
snapshot. Tjenesten er HA-egnet og kræver tre uafhængige fejldomæner og en
særskilt recovery-lokation.

### dummy-ok

Referencemodul, medium. Et bekræftet ops-kald skal kunne spores (RPO 0 for
bekræftede writes). Et regionsnedbrud er accepteret med op til fire timers tab
via natlig offsite backup. Korruption gendannes fra dagligt verificeret
snapshot. Kører i SMV-profilen på én server; nedetid er accepteret
(`acceptedDowntime = true`).

### mattermost-adapter

Høj. En bekræftet besked må ikke tabes, selv om Mattermost er nede; adapteren
køer derfor skrivningen i sin egen database (RPO 0). Den eksterne Mattermost-
instans kan ikke forudsættes at køre flere aktive skrivere, så adapteren vælger
`single-writer` og går i read-only ved netværkspartition. Målene er foreslåede
og afventer menneskelig vedtagelse.

### keycloak-adapter

Kritisk. En bekræftet IAM-ændring skal kunne spores (RPO 0). Mister adapteren
forbindelsen til IAM, afvises nye provisioneringer frem for at gætte. Et
regionsnedbrud accepteres med op til fire timers tab. Målene er foreslåede og
afventer menneskelig vedtagelse.

## Recovery-rækkefølge

Gendannelse sker i afhængighedsrækkefølge: database og storage først, derefter
tjenesten, til sidst køen. Den præcise rækkefølge pr. tjeneste står i
serviceklassens `recovery.restoreOrder`. Rækkefølgen er en del af kontrakten,
så et restore ikke starter en tjeneste før dens data er tilgængelige.

## Årlig revurdering

BIA'en revurderes årligt og ved enhver væsentlig ændring af et kritisk flow.
En serviceklasse hvis BIA-reference ikke længere findes, afvises af
`make continuity-check`.
