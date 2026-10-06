# Web — kolo 3

Instrukce pro Claude Code. Proveď kroky 1 až 4 přesně a doslova. Obsah k vložení je vždy mezi řádky `=== ZAČÁTEK` a `=== KONEC`. Prompty samotné neprováděj — provedou se příkazem `/pokracuj`.

---

## Krok 1 — Na konec `docs/plan.md` přidej tohle

=== ZAČÁTEK

---

# FÁZE 10 — Domovský web, zkušební období, veřejná registrace

## Prompt 10.1 — Struktura webu, veřejná registrace a zkušební období · **Opus 5.5**

```
Gradus dostane veřejný domovský web ve stejném projektu. Tenhle prompt
připraví strukturu a přihlašování; vzhled a texty webu přijdou v dalším.

STRUKTURA ADRES
- Marketingový web v route group src/app/(marketing): / (domovská), /cenik,
  /podminky, /soukromi. V angličtině /en, /en/pricing, /en/terms, /en/privacy.
- Aplikace se přesune pod /app: /app (dashboard), /app/milniky atd. Všechny
  staré adresy přesměruj na nové (301). Projdi kód a oprav každý odkaz.
- Přihlášení a registrace zůstávají v (auth): /prihlaseni, /registrace,
  /zapomenute-heslo a jejich anglické varianty.
- Middleware: přihlášený uživatel na / jde na /app; nepřihlášený na /app
  jde na /prihlaseni a po přihlášení zpět, kam chtěl.
- Marketingový web má vlastní layout bez sidebaru a bez Jarvisova tlačítka,
  vlastní hlavičku (logo, Funkce, Ceník, přepínač jazyka, Přihlásit se,
  tlačítko Vyzkoušet zdarma) a patičku.
- Jazyk webu: čeština výchozí, angličtina na /en. Detekce podle prohlížeče
  jen při prvním příchodu na /, pak podle adresy. Texty webu v překladech
  pod jmenným prostorem marketing.

PŘEPÍNAČ VEŘEJNÉ REGISTRACE
Proměnná PUBLIC_SIGNUP_ENABLED (true / false, výchozí false), čtená jen na
serveru.
- false: registrace dál vyžaduje pozvánkový kód (beta). Tlačítka na webu
  místo registrace otevírají ČEKACÍ LISTINU: pole na e-mail, uložení do
  tabulky waitlist (email, locale, source, created_at, confirmed_at),
  potvrzovací e-mail přes Resend s odkazem, který confirmed_at nastaví.
  Text tlačítka „Chci vědět o spuštění", po odeslání poděkování.
- true: registrace bez kódu, přímo z webu. Tlačítko „Vyzkoušet 14 dní
  zdarma".
Pozvánky pracovníků fungují v obou režimech beze změny.

ZKUŠEBNÍ OBDOBÍ
Při registraci bez pozvánky vznikne subscription: plan_key = pro,
status = trialing, trial_ends_at = teď + 14 dní, bez platební karty.
Účty založené s pozvánkovým kódem dostanou plan_key = beta bez expirace.
- V aplikaci během zkušebního období nenápadný pruh nad obsahem: „Zkušební
  období · zbývá 9 dní" s odkazem Vybrat tarif. Posledních 3 dny výraznější.
- Po skončení: aplikace přejde do režimu jen pro čtení — data vidí, nic
  nového nezaloží — a nahoře zobrazí kartu s výzvou k výběru tarifu.
  Žádné mazání dat.
- Stránka /app/tarif: tři tarify jako na webu a zatím místo platby
  tlačítko „Mám zájem", které pošle majiteli e-mail a uživateli poděkuje
  — platební brána přijde zvlášť.
- Do majitelského přehledu přidej počty: na zkušebním období, po expiraci,
  na čekací listině.

Serverová funkce current_plan(user_id) vrátí plán a stav. Limity
generování a AI berou plán odsud.

CLAUDE.md: doplň sekci Prostředí o PUBLIC_SIGNUP_ENABLED a sekci Data
o pravidla zkušebního období. Testy: registrace v obou režimech, vznik
trialing subscription, přechod do režimu jen pro čtení po expiraci.
Commit po částech.
```

## Prompt 10.2 — Domovská stránka: design a texty · **Opus 5.5**

