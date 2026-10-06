# Gradus

Gamifikovaná aplikace pro začínající podnikatele: milníky a úkoly, pipeline obchodů, kontakty s uživatelskými tabulkami, cold calling, kalendář, finance s Fakturoidem, pracovníci a AI asistent Jarvis. Postavená na tom, že podnikání má být hra — oslavy, XP, odemykání.

Majitel: Ondřej. **Komunikuj s ním česky.** Kód, identifikátory a commity anglicky.

Spuštění 1. 12. 2026. Beta od poloviny října. Plán práce je v `Plan_prestavby_Claude_Code.md`.

---

## Stack

- **Next.js 15**, App Router, TypeScript strict, Bun
- **Supabase** — Postgres, Auth (`@supabase/ssr`), Storage, RLS. Migrace přes Supabase CLI v `supabase/migrations`, typy generované do `src/types/database.ts`
- **Tailwind v4** (`@theme` tokeny), **shadcn/ui**, **Framer Motion**, lucide-react
- **next-intl** — EN výchozí, CS druhá
- **TanStack Query** na klientu, serverové routy v `src/app/api`
- Recharts, dnd-kit, react-zoom-pan-pinch, canvas-confetti, date-fns, zod
- Vitest, Playwright
- **Vercel** (fra1), Vercel Cron; **Anthropic SDK** pro Jarvise; Resend pro e-maily

## Příkazy

```bash
bun install
bun run dev
bun run build
bun run lint
bun run test
bun run db:migrate    # supabase db push
bun run db:types      # generuje src/types/database.ts
```

## Struktura

