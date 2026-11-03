# Nastavení — diagnóza před přestavbou (prompt 18.4)

Snímky před: `before/settings-1440.png`, `before/settings-390.png` (Nastavení), `before/subscription-*.png` (Předplatné z 18.3) a `before/profile-*.png` (Profil, samostatná stránka). Pořízené 3. 11. 2026 z dev serveru přihlášený jako jednorázový majitel v game režimu (`bun scripts/settings-redesign-shots.ts before`), celá stránka, `prefers-reduced-motion: reduce`.

## Co kde je

Jedna stránka `/app/nastaveni`, 14 karet pod sebou v tomto pořadí (majitel):

| # | Karta | Obsah | Kdo ji vidí |
|---|---|---|---|
| 1 | Jazyk | 2 dlaždice (English / Čeština) | všichni |
| 2 | Region a formáty | země, časové pásmo, měna, formát data, času, čísel, první den týdne (7 řádků se selectem vpravo) | všichni |
| 3 | Hra | režim (2 dlaždice), cesta (8 dlaždic), potvrzení v dialogu | jen majitel (`!worker`) |
| 4 | Vzhled | 6 náhledů témat se zámky úrovní | všichni |
| 5 | Hratelnost | zvuk, animace (2 přepínače) | všichni |
| 6 | Jarvis | ozývá se sám, jak často (5 dlaždic), tichý režim (přepínač + 2 selecty) | jen majitel |
| 7 | Pipeline | nabídnout nové oslovení po (select + vlastní číslo) | majitel |
| 8 | Cold Calling | fáze nového obchodu (select) | kdo smí volat a zakládat obchody |
| 9 | Faktury | formulář dodavatele (13 polí, ARES, Uložit údaje), pak styl (4 náhledy), barva linky, QR | majitel |
| 10 | Živá ukázka | 6 dlaždic s formáty + 7 dní v týdnu | všichni |
| 11 | Integrace | jen test Jarvise (tlačítko + výsledek) | všichni |
| 12 | Nápověda | Spustit provedení | všichni |
| 13 | Předplatné | jediné tlačítko „Spravovat předplatné“ → `/app/nastaveni/predplatne` | majitel |
| 14 | Účet | Stáhnout ZIP, **Smazat účet** | všichni |

Mimo tuhle stránku:

- **Profil** `/app/profil` (menu u avatara, spodní lišta Více): fotka, zobrazované jméno, uživatelské jméno, e-mail jen ke čtení, změna hesla (každé s vlastním tlačítkem Uložit); majiteli aplikace navíc 3 dlaždice „Přehled aplikace“.
- **Předplatné** `/app/nastaveni/predplatne` (18.3): karta tarifu, Historie plateb, Fakturační údaje; nahoře odkaz „Zpět do nastavení“.
- **⌘K** nabízí 12 položek nastavení s `?focus=settings-…`, včetně „Integrace“.

Výška stránky Nastavení: **6 209 px na 1440**, **8 544 px na 390** (přes 10 obrazovek telefonu). Smazat účet je úplně dole, Předplatné hned nad ním.

## Co se opakuje

1. **Tři různé „řádky nastavení“** pro totéž: `SettingRow` v settings-view, `Row` v jarvis-settings, `Row` v account-settings (bez `label for`), plus `FormField` v profilu a fakturách. Stejná věc, čtyři šířky popisků a tři velikosti písma.
2. **Dva druhy radio dlaždic** (jazyk, režim, cesta, frekvence, téma, styl faktury) se čtyřmi různými výškami (14 / 11 / 20 / 56 px) a dvěma styly zaškrtnutí.
3. **Ukládání třemi způsoby**: `user_settings` se ukládá na místě a stav se hlásí jediným „Změny se ukládají samy / Vše uloženo“ *v záhlaví stránky* — u řádku 7 karet níž ho nikdo nevidí; Hra se ptá v dialogu; Profil, Heslo, Faktury a Fakturační údaje mají každý vlastní tlačítko Uložit. Ve Fakturách je tlačítko „Uložit údaje“ pod 13 poli, pod ním bez oddělení pokračují přepínače, které se ukládají samy.
4. **Formáty dvakrát**: 7 řádků v Regionu a formátech ukazuje v selectu *dnešní* datum a čas, a o 1 400 px níž „Živá ukázka“ ukazuje totéž znovu.
5. **Jazyk a zvuk** jsou v menu u avatara i v Nastavení; **Předplatné** má kartu v Nastavení, jejíž jediný obsah je odkaz na stránku s vlastním „Zpět do nastavení“.
6. **Popisek pod každým polem**, i kde je zřejmý: „Formát data“, „Formát času“ popisek nemají, ale „Jazyk aplikace.“, „Zvuk — Krátký tón u oslav…“, „Země — Používá se pro telefonní čísla…“ ano; u Měny, Pásma a Jarvise tři řádky textu 12 px.

## Co je zbytečně hluboko nebo na špatném místě

