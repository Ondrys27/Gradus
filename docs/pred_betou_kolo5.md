# Před betou — kolo 5

Instrukce pro Claude Code. Proveď kroky 0 až 4 přesně a doslova. Obsah k vložení je vždy mezi řádky `=== ZAČÁTEK` a `=== KONEC`. Prompty samotné neprováděj — provedou se příkazem `/pokracuj`.

---

## Krok 0 — Subagent pro Fable

a) Vytvoř soubor `.claude/agents/designer.md`:

=== ZAČÁTEK
---
name: designer
description: Vizuální návrh a přestavba rozhraní Gradusu — web, typografie, rozvržení, animace. Pro úkoly, kde rozhoduje vkus a celkový dojem.
model: fable
---
Jsi seniorní produktový designér a frontendový vývojář na projektu Gradus. Dostaneš jeden prompt z plánu přestavby, ve kterém jde hlavně o vzhled a dojem.

Pravidla:
1. Nejdřív si přečti CLAUDE.md a drž se ho doslova, hlavně sekci Rozhraní a Web.
2. Než začneš psát kód, udělej si diagnózu současného stavu a promysli směr. Rozhoduj se s vkusem, ne podle šablony.
3. Udělej přesně to, co je v promptu. Co prompt říká zachovat, nech beze změny.
4. Než skončíš, spusť `bun run lint`, `bun run test` a `bun run build` a oprav všechno, dokud neprojdou.
5. Nikdy nečti, nevypisuj ani nekopíruj obsah `.env.local`. Nikdy nespouštěj `supabase db reset` ani nic, co maže data.
6. Na konci udělej commit s anglickým popisem.
7. Vrať krátké shrnutí česky ve třech částech: **Hotovo**, **Zkontroluj ručně** (konkrétní kroky), **Otevřené**. Maximálně 15 řádků.
=== KONEC

b) V `.claude/commands/pokracuj.md` v kroku 6 nahraď text `(`builder`, `architect` nebo `reviewer`)` textem `(`builder`, `architect`, `designer` nebo `reviewer`)`.

c) Pokud Claude Code model `fable` nezná, přepiš v `designer.md` řádek na `model: claude-fable-5-1`. Když neprojde ani ten, nastav `model: opus` a uživateli to napiš.

---

## Krok 1 — Na konec `docs/plan.md` přidej tohle

=== ZAČÁTEK

---

# FÁZE 12 — Připraveno pro beta testery

## Prompt 12.1 — Jarvis na API kreditech · **Opus 5.5**

```
Jarvis teď poběží na měsíčních API kreditech z předplatného Claude Max
(100 USD měsíčně, propadají na konci cyklu, po vyčerpání API přestane
odpovídat až do dalšího přídělu). Připrav na to aplikaci.

1. MODELY. V src/features/jarvis/models.ts jsou claude-haiku-4-5,
   claude-sonnet-5 a claude-opus-5. Ověř v oficiální dokumentaci
   (docs.claude.com, stránky Models overview a Pricing) aktuální
   identifikátory a ceny nejnovější řady Haiku, Sonnet a Opus a přepni
   na ně. Ceny přepiš i v src/config/costs.ts, se zdrojem a datem
   v komentáři. Rozdělení úloh mezi modely zachovej podle CLAUDE.md.
   Pusť Jarvisův integrační test proti skutečnému API.

2. MĚSÍČNÍ ROZPOČET. Proměnná JARVIS_MONTHLY_BUDGET_USD (výchozí 90 —
   rezerva pod 100). Útrata za aktuální kalendářní měsíc se počítá
   z ai_usage na serveru. Před každým voláním modelu kontrola:
   - nad 80 %: jeden e-mail majiteli za den přes Resend se stavem
   - nad 100 %: Jarvis volání modelu neprovede; chat ukáže vlídnou hlášku
     („Jarvis si dává do konce měsíce pauzu, aplikace funguje dál"),
     noční analýza a hlídání příležitostí běží jen z pravidel bez AI
   Interní účty se do rozpočtu počítají taky — kredity jsou jedny.

3. VYČERPANÉ KREDITY. Když API vrátí chybu kvůli nedostatku kreditu
   nebo dosažení limitu útraty organizace, zachyť ji podle typu chyby
   z Anthropic SDK (ne podle textu zprávy), zobraz tutéž vlídnou hlášku,
   pošli majiteli nejvýš jeden e-mail za den a zapiš událost do
   analytiky s kódem chyby. Nikdy nespadni a nikdy neukaž surovou chybu.

4. ADMINISTRACE. V sekci AI a Jarvis nahoře karta: útrata tento měsíc
   proti rozpočtu (ukazatel), odhad do konce měsíce podle dosavadního
   tempa, počet volání, a stav (v pořádku / blízko limitu / pauza).

5. Zapiš pravidlo o rozpočtu do CLAUDE.md, sekce Jarvis, a proměnnou do
   .env.example a sekce Prostředí.

Testy: volání nad rozpočtem se neprovede a vrátí hlášku; chyba
nedostatku kreditu se zobrazí vlídně; e-mail majiteli max jednou denně.
Lint, test, build, commit.
```