```
Postav domovskou stránku Gradusu. Má být minimalistická, moderní, s
krásnými animacemi a má prodávat. Použij stejný design systém jako
aplikace — tmavé pozadí s jemnou mřížkou a zářemi, fialová a tyrkysová —
ale s mnohem víc prostoru, větším písmem a méně prvky na obrazovku.
Jedna myšlenka na sekci.

PRAVIDLA TEXTŮ
Jasně před chytře. Přínos před funkcí. Konkrétně před obecně. Žádné
vykřičníky, žádné „inovativní", „revoluční", „streamline". Žádná vymyšlená
čísla, žádné vymyšlené recenze — web je před spuštěním a říkáme to
na rovinu. Tykání, přátelsky, ne korporátně. Texty níž jsou základ,
který můžeš zlepšit, ne oslabit. Anglickou verzi přelož se stejným tónem,
ne doslova.

HLAVIČKA
Logo Gradus vlevo. Uprostřed Funkce, Jak to funguje, Ceník (kotvy).
Vpravo přepínač CS/EN, Přihlásit se (text), Vyzkoušet zdarma (fialové
tlačítko). Při posunu se hlavička zúží a dostane skleněné pozadí. Na
telefonu hamburger s plným menu.

1. ÚVOD
Nadpis (vyber a odůvodni, nebo navrhni lepší v tomhle duchu):
  A) Podnikání, které víš, jak hrát.
  B) Z nápadu k první faktuře. Krok za krokem.
  C) Každý den víš, co udělat. A chce se ti to.
Podnadpis: „Gradus rozloží rozjezd tvého podnikání na kroky, hlídá
obchody i kontakty a každé ráno ti řekne, co dnes udělat. Když to splníš,
oslaví to s tebou."
Tlačítka: hlavní „Vyzkoušet 14 dní zdarma" (nebo čekací listina podle
přepínače), pod ním drobně „Bez platební karty. Zrušíš kdykoliv."
Vedlejší: „Podívat se, jak to vypadá" — plynule sjede k ukázce.
Pod textem velký snímek dashboardu aplikace v rámečku s jemným
perspektivním náklonem, který se při posunu narovná (parallax). Snímky
ber z /public/screenshots — pokud tam ještě nejsou, použij zástupný
rámeček se stejnými rozměry, snímky doplní další prompt.
Nadpis a text nastupují slovo po slově s krátkým zpožděním.

2. POZNÁVÁŠ SE?
Nadpis: „Zní ti to povědomě?"
Čtyři karty v řadě, ikona a dvě věty:
- Tabulky všude. Kontakty v jednom souboru, faktury ve druhém, plán nikde.
- Zapomenuté follow-upy. „Ozvu se příští týden" a příští týden je pryč.
- Nevíš, co dnes. Práce je dost, ale která z nich posune firmu?
- Motivace mizí. Výsledky přijdou za měsíce, chuť zmizí za týden.
Karty nastupují se stagger efektem při vjezdu do obrazu.

3. JEDEN SYSTÉM MÍSTO PĚTI NÁSTROJŮ
Střídavé bloky text–obraz, šest funkcí, každá s nadpisem, dvěma větami
a snímkem obrazovky, který se při posunu jemně posune a zaostří:
- Milníky a kapitoly — „Vyber obor a dostaneš plán: kapitoly s úkoly,
  které v tvém oboru dávají smysl. Nebo si napiš vlastní."
- Pipeline obchodů — „Vidíš, kde každý obchod stojí. Přetáhneš ho dál.
  Když zaplatí, Gradus to oslaví."
- Kontakty a Cold Calling — „Vygeneruj firmy ve svém okolí, obvolávej je
  s časovačem a posouvej mezi tabulkami. Nic se neztratí."
- Kalendář — „Schůzky, termíny úkolů a uzavření obchodů na jednom místě.
  Synchronizace s Googlem."
- Finance — „Zaplacený obchod se propíše sám. Faktura na jedno klepnutí."
- Jarvis — „Asistent, který zná tvůj byznys. Ráno ti řekne, co udělat,
  a večer, co se stalo."

4. JAK TO FUNGUJE
Tři kroky vedle sebe, čísla, krátce:
1. Vyber svůj obor — Gradus ti připraví kapitoly a první úkoly.
2. Pracuj po krocích — úkoly, kontakty, schůzky, obchody. Jarvis hlídá
   termíny.
3. Odemykej dál — každá splněná kapitola otevře novou část aplikace.
Pod tím věta: „Nechceš hrát? Vypni to. Gradus funguje i jako obyčejný
nástroj."

5. JARVIS
Nadpis: „Seznam se s Jarvisem." Velká animovaná postavička (komponenta
Jarvis) vlevo, vpravo ukázka chatu, kde se zprávy píší samy a opakují
ve smyčce: uživatel se zeptá na obchod, Jarvis odpoví s konkrétním
návrhem a tlačítkem. Tři body pod tím: zná celý tvůj byznys · sám hlídá
příležitosti · poradí s obchodem i cenou. Jarvisovy oči sledují kurzor.

6. HRA
Nadpis: „Podnikání, které tě odměňuje." Vlevo text o kapitolách,
úrovních a oslavách, vpravo živá ukázka: karta milníku, u které se
po vjezdu do obrazu odškrtne poslední úkol a spustí se zmenšená oslava
s konfetami (jen jednou, pak tlačítko Přehrát znovu).

7. PRO KOHO
Nadpis: „Postavené pro lidi, kteří začínají." Osm dlaždic oborů z herního
systému s ikonou — řemeslník, konzultant, e-shop, gastro, osobní služby,
kreativec, IT, ostatní. Po najetí dlaždice ukáže první kapitolu toho oboru.

8. CENÍK (kotva #cenik, i samostatná stránka /cenik)
Přepínač Měsíčně / Ročně (ročně = dva měsíce zdarma). Tři karty:
- Solo — 490 Kč měsíčně — pro jednoho. Všechny sekce, 100 vygenerovaných
  kontaktů měsíčně, Jarvis.
- Pro — 890 Kč měsíčně — DOPORUČENO, zvýrazněná karta. 300 kontaktů
  měsíčně, AI rozbor schůzek, soubory do Jarvise, synchronizace kalendáře,
  přednostní podpora.
- Tým — 890 Kč měsíčně + 290 Kč za každého pracovníka. Vše z Pro,
  pracovníci s právy, systém odměn, týmové statistiky.
Ceny bez DPH, pod kartami drobně. V angličtině zobraz EUR: 19 / 35 / 35 + 12.
Pod kartami: „Všechny tarify začínají 14 dny zdarma. Bez karty." a odkaz
na FAQ. Čísla ber z jednoho konfiguračního souboru, ne natvrdo v komponentě.

9. ČASTÉ OTÁZKY
Rozbalovací, animované:
- Potřebuju platební kartu? — Ne. 14 dní zkoušíš bez karty, pak si vybereš.
- Můžu zrušit? — Kdykoliv, jedním klepnutím. Data si můžeš exportovat.
- Funguje to na telefonu? — Ano, celá aplikace. Nativní aplikace připravujeme.
- Musím hrát? — Ne. Herní režim se dá vypnout a Gradus je obyčejný nástroj.
- Co dělá AI s mými daty? — Jarvis vidí jen tvoje data a používá je jen
  pro tebe. Nikdy netrénujeme modely na datech zákazníků.
- Pro koho Gradus není? — Pro firmy s desítkami obchodníků a složitými
  procesy. Je pro lidi, kteří začínají nebo jedou v malém týmu.
- Odkud jsou kontakty? — Z veřejných údajů o firmách. Hlídáme limity
  i ochranu osobních údajů.

10. ZÁVĚREČNÁ VÝZVA
Velký nadpis: „Začni dnes. Za 14 dní budeš vědět." Tlačítko, pod ním
„Bez karty. Zrušíš kdykoliv. Data jsou tvoje."
Pod tím krátká poznámka zakladatele, pravdivá: „Gradus stavíme s prvními
podnikateli v betě. Tohle není hotový produkt velké firmy — je to nástroj,
který roste s vámi, a každý nápad od vás čteme." Podpis jménem majitele
(z profilu majitelského účtu, ne natvrdo).

PATIČKA
Logo, Funkce, Ceník, Přihlásit se, Podmínky, Soukromí, Kontakt (e-mail
majitele z konfigurace), přepínač jazyka, © rok Gradus.

ANIMACE A VÝKON
Všechny animace Framer Motion přes transform a opacity, spouštěné při
vjezdu do obrazu, jednou. Respektuj reduced-motion. Stránka staticky
generovaná, obrázky přes next/image s rozměry, písma lokálně. Cíl:
Lighthouse 95+ na mobilu, LCP pod 2 s. Žádné sledovací cookies, takže
žádná cookie lišta.

Stránky /podminky a /soukromi: zatím struktura s nadpisy a viditelným
upozorněním „Připravujeme", texty dodá právník.

SEO: title a description pro každou stránku v obou jazycích, Open Graph
obrázek (vygeneruj přes next/og s názvem a nadpisem na tmavém pozadí),
sitemap, robots, hreflang pro cs/en, strukturovaná data SoftwareApplication
s cenami.

Commit po částech.
```

