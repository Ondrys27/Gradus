# Gradus — plán přestavby v Claude Code

_23. 9. 2026_

Kompletní přestavba webové aplikace podle aktualizované myšlenkové mapy. Stejný vzhled jako v Lovable, čistý kód, vlastní infrastruktura od prvního dne.

---

## Souhrn

|                        |                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| **Stack**              | Next.js 15 (App Router) · TypeScript · Tailwind v4 · shadcn/ui · Framer Motion · Supabase · Vercel |
| **Fází**               | 8                                                                                                  |
| **Promptů**            | 26 (včetně tří kontrol)                                                                            |
| **Odhad**              | 5–6 týdnů při 2–3 hodinách denně                                                                   |
| **Jádro hotové**       | ≈ 10. října — start uzavřené bety                                                                  |
| **Celý rozsah hotový** | ≈ 31. října                                                                                        |
| **Spuštění**           | 1. prosince — beze změny                                                                           |

**Proč Next.js a ne TanStack Start jako v Lovable:** když se stejně staví od nuly, vyplatí se vzít framework, na kterém Claude Code dělá nejméně chyb a který má nejvíc dokumentace. Next.js je na Vercelu doma, má vestavěné streamování pro Jarvise a nejširší ekosystém. TanStack Start je dobrý, ale Claude Code na něm častěji sáhne po neexistujícím API.

---

## Stavíme od nuly

Starý kód z Lovable se nepoužívá. Design je proto v promptech popsaný do detailu — barvy, rozměry, animace, robot i oslavná sekvence — aby výsledek vypadal stejně, i když nevznikne ani řádek kopírováním. Překlady se vytváří průběžně: každá sekce přidává své klíče při stavbě.

---

## Který model na co

Claude Max ti dává přístup k celé řadě. Rozdíl mezi nimi je v tom, jak moc přemýšlí a jak rychle vyčerpáš limit.

| Fáze                                        | Model                                                   | Proč                                                   |
| ------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| Architektura, databáze, zabezpečení, Jarvis | **Nejsilnější dostupný** — Fable 5.1, případně Opus 5.5 | Rozhodnutí, která se špatně mění zpětně                |
| Stavba obrazovek a sekcí                    | **Sonnet 5**                                            | Rychlý, šetří limit, na UI podle přesného zadání stačí |
| Integrace (Fakturoid, e-mail, Google)       | **Opus 5.5**                                            | Cizí API, kde se vyplatí přemýšlet                     |
| Kontrola kódu po každé fázi                 | **Nejsilnější dostupný**                                | Najde, co Sonnet přehlédl                              |
| Opravy, překlady, kosmetika                 | **Sonnet 5**                                            | Levné a rychlé                                         |

Model přepínáš příkazem `/model`. Pravidlo palce: **Sonnet staví, silný model navrhuje a kontroluje.** Když pojedeš celou dobu na nejsilnějším modelu, limit vyčerpáš za pár hodin a zbytek dne stojíš.

**U každého promptu níž je model napsaný přímo v nadpisu.** Když ti Claude Code Fable 5.1 nenabídne, použij místo něj Opus 5.5. Když narazíš na limit, dočasně přejdi o stupeň níž a silný model si nech na kontroly.

---

## Jak pracovat s Claude Code

Pět návyků, které rozhodují o tom, jestli to bude fungovat:

**1. Plánovací režim před každým větším promptem.** Přepneš ho klávesou Shift+Tab. Claude Code nejdřív napíše, co udělá, a čeká na schválení. U každého promptu níž je napsané, jestli ho použít.

**2. Commit po každém promptu.** Když něco pokazí další krok, vrátíš se. Prompt na konci: _„Udělej commit s popisem toho, co jsi změnil."_

**3. Testuj sám, nevěř „mělo by to fungovat".** Po každém promptu spusť `bun run dev` a proklikej to. Claude Code umí spustit testy, ale neumí kliknout myší.

**4. Chyby posílej s výstupem.** Ne „nefunguje generování", ale „generování vrací tohle:" a vlož text z terminálu nebo z konzole prohlížeče. Claude Code chybu vidí a opraví ji napoprvé.

**5. `/clear` mezi fázemi.** Dlouhý kontext zpomaluje a mate. Po dokončení fáze vyčisti historii — `CLAUDE.md` mu zůstane.

---

# FÁZE 0 — Založení projektu

_1 večer · nejsilnější model · plánovací režim ANO_

## Než spustíš Claude Code

1. Založ nový projekt v **Supabase** — region Frankfurt, bezplatný tarif na začátek
2. Založ prázdný repozitář `gradus` na GitHubu
3. Vytvoř složku, naklonuj repozitář, vlož do ní soubor `CLAUDE.md` (dodaný zvlášť)
4. Do `.env.local` ulož `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` — v Supabase tlačítko **Connect** nahoře, případně Settings → API Keys, záložka s publishable a secret klíči. **Nepoužívej staré klíče anon a service_role** — koncem roku 2026 končí.

## Prompt 0.1 — Založení · **Sonnet 5**

```
Přečti si CLAUDE.md a drž se ho. Založ nový projekt Gradus:

- Next.js 15 s App Routerem, TypeScript ve strict režimu, Bun jako správce balíčků
- Tailwind v4, shadcn/ui (inicializuj s tmavým motivem), Framer Motion, lucide-react
- @supabase/supabase-js a @supabase/ssr, Supabase CLI pro migrace a generování typů
- next-intl pro překlady, angličtina výchozí, čeština druhá
- TanStack Query pro data na klientu
- Vitest a Playwright pro testy, ESLint a Prettier
- Recharts, dnd-kit, react-zoom-pan-pinch, canvas-confetti, date-fns, zod

Struktura: src/app pro stránky, src/features/<sekce> pro logiku po sekcích, src/components/ui a src/components/layout, src/lib, src/locales, supabase/migrations.

Nastav skripty: dev, build, lint, test, db:migrate, db:types (generování typů ze Supabase). Přidej .env.example se seznamem všech proměnných, které projekt používá.

Ověř, že bun run dev nastartuje a zobrazí prázdnou stránku. Pak commit.
```

---

# FÁZE 1 — Design systém a kostra aplikace

_2–3 večery · Sonnet staví, silný model zkontroluje · plánovací režim u 1.1_

## Prompt 1.1 — Design systém · **Opus 5.5**

```
Postav design systém Gradusu jako tokeny v Tailwind v4 (@theme). Použij
přesně tyhle hodnoty:

Barvy: pozadí #070B1F, tmavší sidebar #05081A, karta #0D1234, karta při najetí
#121A3C, okraj #2A3468, světlý okraj #3B4682, fialová #7C5CFF (primární),
tyrkysová #2FE3C8 (postup, úspěch, Jarvis), zlatá #FFC64B (odměny, XP),
zelená #3DDC97 (vyhráno), růžová #FF6B8A (prohráno, chyby), text bílý,
text běžný #AEB8DE, text tlumený #8892BE.

Pozadí aplikace: #070B1F s jemnou mřížkou 100×100 px v #141A3C, velká rozmazaná
fialová záře vlevo dole (~60 % šířky, ~35 % průhlednost) a tyrkysová vpravo
nahoře (~45 %, ~30 %). Záře jsou fixní za obsahem.

Karty: pozadí karta, 1px okraj, zaoblení 16 px, měkký fialový vnější svit.
Při najetí světlejší okraj, silnější svit, zdvih o 2 px.

Písmo Inter. Nadpisy stránek 34 px tučně, mikro-popisky 11 px verzálky
s rozestupem 0.15em, velká čísla 32–40 px tučně.

Vytvoř sdílené prvky: GlowCard, StatTile, ProgressBar (s putujícím leskem),
ProgressRing, StatusPill, AnimatedNumber (dopočítání z nuly), PageHeader,
EmptyState, Skeleton. Rolovací nabídky, přepínače, pole a datum přestyluj,
aby nic nevypadalo jako systémový prvek prohlížeče.

Všechny barvy přes CSS proměnné, žádné hexy v komponentách. Přidej stránku
/design-system, kde jsou všechny prvky vidět — bude sloužit ke kontrole.
Respektuj prefers-reduced-motion. Commit.
```