## Prompt 12.2 — Web, který nevypadá jako od AI · **Fable 5.1**

```
Domovský web působí na první pohled jako vygenerovaný umělou inteligencí
a kazí to první dojem. Přepracuj ho tak, aby vypadal jako práce
konkrétních lidí s vlastním vkusem. Obsah a struktura ceníku zůstávají,
mění se forma.

NESAHEJ NA: otáčení snímku aplikace pod úvodem při posunu
(src/features/marketing/home/scroll-effects.tsx). To je nejlepší věc
na webu, zachovej ho přesně, jak je.

NEJDŘÍV DIAGNÓZA
Udělej snímky současné domovské stránky (1440 a 390 px) do
docs/web-redesign/before/ a napiš do docs/web-redesign/diagnoza.md, co
přesně působí strojově. Typické znaky, které na webu jsou:
- čtyři rozmazané záře (blur 60–110 px) a „glow" efekty skoro všude
- nadpis, který se skládá slovo po slově
- každá sekce podle stejné šablony: malý nadpisek, vycentrovaný nadpis,
  mřížka karet s ikonou v kroužku
- sekce bolestí se čtyřmi kartami a řečnickou otázkou
- deset sekcí se stejnou vahou a stejným nástupem při posunu
- Inter na všem, nadpisy i text stejnou rodinou
- dokonalá symetrie, všechno na střed
- texty se vzorci typickými pro AI: trojice, „Ne X. Y.", řečnické otázky
Doplň, co dalšího najdeš.

PAK PŘESTAVBA
- Typografie s charakterem: výrazné písmo pro nadpisy (vyber vhodný
  grotesk s osobností, self-hostovaný, s češtinou), střídmé písmo pro
  text. Nadpisy větší, těsnější, zarovnané vlevo.
- Méně sekcí, jasnější rytmus. Cíl kolem šesti: úvod se snímkem; tři
  příběhy (pipeline, cold calling, Jarvis) — každý jeden velký skutečný
  snímek přes šířku a pár vět, střídavě vlevo a vpravo; hra s živou
  ukázkou; ceník; časté otázky spojené se závěrečnou výzvou.
- Sekci bolestí s kartami zruš. Jednu konkrétní větu o problému dej
  do úvodu.
- Záře nejvýš jedna, jen v úvodu. Ostatní pozadí čisté. Jedna akcentní
  barva dominuje, tyrkysová jen jako doplněk.
- Animace jen tam, kde něco ukazují: otáčení snímku, ukázka hry, Jarvisův
  chat. Nástup každého bloku při posunu zruš. Žádné skládání slov.
- Asymetrie a záměrné nepravidelnosti: různé šířky bloků, snímky
  přesahující mřížku, popisky přímo u detailů na snímcích (šipka a krátká
  poznámka ručním písmem nebo kurzívou).
- Texty: konkrétní čeština z reálného podnikání — Kč, IČO, Fakturoid,
  „zavolat panu Novákovi", konkrétní čísla z aplikace (+250 XP, 3 / 8
  úkolů). Žádné trojice, žádné řečnické otázky v nadpisech, žádné
  vykřičníky. Tykání, jako by psal člověk, ne značka.
- Poznámka zakladatelů: pokud existuje public/founders.jpg, použij ji
  se jmény z konfigurace; skutečná tvář je nejsilnější protijed na
  dojem AI. Pokud fotka není, sekci nech bez fotky, nevymýšlej.
- Ikony jen tam, kde nesou význam, ne jako dekorace u každého bodu.

Řiď se skillem frontend-design, pokud je k dispozici. Zachovej
přístupnost, obě jazykové verze, SEO a výkon (Lighthouse na mobilu
neklesne). Na konci snímky do docs/web-redesign/after/ a do diagnoza.md
krátké porovnání před a po. Commit po částech.
```

