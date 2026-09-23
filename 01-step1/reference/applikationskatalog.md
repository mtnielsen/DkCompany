# Applikationskatalog — 169 moduler og anvendelser

Dato: 22. september 2026. Målgruppe: små og mellemstore virksomheder, IT-/servicevirksomheder og større organisationer. Kataloget beskriver mulige moduler; det er ikke en ordre om at bygge dem alle samtidig.

Et modul er en brugerfunktion eller en platformfunktion. Flere rækker kan leveres af samme installation. Eksempelvis skal opgaver og projekter normalt dele OpenProject; kalender, filer og dokumenter kan dele Nextcloud. Antallet er derfor ikke et antal uafhængige produkter eller deployerbare tjenester.

**Byg** = vores sammenhængende produktlag. **Udbyg** = kode findes i DkCompany, men kræver videre arbejde. **Integrér** = adapter omkring et eksisterende produkt. **Undersøg** = behov og kandidat kræver discovery før kode. En nævnt kandidat er en begrundet mulighed, ikke en godkendt løsning eller bekræftelse af alle features i en gratis edition.

**Kerne** = platformens forudsætninger. **Basis** = første fælles arbejdsplads. **Udvidelse** = efter fungerende pilot. **Senere** = enterprise/branche/behovsdrevet. **Reguleret** = særskilt faglig/juridisk gate; betyder ikke at andre moduler er uden regler.

Formålene er vores foreslåede produktkrav. Kandidaternes overordnede anvendelse er undersøgt i officielle projektkilder. SSO, SCIM, APIs, edition, licens og kommerciel hosting skal verificeres for den præcise version i DKC-002 og DKC-023. Ingen fuld licens- eller funktionsaudit er udført. Kilderne er links i kandidatsøjlen.

## Fælles platform og AI-styring

