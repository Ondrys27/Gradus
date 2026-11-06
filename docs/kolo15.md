# Po schůzce 6. 11.: podpora, promo kódy, přehled funkcí, jeden účet a víc firem — kolo 15

Instrukce pro Claude Code. Proveď kroky 1 až 3 přesně a doslova. Obsah k vložení je vždy mezi řádky `=== ZAČÁTEK` a `=== KONEC`. Prompty samotné neprováděj — provedou se příkazem `/pokracuj` (nebo nočním během `scripts/noc.sh`).

---

## Krok 1 — Na konec `docs/plan.md` přidej tohle

=== ZAČÁTEK

---

# FÁZE 22 — Po schůzce 6. 11.

*Pořadí: rychlé věci pro podporu a marketing (22.1–22.3) jdou první, velká změna účtů (22.4–22.5) až po nich. Odloženo a nedělat: tržiště práce uvnitř Gradusu, generování cenových nabídek, nativní aplikace.*

## Prompt 22.1 — Podpora v administraci: e-mail, hledání, reset hesla · **Opus 5.5**

```
Když někdo napíše na podporu, musí ho majitel v administraci najít
a pomoct mu bez databáze.

1. Seznam uživatelů (/admin/uzivatele): sloupec E-mail vedle jména
   (po 14.3 se e-mail nezobrazuje), hledání najde podle jména,
   e-mailu, ID i krátkého ID z 22.4 (až vznikne), bez diakritiky,
   i část e-mailu. Export CSV má e-mail.
2. Detail uživatele: karta Účet s e-mailem (Kopírovat), datem
   registrace, posledním přihlášením, zařízením, tarifem, stavem
   zkoušky a tlačítky:
   - „Poslat odkaz na reset hesla" (Supabase admin API generateLink
     typu recovery, odeslaný e-mailem uživateli přes Resend — nikdy
     nezobrazit odkaz v administraci; potvrzení; do admin_audit),
   - „Poslat znovu potvrzení e-mailu" (pokud ověření chybí),
   - „Ukončit všechna přihlášení" (sign out everywhere, pro
     ukradený účet),
   - „Změnit e-mail" (s potvrzením na novou adresu).
   Všechno jen majitel + admin role; každá akce do admin_audit
   s důvodem (povinné pole „proč").
3. V hlášeních chyb a zpětné vazbě odkaz na detail uživatele
   a z detailu uživatele seznam jeho hlášení.
4. Vitest, E2E: hledat podle části e-mailu → otevřít → reset
   hesla zavolá mock Resend s recovery odkazem → audit má záznam.
```

---

## Prompt 22.2 — Promo kódy a provize pro partnery · **Opus 5.5**

```
Váša bude oslovovat influencery a partnery: každý dostane kód,
uživatel ho zadá při registraci nebo při platbě a partner dostane
provizi jen z první platby.

1. DATA. promo_codes (code unikátní, velká písmena bez diakritiky
   4–16 znaků, partner_name, partner_email, partner_note, kind
   influencer|partner|campaign, benefit: trial_days_extra nebo
   percent_off_first nebo months_free, commission_percent_first
   0–100, max_uses null, valid_from/to, active, created_by,
   created_at), promo_redemptions (code_id, user_id unikátní —
   jeden kód na účet, redeemed_at, source signup|checkout|settings),
   partner_payouts (code_id, user_id, payment_id, amount, status
   pending|approved|paid, created_at) — vzniká při první platbě
   uživatele s kódem; provize = commission_percent_first × první
   platba bez DPH. RLS: jen server a administrace.
2. UŽIVATEL: pole „Máš kód?" v registraci (i v průvodci a v
   Nastavení → Předplatné, dokud nezaplatil), odkaz
   gradus…/?kod=XYZ kód předvyplní a uloží do cookie na 30 dní.
   Potvrzení „Kód XYZ: první měsíc za polovinu" hned při zadání;
   neplatný/vyčerpaný kód vysvětlí proč. Výhoda se promítne do
   zkoušky a do první platby (platební brána ještě není — připrav
   výpočet ceny s kódem v plan.ts a zobraz ji v Předplatném; když
   brána přibude, použije ho).
3. ADMINISTRACE → Nastavení → Promo kódy: seznam s počtem registrací,
   platících, provizí k vyplacení; založit kód (generátor i vlastní
   text), upravit, deaktivovat, odkaz ke zkopírování; detail kódu:
   uživatelé (jméno, datum, zaplatil?), výplaty se schválením
   a označením Vyplaceno (export CSV pro účetní). Souhrn nahoře:
   nejlepší kódy za 30 dní.
4. Analytika: promo_redeemed (kód jako hash, ne text), konverze
   kód → platba v Aktivaci; Jarvis o kódech neví.
5. Vitest pro validaci a výpočet provize, E2E: registrace s kódem
   → výhoda vidět → v administraci u kódu 1 registrace → simulovaná
   první platba (@gradus.local) → výplata pending → schválit.
   Doplň CLAUDE.md sekci Promo kódy.
```

---

## Prompt 22.3 — Přehled funkcí a nákladů pro návrh tarifů · **Opus 5.5**

