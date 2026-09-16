# Beslutningslog (ADR)

Arkitekturvalg dokumenteres som ADR'er i [MADR-format](https://adr.github.io/madr/). En ADR er nødvendig, når et valg er svært at fortryde, påvirker flere moduler, eller binder en kontrakt.

- [ADR-0001 — Fire planer som bindende kontrakter](0001-fire-planer.md)
- [ADR-0002 — Monorepo og rækkefølgen kontrakt → test → modul](0002-monorepo-og-raekkefoelge.md)
- [ADR-0003 — Partial conformance frem for binær](0003-partial-conformance.md)
- [ADR-0004 — Egen letvægts-PDP bag en OPA-kompatibel kontrakt](0004-letvaegts-pdp.md)
- [ADR-0005 — Git er den eneste ændringskanal](0005-git-eneste-aendringskanal.md)
- [ADR-0006 — Alle modelkald gennem én gateway](0006-alle-modelkald-gennem-gateway.md)
- [ADR-0007 — Evidens og prosa adskilles; revieweren kan ikke godkende](0007-evidens-og-prosa-adskilt.md)
- [ADR-0008 — OSCAL-assessment-results som evidensformat](0008-oscal-evidensprofil.md)
- [ADR-0009 — Kontrolmapping som maskinlæsbar registry med udgiver/deployer-roller](0009-kontrolmapping-roller.md)
- [ADR-0010 — Dashboards og SLO-regler genereres fra modulmanifestet](0010-dashboards-fra-manifest.md)
- [ADR-0011 — Sikkerhedsfund normaliseres ind i OSCAL-evidensplanen](0011-sikkerhedsfund-i-evidensplanen.md)

Ny ADR: kopiér [template.md](template.md), giv næste ledige nummer, og tilføj den til listen ovenfor. En ADR kan ikke ændres, når den er accepteret — den erstattes af en ny.