| ID | Modul | Formål | Bølge | Strategi og kandidat | Særlig gate |
|---|---|---|---|---|---|
| APP-001 | Virksomhedsportal | Samle apps, status og godkendelser ét sted | Kerne | Byg | Rettigheder håndhæves også i backend |
| APP-002 | Kunde- og organisationsregister | Styre virksomheder, afdelinger og installationer | Kerne | Byg | Tenant må ikke vælges frit af klienten |
| APP-003 | Login og identitet | Fælles login, MFA og brugerlivscyklus | Kerne | Integrér: [Keycloak](https://www.keycloak.org/), [authentik](https://goauthentik.io/) | Edition, SSO og provisioning skal verificeres |
| APP-004 | Rolle- og adgangsstyring | Bestemme hvem der må læse og handle | Kerne | Byg | Ressource-, tenant- og miljøscope |
| APP-005 | Policy-motor | Afgøre om en handling er tilladt | Kerne | Udbyg | Signerede regler og default-deny |
| APP-006 | Godkendelsescenter | Indhente verificerede menneskelige beslutninger | Kerne | Udbyg | Bind godkendelse til præcis ændring |
| APP-007 | Agentregister og runtime | Registrere agenter og udføre tilladte opgaver | Kerne | Udbyg | Ingen fri shell eller selvudvidede rettigheder |
| APP-008 | AI-gateway | Styre modeller, dataruter og forbrug | Kerne | Udbyg | Virkelig provider, dataaftale og budgetreservation |
| APP-009 | Agentkontrol og nødstop | Standse, tilbagekalde og begrænse agenter | Kerne | Byg | Skal virke hos executor |
| APP-010 | Revisionslog og evidens | Dokumentere handlinger og tekniske kontroller | Kerne | Udbyg | Holdbar lagring og eksterne checkpoints |
| APP-011 | Privacy-center | Samle indsigt, eksport, sletning og retention | Kerne | Byg | Identitetskontrol og ærlig partial-status |
| APP-012 | Modulkatalog og provisioning | Installere godkendte apps med kendte versioner | Kerne | Byg | DKC-053/054/061: dependency graph, installer, lifecycle and separate data deletion |
| APP-013 | Job- og workflowmotor | Genoptage længere processer sikkert | Kerne | Byg | Idempotency, leases og unknown outcomes |
| APP-014 | Secrets og nøgleforvaltning | Udstede og rotere begrænset adgang | Kerne | Integrér | Vælg gennemprøvet broker/KMS i arkitektur-ADR |
| APP-015 | Backup- og restorecenter | Gendanne kundens data og konfiguration | Kerne | Integrér | DKC-016 og DKC-042: separat recoverydomæne, PITR og målte RPO/RTO |
| APP-016 | Drifts- og sikkerhedscenter | Overvåge fejl, belastning og sikkerhedshændelser | Kerne | Udbyg: [Wazuh](https://wazuh.com/) | Eksisterende observability og faktiske sensorer |
| APP-017 | Forbrug og omkostninger | Vise pris pr. kunde, app og AI-opgave | Kerne | Byg | Afstem måling med faktiske udgifter |
| APP-018 | Migration og exit | Flytte indhold og rettigheder ind og ud | Kerne | Byg | Dokumenterede eksportformater |
| APP-019 | Fælles søgning og AI-viden | Finde tilladt viden på tværs af apps | Basis | Byg: [OpenSearch](https://opensearch.org/) | ACL før retrieval og ved kildeadgang |
| APP-020 | Integrationer og webhooks | Udveksle hændelser mellem godkendte apps | Basis | Byg: [Activepieces](https://www.activepieces.com/) | DKC-056/059: capability contract, scoped credentials and tested provider migration |

## Kommunikation og kontor

| ID | Modul | Formål | Bølge | Strategi og kandidat | Særlig gate |
|---|---|---|---|---|---|
| APP-021 | Teamchat | Kanaler og direkte intern kommunikation | Basis | Integrér: [Mattermost](https://docs.mattermost.com/) | Eksisterende adapter skal testes live |
| APP-022 | Videomøder | Afholde interne og eksterne møder | Udvidelse | Integrér: [Nextcloud Hub](https://nextcloud.com/hub/) | Kapacitet, TURN og mødegæster |
| APP-023 | Virksomhedsmail | Sende, modtage og administrere postkasser | Udvidelse | Integrér: [mailcow](https://docs.mailcow.email/) | Leveringssikkerhed, DNS og misbrugsberedskab |
| APP-024 | Webmail | Læse mail fra browser | Udvidelse | Integrér: [Nextcloud Hub](https://nextcloud.com/hub/), [mailcow](https://docs.mailcow.email/) | Mailklient kræver mailserver |
| APP-025 | Fælles kalender | Planlægge møder og delte kalendere | Basis | Integrér: [Nextcloud Hub](https://nextcloud.com/hub/) | Invitations- og delingsrettigheder |
| APP-026 | Kontaktbog | Dele kontaktoplysninger i organisationen | Basis | Integrér: [Nextcloud Hub](https://nextcloud.com/hub/) | Hold CRM-masterdata adskilt fra personlige kontakter |
| APP-027 | Filbibliotek og deling | Opbevare og dele arbejdsfiler | Basis | Integrér: [Nextcloud Hub](https://nextcloud.com/hub/) | Eksterne links, malwarekontrol og retention |
| APP-028 | Dokumentredigering | Samarbejde om tekst, ark og præsentationer | Basis | Integrér: [Nextcloud Hub](https://nextcloud.com/hub/) | Valgt editor, edition og formatkompatibilitet |
| APP-029 | Personlige noter | Gemme kladder og mødenoter med adgangskontrol | Udvidelse | Integrér: [Nextcloud Hub](https://nextcloud.com/hub/) | Noter er ikke automatisk fælles viden |
| APP-030 | Whiteboard | Tegne og udvikle ideer sammen | Udvidelse | Undersøg | Vælg komponent med eksport og adgangskontrol |
| APP-031 | Mødebooking | Lade kunder reservere ledige tider | Udvidelse | Integrér: [Cal.com](https://cal.com/) | Edition, SSO og kalenderadgang |
| APP-032 | Telefonisystem | Ringe, viderestille og håndtere køer | Senere | Undersøg | SIP-udbyder, nødopkald og optagelsesregler |
| APP-033 | Transskription og referater | Lave søgbare referater og opgaveforslag | Udvidelse | Byg | Oplysning, behandlingsgrundlag og slettepolitik |
| APP-034 | Intranet og nyheder | Dele interne beskeder og virksomhedsindhold | Udvidelse | Integrér: [WordPress](https://wordpress.org/) | Privat adgang og redaktionelle roller |
| APP-035 | Intern vidensbase | Vedligeholde procedurer og vejledninger | Basis | Integrér: [BookStack](https://www.bookstackapp.com/) | Dokument-ACL og versionshistorik |
| APP-036 | Dokumentarkiv og OCR | Indlæse og finde scannede dokumenter | Udvidelse | Integrér: [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) | OCR-lagring, filadgang og retention |
| APP-037 | Elektronisk underskrift | Indhente underskrifter på dokumenter | Udvidelse | Integrér: [Documenso](https://documenso.com/) | Underskriftsniveau og juridisk anvendelse afklares |
| APP-038 | Formularer og undersøgelser | Indsamle strukturerede svar | Udvidelse | Integrér: [LimeSurvey](https://www.limesurvey.org/) | Formål, adgang, anonymitet og dataminimering |

## Projekter, ressourcer og konsulentarbejde

| ID | Modul | Formål | Bølge | Strategi og kandidat | Særlig gate |
|---|---|---|---|---|---|
| APP-039 | Projektstyring | Planlægge leverancer, milepæle og ansvar | Basis | Integrér: [OpenProject](https://www.openproject.org/docs/getting-started/openproject-introduction/) | Community versus betalte funktioner |
| APP-040 | Opgaver og Kanban | Følge det daglige arbejde | Basis | Integrér: [OpenProject](https://www.openproject.org/docs/getting-started/openproject-introduction/) | Kan leveres i samme installation som projektstyring |
| APP-041 | Porteføljestyring | Prioritere projekter på tværs af afdelinger | Udvidelse | Integrér: [OpenProject](https://www.openproject.org/docs/getting-started/openproject-introduction/) | Funktionsdækning pr. edition skal bevises |
| APP-042 | Tidsregistrering | Registrere timer på kunder og projekter | Udvidelse | Integrér: [Kimai](https://www.kimai.org/en/) | Godkendelse, eksport og lokal praksis |
| APP-043 | Ressourceplanlægning | Fordele medarbejderkapacitet og opgaver | Udvidelse | Undersøg: [OpenProject](https://www.openproject.org/docs/getting-started/openproject-introduction/) | Afklar planlægningsfunktioner og edition |
| APP-044 | Projektøkonomi | Sammenholde timer, budget og omkostninger | Udvidelse | Integrér: [OpenProject](https://www.openproject.org/docs/getting-started/openproject-introduction/) | Autoritative tal kommer fra økonomisystemet |
| APP-045 | Risici og projektbeslutninger | Følge risici, ejere og beslutningshistorik | Udvidelse | Byg | Udvid eksisterende projektmodul før ny app |
| APP-046 | Kundeportal | Give kunden adgang til aftalte leverancer | Udvidelse | Byg | Ekstern adgang pr. projekt og organisation |
| APP-047 | Kvalitetsgodkendelse af leverancer | Indsamle kundens accept og ændringsønsker | Udvidelse | Byg | Dokumentversion og godkenderidentitet |
| APP-048 | OKR og mål | Følge mål og fælles fremdrift | Senere | Undersøg | Undgå automatisk individuel medarbejderscoring |

## Salg, CRM og kundeservice

| ID | Modul | Formål | Bølge | Strategi og kandidat | Særlig gate |
|---|---|---|---|---|---|
| APP-049 | CRM | Holde styr på kunder, kontakter og relationer | Basis | Integrér: [EspoCRM](https://www.espocrm.com/) | Valg af masterdata og dubletregler |
| APP-050 | Salgspipeline | Følge muligheder og næste salgsaktivitet | Basis | Integrér: [EspoCRM](https://www.espocrm.com/) | Samme CRM-installation |
| APP-051 | Tilbud og salgsordrer | Oprette tilbud og omdanne accepterede tilbud til ordrer | Udvidelse | Integrér: [ERPNext](https://docs.frappe.io/erpnext/introduction) | Pris, rabat og godkendelsesgrænser |
| APP-052 | Produktkonfiguration og CPQ | Beregne tilbud på sammensatte produkter | Senere | Undersøg | Domæneregler og prisberegning skal verificeres |
| APP-053 | Supporttickets | Håndtere kundesager og svartider | Basis | Integrér: [Zammad](https://zammad.org/) | Rettigheder til mails og vedhæftninger |
| APP-054 | Livechat og fælles indbakke | Samle kundedialog fra flere kanaler | Udvidelse | Integrér: [Chatwoot](https://www.chatwoot.com/) | Sociale kanaler kan kræve aftaler og betaling |
| APP-055 | Kundeselvbetjening | Lade kunder finde svar og følge egne sager | Udvidelse | Integrér: [Zammad](https://zammad.org/), [Chatwoot](https://www.chatwoot.com/) | Afprøv den valgte editions portal |
| APP-056 | Serviceaftaler og SLA | Følge aftalt responstid og ansvar | Udvidelse | Integrér: [Zammad](https://zammad.org/) | Kalendere, eskalation og måledefinitioner |
| APP-057 | Customer success | Følge onboarding, behov og opfølgning hos kunder | Senere | Byg | Samles oven på CRM og supportdata |
| APP-058 | Kundetilfredshed | Indsamle evalueringer efter leverancer | Udvidelse | Integrér: [LimeSurvey](https://www.limesurvey.org/) | Frivillighed og korrekt anonymitetsbeskrivelse |
| APP-059 | Reklamationer og returvarer | Behandle mangler, retur og kompensation | Udvidelse | Integrér: [Medusa](https://medusajs.com/) | Refusion kræver økonomi- og betalingsintegration |
| APP-060 | Partner- og forhandlerportal | Dele relevante kunder, ordrer og materialer | Senere | Byg | Organisationer og data skal være adskilt |

## Marketing og digitalt indhold

| ID | Modul | Formål | Bølge | Strategi og kandidat | Særlig gate |
|---|---|---|---|---|---|
| APP-061 | Hjemmeside og CMS | Udgive sider og redaktionelt indhold | Udvidelse | Integrér: [WordPress](https://wordpress.org/) | Pluginudvælgelse og sikker patchning |
| APP-062 | Landing pages | Lave kampagnesider med formularer | Udvidelse | Integrér: [WordPress](https://wordpress.org/) | Samtykke og godkendt publicering |
| APP-063 | Nyhedsbreve | Udsende til tilmeldte modtagere | Udvidelse | Integrér: [listmonk](https://listmonk.app/) | Dokumenteret tilmelding og effektiv afmelding |
| APP-064 | Marketingautomation | Planlægge kunderejser og opfølgning | Udvidelse | Integrér: [Mautic](https://docs.mautic.org/en/7.2/) | Lovligt datagrundlag og kanalregler |
| APP-065 | Webanalyse | Måle brug af hjemmesider | Udvidelse | Integrér: [Matomo](https://matomo.org/) | Konfiguration og samtykke vurderes konkret |
| APP-066 | Kampagneplanlægning | Koordinere indhold, deadlines og kanaler | Udvidelse | Byg | Genbrug projektmodulet |
| APP-067 | Social publicering | Planlægge og sende godkendte opslag | Senere | Undersøg | API-adgang, priser og platformvilkår |
| APP-068 | SEO-arbejdsrum | Følge tekniske fejl og forbedringsopgaver | Senere | Undersøg | Crawling og datakilders vilkår |
| APP-069 | Digitalt mediebibliotek | Styre billeder, videoer og brugsrettigheder | Udvidelse | Undersøg | DAM-krav, metadata og rettighedsudløb |
| APP-070 | Design og prototyper | Designe skærmbilleder og komponenter | Udvidelse | Integrér: [Penpot](https://penpot.app/) | Eksport, SSO og edition |
| APP-071 | Brand- og skabelonbibliotek | Dele godkendte logoer og skabeloner | Udvidelse | Byg | Genbrug filbibliotek og designværktøj |
| APP-072 | Events og billetsalg | Håndtere tilmelding, billetter og adgang | Udvidelse | Integrér: [pretix](https://pretix.eu/about/en/) | Betalingsudbyder og billetdata |

## Økonomi, indkøb og administration

| ID | Modul | Formål | Bølge | Strategi og kandidat | Særlig gate |
|---|---|---|---|---|---|
| APP-073 | Finansbogføring | Registrere posteringer og regnskabsperioder | Reguleret | Integrér: [ERPNext](https://docs.frappe.io/erpnext/introduction) | Dansk bogføringsvurdering før anvendelse |
| APP-074 | Fakturering | Oprette fakturaer og kreditnotaer | Reguleret | Integrér: [ERPNext](https://docs.frappe.io/erpnext/introduction) | Nummerering, moms og opbevaring |
| APP-075 | E-faktura og Nemhandel | Udveksle strukturerede fakturaer | Reguleret | Integrér | Vælg access point og valider danske formater |
| APP-076 | Kreditor og bilagsgodkendelse | Kontrollere leverandørbilag før bogføring | Reguleret | Integrér: [ERPNext](https://docs.frappe.io/erpnext/introduction) | Godkendelse og kontrol mod indkøbsordre |
| APP-077 | Udlæg og rejseafregning | Registrere kvitteringer og godtgørelser | Udvidelse | Integrér: [Frappe HR](https://github.com/frappe/hrms) | Danske regler og økonomiintegration |
| APP-078 | Bankafstemning | Matche bankbevægelser og posteringer | Reguleret | Integrér: [ERPNext](https://docs.frappe.io/erpnext/introduction) | Bankdata via godkendt integration |
| APP-079 | Budget og prognose | Planlægge indtægter og omkostninger | Udvidelse | Integrér: [ERPNext](https://docs.frappe.io/erpnext/introduction) | Versionshistorik og autoritative tal |
| APP-080 | Likviditetsplan | Forudsige ind- og udbetalinger | Udvidelse | Byg | Beregningsmodel oven på økonomidata |
| APP-081 | Abonnementsafregning | Beregne abonnementer og forbrugsbetaling | Udvidelse | Integrér: [Lago](https://getlago.com/) | Afregning er ikke betalingsafvikling |
| APP-082 | Rykkerhåndtering | Følge forfaldne fakturaer og opfølgning | Reguleret | Integrér: [ERPNext](https://docs.frappe.io/erpnext/introduction) | Renter, gebyrer og kommunikation vurderes |
| APP-083 | Anlægskartotek | Følge aktiver og afskrivninger | Reguleret | Integrér: [ERPNext](https://docs.frappe.io/erpnext/introduction) | Regnskabsregler og historik |
| APP-084 | Indkøbsrekvisitioner | Indhente intern tilladelse til indkøb | Udvidelse | Integrér: [ERPNext](https://docs.frappe.io/erpnext/introduction) | Beløbsgrænser og funktionsadskillelse |
| APP-085 | Leverandørregister | Samle leverandører, aftaler og kontaktdata | Udvidelse | Integrér: [ERPNext](https://docs.frappe.io/erpnext/introduction) | Verifikation af betalingsoplysninger |
| APP-086 | Indkøbsordrer | Bestille og følge leverancer | Udvidelse | Integrér: [ERPNext](https://docs.frappe.io/erpnext/introduction) | Ordre, modtagelse og faktura skal kunne afstemmes |
| APP-087 | Kontraktstyring | Følge aftaler, frister og fornyelser | Udvidelse | Byg | Dokumentarkiv, signatur og påmindelser genbruges |
| APP-088 | Betalingsintegration | Gennemføre autoriseret betaling via udbyder | Reguleret | Integrér | Ingen egen opbevaring af kortdata; scopes og bekræftelse |
| APP-089 | Koncernrapportering | Samle tal fra flere selskaber | Senere | Undersøg | Valuta, eliminering og revisionsspor |
| APP-090 | Skat og momsrapportering | Forberede oplysninger til indberetning | Reguleret | Undersøg | Landespecifik validering og faglig godkendelse |

## HR, tid og læring

| ID | Modul | Formål | Bølge | Strategi og kandidat | Særlig gate |
|---|---|---|---|---|---|
| APP-091 | Medarbejderregister | Vedligeholde ansættelsesoplysninger | Udvidelse | Integrér: [Frappe HR](https://github.com/frappe/hrms) | Særligt begrænset adgang og dataminimering |
| APP-092 | Onboarding og offboarding | Koordinere udstyr, adgang og introduktion | Udvidelse | Integrér: [Frappe HR](https://github.com/frappe/hrms) | Koble til IAM og verificér tilbagekaldelse |
| APP-093 | Ferie og fravær | Ansøge, godkende og følge fravær | Reguleret | Integrér: [Frappe HR](https://github.com/frappe/hrms) | Lokale regler og begrænset sygdomsinformation |
| APP-094 | Arbejdstidsregistrering | Registrere arbejdstid og relevante afvigelser | Reguleret | Integrér: [Frappe HR](https://github.com/frappe/hrms), [Kimai](https://www.kimai.org/en/) | Krav og medarbejderinformation afklares |
| APP-095 | Vagtplanlægning | Planlægge bemanding og vagtskifte | Reguleret | Undersøg: [Frappe HR](https://github.com/frappe/hrms) | Kompetencer, hviletid og overenskomster |
| APP-096 | Løn | Beregne løn og sende lønoplysninger | Reguleret | Integrér | Brug dansk lønintegration før eventuel egen motor |
| APP-097 | Rekruttering og ATS | Organisere ansøgninger og samtaler | Reguleret | Undersøg: [Frappe HR](https://github.com/frappe/hrms) | Ingen automatisk kandidatrangering i basispakken |
| APP-098 | Medarbejdersamtaler | Dokumentere mål og samtaler | Reguleret | Integrér: [Frappe HR](https://github.com/frappe/hrms) | Følsom kontekst og ingen skjult scoring |
| APP-099 | Læringsplatform | Udgive kurser og følge gennemførelse | Udvidelse | Integrér: [Moodle](https://moodle.org/) | Dokumentér identitet og gennemført træning |
| APP-100 | Kompetencer og certifikater | Følge nødvendige kvalifikationer og udløb | Udvidelse | Byg | Genbrug læringsdata og medarbejderregister |
| APP-101 | Personalehåndbog | Dele gældende regler og dokumentere modtagelse | Udvidelse | Integrér: [BookStack](https://www.bookstackapp.com/) | Versionsbinding og tilgangskvittering |
| APP-102 | Trivselsmålinger | Indsamle medarbejderfeedback | Reguleret | Integrér: [LimeSurvey](https://www.limesurvey.org/) | Små grupper kan afsløre identiteter |

## Handel, lager og produktion

| ID | Modul | Formål | Bølge | Strategi og kandidat | Særlig gate |
|---|---|---|---|---|---|
| APP-103 | Webshop | Sælge produkter og modtage ordrer | Udvidelse | Integrér: [Medusa](https://medusajs.com/) | Betaling, forbrugerflow og driftsansvar |
| APP-104 | Produktinformation PIM | Vedligeholde produktdata på tværs af kanaler | Senere | Undersøg | Vælg PIM efter datamodel og kanaler |
| APP-105 | Ordrestyring | Koordinere ordrestatus og levering | Udvidelse | Integrér: [Medusa](https://medusajs.com/) | Entydig master for ordre og lager |
| APP-106 | Lagerstyring | Følge beholdning og bevægelser | Udvidelse | Integrér: [ERPNext Stock](https://docs.frappe.io/erpnext/stock) | Lagertransaktioner og rollbackbegrænsninger |
| APP-107 | Pluk og pak | Styre lageropgaver og pakkeforløb | Udvidelse | Integrér: [ERPNext Stock](https://docs.frappe.io/erpnext/stock) | Scannerflow og sporbarhed skal testes |
| APP-108 | Fragtintegration | Bestille fragt og udskrive labels | Udvidelse | Integrér | Transportør-APIer og eksterne omkostninger |
| APP-109 | Kassesystem POS | Registrere salg ved fysisk kasse | Reguleret | Undersøg: [ERPNext](https://docs.frappe.io/erpnext/introduction) | Landekrav, hardware og offlinehåndtering |
| APP-110 | Stregkoder og sporbarhed | Følge varer via batch og serienummer | Udvidelse | Integrér: [ERPNext Stock](https://docs.frappe.io/erpnext/stock) | Test datadækning i alle bevægelser |
| APP-111 | Produktionsplanlægning | Planlægge materialer, kapacitet og ordrer | Senere | Undersøg: [ERPNext](https://docs.frappe.io/erpnext/introduction) | Fabriksspecifik validering |
| APP-112 | Styklister og revisioner | Beskrive komponenter og versioner | Senere | Undersøg: [ERPNext](https://docs.frappe.io/erpnext/introduction) | Ændringskontrol og korrekt revision |
| APP-113 | Kvalitetskontrol | Registrere målinger og afvigelser | Senere | Undersøg: [ERPNext](https://docs.frappe.io/erpnext/introduction) | Faglige krav og revisionsspor |
| APP-114 | Vedligehold af maskiner | Planlægge eftersyn og reparationer | Senere | Undersøg | CMMS og integration til udstyr |
| APP-115 | Leverandørkvalitet | Følge reklamationer og leverancekvalitet | Senere | Byg | Genbrug indkøb og kvalitetsdata |
| APP-116 | Efterspørgselsprognose | Foreslå indkøb og lagerbehov | Senere | Byg | Mål prognosefejl; ingen automatisk storordre |

## IT, udvikling og sikkerhed

| ID | Modul | Formål | Bølge | Strategi og kandidat | Særlig gate |
|---|---|---|---|---|---|
| APP-117 | IT-service desk | Håndtere interne IT-henvendelser | Kerne | Integrér: [GLPI](https://www.glpi-project.org/en/) | Indgår i DKC-044 sammen med incident, request, CMDB og menneskelig eskalation |
| APP-118 | IT-asset management | Registrere udstyr, ejer og udlån | Udvidelse | Integrér: [Snipe-IT](https://snipeitapp.com/) | Offboarding, inventur og eksport |
| APP-119 | CMDB | Beskrive IT-komponenter og afhængigheder | Udvidelse | Integrér: [GLPI](https://www.glpi-project.org/en/) | Automatisk opdagelse kræver begrænsede rettigheder |
| APP-120 | Password manager | Dele menneskers adgangshemmeligheder sikkert | Udvidelse | Integrér: [Passbolt](https://www.passbolt.com/) | Adskilles fra agenternes secrets-broker |
| APP-121 | Enhedsadministration MDM | Konfigurere og sikre arbejdsudstyr | Senere | Undersøg | OS-support, enterprisefeatures og slettebeføjelser |
| APP-122 | Patch management | Planlægge og rulle softwareopdateringer ud | Udvidelse | Byg | Genbrug GitOps; endpoints kræver egen kandidat |
| APP-123 | Sikkerhedsovervågning SIEM | Samle og undersøge sikkerhedshændelser | Udvidelse | Integrér: [Wazuh](https://wazuh.com/) | Sensorer, alarmansvar og logretention |
| APP-124 | Sårbarhedsstyring | Prioritere og følge sikkerhedsrettelser | Udvidelse | Udbyg | Genbrug eksisterende security-plan og scannerdata |
| APP-125 | Git og kodereview | Versionere kode og behandle ændringer | Senere | Integrér: [Forgejo](https://forgejo.org/) | Platformens eget GitHub-repo flyttes ikke automatisk |
| APP-126 | CI og release | Bygge og teste software reproducerbart | Udvidelse | Integrér: [Forgejo](https://forgejo.org/) | Runnerisolering og supply-chain-kontrol |
| APP-127 | Artefaktregister | Opbevare images og releasepakker | Udvidelse | Undersøg | Signaturkontrol, adgang og retention |
| APP-128 | Udviklerportal | Vise tjenester, ejere og dokumentation | Senere | Undersøg | Hold den adskilt fra kundens appportal |
| APP-129 | Fejlsporing i apps | Indsamle fejl og relevant fejlkontekst | Udvidelse | Undersøg | Maskér persondata i payloads |
| APP-130 | API-administration | Udstille dokumenterede APIer med kvoter | Udvidelse | Byg | Fælles identitet, versioner og nøglerevokation |

## Data og automatisering

| ID | Modul | Formål | Bølge | Strategi og kandidat | Særlig gate |
|---|---|---|---|---|---|
| APP-131 | BI og dashboards | Udforske virksomhedens nøgletal | Udvidelse | Integrér: [Metabase](https://www.metabase.com/start/oss), [Apache Superset](https://superset.apache.org/) | Edition, dataroller og kundeadskillelse |
| APP-132 | Rapportplanlægning | Distribuere tilbagevendende rapporter | Udvidelse | Undersøg: [Metabase](https://www.metabase.com/start/oss), [Apache Superset](https://superset.apache.org/) | Rettigheder kontrolleres ved afsendelse |
| APP-133 | Dataintegration ETL | Flytte og omforme data mellem systemer | Udvidelse | Undersøg | Ingen uautoriserede kopier til fælles datalager |
| APP-134 | Datakatalog og lineage | Vise definitioner, ejere og dataoprindelse | Senere | Undersøg | Kobl til behandlingsregister |
| APP-135 | Masterdata og datakvalitet | Finde dubletter og modstridende værdier | Udvidelse | Byg | Ét autoritativt system pr. datatype |
| APP-136 | Automatisering af forretningsflows | Koble hændelser til tilladte handlinger | Udvidelse | Integrér: [Activepieces](https://www.activepieces.com/) | Rå connectors må ikke omgå PDP |
| APP-137 | Interne formularapps | Bygge mindre virksomhedsprocesser | Senere | Undersøg | Formularer må ikke skabe skjulte datalagre |
| APP-138 | Dokumentudtræk med AI | Foreslå strukturerede felter fra dokumenter | Udvidelse | Byg | Usikkerhed og menneskelig kontrol før bogføring |
| APP-139 | AI-assistent til medarbejdere | Besvare spørgsmål og foreslå arbejde | Udvidelse | Byg | Samme adgangsrettigheder som brugeren |

## Compliance, faciliteter og brancher

| ID | Modul | Formål | Bølge | Strategi og kandidat | Særlig gate |
|---|---|---|---|---|---|
| APP-140 | Behandlingsfortegnelse | Registrere behandlinger og ansvar | Kerne | Byg | Del af privacy-center, ikke ny separat database |
| APP-141 | Risikoregister og kontrolplan | Følge risici, kontroller og ejere | Udvidelse | Byg | Genbrug evidens og godkendelsescenter |
| APP-142 | Leverandør- og databehandlerkontrol | Følge aftaler og underleverandører | Udvidelse | Byg | Beslutninger kræver ejer, kilder og dato |
| APP-143 | Whistleblowerkanal | Modtage og behandle beskyttede henvendelser | Reguleret | Integrér: [GlobaLeaks](https://globaleaks.org/) | Særskilt adgangsmodel; ingen fælles AI-indeksering |
| APP-144 | Mødelokaler og desk booking | Reservere arbejdspladser og lokaler | Udvidelse | Undersøg | Genbrug kalender hvor muligt |
| APP-145 | Besøgsregistrering | Håndtere gæster og udløb af besøgsdata | Reguleret | Undersøg | Ingen permanent gæstelog som standard |
| APP-146 | Facility management | Følge bygninger, opgaver og serviceaftaler | Senere | Undersøg | Tilpas til ejendomsdata og serviceleverandører |
| APP-147 | Feltservice | Planlægge teknikere og dokumentere servicebesøg | Senere | Undersøg | Mobil, offline og kundeadgang |
| APP-148 | Flådestyring | Følge køretøjer, vedligehold og udgifter | Reguleret | Undersøg | Lokationsdata og medarbejderinformation |
| APP-149 | Geodata og kort | Arbejde med steder, arealer og infrastruktur | Senere | Integrér: [QGIS](https://qgis.org/) | Desktop/server-integration kræver egen driftsprofil |
| APP-150 | Byggeri og BIM | Koordinere byggesager og modelrelaterede opgaver | Senere | Undersøg: [OpenProject](https://www.openproject.org/docs/getting-started/openproject-introduction/) | BIM-dækning og faglige processer verificeres |
| APP-151 | CAD og teknisk konstruktion | Udarbejde tekniske tegninger og modeller | Senere | Undersøg | Desktopsoftware, formater og GPU kan kræve særskilt løsning |
| APP-152 | Laboratoriestyring LIMS | Følge prøver, analyser og sporbarhed | Reguleret | Undersøg | Validering og branchekrav før produktvalg |
| APP-153 | Klinik- og journalsystem | Håndtere kliniske forløb og journaler | Reguleret | Undersøg | Helbredsdata, autorisation og sektorspecifik vurdering |
| APP-154 | Hotel- og reservationssystem | Styre værelser, ophold og bookingkanaler | Senere | Undersøg | Channel manager og betalingsintegration |
| APP-155 | Medlems- og foreningssystem | Følge medlemmer, kontingenter og arrangementer | Senere | Undersøg | Rettigheder, børnedata og betaling efter behov |
| APP-156 | Transportplanlægning | Planlægge ture, last og leveringer | Reguleret | Undersøg | Rute-, køre-/hviletids- og telematikbehov |
| APP-157 | ESG- og klimadata | Samle aktivitetsdata og beregninger | Reguleret | Undersøg | Versionsstyrede faktorer og gældende rapporteringskrav |

## Skalering, kontinuitet og kontrolleret selvreparation

| ID | Modul | Formål | Bølge | Strategi og kandidat | Særlig gate |
|---|---|---|---|---|---|
| APP-158 | Distribueret klyngedrift | Fordele workloads over flere servere og fejldomæner | Kerne | Integrér | Quorum og N+1 skal bevises i DKC-038 |
| APP-159 | Service discovery og intern trafik | Finde tjenester og beskytte kommunikation mellem servere | Kerne | Integrér | Redundant ingress/DNS og faktiske netværkspolitikker |
| APP-160 | Database-HA og PITR | Bevare transaktioner og gendanne til valgt tidspunkt | Kerne | Integrér | Fencing, consistency og RPO pr. fejltype |
| APP-161 | Replikeret fil- og objektlager | Bevare filer ved host- eller diskfejl | Kerne | Integrér | Valideret storageprofil og checksums |
| APP-162 | Holdbar eventbus | Udveksle hændelser og opgaver mellem tjenester | Kerne | Integrér | Bekræftelser, replay, outbox og idempotency |
| APP-163 | Deduplikering og backupkatalog | Reducere kopier og bevare verificerbar gendannelse | Kerne | Integrér | Tenantgrænser, retention og sikker prune |
| APP-164 | AI-immutable datalager | Beskytte udvalgte versioner mod AI-ændring og sletning | Kerne | Byg | Storage- og KMS-kontrol uden for AI-rettigheder |
| APP-165 | Runbook- og healingcontroller | Udføre begrænset selvreparation med fallback | Kerne | Byg | Versionsbundet menneskelig godkendelse og fuldt auditspor |
| APP-166 | Change- og releasekalender | Koordinere godkendte ændringer og vedligehold | Kerne | Byg | Standard, normal og emergency change har tydelige autoriteter |
| APP-167 | Problem- og known-error-register | Følge årsager og gentagne servicefejl | Kerne | Integrér: [GLPI](https://www.glpi-project.org/en/) | Kandidatens procesdækning verificeres før valg |
| APP-168 | ITSC- og katastrofeberedskab | Prioritere og øve genetablering af forretningsservices | Kerne | Byg | Menneskelig ejer og uafhængig recoveryadgang |
| APP-169 | Kapacitet og servicelevels | Måle belastning, vækst og leveret tilgængelighed | Kerne | Udbyg | Målte SLOer pr. kundepakke og fejlsituation |

## Fælles leverancekrav for hver ny app

1. Verificér behov, brugere og hvilken eksisterende software kunden faktisk vil erstatte.
2. Vælg upstream-version/edition og dokumentér licens, vedligeholdelse og nødvendige betalte features.
3. Definér dataejer, tenantgrænse, autoritativ datakilde og API-kontrakt.
4. Implementér identitet, PDP, audit og begrænsede operationer uden åbne omveje til upstream.
5. Dokumentér hvert ops- og privacy-verbum som full, partial eller unsupported med live evidens.
6. Bevis backup/restore, sikker opgradering, migration, eksport og exit.
7. Mål driftspris og supportbehov; udpeg ejer og tillad kun den testede produktprofil.

En app er først klar til kunder, når denne gate er opfyldt. Kandidatlister må ikke bruges som løfte om gratis enterprise-funktionalitet eller om fuld erstatning af alle funktioner i en kommerciel suite.