## Prompt 10.3 — Snímky aplikace a kontrola webu · **Sonnet 5**

```
Web potřebuje skutečné snímky aplikace, ne zástupné rámečky. Udělej to
tak, aby šly kdykoliv znovu vygenerovat jedním příkazem.

1. UKÁZKOVÝ ÚČET. Skript bun run demo:seed vytvoří (nebo obnoví) účet
   demo@gradus.local s pěknými, realistickými, ale smyšlenými daty v
   češtině: 6 milníků v různých fázích, 14 obchodů napříč pipeline,
   30 kontaktů v různých tabulkách, události v kalendáři na tento měsíc,
   transakce za 6 měsíců, dva pracovníci, odvolaný čas za 3 týdny, úroveň 7.
   Jména firem i lidí smyšlená, ne skutečné firmy. Skript je idempotentní.

2. SNÍMKY. Skript bun run screenshots přes Playwright přihlásí demo účet,
   nastaví viewport 1440×900 a tmavý motiv a vyfotí: dashboard, milníky
   (pohled Cesta), detail milníku s mapou, pipeline, kontakty, cold
   calling, kalendář (měsíc), finance, Jarvisův panel s otevřeným chatem.
   Plus mobilní 390×844 pro dashboard, pipeline a cold calling. Před
   každým snímkem počkej na načtení dat a dokončení animací. Ulož do
   /public/screenshots jako WebP, 2× rozlišení.

3. ZAPOJENÍ. Nahraď zástupné rámečky na webu skutečnými snímky přes
   next/image s rozměry a alt texty v obou jazycích. Mobilní snímky
   použij v sekci Funkce u Cold Callingu a v hlavičce na telefonu.

4. KONTROLA WEBU. Projdi domovskou stránku a ceník na 1440, 1024, 768
   a 390 px: zalomení nadpisů, přetékání, překrývání, čitelnost na
   zářích. Spusť Lighthouse na mobilu a oprav, co je pod 95. Ověř, že
   přepínač jazyka drží adresu, že Přihlásit se vede do aplikace a že
   tlačítko zkušebního období nebo čekací listiny funguje podle
   PUBLIC_SIGNUP_ENABLED.

Commit.
```

