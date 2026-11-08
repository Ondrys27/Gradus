# Plánovač schůzek, světové měny a jazyky — kolo 16

Instrukce pro Claude Code. Proveď kroky 1 až 3 přesně a doslova. Obsah k vložení je vždy mezi řádky `=== ZAČÁTEK` a `=== KONEC`. Prompty samotné neprováděj — provedou se příkazem `/pokracuj` (nebo nočním během `scripts/noc.sh`).

---

## Krok 1 — Na konec `docs/plan.md` přidej tohle

=== ZAČÁTEK

---

# FÁZE 23 — Plánovač schůzek, měny a jazyky

*Rozhodnutí ze dne 8. 11.: plánovač pracuje jen s kalendářem Gradusu (cizí kalendáře jednosměrně přes odběr ICS; obousměrné propojení s Googlem až po ověření aplikace u Googlu, samostatné kolo). Odkaz na videohovor je trvalý odkaz uživatele (automatický Google Meet později). Pořadí: 23.4 (měny) a 23.5 (jazyky) jdou PŘED plánovačem, protože veřejná stránka plánovače potřebuje obojí. Vercel Hobby: plánované úlohy jen jednou denně — připomínky proto plánuje Resend (scheduled_at), ne cron.*

## Prompt 23.1 — Světové měny · **Opus 5.5**

```
Gradus má být celosvětový: jakákoli měna v nastavení uživatele,
ve financích, fakturách i v cenách tarifů.

1. SEZNAM MĚN. Místo ručního CURRENCIES v src/lib/format.ts použij
   všechny platné kódy ISO 4217 (Intl.supportedValuesOf("currency")
   na serveru při buildu → vygenerovaný soubor src/config/currencies.ts
   s kódem, počtem desetinných míst a názvem přes
   Intl.DisplayNames v jazyce uživatele; skript bun run gen:currencies).
   Výběr měny v nastavení: hledání podle kódu i názvu, nejčastější
   nahoře podle země uživatele. Formátování všude přes src/lib/format.ts
   (symbol, desetinná místa, oddělovače podle jazyka; nulová místa
   u JPY/HUF/KRW…). Projdi všechna místa, kde je CZK nebo EUR
   napevno (grep), a odstraň je kromě seedu katalogu.
2. KURZY. Tabulka exchange_rates (base EUR, code, rate, fetched_at,
   source). Denní cron (Vercel Hobby, jednou denně) stáhne kurzy
   z ECB (frankfurter.app, bez klíče, ~30 měn) a pro ostatní z
   open.er-api.com (bez klíče, ~160 měn); když zdroj selže, zůstane
   poslední kurz a administrace Zdraví to ukáže. Žádný kurz starší
   než 7 dní se nepoužije pro cenu — místo něj EUR. Přepočet jen
   pro zobrazení cen a souhrnů; uložené částky se nikdy nepřepočítávají
   (finance zůstávají v měně, ve které vznikly; souhrn napříč měnami
   ukáže přepočet s poznámkou „orientačně podle kurzu z <datum>").
3. CENY TARIFŮ V KAŽDÉ MĚNĚ. Katalog tarifů (15.5) má základní
   ceny v EUR a ruční ceny pro měny, které majitel zadá (CZK dnes,
   dál libovolné). Pro všechny ostatní měny se cena odvodí z EUR
   kurzem a zaokrouhlí „prodejně" funkcí psychologicalPrice(amount,
   currency) se zdokumentovanými pravidly: měny s desetinnými místy
   a částkou do 20 → x,99; do 100 → x9 (např. 49); do 1 000 → x9
   nebo x90 podle velikosti; nad 1 000 → x90 / x900; měny bez
   desetinných míst analogicky (JPY 2 990). Výsledek se od přesného
   přepočtu nesmí lišit o víc než 8 %. Testy na EUR→CZK (0,99 € →
   29 Kč, 19 € → 490 Kč v rozumném rozmezí), USD, GBP, PLN, JPY,
   INR, BRL. Administrace → Tarify: náhled ceny v libovolné měně,
   možnost přepsat ručně (ruční cena má přednost a kurz ji nemění),
   upozornění, když se ruční cena vzdálí od kurzu o víc než 15 %.
4. WEB A APLIKACE. Ceník na webu a v aplikaci ukazuje měnu podle
   země návštěvníka (hlavička Vercelu x-vercel-ip-country → měna
   země z tabulky země→měna v src/config/currencies.ts) s přepínačem;
   přihlášený uživatel vidí svou měnu. SEO offers v měně stránky.
5. DOPLNĚK „BEZ ZNAČKY GRADUS" (použije 23.3): položka katalogu
   add_ons s klíčem no_branding, cena 0,99 € měsíčně, ruční CZK
   29, ostatní měny odvozené (USD 0,99, GBP 0,89, PLN 3,99…
   podle funkce). Zobrazení v Nastavení → Předplatné jako
   přepínatelný doplněk (bez platby, jako ostatní; TODO(payments)).
6. Vitest pro zaokrouhlování a přepočty, E2E: změnit měnu na JPY →
   finance a ceník správně formátované; ceník z IP jiné země.
   Doplň CLAUDE.md (Texty a formáty, Tarify).
```