## Prompt 1.2 — Kostra a navigace · **Opus 5.5**

```
Postav kostru aplikace podle CLAUDE.md, sekce Rozhraní.

Počítač (nad 1024 px): levý sidebar 240 px s položkami Dashboard, Milníky,
Kontakty, Pipeline, Cold Calling, Kalendář, Finance, Pracovníci. Aktivní položka
je fialová pilulka s glowing okrajem, mezi položkami klouže (layoutId). Horní
lišta 72 px jen nad obsahem: hledání vlevo, vpravo zlatá pilulka série, tyrkysová
pilulka úrovně, avatar s nabídkou.

Tablet (768–1024 px): sidebar jen s ikonami.

Telefon (pod 768 px): sidebar skrytý, plovoucí spodní lišta se skleněným
pozadím: Dashboard, Milníky, Pipeline, Kalendář, Více. Více otevírá spodní
panel se zbytkem. Horní lišta zestručněná, hledání pod ikonou lupy.

Jarvis: 64 px kulaté tlačítko vpravo dole, tyrkysový radiální svit, měkce
pulzující prstenec, vznáší se nahoru a dolů (3 s ease-in-out smyčka), mrká
každých ~5 s. Uvnitř robot jako inline SVG komponenta (ne emoji, ne obrázek):
zaoblená čtvercová hlava v tmavé barvě karty s tyrkysovým obrysem, dvě velké
kulaté tyrkysové oči se svitem a malým bílým odleskem, krátká anténa
s tyrkysovou kuličkou, drobný úsměv, dvě malé uši po stranách. Přátelský,
roztomilý, jednoduchý, čitelný i ve 24 px. Komponenta přijímá velikost
a stav (idle / thinking / happy: v thinking se oči zúží a přejíždí po nich
světlo, v happy se úsměv rozšíří a robot poskočí).
Pravý dolní roh je vyhrazený jen pro Jarvise.

Oslavná sekvence: vytvoř hook useCelebration({ title, subtitle, xp })
a komponentu, kterou později napojíme na události:
1. pozadí ztmavne a rozostří se za 200 ms
2. modální karta se zlatým 2 px svítícím okrajem najede pružinou z měřítka 0.85
3. velký zlatý pohár (lucide Trophy) v zářícím kruhu se objeví pružinou
   s přestřelem, za ním pomalu rotující světelné paprsky
4. canvas-confetti vystřelí dva výbuchy ve zlaté a fialové ze středu karty
   přes celé okno
5. text: title zlatě 32 px tučně, subtitle bílý, tyrkysový progress bar
   animovaný 0 až 100 %, zlatý odznak +{xp} XP vyskočí pružinou, fialové
   tlačítko Pokračovat přes celou šířku
6. zvuk: krátká stoupající třítónová znělka syntetizovaná přes Web Audio API,
   bez zvukových souborů, respektuje vypnutí zvuku v nastavení
Na telefonu se karta vejde s okraji. Přidej dočasné dev tlačítko na
/design-system, které oslavu spustí.

Přechody mezi stránkami: fade a posun o 12 px za 250 ms. Karty nastupují se
stagger efektem 40 ms. Založ prázdné stránky pro všech osm sekcí s nadpisem
a EmptyState. Všechny texty přes next-intl. Commit.
```

## Prompt 1.3 — Překlady a formáty · **Sonnet 5**

```
Nastav vícejazyčnost a formátování.

Založ en.json a cs.json se jmennými prostory podle sekcí: common, nav, auth,
dashboard, milestones, contacts, pipeline, coldCalling, calendar, finance,
workers, jarvis, celebration, settings. Klíče pojmenované podle významu, ne
podle textu. Angličtina výchozí a záložní, čeština druhá. Název aplikace není
v překladech — je to konstanta APP_NAME a do vět se dosazuje. V režimu vývoje
vypisuj varování u chybějících klíčů. Každá další sekce přidává své klíče
při stavbě, žádný text natvrdo v komponentě.

Formátování: vytvoř src/lib/format.ts s funkcemi formatCurrency, formatDate,
formatTime, formatDateTime, formatNumber, formatPercent, formatDuration.
Berou nastavení uživatele z jednoho kontextu (měna, umístění symbolu, formát
data, formát času, oddělovač desetin, oddělovač tisíců, první den v týdnu,
časové pásmo, země). Každá volba má hodnotu „podle jazyka" a jde přepnout.
Uvnitř Intl. Napiš k tomu Vitest testy: česky s korunami, anglicky s dolary,
česky s dolary a americkým datem, přechod přes půlnoc v pásmu Europe/Prague.

Nastavení měny mění jen zobrazení, nepřepočítává částky.

Zatím drž nastavení v paměti s výchozími hodnotami — do databáze se napojí
ve fázi 2. Commit.
```

## Kontrola fáze 1 · **Fable 5.1**

Přepni na nejsilnější model a pošli:

```
Projdi celý dosavadní kód a zkontroluj proti CLAUDE.md: hexy v komponentách,
texty natvrdo, přímé formátování bez format.ts, chybějící prefers-reduced-motion,
klikatelné plochy pod 44 px na telefonu. Vypiš, co jsi našel, a oprav to.
Pak otevři /design-system při 390, 768 a 1440 px a popiš, co nesedí.
```

---

# FÁZE 2 — Databáze a přihlášení

_2 večery · nejsilnější model · plánovací režim ANO u obou_

## Prompt 2.1 — Datový model · **Fable 5.1**

```
Navrhni a vytvoř datový model Gradusu od nuly jako migrace Supabase, přesně
podle tohoto zadání. Každá tabulka má id uuid, user_id (nebo owner_id),
created_at a updated_at.

1. TABULKY KONTAKTŮ jsou uživatelsky definované. Tabulky:
   contact_tables (user_id, name, color, position, is_system, system_key)
   contact_table_fields (table_id, label, type: text/long_text/date/datetime/
     select/boolean, required, options json, depends_on_field_id,
     depends_on_value, position)
   contact_table_entries (user_id, contact_id, table_id, answers json, moved_at)
     — jedinečné na user_id + contact_id, kontakt je vždy jen v jedné tabulce
   contact_table_moves (historie: from_table_id, to_table_id, answers, created_at)
   Při založení účtu vznikne sedm výchozích tabulek s výchozími otázkami:
   Neoslovení klienti (bez otázek), Nezvedají telefon (bez), Neúspěch (důvod:
   Už mají řešení / Nemají zájem + Proč? / Nemá finance / Není cílová skupina
   + Proč? / Jiné + Popis), Domluvená schůzka (Kdy?, Podrobnosti, O jaký produkt
   má zájem), Odeslán e-mail (Vložit odeslaný e-mail, Kdy byl poslán — výchozí
   dnes), Ozvat se (Kdy?, Podrobnosti, O jaký produkt měl zájem), Klienti
   (systémová, plní se sama z vyhraných obchodů, ručně se do ní nepřesouvá).

2. ÚKOLY: milestones (title, description, category work/personal, tag,
   target_date, status, ai_feedback, completed_at) a tasks (milestone_id,
   parent_task_id, title, description, status todo/in_progress/done, position,
   due_date, completed_at). Podúkoly do libovolné hloubky. Postup milníku se
   počítá ze všech úkolů při čtení.

3. ČASOVAČ: prospecting_segments (started_at, ended_at, end_reason pause/idle).
   Žádné nasčítané sekundy. Nečinnost 15 minut.

4. PRACOVNÍCI: workers, worker_invites (kód pozvánky), worker_permissions po
   sekcích, worker_tasks (úkoly zadané majitelem: title, description, due_date,
   status, assigned_by), work_sessions (odpracovaný čas), reward_rules (strom
   pravidel v json), worker_earnings (amount, status pending/approved/paid,
   approved_at, paid_at), worker_payments (skutečně vyplacené částky).

5. PŘEDPLATNÉ: plans (key, name, daily_generation_limit, monthly_generation_limit,
   ai_calls_limit, file_uploads_limit) a subscriptions (user_id, plan_key,
   status, current_period_end). Výchozí plán pro betu s velkorysými limity.

6. DOTAZNÍK: meeting_surveys (deal_id, stage_id, answers json, created_at) a
   sales_analyses (user_id, content, created_at).

7. Ostatní beze změny: profiles s username, user_roles odděleně, user_settings,
   milestones, tasks, pipeline_stages, deals s entered_stage_at, contacts
   s external_place_id, contact_activities, calendar_events, transactions,
   recurring_payments, invoices (číslo, částka, stav, fakturoid_id), unlocks,
   jarvis_conversations, jarvis_messages, attachments, feature_requests,
   usage_events, ai_usage, call_time_stats.

Pravidla: ochrana řádků na všech tabulkách, uživatel vidí jen svoje. Role v
user_roles, has_role() jako SECURITY DEFINER. usage_events a ai_usage bez
pravidel pro zápis z klienta. call_time_stats čitelné všem přihlášeným, bez
vazby na uživatele. Funkce initialize_user zakládá profil, nastavení, šest
fází pipeline a sedm tabulek kontaktů. Indexy na user_id a časté dvojice.

Po migraci vygeneruj TypeScript typy (db:types). Napiš mi seznam tabulek
a kde jsi se od zadání odchýlil a proč. Commit.
```

