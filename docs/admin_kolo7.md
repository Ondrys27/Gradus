# Administrace — kolo 7

Instrukce pro Claude Code. Proveď kroky 1 až 3 přesně a doslova. Obsah k vložení je vždy mezi řádky `=== ZAČÁTEK` a `=== KONEC`. Prompty samotné neprováděj — provedou se příkazem `/pokracuj` (nebo nočním během `scripts/noc.sh`).

---

## Krok 1 — Na konec `docs/plan.md` přidej tohle

=== ZAČÁTEK

---

# FÁZE 14 — Administrace po druhém testování

*Pořadí je záměrné: nejdřív chování a nové funkce (14.1–14.5), až nakonec přestavba vzhledu (14.6), aby designér pracoval s konečnou sadou funkcí.*

## Prompt 14.1 — /admin bez přihlášení vede na přihlášení · **Opus 5.5**

```
Dnes: kdo přijde na /admin bez živé relace administrace, dostane 404.
Majitel musí sám vědět, že má jít na /admin/prihlaseni. Nově:

1. Kdokoli bez průchodu bránou administrace (nepřihlášený, přihlášený
   bez druhého faktoru, vypršelá nebo ukončená relace administrace)
   je z /admin a všech podstránek přesměrovaný na
   /admin/prihlaseni?next=<původní cesta> (next jen relativní cesty
   pod /admin, přes safeNextPath). Po úspěšném přihlášení včetně
   druhého faktoru pokračuje na next, jinak na /admin.
2. Přihlašovací stránka se zobrazí každému — i nepřihlášenému
   návštěvníkovi. Co se stane po zadání hesla, se nemění: kdo není
   majitel (nebo administrátor z 14.4), dostane 404 jako dosud,
   zámek po pěti neúspěšných pokusech zůstává, vše do admin_audit.
   Důsledek, který uživatel přijal: existence administrace přestává
   být skrytá; nic jiného se cizímu neprozradí (žádný náznak, zda
   e-mail existuje).
3. Odkaz z přihlašovací stránky zpět do aplikace.
4. Když relace administrace vyprší během práce (idle/expired),
   stránka to pozná při dalším dotazu a přesměruje na přihlášení
   s next, místo chyby nebo prázdných dat.
5. Uprav src/middleware.ts, src/features/admin/access.ts a guard;
   přepiš dotčené testy (access.test.ts, admin-gate.test.ts) a E2E:
   anonym → přihlášení; majitel bez aal2 → přihlášení → po TOTP
   zpět na původní podstránku; ne-majitel po hesle → 404.
   Aktualizuj CLAUDE.md (řádek „/admin: role owner + aal2, jinak 404").
```

---

## Prompt 14.2 — Administrace neskáče nahoru · **Opus 5.5**

```
Hlášení: v administraci (např. /admin/funkce) si uživatel sjede dolů,
přepne záložku (milníky → pipeline) a stránka vyskočí nahoru.

1. Najdi příčinu. Podezřelí: <Link> nebo router.push/replace bez
   scroll: false při změně parametrů v adrese (admin-controls,
   view-state, záložky ve funkce), přemontování stránky přes key,
   Suspense fallback, který nahradí celou stránku a shodí výšku.
2. Oprav plošně: každá změna pohledu v administraci (období,
   porovnání, filtr, záložka, stránkování, interní účty) zachová
   pozici scrollu; při načítání nových dat zůstane staré rozvržení
   se ztlumením nebo skeleton stejné výšky — nikdy prázdná stránka.
   Přechod do jiné sekce z levého menu scroll nahoru resetuje
   (to je správně).
3. Totéž zkontroluj v aplikaci: záložky a filtry v kontaktech,
   pipeline, financích a milnících. Co skáče, oprav stejně.
4. E2E test: scroll, přepnutí záložky, window.scrollY se nezměnil
   o víc než 50 px.
```

---

## Prompt 14.3 — Jména místo ID · **Opus 5.5**

```
V administraci se u uživatelů zobrazují ID. Všude, kde se ukazuje
člověk (seznam uživatelů, detail, audit, průzkumník, zpětná vazba,
hlášení chyb, retence, aktivace, AI výjimky), zobraz jméno
z profilu; když jméno chybí, e-mail; když chybí i ten, „Účet bez
jména" + poslední 4 znaky ID. ID zůstane jen jako nenápadný kód
v detailu uživatele s tlačítkem Kopírovat. Hledání v seznamu
uživatelů hledá podle jména i e-mailu (bez diakritiky). Sdílený
pomocník displayName v src/features/admin, Vitest; exporty CSV mají
sloupec jméno i ID. Analytika a usage_events zůstávají bez PII.
```

---

## Prompt 14.4 — Administrátoři a pozvánky · **Opus 5.5**