---

## Prompt 23.2 — Jazyky: libovolný jazyk a automatický překlad · **Opus 5.5**

```
Aplikace má být dostupná ve světových jazycích. Dnes CS a EN,
~6 000 textů na jazyk v src/locales/*.json. Překlad všech jazyků
ručně nejde; udělej infrastrukturu pro libovolný jazyk a strojový
překlad s kontrolou.

1. INFRASTRUKTURA. src/i18n/locales.ts se stane seznamem všech
   podporovaných jazyků s metadaty (kód BCP 47, název v daném
   jazyce, směr psaní, výchozí měna a formát data, stav: published |
   draft). Načítání zpráv po jazyce líně (dynamický import), ne
   všechny do bundle. Výběr jazyka v nastavení a na webu (návštěvník
   podle Accept-Language, s přepínačem; URL /en, /de… pro web,
   aplikace podle nastavení). RTL: layout musí fungovat s dir="rtl"
   (logické CSS vlastnosti místo left/right; projdi Tailwind třídy
   ml-/mr-/pl-/pr-/left-/right- a nahraď ms-/me-/ps-/pe-/start-/end-).
   Jarvis odpovídá v jazyce uživatele (už umí? ověř a doplň
   instrukci do promptu), e-maily, PDF faktur (fonty pro latinku,
   cyrilici, řečtinu; CJK a arabština přes vhodný font — ověř, že
   PDF nezobrazí čtverečky) a Jarvisovy pevné texty tutoriálu
   a pravidel jdou ze stejných souborů.
2. PŘEKLADOVÝ KANÁL. Skript bun run i18n:translate <jazyk>:
   vezme en.json jako zdroj, přeloží jen klíče, které v cílovém
   jazyce chybí nebo mají starší hash zdroje (ulož hash každého
   zdrojového textu do locales/.hashes.json), přes Claude API
   (Sonnet, dávky po ~150 klíčích, s glosářem pojmů Gradusu:
   Jarvis, milník, pipeline, Close Date… v docs/i18n-glosar.md,
   kde pro každý jazyk je i rozhodnutí, co se nepřekládá). Zachová
   zástupné symboly {name}, ICU plurály a HTML značky — validace po
   překladu, selhání se opraví druhým průchodem. Výsledek označí
   jako draft; bun run i18n:check vypíše chybějící a zastaralé
   klíče ve všech jazycích; bun run i18n:translate --all přeloží
   všechny jazyky se stavem published nebo draft. Odhadni a napiš
   do souhrnu cenu jednoho jazyka (orientačně do 2 USD).
3. PRVNÍ SADA. Přelož a zapni (published) tyto jazyky: de, sk,
   pl, es, fr, it, pt-BR, nl, uk, ro, hu, tr. Připrav jako draft
   (přeložené, ale skryté): ru, ja, zh-CN, ko, ar (RTL), hi, id,
   vi, sv, da, nb, fi, el, cs/en zůstávají. Další jazyk = jeden
   příkaz a přepnutí stavu v administraci → Nastavení → Jazyky
   (seznam, stav, procento přeloženého, datum překladu, tlačítko
   Přeložit chybějící). Jazyk ve stavu draft jde zapnout pro
   konkrétní účet (interní testeři) v detailu uživatele.
4. KVALITA. V aplikaci u každého textu v draft jazyce nenápadná
   možnost „Navrhnout lepší překlad" (jen přihlášený; návrhy do
   tabulky i18n_suggestions, administrace je schválí → zapíše do
   JSON přes skript). Překlady nikdy nemění klíče ani strukturu.
5. Vitest pro validaci zástupných symbolů a plurálů, i18n:check
   v CI (bun run lint ho volá), E2E: přepnutí do de a ar →
   aplikace i web bez anglických zbytků na nástěnce, RTL rozvržení
   bez překryvů. Doplň CLAUDE.md (Texty a formáty: každý nový text
   jde do en.json a cs.json, ostatní jazyky doplní skript).
```

