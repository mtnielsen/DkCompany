# LinkedIn-udkast

> Først når 1.4 og 2.6 er grønne. Ét deck med én fungerende adapter og kørende konformanstest slår tolv tomme repos.

## Kort version

De fleste platforme kan vise en politik. Få kan vise, at den virker.

Jeg har bygget et monorepo, hvor kontrakten og den kørende test følger hinanden:

• `make conform` siger pass/fail pr. krav — og et bevidst brudt modul fejler med vilje.
• En adapter, der ikke kan slette fra backups, erklærer ærligt `partial` i stedet for at lyve.
• Alle modelkald går gennem én gateway; agenter må kun bruge deklarerede verber og stopper, når governance ikke kan nås.
• Konformans, policy, audit, git og sikkerhedsscan bliver til én OSCAL-evidenspakke til revisoren.

Fire planer, der kan testes — ikke ti, der aldrig bliver implementeret.

Repo: <indsæt link>

#platform #compliance #NIS2 #GDPR #AIAct #OSCAL #platformengineering

## Lang version

En politik uden en kørende test er en PDF, ingen følger. Det er udgangspunktet for det her repo.

Jeg har bygget en fler-modul-platform, hvor det, der kan påstås, også kan efterprøves:

1. **Kontrakt før implementering.** Hvert modul erklærer sine verber med et conformance-niveau: `full`, `partial` eller `unsupported`. `partial` og `unsupported` kræver en begrundelse, så et manifest kan være ærligt i stedet for at lyve.
2. **Test før moduler.** `make conform` kører en suite pr. modul. Den bevidst brudte fixture skal fejle — ellers ved vi ikke, om suiten virker.
3. **To beviste adaptere før skalering.** En greenfield-tjeneste og en stædig upstream (Mattermost). Sidstnævnte kan ikke slette persondata fra backups, og det står der. Suiten accepterer `partial`, ikke en løgn.
4. **Agenter inden for en grænse.** Kun deklarerede verber, ingen fri shell, fail-closed ved utilgængelig PDP/audit-log, budgetter og loop-detektion. En reviewer-agent fra en anden leverandør kan kun flagge eller afvise.
5. **Evidens frem for prosa.** Godkenderen møder maskinevidens og agentprosa visuelt adskilt. Alle artefakter samles i en OSCAL-assessment-results-pakke.

Det er ikke «compliant software». Det er kontrakter, tests og evidensmaskineri, der gør en organisation i stand til at dokumentere og håndhæve sine kontroller — og gør ansvaret synligt.

`make install && make ci` og se det selv.

Repo: <indsæt link>

#platform #compliance #NIS2 #GDPR #AIAct #OSCAL #platformengineering #governance