## Prompt 2.2 — Přihlášení, profil, nastavení · **Opus 5.5**

```
Postav přihlašování přes Supabase Auth s @supabase/ssr.

Stránky ve vzhledu aplikace: přihlášení, registrace s pozvánkovým kódem
(kód v proměnné INVITE_CODE na serveru, nikdy v prohlížeči), zapomenuté heslo,
nové heslo. Potvrzování e-mailu zatím vypnuté. Chráněné stránky přes middleware
— nepřihlášený jde na přihlášení a po přihlášení zpět tam, kam chtěl.

Přihlášení se ověří jednou při startu a dál se jen poslouchá změna. Přechody
mezi stránkami nikdy nečekají na ověření a nikdy nezobrazují načítání.
První registrovaný účet dostane roli owner přes serverovou funkci.

Profil: zobrazované jméno, uživatelské jméno (jedinečné, 3–20 znaků, malá
písmena, číslice, tečka, podtržítko, kontrola dostupnosti při psaní), avatar
do úložiště avatars (JPG/PNG do 2 MB, oříznutí na čtverec, pravidla úložiště
jen na vlastní soubor), změna hesla.

Nastavení: stránka se sekcemi Jazyk a Region a formáty. Všechny volby z
format.ts se ukládají do user_settings, načítají po přihlášení, zdroj pravdy
je databáze. Živá ukázka formátování pod nastavením. Země se odvodí z pásma
prohlížeče a jde změnit.

Odhlášení v nabídce avatara a v panelu Více na telefonu — vyčistí veškerý
stav. Všechny texty do překladů. Commit.
```

## Kontrola fáze 2 · **Fable 5.1**

```
Udělej bezpečnostní audit databáze a přihlašování: projdi všechna pravidla
ochrany řádků a najdi tabulky, kam může klient zapisovat a neměl by. Ověř,
že has_role je SECURITY DEFINER a že user_roles nemá pravidla pro zápis.
Zkus si představit útočníka s běžným účtem — co uvidí a co změní, co nemá?
Vypiš nálezy a oprav je.
```

---

# FÁZE 3 — Jádro na skutečných datech

_8–10 večerů · Sonnet staví, silný model kontroluje · plánovací režim u 3.3 a 3.4_

Po každém promptu proklikej sekci na počítači **i na telefonu**.

## Prompt 3.1 — Milníky a úkoly · **Sonnet 5**

```
Postav sekci Milníky na tabulkách milestones a tasks.

Seznam: karty s názvem, štítkem kategorie, tlustým progress barem s putujícím
leskem, procenty v barvě baru, cílovým datem. Filtr Vše / Pracovní / Osobní.
Rozpracované nahoře podle nejbližšího data, dokončené ztlumené dole.
Postup = podíl splněných úkolů ze VŠECH úkolů milníku, počítaný při čtení,
nikam neukládaný. Bez úkolů 0 % a text „zatím bez úkolů".

Zakládání a úpravy: dialog na počítači, spodní panel na telefonu. Název, popis,
kategorie, štítek, cílové datum. Smazání s potvrzením smaže i úkoly. Milník se
dokončí ručně; když jsou hotové všechny úkoly, nabídni dokončení, nedokončuj sám.

Detail: kruhový ukazatel 220 px, počty úkolů, seznam úkolů s podúkoly odsazenými
a sbalitelnými. Odškrtnutí okamžitě přepočítá postup, ukládá na pozadí.

Pravidlo pro úkol s podúkoly: dokud nejsou všechny jeho podúkoly hotové,
NEJDE odškrtnout. Zaškrtávátko je ztlumené se zámkem a po najetí vysvětlí,
kolik podúkolů zbývá. Jakmile jsou podúkoly hotové, zaškrtávátko se odemkne
(krátká animace odemčení), ale úkol se NEDOKONČÍ SÁM, uživatel ho odškrtne
ručně. Odškrtnutí podúkolu u dokončeného nadřazeného úkolu ho zase zamkne
a vrátí do rozpracovaného stavu.

Rychlé zakládání řádkem na konci, přeskládání tažením, podúkol přes akci
u úkolu. Stavy todo / in_progress / done, lhůta.

Prázdné stavy s vysvětlením a tlačítkem. Kostry při načítání. Překlady.
Zatím bez stromové mapy a bez AI hodnocení. Commit.
```

## Prompt 3.2 — Stromová mapa úkolů · **Opus 5.5**

```
Přidej do detailu milníku přepínač Seznam / Mapa (volba se pamatuje).

Mapa: vodorovný strom zleva doprava, kořen = milník, větve = úkoly, listy =
podúkoly, libovolně hluboko. Spojnice jsou plynulé bezierovy křivky ve dvou
vrstvách: spodní plná fialová čára bez přechodu (musí být vidět vždy) a nad ní
pomalu putující lesk. Žádné přechody s objectBoundingBox. Jedinečná id
odvozená od id úkolu.

Uzly se přizpůsobují textu: šířka 140–260 px, text se zalamuje, nikdy ořez.
Rozvržení počítá ze skutečně naměřených rozměrů uzlů, spojnice se připojují
na svislý střed. Stavy: splněný tyrkysově s fajfkou, rozpracovaný fialový obrys, zamčený
(má nehotové podúkoly) ztlumený se zámkem, nejde odškrtnout a po najetí ukáže,
kolik podúkolů zbývá. Když se podúkoly dokončí, uzel se s animací odemkne
a čeká na ruční odškrtnutí. Sbalování větví s počtem skrytých.

Ovládání vlevo dole (pravý dolní roh patří Jarvisovi): přiblížit, oddálit,
vycentrovat (Crosshair), celá obrazovka (Maximize/Minimize). Celá obrazovka
jako překryvná vrstva, ne nativní fullscreen — na iOS nefunguje. Stejná
instance komponenty, jen jiné styly, ResizeObserver, nikdy neměřit během
animace ani neukládat nulové rozměry. Esc zavírá.

Na telefonu posun prstem a přiblížení dvěma prsty, plus na uzlu vidět rovnou.
Klepnutí na uzel otevře detail úkolu. Nový uzel nasype animací. Commit.
```

## Prompt 3.3 — Pipeline obchodů · **Sonnet 5**