## Prompt 12.3 — Automatický test hlavních cest · **Opus 5.5**

```
Než pustíme beta testery, chci mít jistotu, že hlavní cesty aplikací
fungují, ne jen pocit ze zběžného proklikání. Napiš end-to-end testy
v Playwrightu, příkaz bun run e2e.

Testy si samy založí interní účty @gradus.local (is_internal = true)
a po sobě je uklidí. Běží proti lokálnímu dev serveru a stávající
databázi. Každý test selže i při jakékoliv chybě v konzoli prohlížeče.

Cesty:
1. Web odhlášený → Vyzkoušet / čekací listina podle PUBLIC_SIGNUP_ENABLED
2. Registrace s pozvánkovým kódem → onboarding v herním režimu s oborem
   → průvodce Jarvisem → dashboard
3. Totéž v běžném režimu, v angličtině
4. Milník → tři úkoly, podúkol → odškrtání → zamčení a odemčení
   nadřazeného → dokončení milníku → oslava
5. Kontakt ručně → přesun do Domluvené schůzky s otázkami → událost
   v kalendáři
6. Obchod → přetažení až do vyhrané fáze → oslava → kontakt v Klientech
   → příjem ve financích
7. Cold calling: spustit a pozastavit časovač, přesun z Neoslovených,
   graf ukazuje dnešek
8. Vyhledávání ⌘K najde kontakt bez diakritiky a podle části telefonu
9. Pracovník přes pozvánku: s právem na kontakty je vidí, finance ne
10. Jarvis odpoví na zprávu (přeskočit, když chybí ANTHROPIC_API_KEY)
11. Generování kontaktů (přeskočit, když chybí GOOGLE_MAPS_API_KEY)
12. Nastavení: změna jazyka, měny a pásma se projeví
13. Telefon 390 px: dashboard, pipeline, cold calling, kalendář —
    spodní lišta, žádný vodorovný posun stránky
14. /admin pro běžného uživatele vrátí 404

Spusť všechno. Každou nalezenou chybu oprav v aplikaci, ne v testu
(test uprav jen tam, kde je chybný test). Na konci tabulku v
docs/e2e-report.md: cesta, výsledek, co bylo opraveno.

Do CLAUDE.md přidej: před každým nasazením musí bun run e2e projít.
Commit.
```

## Prompt 12.4 — Beta režim a hlášení chyb · **Sonnet 5**

