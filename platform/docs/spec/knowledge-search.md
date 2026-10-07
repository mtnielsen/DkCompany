# Rettighedsbevidst vidensbase og søgning

DKC-028 gør intern viden tilgængelig for mennesker og AI **med de samme
adgangsgrænser**. BookStack er den første kandidat som read-only videnskilde.
Søgningen filtrerer på tenant og kilde-ACL *før* nogen scoring, så et
uautoriseret menneske hverken får en privat side i svaret, i et snippet, i en
embedding-søgning eller i en citationsliste.

## Dataflyt

```
search/sources.json        (read-only, tenantbundne BookStack-kilder)
        │  search/src/bookstack.mjs  (mapper sider + permissions)
        ▼
search/src/ingest.mjs  →  search/src/index-store.mjs  (filbaseret indeks, ACL, epoch)
        │  search/src/permissions.mjs (tenant + ACL, default-deny)
        ▼
search/src/retrieval.mjs  (tenant/ACL-filter FØR leksikalsk+embedding scoring)
        │  search/src/answer.mjs (kildehenvisning, usikkerhed, ubetroet indhold)
        ▼
search/report/knowledge-search-report.json  +  docs/search/knowledge-search-report.md
```

## Beslutningssemantik

- **Read-only kilde.** BookStackkilden er `readOnly`, tenantbundet og bruger en
  secretreference (aldrig en rå hemmelighed). Der skrives ikke tilbage.
- **Tenant + ACL før scoring.** `retrieve` udleder tenanten af den verificerede
  principal, filtrerer dokumenter på tenant og kilde-ACL og scorer kun de
  autoriserede. Et fortroligt/særligt følsomt dokument kræver desuden en
  tilsvarende klarering.
- **Revalidering ved læsning.** En `aclResolver` læser den aktuelle ACL fra
  kilden ved hver søgning. En tilbagekaldt rettighed rammer derfor også
  allerede indekseret indhold; er resolveren utilgængelig, nægtes dokumentet
  (fail-closed).
- **Invalidning.** Hver upsert/sletning/ACL-ændring hæver indeksets epoch, og
  cachen er bundet til epoken. En sletning er en tombstone, så et cachelagret
  snippet ikke kan genopstå.
- **Slettefrist.** En slettet side fjernes fra indeks og cache, og fristen måles
  deterministisk mod `deletion.deadlineSeconds`. En målt frist på en levende
  BookStack er en ekstern integration.
- **Ubetroet indhold.** Hvert snippet pakkes som ubetroet indhold gennem
  runtimens grænse (DKC-011) og scannes for injektion. Et forfalsket
  værktøjskald i en artikel bliver aldrig et kald: `toolProposals` er tom, og
  `toolActivationDenied` er altid sand.

## Kontrakter

- `contracts/knowledge-source.schema.json` (`KnowledgeSource`)
- `contracts/knowledge-document.schema.json` (`KnowledgeDocument`)
- `contracts/retrieval-answer.schema.json` (`RetrievalAnswer`)

## Kommandoer

```bash
make search-sync     # synkronisér kilder ind i et indeks (SEARCH_INDEX_DIR)
make search-check    # validér kilder, politik, dokumenter og scenarier
make search-test     # enheds- og konformanstests
make search-run      # deterministisk søge- og ACL-kontrol
make search-render   # skriv rapporten
make search-report   # skriv rapporten til stdout
make search-live     # NOT RUN: kræver en levende BookStack og en rigtig hændelse
```