```
Majitel chce do administrace pozvat dalšího člověka. Nová sekce
Administrátoři (v menu administrace, jen pro majitele).

1. ROLE. Zaveď roli admin vedle owner (tabulka rolí, která už
   existuje přes has_role). Admin smí do administrace za stejných
   podmínek jako majitel (heslo + TOTP + živá relace) a vidí všechno
   kromě: sekce Administrátoři, stropů AI a výjimek (jen čtení),
   exportů s osobními údaji. Co admin nesmí, se neukáže (ne šedé).
   Projdi každou mutaci v src/features/admin/server a SECURITY DEFINER
   funkce admin_* — všude, kde dnes stačí owner, rozhodni owner-only
   nebo owner+admin, a uveď to v tabulce v docs/admin-roles.md.
2. POZVÁNKY. Tabulka admin_invites: id, email (nepovinný), token_hash
   (sha256 náhodného 32-bajtového tokenu; token sám se neukládá),
   created_by, created_at, expires_at (7 dní), accepted_at,
   accepted_by, revoked_at. Zápis jen přes SECURITY DEFINER funkci
   pro majitele s živou relací a aal2, vše do admin_audit.
   V sekci tlačítko „Pozvat administrátora": volitelně e-mail
   a poznámka, výsledek je unikátní odkaz
   /admin/pozvanka/<token> zobrazený jednou s tlačítkem Kopírovat
   (+ „Poslat e-mailem" přes Resend, pokud je e-mail vyplněný;
   bez ověřené domény dojde jen na adresu účtu Resend — napiš to
   u tlačítka). Pozvánku jde zrušit.
3. PŘIJETÍ. /admin/pozvanka/<token>: platný, nevyužitý, nevypršelý
   token → stránka „Pozvánka do administrace Gradusu": přihlášení
   existujícím účtem nebo založení nového (e-mail + heslo), poté
   povinné zapnutí TOTP (stejná komponenta jako majitel), pak role
   admin a přesměrování do /admin. Token se spotřebuje v jedné
   transakci s přidělením role (žádné dvojí použití při souběhu).
   Neplatný token → neutrální hláška bez detailů, limit pokusů podle
   IP jako u přihlášení. Pozvaný účet se zakládá bez průvodce
   podnikatele a bez pracovního prostoru; s interním příznakem,
   aby nebyl v metrikách.
4. PŘEHLED. Seznam administrátorů i majitele: jméno, e-mail, role,
   poslední přihlášení do administrace, počet přihlášení za 30 dní,
   poslední aktivita, stav (aktivní / odebraný). Rozklik: historie
   přihlášení a relací z admin_audit (čas, IP zkrácená, prohlížeč).
   Majitel může admina odebrat (ukončí jeho živou relaci okamžitě);
   sebe odebrat nemůže, majitel je vždy právě jeden.
5. Doplň CLAUDE.md (sekce Analytika a administrace, Data). Vitest
   pro tokeny a expiraci, E2E: pozvánka → nový účet → TOTP → /admin;
   druhé použití odkazu selže; admin nevidí Administrátory;
   odebraný admin je při dalším požadavku venku.
```

---

## Prompt 14.5 — Filtry, které fungují · **Opus 5.5**

```
1. Přejmenuj „Segmenty" na „Filtry" všude v rozhraní (i18n, aria,
   nápovědy). Kód může zůstat.
2. Uživatel vyfiltroval „beta uživatelé" v /admin/uzivatele a nic
   se nestalo. Projdi každý filtr (obor, země, tarif, beta, interní
   účty, období, porovnání) na každé stránce administrace a ověř
   proti databázi, že se skutečně aplikuje: napiš Vitest, který pro
   každou kombinaci stránka × filtr zkontroluje, že dotaz filtr
   obsahuje, a E2E, který po zapnutí filtru vidí změněný počet
   řádků. Co nefunguje, oprav v datové vrstvě, ne jen v rozhraní.
3. Aktivní filtry jsou vidět jako štítky nad obsahem s křížkem
   a tlačítkem „Zrušit filtry"; počet aktivních filtrů na tlačítku.
   Filtr, který na dané stránce nemá smysl, se tam nenabízí.
4. Stav filtrů zůstává v adrese (sdílitelný odkaz) a přežije
   přechod mezi sekcemi.
```

---

## Prompt 14.6 — Přestavba administrace · **Fable 5.1**