---

## Prompt 23.3 — Plánovač schůzek: typy, dostupnost, odběry · **Opus 5.5**

```
Nová sekce Plánovač schůzek (menu za Kalendářem, ikona CalendarClock,
adresa /app/planovac, EN „Scheduler"). Uživatel nastaví typy schůzek
a dostupnost; klient si pak přes veřejný odkaz (23.4) vybere termín,
který je v kalendáři Gradusu volný.

1. DATA (RLS podle prostoru a vlastníka; pracovník jen své):
   - scheduler_profiles (user_id, space_id, handle unikátní globálně
     [a-z0-9-], 3–30 znaků, výchozí z jména; display_name, headline,
     bio, photo z profilu, time_zone z nastavení, video_link —
     trvalý odkaz na Google Meet/Teams/Zoom/Jitsi, branding_hidden
     odvozené z doplňku no_branding),
   - event_types (profile_id, slug, name, description, duration_min
     15/20/30/45/60/90/120/vlastní, location_kind video|phone|
     in_person|custom, location_text, color, active, position,
     requires_approval bool, buffer_before_min, buffer_after_min,
     min_notice_hours, max_days_ahead, max_per_day, slot_step_min
     (15/30/60), questions JSON [{key,label,type text|textarea|
     phone|email|select|checkbox, required, options}], deal_stage_id
     null (založit obchod ve fázi), reminders JSON [{offset_minutes,
     channel email}], confirmation_note),
   - availability_rules (profile_id, weekday 0–6, start_time,
     end_time; více intervalů za den) + availability_overrides
     (profile_id, date, start/end nebo celý den blokovaný; dovolená),
   - calendar_subscriptions (user_id, name, ics_url šifrovaná
     INTEGRATIONS_ENCRYPTION_KEY, last_fetched_at, last_status,
     busy JSON cache intervalů na 60 dní),
   - bookings (event_type_id, host_user_id, space_id, starts_at,
     ends_at, guest_name, guest_email, guest_phone, guest_company,
     guest_time_zone, answers JSON, status held|pending|confirmed|
     cancelled|declined|rescheduled, hold_expires_at, manage_token_hash,
     contact_id, calendar_event_id, deal_id, reminder_ids JSON,
     cancelled_by host|guest, cancel_reason, created_at).
2. VÝPOČET VOLNÝCH TERMÍNŮ (čistá funkce src/features/scheduler/
   slots.ts, testy): pracovní doba podle pravidel v pásmu hostitele
   → mínus výjimky → mínus události kalendáře Gradusu hostitele
   (včetně schůzek pracovníků? ne — jen vlastní; úkoly s časem
   ano, celodenní ne) → mínus obsazenost z odběrů ICS → mínus
   aktivní bookings a held → aplikuj buffer před/po, min_notice,
   max_days_ahead, max_per_day → sloty po slot_step → převést do
   pásma hosta. Přechody letního času a půlnoc testovat.
3. ODBĚRY ICS. Nastavení → Kalendář → Odebírané kalendáře: vložit
   tajný ICS odkaz (Google: „Tajná adresa ve formátu iCal", Apple,
   Outlook — nápověda s obrázky), název, barva. Server stáhne ICS
   (limit 5 MB, timeout 10 s, jen https), rozparsuje VEVENT včetně
   opakování (RRULE, EXDATE) na 60 dní dopředu, uloží busy intervaly.
   Obnova: při otevření veřejné stránky, když je cache starší než
   10 minut (na pozadí, stránka použije cache), a denním cronem.
   Události z odběru se v kalendáři Gradusu zobrazují šedě jen pro
   čtení (přepínatelné), nikdy se neukládají jako calendar_events.
   Export: Nastavení → Kalendář → „Odkaz pro odběr kalendáře
   Gradusu" (ICS feed s tokenem, obnovitelný) pro Google/Apple.
4. ROZHRANÍ SEKCE: seznam typů schůzek jako karty (název, délka,
   místo, odkaz Kopírovat, přepínač aktivní, počet rezervací za
   30 dní), tlačítko Nový typ; editor typu se záložkami Základ ·
   Dostupnost (výchozí z profilu, lze přepsat) · Otázky (výchozí
   Jméno*, E-mail*, Telefon*, Firma; přidat, řadit, povinné) ·
   Připomínky (výchozí 24 h a 1 h, přidat/odebrat, nejvýš 5) ·
   Potvrzení (schvalovat ručně ano/ne, text po rezervaci, založit
   obchod ve fázi) · Náhled. Záložka Dostupnost profilu: pracovní
   doba po dnech (víc intervalů), pásmo, výjimky kalendářem. Záložka
   Rezervace: seznam nadcházejících a minulých se stavem a filtrem.
   Při prvním otevření tři přednastavené typy: Úvodní hovor 15 min,
   Konzultace 30 min, Schůzka 60 min, a průvodce „nastav handle,
   odkaz na videohovor, pracovní dobu".
5. PRACOVNÍCI: každý pracovník s právem „plánovač: vlastní" má svůj
   profil a typy; majitel vidí v sekci přepínač „Všichni" se
   seznamem podle pracovníků a jejich rezervace (jen čtení, může
   deaktivovat typ). Přidej akce do katalogu práv z 19.3.
6. TARIF: Free 1 aktivní typ schůzky, Pro a vyšší neomezeně
   (limit v katalogu tarifů, hláška s nabídkou).
7. Jarvis: zná nadcházející rezervace a čekající schválení; v návrhu
   e-mailu a u kontaktu v Cold Callingu ve stavu Ozvat se navrhne
   „pošli odkaz na schůzku" s odkazem na nejvhodnější typ.
   Analytika: scheduler_event_type_created, booking_* (bez PII).
8. Vitest pro sloty (buffer, notice, max/den, DST, pásma, ICS
   opakování), E2E: založit typ → nastavit dostupnost → odkaz →
   (dokončí 23.4). Doplň CLAUDE.md sekci Plánovač schůzek.
```

