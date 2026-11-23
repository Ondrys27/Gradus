# Widgety: diagnóza před 28.6

Snímky v `before/` (1440, 820, 390 px): `board-*` = všechny widgety ve výchozí velikosti, `size-S|M|L|XL-*` = každý widget v dané velikosti, `editing-*`, `gallery-*`, `detail-*`. Pořizuje `bun scripts/widgets-design-shots.ts before|after` nad dočasným účtem s nasazenými daty.

## Celkově

- **Velikost = zmenšenina.** S a M jsou u většiny widgetů totéž číslo s jinou šířkou (Úspěšnost, Nové kontakty, Faktury, Odměny, Finance S), L a XL jsou M s prázdným místem pod ním (Pipeline XL, Co hoří XL, Úkoly po termínu L, Finance L). Každá velikost nemá vlastní kompozici.
- **Prázdné karty s textem.** Vývoj kapitálu bez plánu je jedna věta v kartě 2×2 i 4×2. Tým, Aktivita, Spokojenost, Čeká na tebe = ikona a dvě věty uprostřed velké plochy. Rezervace L totéž.
- **Žádná jednotná anatomie.** Velké číslo je někde `BigValue` (40 px), jinde `text-lg`, jinde prstenec; sekundární řádek někde `Hint`, někde `text-xs text-ink-muted`; barvy náhodně (Úspěšnost zlatě, Nové kontakty tyrkysově, Pipeline fialově) místo jedné barvy podle sekce.
- **Grafy chybí.** Jen Pipeline (segmenty bez mezer, bary 6 px), Cold Calling L (plné fialové bloky bez popisků, dnešek se nedá odlišit) a Úspěšnost M (sparkline). Žádné sloupce po dnech, žádný mini kalendář s hustotou, žádný prstenec kromě splněných úkolů a úrovně.
- **Režim úprav:** všechny widgety se vlní stejně (fáze z pořadí, jediná perioda 0,34 s = působí jako jeden stroj), zvednutý widget se jen mírně natočí, odebrání zmizí bez animace, přidání z galerie „spadne shora“ místo z náhledu. Rohová tlačítka 32 px jsou na telefonu malá.
- **Galerie:** seznam karet s třemi miniaturami vedle sebe ve scale(0.56); miniatury jsou nečitelné, popis zapadá, žádné doporučení, žádné přepínání velikostí tečkami. Na telefonu přetéká vodorovně.
- **Živost:** Grady widget je jen vstupní pole bez postavy; čísla se počítají od nuly při každém příchodu, ne při změně dat; Dnes v M neodškrtává.

## Po widgetech

| Widget | S | M | L | XL |
|---|---|---|---|---|
| Dnes | – | čtyři počty v řádku, pod nimi prázdno | seznam (ok) | stejný seznam, pravá polovina prázdná |
| Čeká na tebe | – | ikona + věta uprostřed | totéž ve 2×2 | totéž ve 4×2 |
| Úkoly po termínu | číslo + slovo | číslo + „Nejstarší: …“ | číslo + 2 řádky, zbytek prázdný | totéž širší |
| Nejbližší schůzky | „dnes 13:00“ (není to číslo, čte se hůř) | 2 řádky | 6 řádků bez dnů | – |
| Týden v kalendáři | – | 7 políček s tečkou, políčko 60 px vysoké pro tečku | 7 sloupců, 2 události, dole prázdno | totéž, 3 události |
| Splněné úkoly | prstenec (ok) | prstenec + věta | prstenec + 3 úkoly bez zaškrtávátka | – |
| Pipeline | číslo + věta | číslo + segmenty bez mezer | bary 6 px (ok) | bary 2 sloupce, polovina plochy prázdná, bez legendy a akcí |
| Co hoří | – | tři čísla (ok) | tři dlaždice, zbytek prázdný | tři dlaždice, 60 % plochy prázdné |
| Úspěšnost | % | % + sparkline | % + sparkline + prázdno | – |
| Nové kontakty | číslo | číslo + „Přidané tento měsíc“ (totéž co S) | číslo + 4 jména | – |
| Cold Calling | 0 min | 0 min + týden | 7 bloků bez popisků | – |
| Rezervace | „Žádná rezervace“ | prázdný stav | prázdný stav uprostřed | – |
| Finance měsíce | příjem | 3 čísla + trend | 3 čísla + trend + prázdno | 3 čísla + celý IncomeChart s vlastními přepínači a figurami podruhé |
| Vývoj kapitálu | – | věta | věta | věta |
| Faktury po splatnosti | číslo | číslo + řádek (číslo se překrývá s textem) | číslo + řádek + prázdno | – |
| Odměny | „Nic k vyplacení“ | prázdný stav | prázdný stav | – |
| Tým | – | prázdný stav | prázdný stav | prázdný stav |
| Aktivita | – | prázdný stav | prázdný stav | prázdný stav |
| Milníky | prstenec + název | 1 řádek s barem + „a další 1“ | 4 řádky s bary, zbytek prázdno | – |
| Úroveň | prstenec | prstenec + titul + XP + série (ok) | – | – |
| Grady | – | pole bez postavy | pole + chipy + 3 návrhy (ok) | – |
| Připnutá poznámka | název | název + 2 řádky | název + 9 řádků (ok) | – |
| Rychlé akce | 4 ikony bez popisků | 4 tlačítka (ok) | 2 sloupce, zbytek prázdno | – |
| Spokojenost | – | prázdný stav | prázdný stav | – |

## Cíl 28.6

S = jedno číslo nebo jeden stav, čitelné z dálky. M = číslo + kontext (trend, segment, další položka). L = seznam nebo graf. XL = graf s legendou a akcemi. Jedna anatomie (`Hero`, `Sub`, `Delta`), tabulární číslice, barva podle sekce, grafy podle dataviz (sparkline 2 px, sloupce ≤ 24 px se zakulaceným koncem, prstenec, mini kalendář s hustotou, segmentový bar s mezerou 2 px). Prázdný stav vždy jako číslo „0“ nebo jedna věta s akcí, nikdy ikona uprostřed prázdné plochy.