```
Postav Pipeline na deals a pipeline_stages.

Sloupce z pipeline_stages uživatele podle position. is_won sloupec zelený okraj,
is_lost růžový a ztlumené karty. Záhlaví: název, počet, součet částek.

Režim úprav: přejmenovat v záhlaví, přeskládat tažením, přidat fázi (název,
barva, příznak), odebrat — s obchody se zeptá, kam je přesunout; poslední fáze
nejde odebrat.

Obchody: karta s názvem, částkou přes formatCurrency, avatarem kontaktu, datem.
Zakládání z horního tlačítka a z plus v záhlaví sloupce. Formulář: název, kontakt
(našeptávač nebo rychlé založení), částka, měna, očekávané uzavření, fáze.
Detail v postranním panelu / spodním panelu: všechna pole, výběr fáze, poznámka,
místo pro historii komunikace (zatím prázdné), smazání.

Přesun tažením (dnd-kit) na počítači s nakloněním karty; na telefonu jeden
sloupec přes šířku, přejíždění s dosednutím, změna fáze v detailu. Každá změna
fáze přepíše entered_stage_at. Výhra zapíše won_at a spustí oslavu; prohra
zapíše lost_at a zeptá se na důvod; návrat vyčistí obojí.

Pravidlo půl roku: obchod v is_lost déle než 6 měsíců od entered_stage_at dostane
zlatý odznak „možné znovu oslovit", počet v záhlaví, filtr.

Když obchod dojde do is_won, kontakt se automaticky objeví v tabulce Klienti
(systémová tabulka contact_tables) — přes databázový trigger nebo při zápisu,
ale spolehlivě. Commit.
```

## Prompt 3.4 — Kontakty s uživatelskými tabulkami · **Opus 5.5**

```
Postav sekci Kontakty. Je to největší sekce, rozděl si ji na kroky a po každém
mi napiš, co je hotové.

A) Seznam kontaktů: tabulka na počítači, karty na telefonu. Hledání podle jména,
firmy a telefonu (ignoruj mezery, pomlčky, předvolbu). Řazení podle posledního
kontaktu. Stránkování nebo donačítání. Zakládání s kontrolou duplicit podle
telefonu a e-mailu (upozornit, neblokovat). Detail: údaje s tlačítky volat /
napsat, poznámka, historie aktivit (contact_activities, ruční přidání), navázané
obchody, aktuální tabulka. last_contact_at se přepisuje při každé aktivitě.

B) Tabulky: nad seznamem řada přepínačů podle contact_tables uživatele, s
počty, barevně odlišené, první volba „Vše". Klienti je systémová tabulka —
zobrazuje kontakty s vyhraným obchodem plus počet a součet obchodů, ručně se
do ní nepřesouvá. Na telefonu řada posouvatelná vodorovně.

C) Správa tabulek: „Upravit tabulky" otevře editor. Přidat, přejmenovat, obarvit,
přeskládat, smazat (s obchody v tabulce se zeptá, kam přesunout). U každé
tabulky editor otázek: přidat pole (typ text / dlouhý text / datum / datum a čas
/ výběr / ano-ne), popisek, povinné, u výběru možnosti, u pole závislost na
hodnotě jiného pole (např. „Proč?" jen když je vybráno „Nemají zájem"). Pořadí
tažením. Systémovou tabulku Klienti nelze smazat ani jí přidat otázky.

D) Přesun: v detailu kontaktu „Přesunout do" → výběr tabulky → formulář
vygenerovaný z jejích polí (respektuje typy, povinnost, závislosti; u data
tlačítko „Dnes"). Přesun jen přes jednu funkci moveContact, která mění
contact_table_entries a zapisuje contact_table_moves. Kontakt je vždy jen
v jedné tabulce. Přesun do tabulky s polem typu datum a čas pojmenovaným
jako schůzka založí událost v kalendáři (systémový klíč meeting_scheduled).

E) Generování kontaktů: tlačítko „Generovat kontakty" → formulář: obor (text),
lokalita (text), počet (číselník, maximum podle plánu, při překročení zatřesení
a hláška). Tlačítko během generování ukazuje průběh s putujícím leskem a
popisem fáze. Serverová route volá Places API (New) Text Search s klíčem
GOOGLE_MAPS_API_KEY, maska polí jen id, displayName, internationalPhoneNumber,
websiteUri, formattedAddress. Duplicity podle external_place_id, telefonu bez
formátování a názvu s adresou. Nové kontakty source=generated, e-mail prázdný,
padají do tabulky Neoslovení klienti. Denní i měsíční limit podle plánu,
zobrazený pod formulářem. Každé volání zapiš do usage_events ze serveru, včetně
neúspěšných, s HTTP stavem a zprávou od Googlu. Chyby od Googlu ukazuj
srozumitelně a konkrétně (API nepovolené, fakturace, omezení klíče, kvóta).

Commit po každém kroku A–E.
```

## Prompt 3.5 — Cold Calling · **Opus 5.5**

```
Postav sekci Cold Calling — pracovní prostor pro obvolávání. Používá stejné
tabulky kontaktů jako sekce Kontakty, nic nezakládá zvlášť.

Levá část: seznam kontaktů v tabulce Neoslovení klienti s hledáním podle jména
a telefonu. Řádek: firma, telefon (klepnutí vytočí), web. Klepnutí otevře detail
s tlačítkem Přesunout do — stejný formulář jako v Kontaktech (moveContact).
Po přesunu kontakt ze seznamu zmizí s animací a načte se další. Nahoře
přepínač na ostatní tabulky pro rychlý náhled.

Pravá část, karta Časovač: velké číslice neproporcionálním písmem, jen dvě
tlačítka spustit / pozastavit, žádné vynulování. Úseky v prospecting_segments.
Denní součet = úseky oříznuté na hranice dne v pásmu uživatele, počítané
databázovou funkcí — o půlnoci automaticky nula, žádná úloha nic nerozděluje.
Nečinnost: efektivní konec otevřeného úseku = min(teď, poslední přesun z
Neoslovených + 15 min), platí i při čtení; při zjištění úsek uzavři s důvodem
idle a ukaž jednou upozornění. Prohlížeč jen zobrazuje a přičítá lokálně,
do databáze průběžně nezapisuje. Časovač přežije obnovení stránky i zavření
prohlížeče.

Pod časovačem Statistiky: dva grafy se společným přepínačem týden / měsíc / rok
a šipkami — odvolaný čas po dnech, domluvené schůzky po dnech (z
contact_table_moves do tabulky se systémovým klíčem meeting_scheduled).
Dnešek zlatě. Nad každým tři čísla: celkem, průměr, nejlepší den. Popisky
grafů ve vzhledu aplikace, nikdy černý text.

Třetí graf — Nejlepší čas pro volání: mřížka den × hodina (Po–Ne, 7–20 h)
z call_time_stats pro zemi uživatele, sytost podle podílu schůzek. Políčko
pod 20 pokusů šedé „zatím málo dat", země pod 200 pokusů zobrazí vysvětlení.
Serverová route pro denní přepočet z contact_table_moves napříč uživateli,
chráněná CRON_SECRET, bez jakékoliv vazby na uživatele v cílové tabulce.
Nad grafem, ze kolika záznamů a z jaké země se počítá. Žádná ukázková čísla.

Čtvrtá karta — Nejlepší obory: z vlastních dat uživatele, podíl schůzek podle
oboru z generování. Zamčená s vysvětlením, dokud uživatel nemá 10 domluvených
schůzek; po odemčení se spustí oslava (klíč unlock v tabulce unlocks).
Commit po částech.
```

## Prompt 3.6 — Kalendář · **Sonnet 5**

```
Postav Kalendář na calendar_events. Chová se jako kalendář v iPhonu.

Pohledy Den / Týden / Měsíc, výchozí měsíc, volba se pamatuje. Dnešek vždy
zřetelně označený vyplněným fialovým kolečkem, počítaný v pásmu uživatele,
nikdy z UTC. Klepnutí na den v měsíci přepne na denní pohled toho dne.
Přejetí prstem přepíná měsíc. První den v týdnu z nastavení.

Měsíc: na počítači pruhy s textem, na telefonu jen barevné tečky (max 3 + šedá).
Týden: sedm sloupců s časovou osou; na telefonu seznam dnů pod sebou.
Den: svislá osa, události jako bloky podle času a délky, linka aktuálního času,
celodenní nahoře, prázdný stav.

Typy: schůzka fialově, úkol tyrkysově, termín zlatě. Tlačítko Přidat událost
nahoře; v dni a týdnu i klepnutím do osy (předvyplní čas, tažením délka).
Formulář: název, typ, začátek, konec, celodenní, popis, kontakt, obchod.
Detail s odkazy na kontakt a obchod, úpravy, smazání. Přesun tažením mění čas
i den, tažení za okraj délku.

Zrcadlené položky jen ke čtení, přepínatelné, vizuálně odlišené: úkoly s lhůtou
z milníků a očekávaná uzavření obchodů; klepnutí otevře zdroj. Schůzky vzniklé
přesunem kontaktu nesou štítek a odkaz na kontakt; jejich smazání kontakt
nepřesouvá.

Ukládej UTC, zobrazuj v pásmu uživatele. Načítej jen zobrazené období. Commit.
```