---

## Prompt 23.4 — Veřejná rezervační stránka a rezervace · **Opus 5.5**

```
Veřejná stránka bez přihlášení, přes kterou si klient vybere termín.
Adresa /s/<handle> (seznam aktivních typů hostitele) a
/s/<handle>/<slug> (konkrétní typ). Vzhled dodělá 23.5; tady
funkčnost, data a e-maily.

1. STRÁNKA TYPU: hlavička hostitele (foto, jméno, headline, firma),
   název a popis schůzky, délka, místo; měsíční kalendář s dny,
   které mají volný termín; po výběru dne sloupec časů v pásmu
   hosta (auto z prohlížeče, přepínač se seznamem pásem); formulář
   s otázkami typu; shrnutí „Konzultace 30 min · út 12. 11. 14:00
   (Europe/Prague) s Ondřejem"; tlačítko Rezervovat. Jazyk stránky
   podle prohlížeče hosta (z published jazyků z 23.2, přepínač),
   výchozí jazyk hostitele. Vlevo nahoře logo a název Gradus s
   odkazem na web, dole „Vytvořeno v Gradusu"; obojí zmizí, když
   hostitel má doplněk no_branding. Stránka indexovatelná jen
   /s/<handle> (robots), typ ne. Bez cookies kromě pásma a jazyka.
2. PODRŽENÍ TERMÍNU: po kliknutí na čas vznikne booking status
   held s hold_expires_at = +5 min (tabulka + unikátní index na
   (host, starts_at) pro aktivní stavy — dva lidé nikdy stejný
   čas); vypršené holds uklízí dotaz na sloty. Odpočet na stránce.
3. REZERVACE: validace odpovědí, limit podle IP (10 rezervací
   za hodinu), honeypot proti botům. Po odeslání:
   - status confirmed (nebo pending, když typ vyžaduje schválení),
   - kontakt: spárovat podle e-mailu v prostoru, jinak založit
     (jméno, e-mail, telefon, firma; zdroj „plánovač"); kontakt v
     Cold Callingu přesunout do Domluvená schůzka (jen při confirmed),
   - calendar_events kind meeting pro hostitele s odkazem na
     booking a kontakt, popis s odpověďmi,
   - obchod ve fázi z typu, pokud nastaveno (confirmed),
   - e-mail hostovi: potvrzení (nebo „čeká na potvrzení") s ICS
     přílohou, odkazem na videohovor (jen po confirmed), tlačítky
     Přesunout a Zrušit (odkaz s manage tokenem, platný do konce
     schůzky), v jazyce hosta,
   - e-mail hostiteli (a Jarvisova bublina): nová rezervace / ke
     schválení,
   - připomínky: naplánované e-maily přes Resend scheduled_at
     podle reminders typu (hostovi i hostiteli), id uložená;
     při přesunu/zrušení se zruší a naplánují znovu; termíny dál
     než 30 dní dopředu naplánuje denní cron, až se dostanou do
     okna.
4. SCHVÁLENÍ: na nástěnce nová sekce „Čeká na tebe" (karty: schůzky
   ke schválení, pozvánky do firmy z 22.5, později další) s tlačítky
   Potvrdit / Odmítnout (důvod, volitelná nabídka jiného času);
   stejná akce v sekci Plánovač → Rezervace a z e-mailu (odkaz do
   aplikace). Potvrzení pošle hostovi e-mail s odkazem na hovor
   a spustí kroky z bodu 3, které čekaly.
5. PŘESUN A ZRUŠENÍ: stránka /s/r/<token>: host vidí schůzku,
   vybere nový termín (stejná logika slotů) nebo zruší s důvodem;
   hostitel totéž z detailu události v kalendáři; obě strany
   dostanou e-mail, kalendář a připomínky se aktualizují, zrušená
   schůzka zůstane v historii kontaktu.
6. PO SCHŮZCE: Jarvisův dotazník o schůzkách (existuje) se spustí
   i pro rezervace z plánovače; no-show označitelný v Rezervacích.
7. E2E ve dvou prohlížečích: host rezervuje → hostitel vidí v
   kalendáři a na nástěnce → schválí → host dostane potvrzení
   (mock Resend s naplánovanými připomínkami) → host přesune →
   připomínky přeplánované; dva hosté stejný čas → druhý dostane
   „termín už není volný". Vitest pro tokeny, holds a stavy.
```

