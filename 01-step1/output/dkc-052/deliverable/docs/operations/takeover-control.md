# Runbook: menneskelig overtagelse og beredskabsøvelse (DKC-052)

Denne runbook beskriver, hvordan et menneske overtager tjenesten, når AI'en
eller den primære platform er nede, og hvordan øvelsen gentages. Den er skrevet
til at kunne læses uden adgang til platformen.

## 0. Før noget sker

- Kende din rolle i `continuity/takeover-plan.json`: serviceejer, on-call,
  stedfortræder, incidentleder, change authority eller dataansvarlig.
- Vide hvor den uafhængige kontaktkanal og den trykte/offline runbook ligger.
- Vide hvem der er depositar for credentials, og at to-personers kontrol kræves.

## 1. Overtagelse (takeover)

1. **Erklær incidenten** (incidentleder). Skriv incident-ID og tidspunkt ned.
2. **Kontakt testmodtagerne** gennem den uafhængige kanal. Kvitteringen er en
   menneskelig handling; hvis den udebliver, eskalerer kæden automatisk til
   næste navngivne menneske (se planens `contactChannel.escalation`).
3. **Bekræft AI-offline.** Kør ikke nogen agent. Verificér at autonome
   handlinger er stoppet, og at nødstoppet er aktivt hvis det er nødvendigt.

## 2. Gendannelse (restore)

1. **Hent break-glass** (dataansvarlig). Følg
   `docs/runbooks/break-glass.md`; to-personers kontrol kræves.
2. **Gendan i prioritetsrækkefølge**: identitet → database → storage →
   konfiguration (se `restorePlan.priority`).
3. **Mål dataintegriteten**: sha256 på hver komponent, ACL-afstemning og et
   fuldt brugerflow.
4. **Træf ejerbeslutningen** om at fortsætte gendannelsen. Beslutningen er
   bundet til øvelsesrapporten med navn og tidsstempel.

## 3. Failback

1. **Træf change-authority-beslutningen** om failback til primær.
2. **Udfør failback** og verificér quorum, databaseintegritet og rejoin.
3. Hvis integriteten ikke er målbar, **rul ikke failback**; bliv i
   recovery-miljøet og eskalér til et menneske.

## 4. Servicevalidering og lukning

1. **Validér servicen** mod de vedtagne serviceklasser og deres test af
   gendannelse.
2. **Menneskelig accept.** En kritisk incident lukkes **først** efter
   servicevalidering og en navngiven ejers accept. En agent kan ikke give denne
   accept (agentCanApprove er altid `false`).

## 5. Den gentagelige øvelse

```sh
make takeover-run      # kør alle scenarier deterministisk
make takeover-check    # validér plan, øvelse og artefakter
make takeover-test     # enheds- og konformanstest
```

Den deterministiske øvelse efterlader alle menneskelige trin som `AFVENTER`.
Det er med vilje: en plan eller en maskinkørsel er ikke en gennemført
overtagelse. Den målte øvelse er `make takeover-live` og er NOT RUN i dette
miljø.

## 6. Periodisk kontrol

| Kontrol | Kadence |
| --- | --- |
| Adgangsrevision | 90 dage |
| Backupkontrol | 30 dage |
| Kapacitetsvurdering | 90 dage |
| DR-øvelse | 180 dage |
| Runbookrecertificering | 180 dage |

Kadencen og sidste gennemførte dato ligger i planens `drills.schedule` og
`drills.lastCompleted`.

## 7. Hvad agenten ikke må

- Udføre et menneskeligt out-of-band-trin på et menneskes vegne.
- Markere et menneskeligt trin som `pass` uden evidens.
- Godkende beredskab eller lukke en kritisk incident.
- Udtale sig om, at en øvelse er målt, når den er deterministisk.