```
Připrav aplikaci na beta testery, ať je pro ně snadné hlásit problémy
a pro nás snadné je řešit.

1. ŠTÍTEK BETA vedle loga v aplikaci, nenápadný. Proměnná
   NEXT_PUBLIC_BETA (true/false).

2. NAHLÁSIT PROBLÉM v nabídce u avatara, v panelu Více na telefonu
   a v Jarvisově panelu. Malé okno: co se stalo (text, povinné),
   volitelně „co jsi čekal", přepínač typu chyba / nápad / něco je
   matoucí. Automaticky se přiloží: adresa stránky, prohlížeč, velikost
   okna, jazyk, verze aplikace (git commit) a posledních 20 chyb
   z konzole — ořezané a vyčištěné stejně jako v analytice. Volitelně
   snímek obrazovky: tlačítko „Přiložit snímek", které zachytí aktuální
   obrazovku v prohlížeči; uživatel ho před odesláním vidí a může
   odebrat.
   Tabulka bug_reports se stavem nový / řeším / opraveno / nelze
   reprodukovat, ochrana řádků (autor vidí své), snímky v úložišti jen
   pro majitele a autora. E-mail majiteli přes Resend při každém hlášení.
   Klávesová zkratka ⌘⇧B / Ctrl+Shift+B.

3. ADMINISTRACE → Zpětná vazba: záložka Hlášení se seznamem, filtry,
   detailem včetně snímku a technických údajů, změnou stavu. Při změně
   na Opraveno dostane autor krátký e-mail s poděkováním.

4. Uvítací e-mail testerovi po registraci s pozvánkou: poděkování,
   tři věty co je beta, jak hlásit problémy, odkaz do aplikace.
   Texty v obou jazycích.

Testy na ochranu řádků bug_reports. Commit.
```

## Prompt 12.5 — Provozní minimum · **Opus 5.5**

```
Poslední věci, bez kterých nemůžeme pustit dovnitř cizí lidi.

1. NAPLÁNOVANÉ ÚLOHY. Ověř, že všechny cron routy (metriky, noční
   analýza, automatické platby, Fakturoid, úklid analytiky, call_time_
   stats) vyžadují CRON_SECRET a že je vercel.json obsahuje se
   správnými časy. Sepiš je do docs/cron.md (co, kdy, proč).

2. E-MAILY PŘIHLAŠOVÁNÍ. Supabase bez vlastního SMTP pošle jen pár
   e-mailů za hodinu — testerům by nedošlo obnovení hesla. Připrav
   docs/supabase-email.md s přesným postupem napojení Supabase Auth
   na Resend SMTP a do docs/email-templates/ hotové HTML šablony
   (potvrzení e-mailu, obnova hesla, změna e-mailu) ve vzhledu Gradusu,
   česky i anglicky. Ověř, že registrace správně zvládá stav „potvrď
   e-mail" pro případ, že potvrzování zapneme.

3. GDPR MINIMUM. V Nastavení → Účet:
   - Exportovat moje data: ZIP s CSV všech mých dat (milníky, úkoly,
     kontakty, obchody, události, transakce, nastavení)
   - Smazat účet: potvrzení zadáním e-mailu, smaže všechna data
     uživatele včetně souborů v úložišti a anonymizuje analytiku;
     majitel s pracovníky je musí nejdřív odebrat
   Testy na obojí.

4. PRÁVNÍ TEXTY PRO BETU. /podminky a /soukromi teď ukazují
   „Připravujeme". Napiš verze pro uzavřenou betu, česky a anglicky,
   s viditelnou poznámkou „Verze pro betu, před spuštěním projde
   revizí právníka":
   - Podmínky: beta je zdarma a bez záruky, může se měnit, data
     mohou být při chybě ztracena, zálohujte si důležité, testeři
     poskytují zpětnou vazbu, kontakt, rozhodné právo ČR
   - Soukromí: správce (údaje z konfigurace, ne natvrdo), jaká data
     a proč, zpracovatelé (Supabase, Vercel, Anthropic, Google Maps
     Platform, Resend, Fakturoid — u každého k čemu a kde), měření
     používání bez obsahu, AI nezpracovává data pro trénink, doba
     uchování, práva subjektu a jak je uplatnit (export, smazání
     přímo v aplikaci), kontakt
   Žádné vymyšlené IČO ani adresy — použij konfiguraci a kde chybí
   údaj, nech viditelné [DOPLNIT].

Commit po částech.
```

## Kontrola fáze 12 · **Opus 5.5**

```
Zkontroluj kolo 5. Priority: Jarvis nikdy neukáže surovou chybu
a nepřekročí rozpočet; bug_reports a jejich snímky nevidí nikdo cizí;
smazání účtu skutečně smaže vše a nesmaže nic cizího (test se dvěma
uživateli); export obsahuje jen moje data; všechny cron routy chrání
CRON_SECRET; nový web nemá chyby v konzoli a drží Lighthouse; bun run
e2e projde celý. Oprav, pusť lint, test, e2e a build.
```