- **Jarvis** je sedmá karta na 2 200 px; frekvence (nová v 18.2, odemyká souhrn dne) je uvnitř ní druhý řádek. Žádný odkaz z Jarvise sem nevede.
- **Smazat účet** je poslední blok na 6 000 px; **Stáhnout ZIP** sedí v téže kartě hned nad ním, bez vizuálního rozlišení nebezpečné akce (červené je jen tlačítko).
- **Integrace** obsahují jen vývojářský test Jarvise s cenou v USD a názvem modelu; pro uživatele nic. Je mezi Živou ukázkou a Nápovědou.
- **Faktury** (největší blok, 1 200 px na 1440, 2 700 px na 390) sedí uprostřed mezi Cold Callingem a Živou ukázkou; kdo chce změnit měnu, musí je přescrollovat.
- **Hra** (režim + cesta, 8 dlaždic) je třetí shora, nad Vzhledem a Jarvisem, i když se mění jednou za život účtu.
- **Profil** (jméno, fotka, heslo) je úplně jiná stránka s jiným odkazem v menu; v Nastavení chybí. „Účet“ v Nastavení znamená export a smazání, „Profil“ jinde znamená jméno a heslo.
- **Nápověda** (provedení) je sama ve vlastní kartě mezi Integracemi a Předplatným; patří k Jarvisovi, který provedení dělá.
- Pracovník vidí Jazyk, Region, Vzhled, Hratelnost, (Cold Calling), Živou ukázku, Integrace, Nápovědu, Účet — osm karet pro tři věci, které reálně mění.

## Co uživatel nenajde

- **Hledání v nastavení** není. ⌘K sice umí „měna“, ale jen pro 12 položek a výsledek skočí na select bez zvýraznění (jen `focus`, který v selectu nevypadá nijak).
- **Kde je heslo** — není v Nastavení, je v Profilu. **Kde je e-mail** — v Profilu, jen ke čtení, bez vysvětlení, že změnit nejde.
- **Odhlásit se** je jen v menu u avatara; v Nastavení ani v Profilu není.
- **Podmínky a soukromí** — z aplikace žádný odkaz (jen z webu).
- **Co znamená „Hratelnost“** — nadpis karty se zvukem a animacemi; zvuk se netýká jen hry.
- **Stav uložení**: „Vše uloženo“ svítí v záhlaví, ale po přepnutí přepínače na 4 000 px ho nikdo nevidí; při chybě se hodnota tiše vrátí a hláška je zase jen nahoře.
- Na telefonu: záhlaví bez obsahu, 14 karet za sebou, žádný způsob, jak přeskočit na Účet, než projet 8 500 px; selecty na plnou šířku pod popiskem, takže každý řádek má 3 řádky textu + 44 px.

## Směr přestavby

- **Šest skupin, levé menu** (`src/features/settings/groups.ts`): Účet · Předplatné · Jarvis · Vzhled a formáty · Práce · Soukromí a data. Každá skupina je stránka `/app/nastaveni/<skupina>`; `/app/nastaveni` je rozcestník (na telefonu seznam skupin, na počítači totéž vedle menu). Profil se stěhuje do Účtu (`/app/profil` přesměruje), Předplatné zůstává na své adrese a dostane menu místo odkazu Zpět. Integrace zmizí; test Jarvise jde do administrace → AI a Jarvis jako karta „Vyzkoušet připojení“ (jen majitel).
- **Jedna stránka = název + jedna věta + formulář v jednom sloupci do 560 px.** Žádné karty; sekce oddělené nadpisem 15 px a linkou. Jeden `SettingRow` (popisek vlevo, ovládání vpravo, popisek pod ním jen kde není zřejmý) a jeden `ChoiceGrid` pro dlaždicové volby.
- **Ukládání na místě**: přepínače a výběry hned, textová pole po opuštění nebo Enter (jméno, uživatelské jméno, počet měsíců), malé „Uloženo“ u pole, co se změnilo, ne v záhlaví. Potvrzení jen tam, kde je následek: heslo, smazání účtu, zrušení předplatného, přepnutí režimu a cesty. Formulář dodavatele faktur zůstává formulářem s tlačítkem (13 polí s validací a ARES; chyby v jednom poli by při ukládání po jednom neměly kde stát).
- **Hledání**: pole nahoře nad menu, filtruje položky všech skupin (katalog `settings-catalog.ts`, sdílený s ⌘K); výsledek vede na `/app/nastaveni/<skupina>?focus=<id>` a položka se na 2 s rozsvítí (fialový rámeček, bez animace při reduced motion).
- **Nebezpečné akce** dole v Soukromí a datech v červeně ohraničené zóně; Odhlásit se v Účtu; Podmínky a Soukromí jako odkazy v Soukromí a datech.
- **Nemění se**: data (`user_settings`, `profiles`, `invoice_profiles`, `subscriptions`), serverové akce, dialogy s potvrzením, e2e chování (jen cesty a selektory).