---

## Prompt 23.5 — Rezervační stránka, která dělá dojem · **Fable 5.1**

```
Veřejná stránka z 23.4 je první, co klient uživatele Gradusu uvidí.
Má působit jako Gradus: pečlivě, živě, bez šablony. Použij skill
frontend-design; pravidla z CLAUDE.md (Web, Rozhraní) platí: jedna
záře nejvýš, žádné rozmazané bubliny, typografie Gradusu.

1. Snímky před (1440 i 390 px) do docs/scheduler-design/before/,
   krátká diagnóza: kde to vypadá jako formulář a ne jako pozvánka.
2. Kompozice: vlevo karta hostitele a schůzky (foto, jméno, co
   klient získá, délka, místo), vpravo kalendář a časy; na telefonu
   kroky za sebou (den → čas → údaje) s plynulým přechodem a
   tlačítkem zpět. Vybraný den a čas „sedí" (výrazný stav), neklik-
   nutelné dny tiché.
3. Pozadí v pohybu: jemné, pomalé, nikdy nepřekáží čtení — např.
   tenké linky nebo body, které se lehce vlní, nebo pomalý přechod
   barvy; respektuje reduced motion (statická verze stejně hezká);
   nesmí stát víc než pár procent CPU na telefonu (zkontroluj).
4. Potvrzení: oslava v duchu hry (krátké konfety jako v aplikaci),
   shrnutí s velkým datem a časem, tlačítka „Přidat do kalendáře"
   (Google, Apple/ICS, Outlook) a odkaz na videohovor; stav
   „čeká na potvrzení" vysvětlený lidsky.
5. Značka Gradus vlevo nahoře a „Vytvořeno v Gradusu" dole jako
   součást designu, ne nálepka; po skrytí doplňkem rozvržení
   nepoznamená díru.
6. Jazykové verze: ověř 3 jazyky (cs, en, de) a RTL (ar) na
   rozvržení. Snímky po do docs/scheduler-design/after/, E2E
   z 23.4 projdou (jen selektory).
```

