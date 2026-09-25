# Målt slettefrist på en levende BookStack (NOT RUN)

`make search-live` er **NOT RUN** i dette miljø. Der findes ingen levende
BookStack-installation, intet rigtigt API-token og ingen rigtig
permission-/slettehændelse at måle imod.

## Hvad der er efterprøvet i stedet

Den rigtige klient, mapping, indeks, tenant-/ACL-filtrering, revalidering,
invalidning og injektionsneutralisering køres deterministisk mod en
mock-upstream med et rigtigt filindeks:

```bash
make search-run
make search-check
make search-test
```

Det dækker:

- en privat HR-side der ikke optræder for en uautoriseret medarbejder i svar,
  snippets, embedding-søgning eller citationsliste,
- en HR-medarbejder der kan se den med den rette gruppe og klarering,
- tenantadskillelse i begge retninger,
- en tilbagekaldt rettighed der håndhæves både ved revalidering ved læsning og
  efter reindeksering,
- en slettet side der forsvinder fra indeks og cache,
- et forfalsket værktøjskald i en artikel der ikke aktiverer et værktøj, og
- en rettighedsændring der invaliderer cachen.

## Hvad der udestår

- En faktisk BookStack-installation med et scoped API-token.
- En rigtig permission-ændring og en rigtig sletning i upstream.
- En målt tid fra sletning til sidste kopi (indeks, cache, afledt AI-visning) er
  væk.
- En reel embedding-model i stedet for den deterministiske hash-embedding;
  retrievalgrænsen og filtreringen er den samme.

Indtil da forbliver `integration-bookstack-live` NOT RUN, og rapporten erklærer
`measured: false`.