## Prompt 3.7 — Finance · **Sonnet 5**

```
Postav Finance na transactions, recurring_payments a invoices.

Souhrn: Příjmy tyrkysově, Výdaje růžově, Zůstatek bílý. Graf (Recharts):
tyrkysová plocha příjmů a fialová linka výdajů za 12 měsíců, popisky ve
vzhledu aplikace. Seznam transakcí: ikona kategorie, popis, datum, částka
(+ tyrkysově / − růžově), stránkování. Zakládání, úpravy, kategorie, filtr
podle období a kategorie.

Automatické platby: seznam s přepínači, den v měsíci, další splatnost;
serverová route (cron, CRON_SECRET) je jednou denně zaúčtuje.

Propisování z pipeline: přesun obchodu do fáze se systémovým významem záloha
vytvoří příjem source=deal_deposit, do is_won fáze příjem source=deal_invoice.
Umožni uživateli označit, která fáze znamená zálohu. Zpětný přesun transakci
nemaže, jen označí ke kontrole.

Faktury: seznam s číslem, klientem, částkou, splatností, stavem (Zaplaceno
zeleně, Čeká zlatě, Po splatnosti růžově). Zakládání faktury z obchodu jedním
klepnutím. Napojení na Fakturoid zatím jako připravené rozhraní (adapter) —
skutečné volání API přijde ve fázi 5. Commit.
```

## Prompt 3.8 — Dashboard · **Sonnet 5**

```
Postav Dashboard na skutečných datech. Pozdrav podle času dne a jména, pod ním
věta shrnující den („Máš dnes 3 obchody k dotažení.") počítaná z dat.

Šest dlaždic, každá klepnutím otevře detail: Příjem za tento měsíc (z transactions,
+/− oproti minulému měsíci), Splněné úkoly dnes (x / y, kruh), Úspěšnost obchodů
(podíl vyhraných z uzavřených za 90 dní, sparkline), Aktivní obchody, Nové
kontakty tento měsíc, Čas strávený sháněním klientů (z prospecting_segments,
tento týden).

Detail Úspěšnosti obchodů: dotazník o schůzkách. Když obchod projde z fáze
„První schůzka proběhla" dál (nebo jakoukoliv fázi s tím významem), nabídni
uživateli krátký dotazník o té schůzce (8–12 otázek: délka, kdo byl přítomen,
námitky, co zafungovalo, nálada, další krok…) — uloží se do meeting_surveys.
V detailu dlaždice seznam vyplněných dotazníků a tlačítko „AI rozbor", zatím
neaktivní s textem „přijde s Jarvisem".

Pravá karta Co dnes udělat: úkoly s lhůtou dnes nebo po lhůtě, události dnes,
kontakty k ozvání dnes (z tabulky Ozvat se), obchody stojící dlouho v jedné
fázi. Odškrtnutí úkolu přímo odtud. Čísla dopočítávají z nuly, karty stagger.
Commit.
```

## Kontrola fáze 3 · **Fable 5.1**

```
Projdi všech osm sekcí a udělej výkonnostní a datový audit: najdi dotazy, které
tahají víc dat, než stránka zobrazuje; místa bez stránkování; N+1 dotazy;
komponenty, které se překreslují při každém tiknutí časovače; data, která by
se měla počítat a místo toho se ukládají. Ověř, že každý dotaz filtruje podle
uživatele. Vypiš nálezy, oprav je, doplň Vitest testy na moveContact, počítání
postupu milníku a denní součty časovače včetně půlnoci a nečinnosti.
```

---

# FÁZE 4 — Jarvis a měření

_3–4 večery · nejsilnější model · plánovací režim ANO_

## Než začneš

Založ účet na console.anthropic.com, vytvoř API klíč, ulož jako `ANTHROPIC_API_KEY` do `.env.local`. Nastav si tam měsíční strop útraty.

## Prompt 4.1 — Jádro Jarvise · **Fable 5.1**

```
Napoj Jarvise na skutečnou AI. Přečti si v CLAUDE.md sekci Jarvis a AI a drž se
jí doslova.

Jedna jediná serverová route /api/jarvis, přes kterou jdou VŠECHNA volání modelu.
Anthropic SDK, klíč ANTHROPIC_API_KEY. Streamované odpovědi. Routing: rutina
(klasifikace, kontroly, krátká shrnutí) na Haiku, rozhovor a hodnocení na Sonnet,
velké rozbory na Opus. Systémový prompt s cachováním (cache_control), obsahuje
osobnost Jarvise — roztomilý, přátelský průvodce podnikáním, mluví jazykem
uživatele, stručně, konkrétně, bez frází.

Kontext: před každým volání sestav souhrn situace uživatele z databáze —
milníky s postupem, obchody po fázích, kontakty k ozvání, dnešní události,
dnešní odvolaný čas, finance za měsíc. Kompaktně, ať to není tisíce tokenů.
Historii v jarvis_conversations a jarvis_messages.

Měření spotřeby PŘÍMO ve volání: po každé odpovědi zapiš do ai_usage model,
input_tokens, cached_input_tokens, output_tokens, feature, cost_usd — ze
serveru, přes servisní klíč. Limit volání podle plánu uživatele; při dosažení
srozumitelná hláška.

Panel: na počítači 420×620 px nad tlačítkem, na telefonu celá obrazovka.
Bubliny asistenta s tyrkysovým levým okrajem, uživatele fialové vpravo.
Tři tečky při psaní, streamovaný text. Chipy s návrhy podle situace.
Commit.
```

## Prompt 4.2 — Soubory, hlídání, hodnocení, nápady · **Opus 5.5**

```
Rozšiř Jarvise:

1. SOUBORY: nahrávání do chatu — PDF, PNG, JPG, TXT, CSV, DOCX, XLSX, do 10 MB,
   3 na zprávu, měsíční limit podle plánu. Typ ověřuj podle obsahu (magic bytes),
   ne přípony. Ulož do úložiště attachments s pravidly na vlastní soubory, text
   z PDF/DOCX/XLSX vytáhni na serveru a předej modelu, obrázky pošli přímo.

2. HLÍDÁNÍ PŘÍLEŽITOSTÍ: serverová route (cron, CRON_SECRET) třikrát denně
   pro každého aktivního uživatele projde změny od posledního běhu a na Haiku
   vyhodnotí, jestli z nich plyne akce. Okamžité spouštěče bez čekání: obchod
   vyhrán, kontakt k ozvání dnes, obchod stojí ve fázi přes 14 dní, úkol po lhůtě
   přes 3 dny. Když nic, mlčí. Návrhy do jarvis_suggestions (user_id, type, text,
   action json, seen_at, dismissed_at) a ukáže je pulzující prstenec na tlačítku
   plus karta v panelu s tlačítkem Udělat.

   Automatické akce: když Jarvis usoudí, že úkol je splněný (např. obchod prošel
   fází, na kterou úkol odkazuje), označí ho a ukáže oznámení s možností Vrátit —
   nikdy tiše. Dokončení milníku nikdy sám, jen navrhne.

3. HODNOCENÍ MILNÍKU: po založení milníku Sonnet posoudí kvalitu (konkrétnost,
   měřitelnost, termín) a napíše 2–4 věty do milestones.ai_feedback. Když je
   milník dobrý, řekne to a nevymýšlí výtky — tohle dej do promptu výslovně.

4. NÁPADY: když uživatel Jarvisovi napíše, že mu něco v aplikaci chybí,
   klasifikátor na Haiku to rozpozná, uloží do feature_requests a pošle e-mail
   majiteli (Resend, RESEND_API_KEY). Jarvis poděkuje a řekne, že to předal.

5. AI ROZBOR SCHŮZEK: aktivuj tlačítko z dashboardu — z meeting_surveys a
   výsledků obchodů udělá Opus rozbor (co funguje, co ne, konkrétní doporučení),
   uloží do sales_analyses. Odemkne se po 5 vyplněných dotaznících.

Všechno přes /api/jarvis, všechno měřené. Commit po částech.
```

