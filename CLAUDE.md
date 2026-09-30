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
- `src/app/api/` — serverové routy (jarvis, generate-contacts, cron/*)
- `src/features/<sekce>/` — komponenty, dotazy, mutace a serverové akce sekce
- `src/components/ui/` — sdílené prvky (GlowCard, StatTile, ProgressBar, ProgressRing, StatusPill, AnimatedNumber, EmptyState)
- `src/components/layout/` — Sidebar, TopBar, BottomNav, Background, JarvisButton
- `src/components/celebration/`, `src/components/jarvis/`
- `src/lib/format.ts` — veškeré formátování · `src/lib/constants.ts` — `APP_NAME` · `src/lib/supabase/` — klienti (browser, server, admin)
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
- **RLS na všech tabulkách.** Uživatel vidí jen svoje. Výjimky: `call_time_stats` (souhrny, čte každý přihlášený), tabulky pracovníků (pracovník vidí své záznamy).
- **Role v `user_roles`**, ne v `profiles`. Bez klientského zápisu. `has_role()` je `SECURITY DEFINER`.
- **`usage_events`, `ai_usage`, `call_time_stats` zapisuje jen server** přes admin klienta. Bez klientských INSERT/UPDATE/DELETE pravidel.
- Admin klient obchází RLS — jen v serverovém kódu, vždy filtrovat podle `userId` ze session.
- **Co jde spočítat, se neukládá:** postup milníku, poslední kontakt, příslušnost do Klientů, denní součty časovače, XP úroveň.
- Dotazy vždy stránkovat nebo omezit na zobrazené období. Žádné `select *` na velkých tabulkách.

### Konkrétní části
- **Úkoly:** `parent_task_id` pro podúkoly do libovolné hloubky. Úkol s podúkoly **nejde odškrtnout, dokud nejsou všechny podúkoly hotové** (zamčené zaškrtávátko se zámkem). Jakmile jsou, odemkne se, ale **nedokončí se sám**, uživatel ho odškrtne ručně. Odškrtnutí podúkolu u hotového nadřazeného ho vrátí do rozpracovaného. Postup milníku = splněné / všechny úkoly.
- **Milníky:** dokončit jde jen ručně a jen když jsou hotové všechny úkoly (a je aspoň jeden); tlačítko je do té doby zamčené. Odškrtnutí úkolu u hotového milníku ho vrátí do rozpracovaného. XP za milník jen poprvé. Volitelná odměna v milestones.reward se ukáže v oslavě.
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

### Rozhraní
- Tokeny v `@theme`, **žádné hexy v komponentách.** Fialová `#7C5CFF`, tyrkysová `#2FE3C8`, zlatá `#FFC64B`, zelená `#3DDC97`, oranžová `#FF9F43` (rozpracované), růžová `#FF6B8A`, pozadí `#070B1F`, karta `#0D1234`.
- **Vyhledávání** (⌘K) prohledává přes klienta přihlášeného uživatele, nikdy admin; bez diakritiky přes unaccent a pg_trgm.
- **Pravý dolní roh patří Jarvisovi.** Plovoucí ovládání vlevo dolů, hlavní akce nahoru k nadpisu.
- Oslava (konfety, zvuk) jen pro velké okamžiky; drobnosti mají malou animaci.
- Telefon < 768 px: spodní lišta, dialogy jako spodní panely, plochy ≥ 44 px, nic jen na hover, žádný vodorovný posun stránky.
- Přihlášení se ověřuje jednou při startu; přechody stránek nikdy nečekají a nezobrazují načítání.
- Stromová mapa: spojnice ve dvou vrstvách (plná čára + lesk), žádný `objectBoundingBox` přechod, rozvržení z naměřených rozměrů, celá obrazovka jako overlay (iOS), ResizeObserver, nikdy neukládat nulové rozměry.
- `prefers-reduced-motion` všude.

---

## Prostředí

Veřejné v `.env`, tajné v `.env.local`. Vždy udržovat `.env.example`.

| Proměnná | K čemu |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Klient |
| `NEXT_PUBLIC_SITE_URL` | Základ odkazů v e-mailech (reset hesla) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server, obchází RLS |
| `INVITE_CODE` | Uzavřená registrace |
| `GOOGLE_MAPS_API_KEY` | Generování kontaktů |
| `ANTHROPIC_API_KEY` | Jarvis |
| `RESEND_API_KEY` | E-maily |
| `CRON_SECRET` | Ověření Vercel Cron |
| `FAKTUROID_*` | Per uživatel, šifrovaně v DB, ne v env |

**Cron úlohy:** `call_time_stats` denně · automatické platby denně · hlídání příležitostí 3× denně.

Registrace jen s pozvánkovým kódem. **První účet = owner.** Potvrzování e-mailu vypnuté — zapnout před spuštěním.

---

## Postup práce

- Před větším krokem plán (plan mode), pak provedení.
- Commit po každém dokončeném kroku, popis anglicky.
- Po každé sekci: Vitest na klíčovou logiku, ruční průchod na 390 / 768 / 1440 px.
- Chyby hlásit s výstupem terminálu nebo konzole, ne popisem.

## Do prosince nepatří

Přátelé a chat, veřejná registrace, prodejní web, platby předplatného, plná mailová schránka, mobilní aplikace, další jazyky. Uživatelské jméno v profilu je rezervované pro budoucí přátele.