=== KONEC

---

## Krok 2 — Do `docs/progress.md` vlož tyhle řádky těsně PŘED řádek začínající `- [ ] 7.1`

=== ZAČÁTEK
- [ ] STOP | Ruční krok: Jarvis na kreditech. 1) Na claude.ai otevři Nastavení → Fakturace a u nabídky API kreditů propoj svou organizaci v Claude Console (platform.claude.com). Propojení už sám nezměníš, vyber tu správnou. 2) V Console ověř, že API klíč, který máš v .env.local jako ANTHROPIC_API_KEY, patří právě do téhle organizace — pokud ne, vytvoř v ní nový a nahraď ho. 3) V Console nastav limit útraty organizace a upozornění e-mailem. Klíč nikdy nevkládej do chatu. Pak /pokracuj.
- [ ] 12.1 | architect | env: ANTHROPIC_API_KEY
- [ ] 12.2 | designer |
- [ ] STOP | Prohlédni si nový web v anonymním okně a porovnej snímky v docs/web-redesign/before a after. Co nesedí, napiš Claude Code rovnou. Pokud chcete s Vášou na web společnou fotku, ulož ji jako public/founders.jpg a napiš Claude Code, ať ji zapojí. Pak /pokracuj.
- [ ] STOP | Ruční krok: Google Maps. V .env.local chybí GOOGLE_MAPS_API_KEY, bez něj testerům nepůjde generovat kontakty. V Google Cloud Console: projekt s připojenou fakturací, povolené „Places API (New)", klíč s omezením API jen na Places API (New) a bez omezení podle webu nebo IP. Ověř ho příkazem z dřívějška v terminálu (musí vrátit firmy, ne 403), pak ho vlož do .env.local a restartuj dev server. Když nechceš generování v betě, přeskoč — test ho vynechá. Pak /pokracuj.
- [ ] 12.3 | architect |
- [ ] 12.4 | builder | env: RESEND_API_KEY
- [ ] 12.5 | architect | env: CRON_SECRET
- [ ] K12 | reviewer |
- [ ] STOP | Ruční krok před nasazením. 1) Supabase: přejdi na tarif Pro (25 USD) — bezplatný projekt nemá zálohy a po týdnu bez provozu se uspí, což by testerům rozbilo aplikaci. 2) Supabase → Authentication: napoj SMTP na Resend podle docs/supabase-email.md a vlož šablony z docs/email-templates/. 3) Kup doménu, pokud ještě nemáš. 4) Založ účet na Vercelu. 5) V /podminky a /soukromi doplň místa [DOPLNIT]. Pak pokračuj nasazením 7.1.
=== KONEC

---

## Krok 3 — Uprav `CLAUDE.md`

a) Do sekce Prostředí přidej řádky do tabulky:
`| JARVIS_MONTHLY_BUDGET_USD | Měsíční strop útraty Jarvise (výchozí 90). Nad 100 % Jarvis nevolá model. |`
`| NEXT_PUBLIC_BETA | Štítek Beta v aplikaci |`

b) Do sekce Jarvis přidej:
`- Jarvis běží na API kreditech s měsíčním stropem. Před každým voláním kontrola rozpočtu z ai_usage; vyčerpané kredity nebo rozpočet = vlídná hláška, nikdy surová chyba, e-mail majiteli max jednou denně.`

c) Do sekce Postup práce přidej:
`- Před každým nasazením musí projít bun run e2e.`
`- Hlášení od testerů jsou v bug_reports; oprava hlášení = stav Opraveno v administraci.`

---

## Krok 4 — Dokončení

Ověř `git check-ignore -v .env.local`, commitni, pushni a napiš uživateli česky, jaký model nakonec dostal subagent designer, kolik položek přibylo a že má napsat `/clear` a pak `/pokracuj` — první položka je ruční krok s propojením API kreditů. Upozorni ho, že nový subagent se načte až po restartu Claude Code (`/exit` a znovu `claude`).