```
Váša navrhuje tarify a potřebuje seznam toho, co Gradus umí, co umí
Jarvis a co nás co stojí. Vytvoř z kódu dokument docs/funkce.md
(česky, pro ne-programátora) a drž ho aktuální.

1. Sekce po částech aplikace (nástěnka, milníky a mapa, poznámky,
   kontakty, Cold Calling, pipeline a obchody, úkoly, kalendář,
   finance a faktury, správa firmy, zprávy, Jarvis, nastavení,
   web). U každé funkce jedna věta co dělá, pro koho (majitel /
   pracovník), a štítek nákladu: žádný · AI · Google Maps · e-mail ·
   úložiště.
2. Jarvis zvlášť: všechno, co dělá (chat, souhrny, návrhy,
   otázky, hodnocení milníku, rozbor schůzky, návrh e-mailu,
   práce s poznámkami, hlídání příležitostí, tutoriál…), u každého
   model (Haiku/Sonnet/Opus), typický počet tokenů a odhadovaná
   cena jednoho použití v USD z src/config/costs.ts, a jak často
   běžný uživatel použije za měsíc (odhad). Tabulka seřazená od
   nejdražšího.
3. Tabulka „Co stojí jeden uživatel za měsíc" pro tři profily
   (lehký, běžný, intenzivní): AI, Google Maps (generování
   kontaktů), e-maily, úložiště — s odkazem na skutečná čísla
   z administrace (ai_usage), pokud jsou.
4. Tabulka „Čím jde omezovat tarif": každý existující limit
   a přepínač (generování denně, AI strop na uživatele, počet
   pracovníků, úložiště, …) a kde se nastavuje; a co by šlo omezit
   snadno, ale dnes limit nemá.
5. Přidej skript `bun run docs:funkce`, který seznam sekcí
   a Jarvisových schopností porovná s kódem (route group,
   JARVIS_* katalogy, nav-items) a vypíše, co v dokumentu chybí;
   do CLAUDE.md pravidlo, že nová funkce se zapisuje do docs/funkce.md.
   Žádné změny v aplikaci kromě skriptu.
```

---

## Prompt 22.4 — Jeden účet, víc firem: datový model a přepínač · **Opus 5.5**

```
Dnes je účet buď majitel (má prostor), nebo pracovník (je ve
workers cizího prostoru). Nově má každý účet svůj prostor a navíc
může být pracovníkem v libovolném počtu cizích firem. Příklad od
Váši: 500 lidí má iPhone; když jednoho zaměstnáš, nedáváš mu nový,
jen ho přiřadíš pod svůj paušál.

1. MODEL. Prostor = dnešní „user_id majitele" (nic se nepřejmenovává,
   migrace jen přidávací). Tabulka memberships (user_id, space_id =
   owner user_id, role owner|worker, worker_id, status invited|
   active|left|removed, joined_at, left_at); majiteli vznikne řádek
   owner pro vlastní prostor, každému workers.user_id řádek worker.
   Workspace z src/features/account/workspace.ts se načítá podle
   aktivního prostoru (cookie active_space + ověření členství na
   serveru), ne podle role účtu. Každý dotaz, RLS a serverová akce,
   která dnes bere „user_id = auth.uid() nebo můj owner", musí jít
   přes aktivní prostor — projdi všechny RLS politiky a helper
   funkce (current_owner_id apod.) a přepiš je na členství; napiš
   test, který pro každou tabulku ověří, že člen cizího prostoru
   nevidí a nezapíše nic z prostoru, kde není.
2. KRÁTKÉ ID. profiles.public_id: 6 znaků bez nejednoznačných
   (např. GR-7K3M9Q jako u chyb, bez předpony), unikátní, vidět
   v Nastavení → Účet s tlačítkem Kopírovat a jako QR. Hledání
   podle něj v administraci (22.1).
3. PŘEPÍNAČ. Vpravo nahoře (vedle profilu) výběr prostoru: „Moje
   firma" + firmy, kde je pracovník, s názvem firmy a logem
   (profiles.company_name/logo majitele). Přepnutí změní cookie,
   znovu načte data, zachová sekci, pokud na ni má právo, jinak
   nástěnka. Barevný proužek nebo štítek s názvem firmy v hlavičce,
   aby bylo vždy jasné, kde člověk je. Na telefonu v menu.
4. VLASTNÍ PROSTOR PRO KAŽDÉHO. Účet založený z pozvánky (dnes
   „jen pracovník") dostane po přijetí i vlastní prázdný prostor
   se zkouškou podle tarifu (bez průvodce, nabídne se při prvním
   přepnutí). Dnešní pracovnické sekce (/app/ukoly, /app/odmeny)
   zůstávají v cizím prostoru.
5. Jarvis pracuje vždy s aktivním prostorem a v cizím prostoru
   respektuje práva pracovníka; poznámky jsou v tom prostoru,
   kde vznikly. Analytika: space_switched (bez ID).
6. Migrace existujících účtů beze ztráty: majitelé a pracovníci
   fungují stejně jako dnes, jen přibude přepínač. E2E: účet
   majitel + pracovník v druhé firmě → přepínání → data se
   nemíchají → cizí prostor přes URL = 404. Doplň CLAUDE.md
   (sekce Data, Účty a prostory).
```