---

## Kontrola fáze 23 · **Opus 5.5**

```
Zkontroluj fázi 23 podle CLAUDE.md:
- měny: žádné CZK/EUR napevno mimo seed, zaokrouhlení v mezích,
  staré kurzy se nepoužijí, uložené částky se nikdy nepřepisují,
- jazyky: i18n:check čistý, zástupné symboly a plurály validní ve
  všech jazycích, RTL bez překryvů, draft jazyk nevidí běžný účet,
  skript nikdy nemění klíče,
- plánovač: sloty respektují buffer, notice, max/den, výjimky, DST
  a pásma; ICS odběr: jen https, limit velikosti, timeout, URL
  šifrovaná, neukládá se jako události; dva hosté nikdy stejný
  čas (souběh); manage token hashovaný, propadá; limit podle IP;
  žádná PII v analytice; pracovník vidí jen své typy a rezervace,
  majitel všechny; připomínky se při přesunu/zrušení skutečně ruší
  (mock Resend), termíny nad 30 dní naplánuje cron,
- veřejná stránka bez přihlášení neprozradí nic jiného než profil
  hostitele a aktivní typy; /s/<handle> cizího uživatele 404 při
  neaktivním profilu,
- doplněk no_branding skrývá značku jen u účtu, který ho má,
- migrace jen přidávací, bun run lint, test, build a e2e projdou.
```

=== KONEC

---

## Krok 2 — Do `docs/progress.md` vlož tyhle řádky těsně PŘED řádek začínající `- [ ] 7.1`

=== ZAČÁTEK
- [ ] 23.1 | architect |
- [ ] 23.2 | architect | env: ANTHROPIC_API_KEY
- [ ] 23.3 | architect | env: INTEGRATIONS_ENCRYPTION_KEY
- [ ] 23.4 | architect | env: RESEND_API_KEY
- [ ] 23.5 | designer |
- [ ] K23 | reviewer |
- [ ] STOP | Konec fáze 23. Přepni si měnu na USD a JPY a projdi finance a ceník; v administraci → Tarify zkontroluj odvozené ceny a doplněk Bez značky. Přepni aplikaci do němčiny a slovenštiny, zkus arabštinu z draftu na svém účtu. V Plánovači nastav handle, odkaz na videohovor a pracovní dobu, přidej odběr svého Google kalendáře (tajná iCal adresa) a ověř, že obsazené časy nejsou v nabídce. Pošli si odkaz na Konzultaci do e-mailu, rezervuj z telefonu v anonymním okně, schval na nástěnce, zkontroluj e-maily, kalendář, kontakt a Cold Calling, pak termín přesuň a zruš. Co nesedí, napiš Claude Code rovnou, pak /pokracuj.
=== KONEC

---

## Krok 3 — Dokončení

Ověř `git check-ignore -v .env.local`, commitni, pushni a napiš uživateli česky, kolik položek přibylo a že může spustit `caffeinate -i bash scripts/noc.sh --bez-zastavek` nebo `/clear` a `/pokracuj`. První poběží 23.1. Upozorni ho, že 23.2 bude volat Claude API na překlady (orientačně do 2 USD na jazyk, ~24 jazyků) z API kreditů.
