# Katalog metrik Gradusu

Závazný seznam toho, co se měří a jak. Každá metrika odsud musí mít definici v `src/lib/analytics/metrics.ts` a místo v administraci.

## Obecná pravidla

- **Interní účty se nepočítají.** Majitel, demo účet a testovací účty mají `is_internal = true` a jsou ze všech metrik vyloučené, pokud se v administraci výslovně nezapnou.
- **Aktivní uživatel** = aspoň jedna smysluplná akce za období (založení, úprava, přesun, odeslání, dokončení). Samotné přihlášení nebo zobrazení stránky nestačí.
- **Žádný obsah.** Měří se počty, časy, stavy a typy — nikdy jména, telefony, e-maily, názvy firem a obchodů, texty úkolů, zprávy Jarvisovi ani poznámky.
- **Segmenty** pro všechny metriky: plán (beta / zkušební / solo / pro / tým), režim (hra / běžný), obor, jazyk, země, role (majitel / pracovník), zařízení, týden registrace.
- **Peníze v různých měnách** se nesčítají dohromady. Hodnoty obchodů a transakcí se zobrazují po měnách.

## 1. Růst a uživatelé

- Registrace — nové účty za období, po dnech
- Celkem uživatelů — kumulativně
- Čekací listina — přihlášení, potvrzení, míra potvrzení, převod na účet
- DAU, WAU, MAU — aktivní za den, 7 a 30 dní
- Stickiness — DAU / MAU
- Noví vs. vracející se aktivní
- Rozdělení podle plánu, režimu, oboru, jazyka, země, zařízení, prohlížeče
- Pracovníci — počet, aktivní, průměr na majitele

## 2. Aktivace

- Trychtýř: registrace → onboarding dokončen → první milník → první splněný úkol → první kontakt → první obchod → první domluvená schůzka → první vyhraný obchod. Procento a medián času mezi kroky.
- Doba do hodnoty — medián času od registrace k první domluvené schůzce
- Onboarding — dokončení a krok, na kterém lidé odpadají
- Jarvisův průvodce — dokončen / přeskočen / na kterém kroku
- Aktivovaný uživatel — do 7 dnů od registrace aktivní aspoň 3 různé dny a ve 2 různých sekcích; podíl

## 3. Retence a zapojení

- Kohortová tabulka — týdny registrace × % aktivních v týdnu 1 až 12
- Retence D1, D7, D30
- Odpadlí — dřív aktivní, 14 dní bez akce
- Relace na uživatele za den a týden, délka relace (medián, p90), čas v aplikaci za den
- Aktivní dny v týdnu — rozdělení 1 až 7
- Kdy aplikaci používají — heatmapa den v týdnu × hodina
- Návraty vyvolané Jarvisovou bublinou nebo e-mailem

## 4. Funkce

U každé sekce: adopce (% aktivních, kteří ji použili), počet akcí, akce na uživatele, trend.

**Milníky** — vytvořené (z kapitoly / vlastní), dokončené, míra a medián doby dokončení, úkoly a podúkoly vytvořené a splněné, hloubka stromu, podíl pohledů Seznam / Mapa / Cesta, vyplněná odměna (%), vyžádané AI hodnocení

**Pipeline** — obchody vytvořené, přesuny, výhry, prohry, míra výhry, průměrná a celková hodnota po měnách, medián času ve fázi, uživatelé s upravenými fázemi, použité „znovu oslovit"

**Kontakty** — přidané ručně / vygenerované, přesuny mezi tabulkami, vytvořené vlastní tabulky a pole, vyplněnost e-mailu, telefonu a webu (%), zachycené duplicity, zaznamenané aktivity

**Generování kontaktů** — dávky, vyžádáno / uloženo / duplicity, chybovost podle kódu chyby, uživatelé na denním a měsíčním stropu (%), nejčastější hledané obory jako souhrn normalizovaných klíčových slov (top 20, bez vazby na uživatele)