---

# FÁZE 5 — Pracovníci, Fakturoid, e-mail

_4–5 večerů · Opus 5.5 · plánovací režim ANO u 5.1_

## Prompt 5.1 — Pracovníci · **Opus 5.5**

```
Postav sekci Pracovníci pro majitele a oddělené prostředí pro pracovníky.

MAJITEL: seznam pracovníků jako karty (avatar, jméno, role, postup úkolů tento
měsíc, odpracované hodiny, vyděláno zlatě, odznak čeká na schválení). Přidat
pracovníka: jméno, e-mail, role, oprávnění po sekcích (vidět / upravovat) →
vznikne pozvánka s kódem a odkazem; karta s návodem „pošli pracovníkovi tenhle
odkaz, zaregistruje se a uvidí jen to, co mu povolíš". Detail pracovníka: úkoly,
které mu majitel zadal (zakládání, lhůta, stav), výdělky (pending / approved /
paid), kolik mu ještě dlužím a kolik už jsem vyplatil, zaznamenání platby,
schválení výdělků jedním klepnutím, odpracovaný čas.

SYSTÉM ODMĚN: editor jako strom (stejná komponenta jako mapa úkolů): kořen
„Odměny", větve = spouštěče (splněný úkol, domluvená schůzka, vyhraný obchod,
odpracovaná hodina…), listy = pravidla (pevná částka / procento / za hodinu,
podmínky). Po klepnutí na „Nechat AI nastavit" projde Jarvis strom, přeloží ho
do reward_rules a shrne, jak to bude fungovat; majitel potvrdí. Výdělky se
generují automaticky ze spouštěčů do stavu pending.

PRACOVNÍK: po registraci přes pozvánku má vlastní prostředí — sidebar jen
Dashboard, Úkoly, Odměny, Kalendář plus sekce podle oprávnění. Dashboard:
vyděláno tento měsíc, odpracováno tento měsíc (vlastní časovač spustit /
pozastavit, work_sessions, stejná logika úseků jako v Cold Callingu). Úkoly od
majitele s odškrtáváním. Odměny: seznam s stavy. Ochrana řádků: pracovník vidí
jen záznamy, kde je uveden, a jen sekce s oprávněním. Commit po částech.
```

## Prompt 5.2 — Fakturoid · **Opus 5.5**

```
Napoj Finance na Fakturoid přes jeho API (OAuth 2.0 client credentials).
Nastavení → Integrace: připojit Fakturoid (client id, client secret, slug účtu,
uložené šifrovaně na serveru per uživatel). Po připojení: „Vystavit fakturu"
u obchodu vytvoří fakturu ve Fakturoidu s odběratelem z kontaktu, položkou
z obchodu a splatností; uloží fakturoid_id a číslo. Webhook nebo denní
synchronizace stavu (zaplaceno / po splatnosti) zpět do invoices; zaplacení
faktury může přesunout obchod do is_won fáze (volitelně, přepínač). Chyby
srozumitelně. Když Fakturoid není připojený, faktury fungují jen interně.
Commit.
```

## Prompt 5.3 — E-mail · **Sonnet 5**

```
Odesílání e-mailů z aplikace přes Resend (RESEND_API_KEY, doména gradus.*).
V detailu kontaktu a obchodu tlačítko Napsat e-mail: předmět, text, přílohy.
Odeslaný e-mail se uloží do contact_activities typ email_sent a nabídne přesun
kontaktu do tabulky Odeslán e-mail s předvyplněným textem a datem. AI návrh
odpovědi: uživatel vloží přijatý e-mail, Jarvis (Sonnet, přes /api/jarvis)
navrhne odpověď v tónu uživatele a s kontextem obchodu; uživatel upraví a
odešle. Historie komunikace u kontaktu a obchodu jako časová osa. Plná
integrovaná schránka se teď nedělá. Commit.
```

---

# FÁZE 6 — Hra, onboarding, dokončení

_3–4 večery · Sonnet staví, silný model kontroluje_

## Prompt 6.1 — Dopamin systém a odemykání · **Sonnet 5**

```
Dopamin systém na skutečných událostech. Oslavnou sekvenci z fáze 1
(useCelebration) napoj na: dokončení milníku, vyhraný obchod, odemčení sekce,
osobní rekord v denním odvolaném čase, první vygenerované kontakty, desátá
domluvená schůzka. Každá událost má vlastní title, subtitle a XP. Odstraň
dev tlačítko z /design-system. Drobné události (odškrtnutý úkol, přesun kontaktu)
jen malá animace, ne konfety.

XP a úroveň: každá událost dává XP (tabulka xp_events), úroveň z celkového XP,
pilulka v horní liště pulzuje při změně. Série: počet dnů v řadě s aspoň jednou
akcí, zlatá pilulka.

Odemykání: nový uživatel vidí Dashboard, Milníky, Kontakty, Pipeline.
Cold Calling se odemkne po 5 kontaktech, Kalendář po první schůzce, Finance
po prvním vyhraném obchodu, Pracovníci po 3 vyhraných. Zamčená sekce v menu
ztlumená se zámkem a motivačním textem, co zbývá. Odemčená sekce svítí, dokud
ji uživatel nenavštíví (unlocks.seen_at). Motivační texty u milníků blízko
dokončení a u úkolů po lhůtě přes 3 dny. Přepínače animací a zvuků v nastavení.
Commit.
```

## Prompt 6.2 — Onboarding · **Sonnet 5**

```
Onboarding při prvním přihlášení: uvítání s Jarvisem, výběr oboru (ovlivní
ukázkové texty), potvrzení země a měny, založení prvního milníku s třemi
navrženými úkoly podle oboru, přidání prvního kontaktu (nebo přeskočit),
krátké představení Jarvise. Čtyři až pět kroků, tečky postupu, jde přeskočit.
Po dokončení oslava a první XP. Prázdné stavy ve všech sekcích s vysvětlením
a akcí. Commit.
```

## Prompt 6.3 — Průchod, mobil, výkon · **Opus 5.5**

```
Kompletní průchod jako nový uživatel v obou jazycích. Vypiš všechno rozbité,
překrývající se, nepřeložené a pomalé; oprav. Pak telefon při 390 px: dotykové
plochy, spodní lišta nezakrývá obsah, bezpečná zóna, nic se neposouvá do stran,
dialogy jako spodní panely. Výkon: Lighthouse nad 90 na mobilu — lazy loading
těžkých komponent (mapa, grafy), obrázky přes next/image, žádné blokující
požadavky při startu, kostry místo prázdna. Commit.
```

---

# FÁZE 7 — Nasazení

_1 večer · Sonnet_

## Prompt 7.1 · **Sonnet 5**

```
Nasaď na Vercel: region fra1, proměnné z .env.example jako tajné hodnoty,
Vercel Cron pro tři úlohy (denní přepočet call_time_stats, denní automatické
platby, hlídání příležitostí 3× denně) s hlavičkou CRON_SECRET. Supabase:
připojovací fond (pooler) místo přímého připojení, produkční adresa v povolených
adresách pro přesměrování, spend cap zapnutý. Vercel spend management zapnutý.
Ověř přihlášení, serverové routy, Jarvise a generování na produkci. Napiš mi
kontrolní seznam toho, co jsem musel nastavit ručně.
```

---

## Harmonogram

| Týden    | Dny           | Fáze           | Výstup                                                               |
| -------- | ------------- | -------------- | -------------------------------------------------------------------- |
| 1        | 23.–29. 9.    | 0, 1, 2        | Kostra, design, databáze, přihlášení                                 |
| 2        | 30. 9.–6. 10. | 3 (3.1–3.5)    | Milníky, pipeline, kontakty, cold calling                            |
| 3        | 7.–13. 10.    | 3 (3.6–3.8), 4 | Kalendář, finance, dashboard, Jarvis · **beta start ~10. 10.**       |
| 4        | 14.–20. 10.   | 5              | Pracovníci, Fakturoid, e-mail                                        |
| 5        | 21.–31. 10.   | 6, 7           | Hra, onboarding, průchod, nasazení · **hotovo ~31. 10.**             |
| listopad |               |                | Prodejní web, veřejná registrace, platby, opravy z bety — beze změny |

