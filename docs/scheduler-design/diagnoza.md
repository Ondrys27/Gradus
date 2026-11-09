# Veřejná rezervační stránka: diagnóza a směr (24.5)

Snímky „před“ jsou v `before/`, „po“ v `after/` (`bun scripts/scheduler-design-shots.ts before|after [scéna]`).

## Kde to před 24.5 vypadalo jako formulář, ne jako pozvánka

- **Dvě stejně těžké karty pod sebou.** „Vyberte termín“ a „Vaše údaje“ jsou dva stejné obdélníky se stejným nadpisem; stránka čte jako nastavení, ne jako pozvání k jednomu člověku. Na telefonu je to jedna dlouhá rolovačka: kalendář, pod ním osm pilulek s časy, pod tím čtyři pole.
- **Hostitel je drobnost v rohu.** Avatar 56 px a tři řádky textu stejnou velikostí jako popis schůzky; jméno hostitele je menší než nadpis „Vyberte termín“. Přitom je to první (a jediný) člověk na stránce.
- **Pásmo křičí, termín šeptá.** Vyhledávací combobox časového pásma je největší prvek v hlavičce panelu; vybraný den a čas jsou jen dvě obarvené dlaždice bez vztahu k tomu, co se vyplňuje dole.
- **Volné dny nejsou od nevolných k rozeznání na první pohled.** Všechny volné dny mají stejné fialové podbarvení, takže vybraný den se ztrácí mezi dvaceti dalšími; nevolné jsou jen o něco bledší.
- **Potvrzení je hláška.** Zelená fajfka, jeden řádek „Konzultace 30 min · út 10. 11. 03:00“ a dvě tlačítka. Žádné velké datum, žádné „přidat do kalendáře“, „čeká na potvrzení“ bez vysvětlení, co se stane dál. Nic z toho neříká „povedlo se“.
- **Značka jako nálepka.** Logo aplikace s vlastní září vlevo, segmentový přepínač jazyka vpravo jako v aplikaci, dole osamělý řádek „Vytvořeno v Gradus“. Po skrytí doplňkem zůstane prázdná hlavička.
- **Pozadí je mrtvé.** Holé plátno bez pohybu; stránka nemá nic, co by ji odlišilo od šablony.
- **Typografie aplikace, ne webu.** Inter všude; web Gradusu má v titulcích Bricolage Grotesque, veřejná stránka by k němu měla patřit.

## Směr

- Vlevo **pozvánka**: karta s hostitelem (foto, jméno v titulkovém písmu, co dělá, firma) a schůzkou (název, co si host odnese, délka, místo); nahoře tenká linka v barvě značky. Vpravo **kalendář a časy**, pak ve stejném panelu údaje s velkým zvoleným termínem a tlačítkem zpět. Na telefonu tři kroky za sebou (den → čas → údaje) s posunem a tlačítkem zpět, s tenkou linkou kroků nahoře.
- Volné dny tiše čitelné (plné číslo s tyrkysovou tečkou), nevolné bledé bez pozadí, vybraný den a čas „sedí“: fialová plocha, jediná záře na obrazovce.
- Pásmo ustoupí na jeden řádek pod časy („Časy v pásmu Europe/Prague · Změnit“).
- Pozadí v pohybu jen přes CSS (žádná smyčka v JavaScriptu): řídká mřížka teček pomalu pluje, pod ní se vlní tři tenké linky, nad tím jedna široká barevná plocha pomalu dýchá. Vše maskované od středu, kde se čte; při `prefers-reduced-motion` stojí.
- Potvrzení jako oslava: krátké konfety jako v aplikaci, velké datum a čas, Přidat do kalendáře (Google, Apple/ICS, Outlook), odkaz na videohovor, „čeká na potvrzení“ řečené lidsky.
- Značka: lockup s titulkovým písmem v hlavičce, dole kolofon oddělený linkou. Se skrytou značkou stojí v hlavičce jméno firmy hostitele, takže díra nevznikne.

## Měření pozadí

`bun scripts/scheduler-design-shots.ts cpu` otevře stránku v telefonním okně (390 px) se 4× zpomaleným procesorem a deset sekund nic nedělá:

| Pohyb | Hlavní vlákno | Skript | Layout |
|---|---|---|---|
| bez omezení | 0,03 % | 0 ms | 0 ms |
| `prefers-reduced-motion: reduce` | 0,01 % | 0 ms | 0 ms |

Pozadí animuje jen `transform` a `opacity` na vlastních vrstvách, takže práci dělá kompozitor a hlavní vlákno spí; měření kompozitor nezachytí, ale právě to drží cenu u pár procent i na slabém telefonu. Žádné `filter: blur`, žádný JavaScript ve smyčce.
