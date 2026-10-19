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
bun run e2e           # Playwright proti běžícímu dev serveru, interní účty e2e-…@gradus.local; před každým nasazením musí projít
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
- `src/app/(admin)/` — administrace na /admin, majitel a administrátoři s druhým faktorem
- `src/lib/analytics/` — katalog událostí (events.ts), registr metrik (metrics.ts), track()
- `docs/metrics.md` — závazný katalog metrik

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
- **Administrátoři:** role `owner` (právě jeden) a `admin`. Admina přidává jen pozvánka v `admin_invites` (jen SHA-256 32bajtového tokenu, 7 dní, jednorázová, zrušitelná); zápis jen přes SECURITY DEFINER funkce `admin_invite_create` / `admin_invite_revoke` / `admin_remove` (majitel s živou relací a aal2), `admin_invite_claim` (nový účet založený z odkazu pozvánku hned zabere, přes jednu pozvánku vznikne nejvýš jeden nový účet) a `admin_invite_accept` (pozvaný s aal2; token se spotřebuje v téže transakci, kde vznikne role), vše do `admin_audit`. Účet založený z pozvánky (`user_metadata.admin_invite`, nastavuje jen server) nemá onboarding, pracovní prostor ani zkušební období; každý držitel role admin je interní.
- **`usage_events`, `ai_usage`, `call_time_stats` zapisuje jen server** přes admin klienta. Bez klientských INSERT/UPDATE/DELETE pravidel.
- Admin klient obchází RLS — jen v serverovém kódu, vždy filtrovat podle `userId` ze session.
- **Co jde spočítat, se neukládá:** postup milníku, poslední kontakt, příslušnost do Klientů, denní součty časovače, XP úroveň.
- Dotazy vždy stránkovat nebo omezit na zobrazené období. Žádné `select *` na velkých tabulkách.
- **Zkušební období:** registrace z webu = plan pro, status trialing, 14 dní, bez karty. Po expiraci režim jen pro čtení vynucený na serveru, data se nemažou. Pozvánka = plan beta bez expirace.
  - Trial zakládá DB trigger každému novému účtu (kromě úplně prvního); server pak účtu s pozvánkou (beta kód i pozvánka pracovníka) zavolá `grant_beta_plan`, při chybě účet smaže. Klient do `subscriptions` nezapíše.
  - Plán a stav jen přes `current_plan(user_id)` (plán, status včetně `expired`, `read_only`, limity). Expirace se počítá, neukládá. Po expiraci jsou limity generování a AI 0.
  - Jen pro čtení hlídá trigger `enforce_workspace_writable` na datech prostoru: zápis přihlášeného uživatele (i přes SECURITY DEFINER funkce) do prostoru s `read_only` skončí chybou `read_only`. Admin klient blokovaný není, serverové routy kontrolují `current_plan` samy. Nastavení, profil a XP zůstávají zapisovatelné. V rozhraní `useCan(…, "edit")` vrací false.
  - `waitlist` píše a čte jen server; e-mail jen se souhlasem, platí až po potvrzení odkazem, nepotvrzené se po 30 dnech mažou.