**Cold Calling** — odvolané hodiny celkem a na uživatele, relace časovače, automatické pauzy (%), oslovení (přesuny z Neoslovených), konverze oslovení → schůzka, → neúspěch podle důvodu, schůzky na hodinu volání

**Kalendář** — události podle typu, připojený Google (%), chyby synchronizace

**Finance** — transakce, vystavené faktury, připojený Fakturoid (%), automatické platby

**Pracovníci** — pozvánky odeslané / přijaté / vypršelé, aktivní pracovníci, zadané a splněné úkoly, schválené výdělky

**Vyhledávání** — hledání, otevřené výsledky, míra hledání bez výsledku, ⌘K vs. kliknutí, použité rychlé akce

**E-mail** — odeslané, vyžádané a použité AI návrhy

**Nastavení** — rozdělení jazyka, měny, země, motivu; vypnuté animace, zvuky a Jarvisova iniciativa

## 5. AI a Jarvis

- Volání podle funkce (chat, hodnocení milníku, noční analýza, hlídání, návrh e-mailu, rozbor schůzek, nastavení odměn) a podle modelu
- Tokeny vstup / z mezipaměti / výstup, míra zásahu mezipaměti
- Náklady v USD a Kč — celkem, na aktivního uživatele, na funkci, 10 nejnákladnějších uživatelů (jen identifikátor a plán)
- Konverzace a zprávy na uživatele, délka konverzace
- Latence p50 a p95, chybovost podle kódu
- Soubory — počet, typy, velikost, odmítnuté a proč
- Proaktivní bubliny — zobrazeno, Udělat, Ukázat, Později, Zavřít, bez reakce; míra přijetí podle typu (postřeh / návrh / otázka)
- Automatické akce Jarvise a kolik z nich uživatel vrátil
- Hodnocení odpovědí palcem nahoru / dolů
- Uživatelé na AI stropu (%)

## 6. Hra

- Podíl hra / běžný režim, přepnutí oběma směry a kdy po registraci
- Rozdělení úrovní, XP za den, zdroje XP
- Kapitoly — dokončení podle pořadí (kde se lidé zasekávají), podle oboru
- Odemčení sekcí — doba od registrace
- Odznaky — rozdělení, nejvzácnější
- Série — rozdělení délek, zamrazení
- Zobrazené oslavy

## 7. Náklady a ekonomika

- Náklady na AI, Google Places (požadavky × cena z konfigurace), e-maily (počet × cena)
- Náklad na aktivního uživatele za měsíc, podle plánu
- Odhad marže proti ceníku
- Zkušební období — běžící, končící tento týden, vypršelá, klepnutí na „Mám zájem", převod

## 8. Technické zdraví

- Chybovost serverových rout a funkcí, nejčastější chyby
- Latence stránek a rout p50 a p95
- Chyby v prohlížeči podle stránky
- Naplánované úlohy — poslední běh, úspěch, doba
- Integrace — chybovost Google Places, Fakturoid, Resend, Google Kalendář, Anthropic

## 9. Zpětná vazba

- Nápady od uživatelů — seznam a stav
- Otázka po 7 dnech používání: „Jak pravděpodobně bys Gradus doporučil?" 0–10 a volitelný komentář → NPS, rozdělení, komentáře
- Hodnocení Jarvisových odpovědí

## 10. Detail uživatele

Plán a stav, registrace, poslední aktivita, obor, režim, úroveň, aktivní dny, časová osa událostí (typy, ne obsah), využití sekcí, spotřeba a náklad AI, generování, pracovníci, zpětná vazba. Bez obsahu kontaktů, obchodů, úkolů a zpráv.

## 11. Průzkumník

Libovolná událost z katalogu × výpočet (počet, unikátní uživatelé, součet nebo průměr číselné vlastnosti) × období × seskupení (den / týden / měsíc) × segment. Pohledy jdou uložit.