## Kontrolní seznam voleb (každá musí zůstat dostupná)

| Volba | Před | Po |
|---|---|---|
| Jazyk | Jazyk | Účet |
| Profilová fotka, zobrazované jméno, uživatelské jméno, e-mail | Profil | Účet |
| Změna hesla | Profil | Účet |
| Odhlásit se | menu u avatara | Účet (i menu) |
| Přehled aplikace (majitel aplikace) | Profil | Předplatné (jen majitel aplikace) |
| Tarif, změna, zrušení, platby, fakturační údaje | Předplatné | Předplatné |
| Jarvis se ozývá sám, jak často, tichý režim | Jarvis | Jarvis |
| Provedení aplikací | Nápověda | Jarvis |
| Téma | Vzhled | Vzhled a formáty |
| Zvuk, animace | Hratelnost | Vzhled a formáty |
| Země, pásmo, měna, datum, čas, čísla, první den týdne | Region a formáty | Vzhled a formáty |
| Živá ukázka | Živá ukázka | Vzhled a formáty (jeden řádek pod formáty) |
| Režim hry, cesta | Hra | Práce |
| Nové oslovení po | Pipeline | Práce |
| Fáze nového obchodu | Cold Calling | Práce |
| Údaje dodavatele, styl, barva, QR | Faktury | Práce |
| Export dat | Účet | Soukromí a data |
| Smazat účet | Účet | Soukromí a data (červená zóna) |
| Podmínky, Soukromí | — | Soukromí a data |
| Test Jarvise | Integrace | Administrace → AI a Jarvis (jen majitel) |

## Porovnání před a po

Snímky po: `after/<stránka>-1440.png` a `after/<stránka>-390.png` (settings = rozcestník, account, subscription, jarvis, appearance, work, privacy, search = hledání „měna“), stejný postup (`bun scripts/settings-redesign-shots.ts after`).

| | Před | Po |
|---|---|---|
| Struktura | 1 stránka, 14 karet pod sebou + Profil a Předplatné jako cizí stránky | 6 skupin (Účet · Předplatné · Jarvis · Vzhled a formáty · Práce · Soukromí a data), levé menu, na telefonu seznam → detail se zpětným odkazem |
| Profil | vlastní stránka `/app/profil` s tlačítky Uložit | v Účtu; `/app/profil` přesměruje; jméno a uživatelské jméno se ukládají po opuštění pole / Enter |
| Hledání | jen ⌘K pro 12 položek | pole nad menu filtruje 32 položek napříč skupinami (slova bez diakritiky, podle začátků slov), výsledek vede na položku a rozsvítí ji; ⌘K bere tytéž položky ze stejného katalogu |
| Ukládání | jedna hláška v záhlaví stránky; tři způsoby ukládání | „Uloženo“ vedle popisku pole, které se změnilo; přepínače a výběry hned, texty po opuštění; potvrzení jen u hesla, smazání účtu, režimu hry, cesty a předplatného |
| Hluboké odkazy | `?focus=` jen zaostří select | `?focus=` posune na řádek, zaostří ovládání a rozsvítí celý řádek na 2 s (bez animace při reduced motion); Jarvisův souhrn dne má „Nastavit, jak často“ |
| Karty | 14 karet se stínem, tři různé řádky, dva druhy dlaždic | žádné karty: nadpis 24 px, sekce 15 px s linkou, jeden `SettingRow`, jedna `ChoiceTile`; sloupec 560 px |
| Nebezpečné akce | Smazat účet v kartě Účet vedle exportu | Soukromí a data: export, Podmínky a Soukromí, dole červená zóna se Smazat účet |
| Integrace | test Jarvise s cenou a modelem pro každého | pryč; v administraci → AI a Jarvis karta „Vyzkoušet připojení“ jen pro majitele |
| Telefon | 8 544 px pod sebou, bez možnosti přeskočit | rozcestník 844 px (nic neskroluje), Účet 1 874 px, Vzhled 2 460 px, Práce 3 391 px (z toho 2 400 px formulář faktur), Jarvis 1 181 px |
| Počítač | 6 209 px | Účet 1 674, Vzhled 1 853, Práce 2 554, Jarvis 909, Soukromí 900 |
| Pracovník | 8 karet | Účet, Jarvis (jen provedení), Vzhled a formáty, Práce (jen s právem volat a zakládat obchody), Soukromí a data |

Výjimka: formulář dodavatele faktur v Práci zůstává formulářem s tlačítkem Uložit údaje (13 polí s validací, ARES, IBAN); ukládání po jednom poli by nemělo kde ukázat chybu napříč poli. Vzhled faktur, barva a QR pod ním se ukládají hned.

Co zůstalo: data a serverové akce, dialogy s potvrzením (smazání účtu, režim hry, cesta, předplatné), adresa Předplatného, e2e testy (jen cesty `/app/nastaveni/<skupina>` a nadpis Účtu v angličtině).
