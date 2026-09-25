# Kapacitets- og skaleringsrapport

> Genereret fra `performance/capacity-plan.json` med `make performance-render`.
> Tallene er en **deterministisk model** (`measured: false`). En levende lasttest pa mindst tre hosts er en ekstern integration, se [`live-load-test.md`](live-load-test.md).

## Skaleringsfaktorer

Faktorer: 1x, 2x, 5x.

## Lille kunde (`small`)

| Faktor | Throughput/s | Fejlrate % | p95 ms | p99 ms | Køalder s | Replikeringslag ms | Pris/md | Flaskehals |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1x | 47.27 | 0 | 900.29 | 2200.71 | 0 | 25 | 4991.8 DKK | api (5.2%) |
| 2x | 94.52 | 0 | 900.58 | 2201.42 | 0 | 25 | 4991.8 DKK | api (10.4%) |
| 5x | 236.31 | 0 | 901.45 | 2203.54 | 0 | 25 | 4991.8 DKK | api (26%) |

## Mellemstor kunde (`medium`)

| Faktor | Throughput/s | Fejlrate % | p95 ms | p99 ms | Køalder s | Replikeringslag ms | Pris/md | Flaskehals |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1x | 472.85 | 0 | 914.7 | 2235.94 | 0 | 25 | 21371.85 DKK | api (52.1%) |
| 2x | 945.7 | 0 | 929.9 | 2273.08 | 0 | 25 | 21371.85 DKK | api (59.5%) |
| 5x | 2364.24 | 0 | 6000 | 13000 | 0 | 142.86 | 21371.85 DKK | queue-worker (100%) |

## Stor kunde (`large`)

| Faktor | Throughput/s | Fejlrate % | p95 ms | p99 ms | Køalder s | Replikeringslag ms | Pris/md | Flaskehals |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1x | 3348.47 | 29.185 | 6000 | 13000 | 0 | 400 | 172902.33 DKK | database (188.9%) |
| 2x | 3851.95 | 59.269 | 6000 | 13000 | 4 | 400 | 172902.33 DKK | database (377.8%) |
| 5x | 4837.36 | 79.539 | 6000 | 13000 | 100 | 400 | 172902.33 DKK | database (944.4%) |

## N+1 efter hosttab

- Hosts: 3, heraf 1 nede → 2 tilbage.
- Baseline-throughput: 472.85/s; efter tab: 472.85/s, fejlrate 0 %.
- N+1 er opfyldt i modellen.

## Ikke-lineær skalering

Tabellen nedenfor viser realiseret gennemstrømning i forhold til 1x. Et forhold under skaleringsfaktoren betyder, at en flaskehals (fx en stateful app uden multi-active-support eller en replikaramme) begrænser skalereringen.

| Profil | Faktor | Realiseret forhold | Lineær? | Flaskehals |
| --- | --- | --- | --- | --- |
| small | 2x | 2 | ja | api (10.4%) |
| small | 5x | 4.999 | ja | api (26%) |
| medium | 2x | 2 | ja | api (59.5%) |
| medium | 5x | 5 | ja | queue-worker (100%) |
| large | 2x | 1.15 | nej | database (377.8%) |
| large | 5x | 1.445 | nej | database (944.4%) |
