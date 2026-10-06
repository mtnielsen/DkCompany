# Rettighedsbevidst videnssøgning

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), Cecilia Christensen (Security Owner)
- **Dato:** 2026-10-02
- **Beslutningsdrev:** DKC-028 kræver, at intern viden gøres tilgængelig for mennesker og AI med de samme adgangsgrænser, og at søgning/RAG filtrerer på kilde-ACL og tenant før retrieval.

## Kontekst og problemstilling

Platformen har en fælles adapter-SDK (DKC-023), en værktøjsgrænse og
injektionssignal (DKC-011), sletning/legal hold (DKC-021), en modelgateway
(DKC-012) og en portal med servicepakker (DKC-025). Men intern viden ligger i
BookStack, og en naiv søgning ville indeksere og score alle sider og først
bagefter filtrere. Så ville en privat HR-side kunne optræde i et svar, et
snippet, en embedding-søgning eller en citationsliste for en uautoriseret
medarbejder — og en tilbagekaldt rettighed ville ikke ramme det allerede
indekserede indhold. En artikel kunne desuden indeholde et forfalsket
værktøjskald, der forsøger at udvide agentens rettigheder gennem prosa alene.

## Beslutningskriterier

- BookStack som første read-only videnskilde, tenantbundet og med
  secretreference.
- Tenant og kilde-ACL filtreres **før** nogen scoring.
- Adgang revalideres ved læsning, så tilbagekaldt adgang også gælder tidligere
  indeksindhold.
- Rettighedsændring og sletning invaliderer indeks og cache, og en slettet side
  forsvinder inden for en fastsat, målt frist.
- Et svar har kildehenvisning og usikkerhed.
- Hentet indhold er ubetroet data og kan ikke aktivere et privilegeret værktøj.

## Overvejede muligheder

- **A:** Indeksér alt og filtrer resultatet efter scoring.
- **B:** Filtrér tenant og kilde-ACL før scoring, gem ACL i et filbaseret indeks
  med en epoch, revalidér ved læsning, pak hvert snippet som ubetroet indhold,
  og mål slettefristen deterministisk.
- **C:** Stol på, at en prompt eller en model selv respekterer adgangsgrænsen.

## Beslutning

Vi vælger **B**. `search/sources.json` beskriver read-only, tenantbundne
BookStackkilder. `search/src/bookstack.mjs` mapper sider og deres
content-permissions til et `KnowledgeDocument` med tenant, klassifikation og
ACL, og `search/src/index-store.mjs` gemmer dokumentet på disk med en epoch, der
hæves ved hver indholds- eller ACL-ændring. `search/src/permissions.mjs`
håndhæver default-deny og et klassifikationsloft, og `search/src/retrieval.mjs`
filtrerer på tenant og ACL **før** den leksikalske og embedding-baserede
scoring. En `aclResolver` revaliderer den aktuelle ACL fra kilden ved hver
søgning, så en tilbagekaldt rettighed også rammer allerede indekseret indhold.
`search/src/invalidation.mjs` invaliderer cachen på epoken, fjerner slettede
sider som tombstones og måler slettefristen. `search/src/answer.mjs` pakker
hvert snippet som ubetroet indhold gennem runtimens grænse (DKC-011), scanner
for injektion og opretter aldrig et værktøjsforslag. Rapporten erklærer
`measured: false`; den målte frist er `make search-live` og er NOT RUN.

### Konsekvenser

- **Positive:** En privat side kan ikke nå svar, snippets, embedding-søgning
  eller citationer for uvedkommende; tilbagekaldt adgang håndhæves straks;
  indeks og cache invalideres; en artikel kan ikke aktivere et værktøj.
- **Negative:** Kilden, klassifikationen og slettefristen skal vedligeholdes, og
  en målt frist på en levende BookStack mangler stadig.
- **Neutrale:** Søgning er en ny førstepartsevne i `search/`; den genbruger
  tenant-konteksten, runtimengrænsen og injektionsscanneren.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Simpelt | Lækker private sider gennem snippets/citationer; bryder tenant- og ACL-grænsen |
| B | Filtrerer før scoring, ærlig om det målte, robust mod injektion | Kræver vedligeholdt indeks og en ekstern målt frist |
| C | Ingen kode | Uacceptabelt; adgang må ikke hvile på en prompt |

## Mere information

- [`docs/spec/knowledge-search.md`](../spec/knowledge-search.md), [`docs/search/knowledge-search-report.md`](../search/knowledge-search-report.md), [`docs/search/bookstack-live.md`](../search/bookstack-live.md), [`docs/operations/knowledge-search.md`](../operations/knowledge-search.md)
- [`search/sources.json`](../../search/sources.json), [`contracts/knowledge-document.schema.json`](../../contracts/knowledge-document.schema.json), [`contracts/retrieval-answer.schema.json`](../../contracts/retrieval-answer.schema.json)
- [`docs/adr/0023-vaerktoejsgraense-og-injection.md`](0023-vaerktoejsgraense-og-injection.md), [`docs/adr/0036-faelles-adapter-sdk-og-godkendelsestest.md`](0036-faelles-adapter-sdk-og-godkendelsestest.md), [`docs/adr/0049-sletning-legal-hold-og-gendannelsesregler.md`](0049-sletning-legal-hold-og-gendannelsesregler.md)