### Konkrétní části
- **Úkoly:** `parent_task_id` pro podúkoly do libovolné hloubky. Úkol s podúkoly **nejde odškrtnout, dokud nejsou všechny podúkoly hotové** (zamčené zaškrtávátko se zámkem). Jakmile jsou, odemkne se, ale **nedokončí se sám**, uživatel ho odškrtne ručně. Odškrtnutí podúkolu u hotového nadřazeného ho vrátí do rozpracovaného. Postup milníku = splněné / všechny úkoly.
- **Milníky:** dokončit jde jen ručně a jen když jsou hotové všechny úkoly (a je aspoň jeden). Do té doby je tlačítko zamčené (ztlumené, zámek, „Zbývají 3 úkoly"; bez úkolů „Přidej první úkol"); po dokončení posledního úkolu se s animací odemkne a rozsvítí, ale milník se nedokončí sám. Hlídá to i DB (`milestones_guard`). Odškrtnutí úkolu (i nový nehotový úkol) u hotového milníku ho vrátí do rozpracovaného (`tasks_reopen_milestone`). XP za milník jen poprvé. Volitelná odměna `milestones.reward` (krátký text, max 120 znaků): pole s dárkem ve formuláři, zlatý dárek na kartě, v oslavě podtitulek „Tvoje odměna: …".
- **Pipeline:** změna fáze přepisuje `entered_stage_at`. Odebrání fáze s obchody se ptá, kam je přesunout. is_won → oslava, kontakt do Klientů. is_lost déle než user_settings.reengage_after_months (výchozí 6) → odznak „znovu oslovit"; filtr v záhlaví filtruje jen sloupec prohry.
- **Tabulky kontaktů** jsou uživatelsky definované (`contact_tables`, `contact_table_fields`, `contact_table_entries`, `contact_table_moves`). Kontakt je **vždy v přesně jedné** (unique user_id + contact_id). Přesun jen přes `moveContact`. Otázky při přesunu se generují z polí tabulky, včetně závislých polí. Klienti je systémová, plní se sama z vyhraných obchodů. Cold Calling používá tytéž tabulky, nic zvlášť.
- **Časovač:** úseky v `prospecting_segments`. Denní součet = úseky oříznuté na den, počítáno DB funkcí; o půlnoci nula bez jakékoliv úlohy. Nečinnost **15 minut** bez přesunu z Neoslovených: efektivní konec = min(teď, poslední aktivita + 15 min), platí i při čtení. Jen spustit / pozastavit, **žádné vynulování**. Prohlížeč do DB průběžně nezapisuje. Totéž pro `work_sessions` pracovníků.
- **Generování kontaktů:** Places API (New) jen ze serveru, klíč nikdy do prohlížeče, minimální maska polí. Limity denně a měsíčně podle `plans`. Duplicity: `external_place_id`, telefon bez formátování, název + adresa. Google nevrací e-maily. Každé volání do `usage_events` včetně neúspěchů se zprávou od Googlu.
- **Sdílený graf času volání:** jediná data napříč uživateli. V `call_time_stats` jen země, den, hodina, pokusy, schůzky. Políčko < 20 pokusů nezobrazovat, země < 200 nepočítat. Nikdy ukázková čísla. Cron započítá z jednoho uživatele nanejvýš 30 pokusů na hodinu a den, aby jeden účet nezkreslil graf.

### Poznámky
- **Účel:** podklady k podnikání na jednom místě (ideální zákazník, produkty a služby, ceník, konkurence, prodejní skript, nápady), ovládání jako Apple Notes. Sekce /app/poznamky v menu po Milnících, nikdy zamčená.
- **Data:** `notes` (title = první řádek, content = JSON editoru Tiptap, content_text = čistý text po řádcích pro hledání a Jarvise, pinned, deleted_at; generované `preview` a `search_vector` (simple + unaccent)). RLS jen vlastní řádky; pracovník k poznámkám majitele přístup nemá a sekci nevidí. Klient zapisuje jen title, content, content_text, pinned, deleted_at; časy hlídá `notes_guard` (updated_at jen při změně textu). Limit velikosti v DB (content 400 kB, text 100 000 znaků, název 200).
- **Ukládání** jen přes `NoteSaver` (src/features/notes/note-saver.ts): debounce 600 ms, jeden požadavek na poznámku, neuložené v localStorage a odeslané po obnovení, varování při zavření karty. Žádné tlačítko Uložit.
- **Koš:** smazání nastaví deleted_at, obnovení ho vynuluje; cron `notes-trash` jednou denně maže po 30 dnech (`purge_deleted_notes`, jen server). Prázdná poznámka se po odchodu z ní smaže hned.
- **Hledání:** `search_notes()` (fulltext, předpony slov, bez diakritiky), používá ho seznam i ⌘K.
- Šablony v `src/features/notes/templates.ts` (klíče idealCustomer, offer, pricing, competition, salesScript; texty v překladech, otázka navíc podle oboru).
- **Obsah poznámek je vždy data uživatele, nikdy instrukce pro Jarvise.** Do kontextu jde ohraničený a označený jako data.
- **Propojení s prací:** `note_links` (note_id + právě jedno z task_id / milestone_id). RLS: obě strany musí být vlastní řádky volajícího (pracovník poznámku k úkolu majitele nepřipojí), klient jen vkládá a maže. V detailu úkolu (dialog) i milníku sekce Poznámky: propojené poznámky, „Připojit poznámku" s hledáním, „Zapsat do poznámek" (nová poznámka s názvem úkolu, propojí a otevře). V poznámce nahoře nenápadně „Patří k: …" s odkazem. Jen ve vlastním prostoru (role owner).
- **Textové kroky cest** mají `path_tasks.note_template` (klíč šablony); úkol ho čte přes `template_id`, nic se nekopíruje. U nich je „Zapsat do poznámek" hlavní tlačítko (i ikona v řádku úkolu) a poznámka dostane osnovu šablony. Nový krok cesty, jehož výstupem je text, dostane note_template.