## Kontrola fáze 10 · **Opus 5.5**

```
Zkontroluj kolo 3. Priority: žádná adresa aplikace nezůstala nedostupná
po přesunu pod /app (projdi všechny odkazy, přesměrování, e-maily
s odkazy, pozvánky pracovníků); nepřihlášený uživatel se do /app
nedostane a přihlášený neuvízne na marketingovém webu; zkušební období
nejde obejít z klienta a režim jen pro čtení skutečně blokuje zápisy
na serveru; čekací listina neukládá e-mail bez souhlasu a potvrzení;
na webu nejsou žádná vymyšlená čísla ani recenze; ceny jdou z jednoho
místa; všechny texty v obou jazycích. Oprav, pusť lint, test a build.
```

=== KONEC

---

## Krok 2 — Do `docs/progress.md` vlož tyhle řádky těsně PŘED řádek začínající `- [ ] 7.1`

=== ZAČÁTEK
- [ ] 10.1 | architect | env: RESEND_API_KEY
- [ ] 10.2 | architect |
- [ ] 10.3 | builder |
- [ ] K10 | reviewer |
- [ ] STOP | Konec kola 3. Otevři / odhlášený — musí být web, ne aplikace. Přihlas se přes Přihlásit se a ověř, že skončíš v /app a staré adresy přesměrují. Projdi web na počítači i telefonu, přepni jazyk. S PUBLIC_SIGNUP_ENABLED=false zkus čekací listinu a ověř, že přišel potvrzovací e-mail. Pak přepni na true, restartuj dev server, založ nový účet z webu a ověř pruh se zkušebním obdobím. Řekni Vášovi, ať si web projde — je to jeho část.
=== KONEC

---

## Krok 3 — Uprav `CLAUDE.md`

a) Do sekce Struktura přidej řádky:
`- src/app/(marketing)/ — veřejný web (/, /cenik, /podminky, /soukromi, anglicky pod /en), vlastní layout bez aplikace`
`- src/app/(app)/ je pod adresou /app`
`- src/config/pricing.ts — ceny a limity tarifů na jednom místě`

b) Do sekce Prostředí přidej řádek do tabulky:
`| PUBLIC_SIGNUP_ENABLED | true = registrace bez kódu a 14denní zkušební období; false = jen pozvánky a čekací listina |`

c) Do sekce Data přidej řádek:
`- **Zkušební období:** registrace z webu = plan pro, status trialing, 14 dní, bez karty. Po expiraci režim jen pro čtení vynucený na serveru, data se nemažou. Pozvánka = plan beta bez expirace.`

d) Do sekce Pravidla přidej podsekci `### Web` s řádky:
`- Marketingový web: čeština výchozí, angličtina pod /en. Žádná vymyšlená čísla, recenze ani loga. Žádné sledovací cookies. Snímky aplikace jen z bun run screenshots nad demo účtem.`

---

## Krok 4 — Dokončení

Ověř `git check-ignore -v .env.local`, commitni, pushni a napiš uživateli česky, kolik položek přibylo, že má napsat `/clear` a pak `/pokracuj`, a že před spuštěním 10.1 musí mít v `.env.local` klíč RESEND_API_KEY.
