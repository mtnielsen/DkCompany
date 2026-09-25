# Målt forbrugs- og omkostningsafstemning (NOT RUN)

`make metering-live` er **NOT RUN** i dette miljø. Der findes ingen levende
faktura, intet faktisk driftsregnskab og ingen leverandørpris at afstemme imod.

## Hvad der er efterprøvet i stedet

Den rigtige prisbog, forbrugsjournal, driftsudgiftsfil og de tre
virksomhedsprofiler valideres og aggregeres deterministisk:

```bash
make metering-run
make metering-check
make metering-test
```

Det dækker:

- prisvalg efter tidspunkt og en manglende pris der afvises (ikke nul),
- valutaomregning og afvisning af en manglende kurs,
- idempotent aggregering på `eventKey` (dubletter tælles én gang),
- tenant-isolation i aggregering og eksport,
- prognose, stopgrænser og budgetstatus,
- afstemning mod driftsudgifter med tolerance, og
- en claim-politik der forbyder målte besparelser, gratis drift og fuld
  SaaS-erstatning uden dokumentation.

## Hvad der udestår

- En faktisk leverandørfaktura og et faktisk driftsregnskab pr. tenant.
- En reel valutakurskilde i stedet for de syntetiske testkurser.
- En målt afvigelse mellem det registrerede forbrug og de betalte udgifter.
- En manuel indtastning af on-call- og upstreamomkostninger med dokumentation.

Indtil da forbliver `integration-metering-live` NOT RUN, og rapporten erklærer
`measured: false`.