---

## Prompt 22.5 — Pozvánky přes ID, přijetí a kdo za koho platí · **Opus 5.5**

```
Navazuje na 22.4.

1. POZVÁNKA. Ve Správě firmy „Pozvat pracovníka": a) zadáním
   krátkého ID nebo e-mailu existujícího uživatele → pozvánka
   čeká na přijetí, b) e-mailem novému člověku → odkaz jako dnes
   (vznikne účet s vlastním prostorem + členství). Pozvánka
   zobrazuje název firmy a jméno majitele („Novák s.r.o. · Václav
   Novák tě zve jako Obchodník"), práva a odměnu, pokud ji majitel
   nastavil. Pozvaný ji v Gradusu přijme nebo odmítne (zvonek +
   e-mail + Jarvisova bublina); majitel vidí stav. Po přijetí je
   firma v přepínači. Odchod z firmy: pracovník sám (potvrzení,
   majitel dostane zprávu) nebo majitel ho odebere (19.3).
2. KDO PLATÍ. Pravidlo ze schůzky: kdo už má vlastní platný
   tarif, dá se do firmy přidat zdarma; za pracovníka bez vlastního
   tarifu platí majitel podle svého tarifu (katalog z 15.5 dostane
   pole included_workers a price_per_extra_worker; Free: 0
   pracovníků, Pro: 0 + za pracovníka, Firma/Team: 10 v ceně, pak
   za každého). V Předplatném majitele řádek „Pracovníci: 3 v ceně,
   2 navíc × 290 Kč"; když pracovník později sám zaplatí, odpočet
   zmizí od dalšího období. Nic se zatím nestrhává (brána chybí),
   částka se jen počítá a ukazuje; TODO(payments) na jednom místě.
3. AI LIMIT V CIZÍ FIRMĚ: útrata pracovníka v cizím prostoru se
   počítá do stropu toho prostoru (majitel platí) a pracovník má
   vlastní strop z ai_user_caps podle svého tarifu; při vyčerpání
   vlídná hláška s nabídkou vyššího tarifu (text, zatím bez platby).
   Administrace ukáže útratu podle prostoru i podle uživatele.
4. Správa firmy: u pracovníka štítek „má vlastní tarif" / „v ceně"
   / „navíc 290 Kč". Vitest pro výpočet ceny pracovníků, E2E:
   pozvat existujícího uživatele přes ID → přijmout → v přepínači →
   Předplatné majitele ukazuje 0 Kč navíc; pozvat nového → navíc
   290 Kč. Doplň CLAUDE.md sekce Tarify a Správa firmy.
```

---

## Kontrola fáze 22 · **Opus 5.5**

```
Zkontroluj fázi 22 podle CLAUDE.md:
- izolace prostorů: pro KAŽDOU tabulku s user_id test, že člen
  jiného prostoru nic nevidí ani nezapíše (přes klienta i RPC),
  přepnutí cookie na prostor bez členství = 403/404, pracovník
  v cizím prostoru má jen práva z grantů,
- reset hesla z administrace: odkaz se nikdy nezobrazí, jen se
  pošle; každá akce v auditu s důvodem; admin role bez práva měnit
  e-mail (jen majitel),
- promo kódy: jeden kód na účet, provize jen z první platby,
  kód v analytice jen jako hash, vyčerpaný/expirovaný kód nejde
  použít ani přes URL,
- docs/funkce.md odpovídá kódu (bun run docs:funkce bez chyb),
- cena pracovníků: existující platící pracovník = 0, změna tarifu
  pracovníka přepočítá majitele od dalšího období,
- migrace jen přidávací, stávající účty fungují beze změny,
  bun run lint, test, build a e2e projdou.
```

=== KONEC

---

## Krok 2 — Do `docs/progress.md` vlož tyhle řádky těsně PŘED řádek začínající `- [ ] 7.1`

=== ZAČÁTEK
- [ ] 22.1 | architect | env: RESEND_API_KEY
- [ ] 22.2 | architect |
- [ ] 22.3 | architect |
- [ ] 22.4 | architect |
- [ ] 22.5 | architect | env: RESEND_API_KEY
- [ ] K22 | reviewer |
- [ ] STOP | Konec fáze 22. Pošli Vášovi docs/funkce.md. V administraci najdi Vášu podle e-mailu a pošli mu reset hesla. Založ promo kód VASA50 a zaregistruj se s ním v anonymním okně. Pozvi Vášu do své firmy přes jeho krátké ID, on pozvánku přijme a přepne se mezi svou a tvou firmou; zkontroluj, že se data nemíchají a že v Předplatném je za něj 0 Kč. Co nesedí, napiš Claude Code rovnou, pak /pokracuj.
=== KONEC

---

## Krok 3 — Dokončení

Ověř `git check-ignore -v .env.local`, commitni, pushni a napiš uživateli česky, kolik položek přibylo a že může spustit `caffeinate -i bash scripts/noc.sh --bez-zastavek` nebo `/clear` a `/pokracuj`. První poběží 22.1.