- `src/app/(auth)/` — přihlášení, registrace, heslo
- `src/app/(app)/` — chráněná aplikace, layout se sidebarem
- `src/app/(app)/` je pod adresou /app
- `src/app/(marketing)/` — veřejný web (/, /cenik, /podminky, /soukromi, anglicky pod /en), vlastní layout bez aplikace
- `src/app/api/` — serverové routy (jarvis, generate-contacts, cron/*)
- `src/features/<sekce>/` — komponenty, dotazy, mutace a serverové akce sekce
- Cesty, úrovně, odznaky a odemykání jsou v src/features/game, Jarvisova postava a proaktivní chování v src/features/jarvis
- `src/components/ui/` — sdílené prvky (GlowCard, StatTile, ProgressBar, ProgressRing, StatusPill, AnimatedNumber, EmptyState)
- `src/components/layout/` — Sidebar, TopBar, BottomNav, Background, JarvisButton
- `src/components/celebration/`, `src/components/jarvis/`
- `src/lib/format.ts` — veškeré formátování · `src/lib/constants.ts` — `APP_NAME` · `src/lib/supabase/` — klienti (browser, server, admin)
- `src/config/pricing.ts` — ceny a limity tarifů na jednom místě
- `src/locales/en.json`, `cs.json`

Projekt je postavený od nuly. Starý kód z Lovable se nepoužívá, design je popsaný v tokenech a v plánu.

---

## Pravidla

Jsou to rozhodnutí, ne doporučení. Kód, který je porušuje, oprav nebo na něj upozorni.

### Texty a formáty
- **Žádný viditelný text natvrdo.** Vše v `en.json`/`cs.json`, klíče podle významu (`pipeline.stage.depositPaid`).
- **`APP_NAME` není v překladech**, dosazuje se `{{appName}}`.
- **Formátování jen přes `format.ts`.** Žádné `toLocaleString`, žádné ruční „Kč". Formáty jsou nezávislé na jazyce, z `user_settings`. Měna mění jen zobrazení.
- Ukládat UTC, zobrazovat a počítat hranice dnů v **pásmu uživatele**. Nikdy UTC.
- **Telefony** vždy přes PhoneInput a formatPhone (src/lib/phone.ts, libphonenumber-js). Ukládat v E.164, zobrazovat národně pro stejnou zemi, jinak mezinárodně.

### Data
- **RLS na všech tabulkách.** Uživatel vidí jen svoje. Výjimky: `call_time_stats` (souhrny, čte každý přihlášený), tabulky pracovníků (pracovník vidí své záznamy), sdílený pracovní prostor (pracovník vidí sekce majitele podle práv, viz Pracovní prostor).
- **Role v `user_roles`**, ne v `profiles`. Bez klientského zápisu. `has_role()` je `SECURITY DEFINER`.
- **`usage_events`, `ai_usage`, `call_time_stats` zapisuje jen server** přes admin klienta. Bez klientských INSERT/UPDATE/DELETE pravidel.
- Admin klient obchází RLS — jen v serverovém kódu, vždy filtrovat podle `userId` ze session.
- **Co jde spočítat, se neukládá:** postup milníku, poslední kontakt, příslušnost do Klientů, denní součty časovače, XP úroveň.
- Dotazy vždy stránkovat nebo omezit na zobrazené období. Žádné `select *` na velkých tabulkách.
- **Zkušební období:** registrace z webu = plan pro, status trialing, 14 dní, bez karty. Po expiraci režim jen pro čtení vynucený na serveru, data se nemažou. Pozvánka = plan beta bez expirace.

### Konkrétní části
- **Úkoly:** `parent_task_id` pro podúkoly do libovolné hloubky. Úkol s podúkoly **nejde odškrtnout, dokud nejsou všechny podúkoly hotové** (zamčené zaškrtávátko se zámkem). Jakmile jsou, odemkne se, ale **nedokončí se sám**, uživatel ho odškrtne ručně. Odškrtnutí podúkolu u hotového nadřazeného ho vrátí do rozpracovaného. Postup milníku = splněné / všechny úkoly.
- **Milníky:** dokončit jde jen ručně a jen když jsou hotové všechny úkoly (a je aspoň jeden). Do té doby je tlačítko zamčené (ztlumené, zámek, „Zbývají 3 úkoly"; bez úkolů „Přidej první úkol"); po dokončení posledního úkolu se s animací odemkne a rozsvítí, ale milník se nedokončí sám. Hlídá to i DB (`milestones_guard`). Odškrtnutí úkolu (i nový nehotový úkol) u hotového milníku ho vrátí do rozpracovaného (`tasks_reopen_milestone`). XP za milník jen poprvé. Volitelná odměna `milestones.reward` (krátký text, max 120 znaků): pole s dárkem ve formuláři, zlatý dárek na kartě, v oslavě podtitulek „Tvoje odměna: …".
- **Pipeline:** změna fáze přepisuje `entered_stage_at`. Odebrání fáze s obchody se ptá, kam je přesunout. is_won → oslava, kontakt do Klientů. is_lost déle než user_settings.reengage_after_months (výchozí 6) → odznak „znovu oslovit"; filtr v záhlaví filtruje jen sloupec prohry.
- **Tabulky kontaktů** jsou uživatelsky definované (`contact_tables`, `contact_table_fields`, `contact_table_entries`, `contact_table_moves`). Kontakt je **vždy v přesně jedné** (unique user_id + contact_id). Přesun jen přes `moveContact`. Otázky při přesunu se generují z polí tabulky, včetně závislých polí. Klienti je systémová, plní se sama z vyhraných obchodů. Cold Calling používá tytéž tabulky, nic zvlášť.
- **Časovač:** úseky v `prospecting_segments`. Denní součet = úseky oříznuté na den, počítáno DB funkcí; o půlnoci nula bez jakékoliv úlohy. Nečinnost **15 minut** bez přesunu z Neoslovených: efektivní konec = min(teď, poslední aktivita + 15 min), platí i při čtení. Jen spustit / pozastavit, **žádné vynulování**. Prohlížeč do DB průběžně nezapisuje. Totéž pro `work_sessions` pracovníků.
- **Generování kontaktů:** Places API (New) jen ze serveru, klíč nikdy do prohlížeče, minimální maska polí. Limity denně a měsíčně podle `plans`. Duplicity: `external_place_id`, telefon bez formátování, název + adresa. Google nevrací e-maily. Každé volání do `usage_events` včetně neúspěchů se zprávou od Googlu.
- **Sdílený graf času volání:** jediná data napříč uživateli. V `call_time_stats` jen země, den, hodina, pokusy, schůzky. Políčko < 20 pokusů nezobrazovat, země < 200 nepočítat. Nikdy ukázková čísla. Cron započítá z jednoho uživatele nanejvýš 30 pokusů na hodinu a den, aby jeden účet nezkreslil graf.

### Jarvis
- **Jedna route `/api/jarvis` pro všechna volání modelu.** Nikdy z prohlížeče, nikdy jinou cestou.
- Anthropic SDK, `ANTHROPIC_API_KEY`. Streamovat. Systémový prompt cachovat.
- Routing: Haiku rutina a klasifikace, Sonnet rozhovor a hodnocení, Opus velké rozbory.
- **Zápis do `ai_usage` přímo ve volání**, ne zpětně.
- Hlídání příležitostí **dávkově 3× denně** + okamžité spouštěče. Když nic, mlčí.
- Automatické akce jen s oznámením a možností Vrátit. Milník nikdy nedokončuje sám.
- Hodnocení milníku: když je dobrý, řekne to a nevymýšlí výtky.
- Soubory: PDF, PNG, JPG, TXT, CSV, DOCX, XLSX; 10 MB; 3 na zprávu; typ podle obsahu.
- **Průvodce** po onboardingu (pracovník dostane zkrácený): postava 140 u prvku s atributem `data-tour`, zbytek ztmavne, spotlight s měkkými okraji, Další / Přeskočit, tečky. Dokončení i přeskočení zapíše `profiles.tour_completed_at`; znovu z Nastavení → Nápověda.
- **Proaktivní ozvání** jen z `jarvis_suggestions` (`kind` briefing | suggestion | question, `payload`, `shown_at`, `answered_at`, `snoozed_until`). Píše jen server přes `/api/jarvis`, klient smí jen `seen_at`/`dismissed_at`. Postava přilétá do levého dolního rohu obsahu s bublinou; zobrazení i každá reakce jdou do `usage_events` (`jarvis_proactive`).
- **Pravidla, ať neotravuje:**
  - nejvýš jedno proaktivní zobrazení za relaci a ne dřív než 4 hodiny po předchozím (frekvence Občas = 12 hodin)
  - nikdy, když běží časovač volání nebo je otevřený dialog (ani průvodce, onboarding, panel Jarvise)
  - nikdy do 30 sekund po načtení stránky nebo přechodu na jinou
  - Později = další den v pásmu uživatele; Zavřít = už nikdy tenhle návrh
  - Nastavení → Jarvis: přepínač, frekvence (často / občas / jen ranní shrnutí), tichý režim v celých hodinách
  - když není co říct, neukazuje se — žádné plané „jak se máš"
- **Ranní shrnutí:** cron každou hodinu, píše se v 6–10 h v pásmu uživatele, Sonnet (`briefing`), měřeno v `ai_usage`; prázdný den = žádné volání. Odemyká úroveň 5 v game režimu, v tool režimu je vždy. Zobrazí se při prvním otevření toho dne.
- **Návrhy** z dávkové kontroly můžou nést úkoly k náhledu; vzniknou až po Přidat (klientem uživatele přes RLS). **Otázky** nejvýš dvě týdně, odpovědi jdou do kontextu chatu.

### Rozhraní
- Tokeny v `@theme`, **žádné hexy v komponentách.** Fialová `#7C5CFF`, tyrkysová `#2FE3C8`, zlatá `#FFC64B`, zelená `#3DDC97`, oranžová `#FF9F43` (rozpracované), růžová `#FF6B8A`, pozadí `#070B1F`, karta `#0D1234`.
- **Vyhledávání** (⌘K) prohledává přes klienta přihlášeného uživatele, nikdy admin; bez diakritiky přes unaccent a pg_trgm.
- **Pravý dolní roh patří Jarvisovi.** Plovoucí ovládání vlevo dolů, hlavní akce nahoru k nadpisu.
- Oslava (konfety, zvuk) jen pro velké okamžiky; drobnosti mají malou animaci.
- Telefon < 768 px: spodní lišta, dialogy jako spodní panely, plochy ≥ 44 px, nic jen na hover, žádný vodorovný posun stránky.
- Přihlášení se ověřuje jednou při startu; přechody stránek nikdy nečekají a nezobrazují načítání.
- Stromová mapa: spojnice ve dvou vrstvách (plná čára + lesk), žádný `objectBoundingBox` přechod, rozvržení z naměřených rozměrů, celá obrazovka jako overlay (iOS), ResizeObserver, nikdy neukládat nulové rozměry.
- `prefers-reduced-motion` všude.
- **Barevná témata** přes `data-theme` na `html`, tokeny v `@theme` pro každé téma, volba v `user_settings`. Šest témat: Gradus (výchozí), Půlnoc, Les, Západ, Ocel, Světlé. V game režimu je odemyká úroveň (Půlnoc 3, Les 7, Západ 12, Ocel 18, Světlé 25), v tool režimu jsou všechna hned; zamčené téma hlídá i DB trigger.
- **Pilulka úrovně** v horní liště (jen game režim) pulzuje od postupu na novou úroveň, dokud uživatel okno úrovně neotevře (`profiles.seen_level`).

### Pracovní prostor
- Prostor = účet majitele. Majitel pracuje ve svém, pracovník v prostoru majitele, který ho pozval (zatím právě jeden). Dotazy filtrují podle current_workspace_id(), nikdy podle auth.uid(). Ochrana řádků přes has_section_access(owner, sekce, úroveň).
- `current_workspace_id()` a `has_section_access(_owner, _section, _level)` jsou SECURITY DEFINER. Majitel má ve svém prostoru vše; pracovník jen podle `worker_permissions` (`view` / `edit`, úprava zahrnuje čtení) a jen když je aktivní.
- Sekce pro práva: milestones, contacts, pipeline, cold_calling, calendar, finance. Kontakty a Cold Calling sdílejí tytéž tabulky, otevírá je kterékoli z obou práv. Sekce workers a settings pracovník nikdy nevidí.
- Ochrana řádků na sdílených tabulkách: čtení `user_id = auth.uid()` nebo `has_section_access(user_id, sekce, 'view')`, vložení, úprava i mazání totéž s `'edit'`. Pracovník zakládá řádky s `user_id` = majitel. Funkce SECURITY DEFINER (move_contact, start_prospecting, mark_invoice_paid…) si právo ověřují samy.
- V aplikaci `useWorkspace()` (id prostoru, role owner / worker, práva) a `useCan(sekce, úroveň)`. Každý dotaz sdílené tabulky má `.eq("user_id", workspaceId)` a vkládá `user_id: workspaceId` (účet pracovníka má vlastní založené tabulky a fáze). Bez práva úprav jsou akce přidat, upravit, smazat a přesunout schované; ochrana řádků to vynucuje i tak.
- Práva jsou živá: změna se pracovníkovi projeví hned bez odhlášení (Realtime na `worker_permissions` a `workers`, záloha čtením každých 30 s). Deaktivovaný pracovník je vrácen do vlastního účtu.
- Tam, kde záleží, kdo akci udělal, je actor_id vedle user_id: `contact_activities`, `contact_table_moves`, `prospecting_segments`, `calendar_events` (actor_id), `deals.created_by`, `tasks.completed_by`. Výchozí actor = auth.uid(); klient jiného aktéra nezapíše. Majitel u aktivit a přesunů vidí avatar pracovníka.
- Časovač je po lidech: jeden běžící úsek na (prostor, aktér). Statistiky majitel vidí celkem i po lidech, pracovník jen svoje. Odměny pracovníka (schůzka, vyhraný obchod) se řídí aktérem, ne prostorem.
- Soukromé zůstává: profily, nastavení, XP, odemčení, Jarvisovy konverzace, nápady. Fakturoid připojuje jen majitel.
- Pracovník nikdy nevidí finance bez výslovného práva, nastavení a pracovníky nikdy. Ověření přes RLS s dvěma účty: `bun run verify:workspace`.

### Hra
- Dva režimy: `profiles.mode` game a tool. Volí se v onboardingu, mění v Nastavení → Hra. Tool nic nezamyká a nezobrazuje XP, oslavy jen tiché; XP a postup zůstávají v DB a při návratu do game se obnoví. Přepnutí do game: sekce, které účet už používá (má v nich řádky), zůstanou odemčené (`grant_used_sections`).
- **Cesty podle oboru** (`paths`, `path_milestones`, `path_tasks`): při výběru se šablony zkopírují do `milestones`/`tasks` uživatele s `template_id`. Vlastní milníky bez šablony nic neodemykají, jen dávají XP. Změna cesty v nastavení: nedotčené milníky staré cesty (nehotové, bez hotového úkolu) se smažou, hotové a rozjeté zůstanou; kroky, co uživatel už má (stejný klíč, z libovolné cesty), se nekopírují znovu.
- **XP jen přes `award_xp(reason, ref_id)` na serveru**, z klienta do `xp_events` nejde zapsat. Hodnoty: úkol 10, podúkol 5, milník ze šablony 100–400, vlastní milník 100 (jen poprvé), vyhraný obchod 150 + 1 XP/1000 Kč (strop bonusu 150), domluvená schůzka 40, přesun kontaktu 5, vygenerovaný kontakt 1, 30 minut volání v jednom dni 30 (jednou denně), událost v kalendáři 5, transakce 5, denní přihlášení 10 × násobek série (max ×3). Denní stropy (`DAILY_CAPS` v `src/features/game/rules.ts`): úkoly 200, vlastní milníky 300, obchody 900, schůzky 200, přesuny kontaktů 50, vygenerované kontakty 30, kalendářní události 25, transakce 25.
- **Úrovně:** 30 úrovní, XP na úroveň n = `round(120 · n^1.6)`, počítá se z celkového XP a nikdy se neukládá. Tituly po pěticích (Učeň, Živnostník, Obchodník, Podnikatel, Stratég, Legenda). `level_rewards`: témata na 3/7/12/18/25, Pracovníci na 10, Jarvisovy dovednosti na 5/15/20.
- **Odznaky** (`achievements`, `user_achievements`) se vyhodnocují serverově po každé relevantní akci (`evaluate_achievements`), jen poprvé.
- **Série:** den se počítá, když uživatel udělá aspoň jednu akci dávající XP (denní přihlášení se nepočítá). Jedna záchrana za týden (pondělí–neděle) — vynechaný den sérii nepřeruší, záchrana se spotřebuje jen když opravdu přemostí k dřívějšímu aktivnímu dni.
- Odemykání sekcí v game režimu jen přes milníky cesty (`unlock_key`) a úrovně, nikdy přes počty akcí. Zamčená sekce v menu ukazuje, který milník ji odemkne.
- Jarvis se sám ozývá podle pravidel v sekci Jarvis. Nic nevytváří bez potvrzení.

### Web
- Marketingový web: čeština výchozí, angličtina pod /en. Žádná vymyšlená čísla, recenze ani loga. Žádné sledovací cookies. Snímky aplikace jen z bun run screenshots nad demo účtem.

---

## Prostředí

Veřejné v `.env`, tajné v `.env.local`. Vždy udržovat `.env.example`.

| Proměnná | K čemu |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Klient |
| `NEXT_PUBLIC_SITE_URL` | Základ odkazů v e-mailech (reset hesla) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server, obchází RLS |
| `INVITE_CODE` | Uzavřená registrace |
| `PUBLIC_SIGNUP_ENABLED` | true = registrace bez kódu a 14denní zkušební období; false = jen pozvánky a čekací listina |
| `GOOGLE_MAPS_API_KEY` | Generování kontaktů |
| `ANTHROPIC_API_KEY` | Jarvis |
| `RESEND_API_KEY` | E-maily |
| `CRON_SECRET` | Ověření Vercel Cron |
| `FAKTUROID_*` | Per uživatel, šifrovaně v DB, ne v env |

**Cron úlohy:** `call_time_stats` denně · automatické platby denně · hlídání příležitostí 3× denně · ranní shrnutí Jarvise každou hodinu (6:00 v pásmu uživatele).

Registrace jen s pozvánkovým kódem. **První účet = owner.** Potvrzování e-mailu vypnuté — zapnout před spuštěním.

---

## Postup práce

- Před větším krokem plán (plan mode), pak provedení.
- Commit po každém dokončeném kroku, popis anglicky.
- Po každé sekci: Vitest na klíčovou logiku, ruční průchod na 390 / 768 / 1440 px.
- Chyby hlásit s výstupem terminálu nebo konzole, ne popisem.

## Do prosince nepatří

Přátelé a chat, veřejná registrace, prodejní web, platby předplatného, plná mailová schránka, mobilní aplikace, další jazyky. Uživatelské jméno v profilu je rezervované pro budoucí přátele.