```
Administrace má hodně funkcí, ale působí nepřehledně a chaoticky.
Přestav ji tak, jak by to udělal seniorní produktový designér
specializovaný na interní nástroje. Všechny funkce zůstávají, mění se
uspořádání, hierarchie a vzhled. Použij skill frontend-design.

1. DIAGNÓZA NEJDŘÍV. Projdi všech 14 sekcí administrace přihlášený
   jako majitel (Playwright, 1440 px i 390 px), udělej snímky do
   docs/admin-redesign/before/ a napiš docs/admin-redesign/diagnoza.md:
   co je na každé stránce, co se opakuje, co si konkuruje, kde
   uživatel nepozná, na co se dívá, kde chybí hierarchie. Teprve
   pak návrh.
2. INFORMAČNÍ ARCHITEKTURA. Místo 14 položek v jedné řadě navrhni
   nejvýš 5 skupin, např.: Přehled · Lidé (uživatelé, aktivace,
   retence, zpětná vazba, hlášení chyb) · Produkt (funkce, hra,
   AI a Jarvis) · Provoz (náklady, zdraví, audit) · Nastavení
   (administrátoři, stropy AI). Levé menu se skupinami, sbalitelné;
   na telefonu spodní lišta se skupinami. Název stránky, jedna věta
   co ukazuje, a hlavní čísla vždy nahoře ve stejném místě.
3. JEDNA ŠABLONA STRÁNKY: nahoře název + popis + ovládání
   (období, porovnání, filtry) v jedné tenké liště, která zůstává
   přilepená při scrollu; pod ní nejvýš 4 klíčová čísla; pak grafy
   a tabulky v jednom rastru. Výjimky jen s důvodem v komentáři.
4. PRAVIDLA, která dnes chybí:
   - jedna typografická škála, jedna sada odstupů, nejvýš 3 úrovně
     zvýraznění; žádný text pod 12 px,
   - čísla: tisíce s mezerou, měny podle src/lib/format.ts, změny
     proti minulému období se šipkou a barvou jen tam, kde barva
     něco znamená (nahoru ≠ vždy dobře: náklady),
   - tabulky: zarovnání čísel vpravo, řazení kliknutím na hlavičku,
     zvýraznění řádku, stránkování dole, prázdný stav s větou co
     dělat,
   - grafy: dataviz pravidla, jedna paleta, legenda jen když je víc
     řad, tooltip s hodnotou i datem,
   - akce s následky (stropy, odebrání admina, exporty) vždy na
     konci stránky nebo v detailu, s potvrzením; nikdy mezi čísly,
   - načítání: skeleton ve stejném rozvržení; chyba: věta a tlačítko
     Zkusit znovu, nikdy prázdno,
   - klávesnice: / do hledání, ⌘K přepínač sekcí, Esc zavře panel.
5. NEMĚNIT: bránu administrace, audit zápisy, datové dotazy,
   adresy sekcí (přesměrování povolené), noindex. Přestavba se dělá
   v src/features/admin/ui a src/app/(admin); datová vrstva beze
   změny.
6. Po dokončení snímky do docs/admin-redesign/after/ a tabulku
   před/po v diagnoza.md. E2E administrace musí projít; uprav
   selektory, ne testované chování.
```

---

## Kontrola fáze 14 · **Opus 5.5**

```
Zkontroluj fázi 14 podle CLAUDE.md a docs/admin-roles.md:
- brána administrace po 14.1 nepropustí nikoho bez aal2 a živé
  relace; přesměrování nikdy neprozradí, zda e-mail existuje,
- role admin: projdi každou mutaci a SECURITY DEFINER funkci —
  owner-only akce admin nespustí ani přímým voláním RPC,
- pozvánky: token se neukládá v čitelné podobě, nejde použít
  dvakrát ani po expiraci ani po zrušení, souběh dvou přijetí,
- odebraný admin je venku při dalším požadavku,
- všechny filtry se aplikují v datové vrstvě,
- žádné ID místo jména, žádná PII v analytice,
- po přestavbě 14.6 zůstala každá funkce dostupná (projdi
  diagnoza.md jako kontrolní seznam), menu a adresy fungují,
- bun run lint, test, build a e2e projdou.
```

=== KONEC

---

## Krok 2 — Do `docs/progress.md` vlož tyhle řádky těsně PŘED řádek začínající `- [ ] 12.4`

=== ZAČÁTEK
- [ ] 14.1 | architect |
- [ ] 14.2 | architect |
- [ ] 14.3 | architect |
- [ ] 14.4 | architect | env: RESEND_API_KEY
- [ ] 14.5 | architect |
- [ ] 14.6 | designer |
- [ ] K14 | reviewer |
- [ ] STOP | Konec fáze 14. V anonymním okně otevři /admin — musí tě poslat na přihlášení a po TOTP zpět. Projdi novou administraci: skupiny v menu, filtry (zapni Beta, počet řádků se musí změnit), scroll při přepínání záložek, jména místo ID. V Administrátorech vytvoř pozvánku, otevři odkaz v jiném prohlížeči, založ účet s TOTP a ověř, co nový admin vidí a nevidí. Porovnej snímky v docs/admin-redesign. Co nesedí, napiš Claude Code rovnou, pak /pokracuj.
=== KONEC

---

## Krok 3 — Dokončení

Ověř `git check-ignore -v .env.local`, commitni (včetně `scripts/noc.sh` a `.gitignore`, pokud jsou necommitnuté), pushni a napiš uživateli česky, kolik položek přibylo a že může spustit `caffeinate -i bash scripts/noc.sh` nebo `/clear` a `/pokracuj`. První poběží 14.1.