Při 2–3 hodinách denně. Když bude dní s půl hodinou víc, posune se to o týden a pořád drží 1. prosinec.

---

## Co potřebuji od tebe, než začneš

- [ ] Nový projekt v Supabase (Frankfurt)
- [ ] Vyřešený 403 u Google Maps — jinak generování nepůjde otestovat
- [ ] Účet na console.anthropic.com a API klíč (do fáze 4)
- [ ] Účet Fakturoid s API přístupem (do fáze 5)
- [ ] Doména gradus.* a účet Resend pro odesílání e-mailů (do fáze 5)
- [ ] Rozhodnutí o limitech tarifů — kolik generování denně na jaký plán (do fáze 3, jinak dám výchozí)

---

# FÁZE 8 — Opravy z testování, kolo 1

*Z testování na počítači. Jarvis je odložený na další kolo.*

## Prompt 8.1 — Chyby v konzoli a nefunkční nabídky · **Opus 5.5**

```
Oprav tři chyby. U každé najdi skutečnou příčinu, ne jen příznak, a pak
projdi celou aplikaci, jestli se stejná chyba nevyskytuje jinde.

1. PŘEKLAD JAKO OBJEKT. V detailu milníku padá next-intl:
   INSUFFICIENT_PATH: Message at `milestones.tasks.delete` resolved to
   `object`, but only strings are supported.
   Místo: src/features/milestones/task-row.tsx:190, volání t("delete")
   v komponentě TaskMenu. Klíč milestones.tasks.delete je v překladech
   objekt (nejspíš s podklíči pro potvrzovací dialog) a zároveň se volá
   jako text. Přejmenuj klíče tak, aby se nekřížily, v en.json i cs.json.

   Pak přidej automatickou kontrolu, která tuhle třídu chyb odhalí dřív,
   než ji uvidí uživatel: Vitest test nebo skript spouštěný v bun run test,
   který ověří, že en.json a cs.json mají totožnou sadu klíčů, a že žádné
   volání t() v kódu nevede na objekt. Nastav next-intl ve vývoji tak,
   aby chybějící nebo špatný klíč byl vidět hned, a v produkci aby
   místo pádu zobrazil záložní text.

2. DIV UVNITŘ P. V dialogu generování kontaktů je <Skeleton>, který
   vykresluje <div>, uvnitř <p>. To rozbíjí hydrataci.
   Místo: src/features/contacts/generate-contacts-dialog.tsx:271–282.
   Oprav to a pak prohledej celou aplikaci: Skeleton a jiné blokové prvky
   uvnitř <p>, <span>, <label> nebo <button>, a tlačítka uvnitř tlačítek.
   Dej komponentě Skeleton variantu, která vykresluje <span>, pro použití
   uvnitř textu.

3. NEOTEVÍRAJÍCÍ SE NABÍDKY V ONBOARDINGU. Na uvítací obrazovce se při
   výběru země a měny rolovací seznamy vůbec neotevřou. Najdi proč —
   typicky vyskakovací vrstva nabídky pod překryvem onboardingu (z-index,
   portál mimo kontejner, pointer-events) nebo zachycení fokusu dialogem.
   Oprav to systémově: všechny rolovací nabídky, výběry data a vyskakovací
   menu musí fungovat uvnitř dialogů, spodních panelů i onboardingu.
   Projdi každý dialog v aplikaci a ověř, že se v něm nabídky otevírají.

Po opravě otevři milníky, detail milníku, dialog generování kontaktů
a onboarding a ověř, že v konzoli prohlížeče není žádná chyba ani
varování. Commit.
```

## Prompt 8.2 — Telefonní čísla a časová pásma · **Opus 5.5**

```
Dvě úpravy formátování.

1. TELEFONNÍ ČÍSLA. Kdekoliv v aplikaci uživatel píše nebo vidí telefonní
   číslo, musí být hezky rozdělené, česká čísla po třech: +420 777 123 456.

   Použij knihovnu libphonenumber-js. Vytvoř sdílenou komponentu PhoneInput
   a funkci formatPhone v src/lib/phone.ts:
   - PhoneInput formátuje číslo už během psaní, výchozí předvolba podle
     země z nastavení uživatele, kurzor nesmí při formátování skákat,
     vložení čísla ze schránky v libovolném tvaru se správně přeformátuje
   - ukládá se vždy ve formátu E.164 (+420777123456)
   - formatPhone zobrazí číslo národně, když je ze stejné země jako
     uživatel, jinak mezinárodně
   - neplatné číslo: jemné upozornění pod polem, ale uložení neblokuj

   Nahraď všechna pole a zobrazení telefonu v aplikaci: kontakty, rychlé
   založení kontaktu z obchodu, cold calling, vygenerované kontakty,
   pracovníci, profil. Odkazy na vytočení (tel:) ať používají E.164.

   Napiš migraci, která existující telefony v databázi převede na E.164.
   Čísla, která nejdou rozpoznat, nech beze změny a vypiš jejich počet.
   Uprav kontrolu duplicit při generování a zakládání kontaktů, aby
   porovnávala E.164. Doplň Vitest testy na formatPhone a převod.

2. ČASOVÁ PÁSMA. U výběru časového pásma v nastavení zobraz u každé
   položky, kolik je v tom pásmu právě hodin, a posun od UTC:
   „Evropa/Praha · 17:42 · UTC+2". Čas se živě aktualizuje každou minutu.
   Seznam jde prohledávat psaním a je seskupený podle kontinentu. Aktuálně
   zvolené pásmo ukazuje svůj čas i v zavřeném stavu. Časy formátuj přes
   format.ts podle nastavení uživatele (12/24 h).

Přidej nový pravidlo do CLAUDE.md, sekce Texty a formáty: telefony vždy
přes PhoneInput a formatPhone, ukládat v E.164. Commit.
```

## Prompt 8.3 — Globální vyhledávání jako Spotlight · **Opus 5.5**

```
Vyhledávání v horní liště teď nefunguje. Postav ho znovu jako Spotlight
v macOS: rychlé, chytré, ovladatelné klávesnicí, prohledá celou aplikaci
přihlášeného uživatele.

UMÍSTĚNÍ A OTEVŘENÍ
Pole v horní liště přesuň doprostřed, šířka kolem 480 px, s nápovědou
zkratky „⌘K" (na Windows „Ctrl K"). Klepnutí do pole nebo zkratka ⌘K /
Ctrl+K kdekoliv v aplikaci otevře vyhledávací okno: vycentrované v horní
třetině obrazovky, šířka kolem 640 px, rozostřené pozadí, najede s pružinou.
Esc nebo klepnutí mimo zavře. Na telefonu přes celou obrazovku.

CO PROHLEDÁVÁ
- kontakty: jméno, firma, e-mail, telefon (podle číslic, i části čísla)
- obchody: název, kontakt, částka
- milníky a úkoly: název, popis
- události v kalendáři: název, popis
- transakce a faktury: popis, číslo faktury, odběratel
- pracovníci: jméno, role
- sekce aplikace a stránky nastavení (navigace — „nastavení měny" otevře
  přesně to místo)
- rychlé akce: Nový kontakt, Nový obchod, Nový milník, Nová událost,
  Spustit časovač, Generovat kontakty

JAK HLEDÁ
- bez ohledu na diakritiku a velikost písmen: „novak" najde „Nováka"
- toleruje překlepy a části slov
- výsledky seskupené podle typu s ikonou, max 5 na skupinu, u skupiny
  odkaz „Zobrazit všechny"; nejlepší shody nahoře
- shodný text ve výsledku zvýrazněný
- ke každému výsledku jeden řádek kontextu (u kontaktu firma a tabulka,
  u obchodu fáze a částka, u úkolu milník)

Technicky: jedna serverová funkce, dotazy přes klienta přihlášeného
uživatele, aby platila ochrana řádků — nikdy admin klient. V Postgresu
rozšíření unaccent a pg_trgm, GIN trigramové indexy na prohledávaná pole
v migraci. Hledání spouštěj s prodlevou 150 ms, zruš rozpracovaný
požadavek, když uživatel píše dál. Odezva do 200 ms při tisících záznamů.

OVLÁDÁNÍ KLÁVESNICÍ
Šipky nahoru a dolů posouvají výběr napříč skupinami, Enter otevře,
⌘Enter otevře na pozadí, Tab přeskočí na další skupinu. Výběr je vidět
fialovým podbarvením a sjede do viditelné části.

PRÁZDNÝ STAV
Než uživatel začne psát: naposledy otevřené položky a nedávná hledání
(uložené v nastavení uživatele, max 8) a rychlé akce. Když se nic
nenajde: srozumitelný text a nabídka „Vytvořit kontakt …" s napsaným
textem.

Všechny texty do překladů. Vitest testy na hledání bez diakritiky
a podle části telefonu. Commit.
```