### Jarvis
- **Jedna route `/api/jarvis` pro všechna volání modelu.** Nikdy z prohlížeče, nikdy jinou cestou.
- Anthropic SDK, `ANTHROPIC_API_KEY`. Streamovat. Systémový prompt cachovat.
- Routing: Haiku rutina a klasifikace, Sonnet rozhovor a hodnocení, Opus velké rozbory.
- **Zápis do `ai_usage` přímo ve volání**, ne zpětně.
- Hlídání příležitostí **dávkově 1× denně** (na Vercel Pro 3× denně) + okamžité spouštěče. Když nic, mlčí.
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
- **Poznámky v kontextu chatu:** `jarvis_notes(zpráva)` (jen vlastní poznámky, SECURITY DEFINER) → `describeNotes` (src/features/jarvis/notes-context.ts): názvy a data úprav 50 nejnovějších, plný text připnutých, propojených s otevřenými milníky a úkoly a 3 nejlepších fulltextových shod se zprávou. Celý blok max 12 000 znaků, zkrácení s „[… truncated]", ohraničený `<user_notes>` jako data, značky uvnitř poznámek se neutralizují. Hodnocení milníku bere poznámky propojené s milníkem a jeho úkoly. Systémový prompt říká, že z poznámek má vycházet a neptat se na zapsané. Cena: nejvýš ~4 000 vstupních tokenů Sonnetu navíc, tj. ≤ 0,008 USD na zprávu (běžně zlomek).
- **Do poznámek** se z Jarvise zapisuje jen tlačítkem „Uložit do poznámek" u odpovědi (nová poznámka, nebo na konec existující). Sám nikdy.
- **Představení Poznámek:** jednou za život účtu (`profiles.notes_intro_seen_at`, zapíše se při zobrazení), jen majitel, po onboardingu a dokončené prohlídce (stávající účty při další návštěvě). Pevný text z překladů, žádné volání modelu, tlačítko „Otevřít Poznámky". Vyskočí až když nic jiného není na obrazovce (prohlídka, oslava, dialog, panel, běžící časovač) a stránka je 4 s v klidu; bere si jediné proaktivní zobrazení relace. Událost `jarvis_notes_intro`.
- **E2E bez modelu:** mimo produkci, jen pro účty e2e-…@gradus.local a s hlavičkou `x-gradus-e2e-model: echo-notes` odpoví chat blokem poznámek z kontextu (src/features/jarvis/server/e2e-model.ts). Jinak vždy Anthropic.
- **Ranní shrnutí:** cron každou hodinu, píše se v 6–10 h v pásmu uživatele, Sonnet (`briefing`), měřeno v `ai_usage`; prázdný den = žádné volání. Odemyká úroveň 5 v game režimu, v tool režimu je vždy. Zobrazí se při prvním otevření toho dne.
- **Návrhy** z dávkové kontroly můžou nést úkoly k náhledu; vzniknou až po Přidat (klientem uživatele přes RLS). **Otázky** nejvýš dvě týdně, odpovědi jdou do kontextu chatu.
- **Časové okno** (`src/features/jarvis/time-window.ts`, deterministické, sdílí server i prohlížeč): volání a schůzky jen v pracovní dny 8:00–17:30 v pásmu uživatele, ne o státních svátcích ČR (včetně Velikonoc; účet bez země v pražském pásmu = CZ), poledne 12–13 není preferované. Když má země uživatele v `call_time_stats` dost dat (≥ 200 pokusů, ≥ 3 políčka po 20), mají přednost její nejlepší hodiny v pracovní dny. Mimo okno se nabízí příprava (poznámky, plán na další pracovní den, seznam lidí k zavolání, e-maily na ráno, úkoly z milníků).
  - Souhrn situace nese místní čas, den v týdnu, pracovní dobu a stav okna; systémový prompt: akce závislé na druhých lidech jen v okně, jinak je naplánovat na další okno s dnem a časem a nabídnout, co jde hned. Nikdy neblokovat.
  - Návrhy „zavolej" (`followUps`, insight s `payload.people`, starší podle slov) se mimo okno proaktivně neukazují a v panelu mají čas dalšího okna (`notBefore`); rozhoduje se při čtení, ne při zápisu. Hlídání dostane čas v kontextu, ranní shrnutí `<day_plan>`.
  - Nástěnka (Komu zavolat) a Cold Calling mimo okno ukazují `CallWindowNotice` („Teď je po pracovní době, lidé to většinou nezvedají") místo výzvy volat, nic neblokuje.
- **Měsíční rozpočet:** Jarvis běží na API kreditech (100 USD měsíčně, propadají). Stropy se nastavují v administraci (/admin → AI a Jarvis → Strop využití AI) bez nového nasazení: `app_settings` klíč `ai_caps` (`monthly_usd` 0–10 000, `per_user_usd` 0–1 000 nebo prázdné = bez limitu, `warn_percent` 1–100). Dokud v DB nic není, platí `JARVIS_MONTHLY_BUDGET_USD` (výchozí 90), bez stropu na uživatele a 80 %. Útrata = součet `ai_usage.cost_usd` všech účtů včetně interních za kalendářní měsíc v UTC (`jarvis_month_spend`, jen server). Kontrola před každým voláním modelu (strážce `check(feature, userId)` v klientovi z `createAnthropic`, `streamModel` bez něj nevolá; každé volání nese `userId`); stropy se čtou s cache nejvýš 30 s, změna platí do minuty:
  - od prahu upozornění: majiteli jeden e-mail denně se stavem (Resend)
  - od 100 % celkového stropu: žádné volání modelu do konce měsíce; chat a ostatní úlohy ukážou vlídnou hlášku (kód `paused`: „Jarvis si dává do konce měsíce pauzu, aplikace funguje dál"), hlídání příležitostí běží jen z pravidel, ranní shrnutí se nepíše
  - strop uživatele (výjimka v `ai_user_caps` — vlastní strop nebo zablokovaná AI, nastavuje se v /admin/uzivatele/[id] —, jinak `per_user_usd`): po dosažení žádné volání modelu pro tohoto uživatele, kód `userLimit` („AI pomocník má pro tvůj účet tento měsíc vyčerpaný limit, zbytek aplikace funguje dál"), bez e-mailu, `jarvis_paused` s důvodem `user_cap` / `user_blocked`
  - `app_settings` a `ai_user_caps` čte jen server, zapisují je jen `admin_set_app_setting` / `admin_set_ai_user_cap` (SECURITY DEFINER, ověří majitele s živou relací administrace a aal2) a ve stejné transakci zapíšou do `admin_audit` kdo, kdy a `detail` z čeho na co; formuláře se ptají na potvrzení
  - vyčerpaný kredit nebo limit útraty z API se pozná podle typu chyby SDK (`billing_error`/402, `error.details.error_code` `enforced_spend_limit_reached`), nikdy podle textu: tatáž hláška, `jarvis_paused` v analytice s kódem, e-mail majiteli max jednou denně (`jarvis_budget_alerts`), nikdy surová chyba
  - administrace AI a Jarvis: karta rozpočtu nahoře (útrata, odhad, volání, stav), pod ní Strop využití AI s útratou a zbytkem u každé hodnoty

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

### Analytika a administrace
- Události jen z katalogu events.ts. Vlastnosti jen identifikátory, výčty, čísla, pravdivostní hodnoty — nikdy volný text, jména, kontakty, názvy ani obsah zpráv.
- Zápis jen přes track() na serveru nebo /api/t, které bere uživatele ze session. Do analytics_events nikdy nezapisuje klient přímo.
- Interní účty (profiles.is_internal) jsou z metrik ve výchozím stavu vyloučené.
- Měny se v metrikách nesčítají.
- /admin: role owner nebo admin + aal2 (TOTP) a živá relace administrace. Kdo je nemá (nepřihlášený, bez druhého faktoru, vypršelá relace), jde na /admin/prihlaseni?next=… (jen cesty pod /admin, `safeAdminNextPath`), po heslu a TOTP zpět na next. Přihlášení vidí každý; kdo není majitel ani admin, dostane po hesle 404, špatné heslo neprozradí, zda e-mail existuje. Data administrace jen na serveru přes admin klienta po ověření, každý pohled a export do admin_audit.
- Admin vidí vše kromě sekce Administrátoři (/admin/administratori, adminovi 404), stropy AI a výjimky jen čte, exporty s osobními údaji (`PERSONAL_DATA_EXPORTS`, export auditu) nemá. Co nesmí, se neukáže (ne šedé); server i DB (`admin_require_owner()`) to vynucují. Tabulka práv v `docs/admin-roles.md`, pravidla v `src/features/admin/roles.ts`; nová akce nebo funkce administrace = nový řádek v tabulce.
- Pozvánka: `/admin/pozvanka/<token>` → přihlášení nebo nový účet → povinné TOTP → role admin → /admin. Neplatný, použitý, zrušený i vypršelý odkaz dostane tutéž neutrální hlášku a počítá se do limitu pokusů podle IP jako přihlášení. Odebrání admina ukončí jeho živou relaci hned. Přihlášení do administrace ukládá do `admin_audit` IP zkrácenou na /24 (IPv6 /48) a třídu prohlížeče, nikdy celou adresu ani User-Agent.
- Nová funkce v aplikaci = nové události v katalogu a případně nová metrika v docs/metrics.md.
- Události a relace se mažou po 13 měsících.

---

## Prostředí

Veřejné v `.env`, tajné v `.env.local`. Vždy udržovat `.env.example`.

| Proměnná | K čemu |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Klient |
| `NEXT_PUBLIC_SITE_URL` | Základ odkazů v e-mailech (reset hesla) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server, obchází RLS |
| `INVITE_CODE` | Uzavřená registrace |
| `PUBLIC_SIGNUP_ENABLED` | true = registrace bez kódu a 14denní zkušební období; false (výchozí) = jen pozvánky a čekací listina. Čte jen server (`src/lib/signup.ts`), změna chce restart |
| `GOOGLE_MAPS_API_KEY` | Generování kontaktů |
| `ANTHROPIC_API_KEY` | Jarvis |
| `JARVIS_MONTHLY_BUDGET_USD` | Jen výchozí hodnota celkového měsíčního stropu Jarvise v USD (90, rezerva pod 100 USD kreditů), dokud ho majitel nenastaví v administraci (`app_settings.ai_caps`). Platné stropy a práh upozornění jsou v administraci. |
| `RESEND_API_KEY` | E-maily |
| `CRON_SECRET` | Ověření Vercel Cron |
| `FAKTUROID_*` | Per uživatel, šifrovaně v DB, ne v env |
| `NEXT_PUBLIC_BETA` | Štítek Beta v aplikaci |

**Cron úlohy:** `call_time_stats` denně · koš poznámek denně · automatické platby denně · hlídání příležitostí 1× denně (10:00 UTC) · ranní shrnutí Jarvise 1× denně (5:00 UTC = 6–8 h v Česku). Běžíme na Vercel Hobby: každá úloha smí běžet nejvýš jednou denně a spouští se kdykoliv během zadané hodiny, jinak nasazení spadne. Častější běh (3× denně, každou hodinu) vrátit až po přechodu na Vercel Pro.

Registrace jen s pozvánkovým kódem. **První účet = owner.** Potvrzování e-mailu vypnuté — zapnout před spuštěním.

---

## Postup práce

- Před větším krokem plán (plan mode), pak provedení.
- Commit po každém dokončeném kroku, popis anglicky.
- Po každé sekci: Vitest na klíčovou logiku, ruční průchod na 390 / 768 / 1440 px.
- Chyby hlásit s výstupem terminálu nebo konzole, ne popisem.
- Před každým nasazením musí projít `bun run e2e`.
- Hlášení od testerů jsou v `bug_reports`; oprava hlášení = stav Opraveno v administraci.
- **Produkce běží.** Aplikace je na Vercelu (Hobby) a každý push na main se hned nasadí k testerům. Pushuj jen s procházejícím `bun run lint`, `bun run test` a `bun run build`.
- **Databáze je jedna pro vývoj i produkci.** Migrace jen přidávací: nové tabulky, nové sloupce s výchozí hodnotou nebo povolené null. Nic nemazat, nepřejmenovávat ani neměnit typ bez samostatného plánu přechodu. Testovací data jen pod účty @gradus.local.
- **Plánované úlohy max 1× denně** (Vercel Hobby), viz Cron úlohy.

## Do prosince nepatří

Přátelé a chat, veřejná registrace, prodejní web, platby předplatného, plná mailová schránka, mobilní aplikace, další jazyky. Uživatelské jméno v profilu je rezervované pro budoucí přátele.