## Prompt 8.4 — Dashboard · **Sonnet 5**

```
Dvě úpravy dashboardu.

1. DETAIL DLAŽDICE JAKO VELKÉ OKNO. Klepnutí na dlaždici teď vysune detail
   zprava. Místo toho otevři velké vycentrované okno: šířka až 960 px,
   výška až 85 % obrazovky, rozostřené a ztmavené pozadí. Okno ať plynule
   vyroste přímo z klepnuté dlaždice (sdílená animace přes layoutId ve
   Framer Motion) a při zavření se do ní zase smrskne. Esc a klepnutí
   mimo zavře. Obsah detailu zůstává stejný, jen dostane víc místa —
   grafy roztáhni na šířku okna. Na telefonu se okno otevře přes celou
   obrazovku.

2. PROCENTA V KRUHU. Dlaždice Splněné úkoly dnes: doprostřed kruhového
   ukazatele dej procento splnění velkým písmem (dopočítává se z nuly),
   pod něj menším písmem „3 / 8". Když dnes nejsou žádné úkoly, ukaž
   v kruhu pomlčku a pod ním „Dnes nic". Formátování přes format.ts.

Commit.
```

## Prompt 8.5 — Milníky a mapa úkolů · **Opus 5.5**

```
Čtyři úpravy milníků. Pravidla z bodů 2 a 3 zapiš i do CLAUDE.md.

1. STAVY ÚKOLŮ V MAPĚ. Každý stav musí být na první pohled poznat,
   moderně a vkusně:
   - Nezačatý: tlumený obrys, neutrální
   - Rozpracovaný: oranžový „živý" rámeček — kónický přechod, který
     pomalu obíhá kolem uzlu, a jemný oranžový svit. Přidej do design
     systému token pro oranžovou (#FF9F43) a používej ho, ne hex v komponentě.
   - Hotový: tyrkysová výplň s fajfkou
   - Zamčený (má nehotové podúkoly): šedý se zámkem
   - Po lhůtě: malá růžová tečka nebo štítek s počtem dnů
   Při prefers-reduced-motion je rámeček statický. Stejné barvy stavů
   použij i v seznamovém pohledu, ať jsou oba pohledy konzistentní.
   Do levého horního rohu mapy dej malou legendu stavů, která jde sbalit.
   V detailu úkolu ať jde stav přepnout.

2. DOKONČENÍ MILNÍKU. Odeber tlačítko Dokončit milník v dosavadní podobě.
   Nahraď ho tlačítkem, které je zamčené — ztlumené, se zámkem a textem
   „Zbývá 3 úkoly" — dokud nejsou hotové všechny úkoly milníku. Ve chvíli,
   kdy se dokončí poslední úkol, se tlačítko s animací odemkne a rozsvítí.
   Milník se ale nedokončí sám — uživatel klepne. Milník bez úkolů nejde
   dokončit, tlačítko řekne „Přidej první úkol". Když uživatel po dokončení
   milníku některý úkol zase odškrtne, milník se vrátí do rozpracovaného
   stavu. XP za dokončení milníku se připíše jen poprvé.

3. ODMĚNA ZA SPLNĚNÍ. K milníku jde volitelně přidat odměnu, kterou si
   uživatel dá, až ho splní — krátký text, třeba „Víkend na horách".
   Migrace: sloupec reward (text, nepovinný) v milestones. Pole ve
   formuláři milníku s ikonou dárku a příkladem v nápovědě. Na kartě
   milníku zlatá ikonka dárku s textem odměny. Při dokončení milníku ji
   oslavná sekvence ukáže jako podtitulek: „Tvoje odměna: Víkend na horách".

4. PŘIBLIŽOVÁNÍ MAPY. Je příliš citlivé a trhané. Uprav nastavení
   react-zoom-pan-pinch:
   - menší krok kolečka a plynulé přiblížení s animací kolem 200 ms
     a náběhem ease-out
   - trackpad na Macu posílá při gestu roztažení prstů desítky událostí
     kolečka s ctrlKey za sekundu — to je hlavní příčina citlivosti.
     Normalizuj deltaY a omez maximální změnu měřítka na jednu událost,
     ať je gesto na trackpadu stejně klidné jako na myši
   - setrvačnost po posunu, ne tvrdé zastavení
   - rozsah přiblížení 0,3 až 2
   - tlačítka přiblížení mění měřítko o 20 % s animací
   - dvojklik na prázdné místo přizpůsobí zobrazení celému stromu
   Otestuj na trackpadu i myši.

Commit.
```

## Prompt 8.6 — Pipeline · **Sonnet 5**

```
Tři úpravy pipeline.

1. ZNOVU OSLOVIT. Filtr „Možné znovu oslovit" teď skryje nebo odkryje
   všechny obchody v celé pipeline. Oprav ho: filtr je přepínač v záhlaví
   sloupce s příznakem prohry a filtruje JEN obchody v tom sloupci —
   ukáže pouze ty, které je možné znovu oslovit. Ostatní sloupce se
   nemění. Aktivní filtr je vidět zvýrazněním přepínače a počtem.

   Doba, po které se obchod v prohře označí k novému oslovení, se nově
   nastavuje v Nastavení v sekci Pipeline: „Nabídnout nové oslovení po"
   s volbami 1, 3, 6, 12 měsíců a vlastní počet měsíců. Výchozí 6.
   Migrace: sloupec reengage_after_months v user_settings. Pravidlo
   i odznak na kartách berou hodnotu odsud. Uprav i CLAUDE.md.

2. PŘESOUVÁNÍ FÁZÍ. V režimu úprav se musí fáze přesouvat jako ikony na
   ploše telefonu: chytnutá fáze se zvedne (mírně zvětší, stín, jemné
   naklonění), drží se kurzoru volně v obou osách, ostatní fáze plynule
   s pružinou uhýbají a ukazují, kam dopadne, a po puštění fáze s animací
   zapadne na místo. Použij dnd-kit se sortable a DragOverlay. Funguje
   i klávesnicí a na dotyk. Pořadí se uloží.

3. PŘIDAT FÁZI. Tlačítko je nevýrazné. Na konec řady fází v režimu úprav
   přidej kartu v plné výšce sloupce s přerušovaným fialovým okrajem,
   velkou ikonou plus a textem „Přidat fázi"; při najetí zesvětlá
   a rozsvítí se fialovým svitem. Klepnutí rovnou otevře formulář nové
   fáze. Mimo režim úprav přidej malé tlačítko se stejnou funkcí vedle
   tlačítka Upravit pipeline.

Commit.
```

## Kontrola fáze 8 · **Opus 5.5**

```
Zkontroluj všechny změny z promptů 8.1 až 8.6. Hledej hlavně regrese:
co se úpravami rozbilo jinde. Konkrétně ověř: že po převodu telefonů na
E.164 funguje hledání, kontrola duplicit a vytáčení; že vyhledávání nikde
nepoužívá admin klienta a nevrací cizí data; že nové migrace mají ochranu
řádků; že všechny nové texty jsou v en.json i cs.json a test na překlady
prochází; že v konzoli prohlížeče nejsou chyby na žádné stránce. Oprav
nálezy, pusť lint, test a build.
```
