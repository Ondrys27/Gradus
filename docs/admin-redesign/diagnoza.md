# Administrace — diagnóza před přestavbou (prompt 14.6)

Snímky před: `before/<sekce>-1440.png` a `before/<sekce>-390.png` pro všech 14 sekcí a detail uživatele. Pořízené 19. 10. 2026 z dev serveru přihlášený jako jednorázový majitel (`bun scripts/admin-redesign-shots.ts before`), celá stránka, `prefers-reduced-motion: reduce`, interní účty zapnuté jen na Uživatelích.

## Co je na stránkách

| Sekce | Obsah | Bloků |
|---|---|---|
| Přehled | 10 dlaždic (registrace, DAU, WAU, MAU, stickiness, aktivace, retence D7, náklady AI, náklad na aktivního, NPS), 1 graf | 11 |
| Růst | 8 dlaždic, 4 grafy, 2 pole (čekací listina, pracovníci), nadpis „Kdo jsou uživatelé" + 7 rozpadů | 21 |
| Aktivace | 3 dlaždice, trychtýř, 4 rozpady | 8 |
| Retence | 7 dlaždic, kohorty, retenční křivky, heatmapa, 2 grafy, pole relací, 3 rozpady | 16 |
| Funkce | tabulka adopce, 11 záložek, pak graf trendu, dlaždice, rozpady a ruční tabulka za záložku | 8–12 |
| AI a Jarvis | rozpočet, **formulář stropů**, 5 dlaždic, graf, 2 tabulky, pole konverzací, tabulka chyb, 6 rozpadů, tabulka top uživatelů + seznam odkazů | 19 |
| Hra | 2 dlaždice, graf, 4 rozpady | 7 |
| Náklady | 3 dlaždice, pole rozpadu, tabulka marže, pole zkušebních období, rozpady | 7 |
| Zdraví | 2 dlaždice, graf, 2 tabulky latence, 2 rozpady, tabulka cronu | 8 |
| Zpětná vazba | 1 dlaždice NPS (280 px sloupec), komentáře, rozpad hodnocení, karta nápadů (rozpad + seznam + vlastní prázdný stav) | 4 |
| Uživatelé | vlastní záhlaví, hledání + řazení, tabulka s přepínačem Interní v každém řádku, stránkování | 1 |
| Detail uživatele | název + Kopírovat ID, 11 faktů, karta AI, karta stropu s formulářem, sekce, časová osa | 5 |
| Průzkumník | karta s výběry, graf + tabulka | 2 |
| Audit | export u nadpisu, tabulka, stránkování | 1 |
| Administrátoři | tlačítko Pozvat u nadpisu, karta členů (fakta, rozbalovací historie, **Odebrat** vedle štítků), karta pozvánek | 2 |

## Co se opakuje a co si konkuruje

1. **14 položek v jedné řadě** v levém menu bez skupin; Audit mezi Průzkumníkem a Administrátory, Uživatelé až na jedenáctém místě. Na telefonu totéž jako vodorovný pás, ze kterého je vidět 3,5 položky.
2. **Ovládání nad názvem stránky.** Období, porovnání, interní účty, Filtry a Aktualizováno jsou v liště *nad* nadpisem — čtenář nejdřív vidí ovládání a až pak, co ovládá. Na telefonu zabírá lišta 300 px, než se objeví „Přehled". Na Uživatelích se k tomu před nadpis vloží ještě štítky filtrů a oranžová výstraha.
3. **Nadpis 34 px + popis + věta o období** v jednom odstavci dvojí barvou (`Hlavní čísla aplikace na jednom místě. Období 20. 9. 2026 – 19. 10. 2026, porovnáno s…`). Období je informace ovládání, ne popis stránky.
4. **Všechno je stejná karta.** Graf, rozpad, pole, tabulka, formulář stropů, rozpočet i seznam nápadů mají stejný rámeček, stejný titulek, stejnou váhu. Na AI je 19 bloků, na Růstu 21; nic není hlavní.
5. **Dlaždice bez hierarchie.** 2 až 10 dlaždic v mřížce 4–5 sloupců; třetí řada Přehledu má dvě osamělé dlaždice. Každá dlaždice nese „bez porovnání" i tam, kde porovnání nedává smysl — na Přehledu se to opakuje 10×, na Růstu 8× v dlaždicích a dál v každém řádku rozpadu.
6. **Popisek dlaždice 11 px verzálkami s prostrkem** (`micro-label`), dlouhé názvy se ořezávají („NÁKLAD NA AKTIV…"). Heatmapa 10 px, meta nápadu 11 px — text pod 12 px je na třech místech.
7. **Prázdný stav jako plakát.** Každý prázdný blok zobrazí přerušovaný rámeček s ikonou databáze a dvěma větami (~130 px). Na AI je jich 11 pod sebou, na Zpětné vazbě dva nad sebou v jedné kartě (rozpad + seznam). Stránka bez dat je stěna rámečků, mezi kterými se ztrácí těch pár čísel, co jsou.
8. **Exporty mezi čísly.** Ikona stažení vpravo dole v každém rozpadu, dvě ikony v každém grafu, ikona nad každou tabulkou, export auditu u nadpisu. Všechno bez potvrzení, i když se každý export zapisuje do auditu.
9. **Akce s následky uprostřed stránky.** Formulář stropů AI (s tlačítkem Uložit změny) je druhý blok shora na AI, *nad* dlaždicemi; přepínač Interní je v každém řádku tabulky uživatelů; Odebrat administrátora sedí hned vedle štítků stavu.
10. **Nápověda ke grafu** („Tažením přes graf přiblížíš oblast…") pod každým grafem — na Růstu 4×, na Retenci 3×.
11. **Tabulky**: bez řazení kliknutím, bez zvýraznění řádku, stránkování „Novější / Starší" jako holé odkazy; v rozpadech surové klíče (`true`, `false`, `list`, `open`, `shown`).
12. **Funkce**: tabulka adopce první, 11 záložek až pod ní, klíčová čísla záložky až třetí; na telefonu záložky znovu jako pás.
13. **Zpětná vazba**: dlaždice NPS s pomlčkou sama ve sloupci 280 px vedle karty komentářů; karta Nápady obsahuje rozpad stavů *a* seznam, každý se svým prázdným stavem.
14. **Pozadí aplikace** (mřížka + dvě záře) prosvítá i za administrací; sidebar má pozadí jen do výšky okna (`h-dvh`), takže na dlouhých stránkách pod 900 px končí a mřížka pokračuje přes celou šířku (vidět na každém snímku 1440).
15. **Telefon**: tabulky se posouvají uvnitř karty, ale karta uživatelů je širší než obrazovka; dlaždice ve dvou sloupcích mají 11px popisky v jednom řádku s hodnotou „bez porovnání" pod číslem.
16. **Klávesnice**: žádná zkratka. `/`, ⌘K ani Esc nic nedělají (⌘K z aplikace tu není, administrace má vlastní layout).

## Kde uživatel nepozná, na co se dívá

- Po příchodu na stránku je první věc ovládání (období), druhá nadpis, třetí 8–10 stejných dlaždic. Není řečeno, které 3–4 čísla jsou ta, kvůli kterým stránka existuje.
- Dlaždice „Retence D7 0,0 % bez porovnání" a „Náklady na AI 0 US$ bez porovnání" vypadají stejně, i když u jedné je nula špatně a u druhé dobře.
- Na AI je nahoře rozpočet (měsíc, UTC) a hned pod ním formulář stropů; dlaždice za zvolené období jsou až pod nimi — dvě různá období pod sebou bez hranice.
- Rozpady ukazují `true` a `false` jako název skupiny.

## Směr přestavby

- **5 skupin místo 14 položek**: Přehled · Lidé (Růst, Aktivace, Retence, Uživatelé, Zpětná vazba) · Produkt (Funkce, Hra, AI a Jarvis, Průzkumník) · Provoz (Náklady, Zdraví, Audit) · Nastavení (Administrátoři; jen majitel). Levé menu se sbalitelnými skupinami a sbalením do úzké lišty; na telefonu spodní lišta se skupinami, skupina otevře spodní panel se stránkami.
- **Jedna šablona stránky**: tenká přilepená lišta = název (20 px) + jedna věta + ovládání (období, porovnání, filtry, obnovit) vpravo; pod ní nejvýš 4 klíčová čísla jako dlaždice se sparkline; další čísla v jednom kompaktním pruhu; pak grafy a tabulky v mřížce 2 sloupců. Výjimky s komentářem: Uživatelé/Audit (seznam je obsah), Průzkumník (výběr dotazu je obsah), detail uživatele (fakta místo dlaždic).
- **Typografie**: 12 / 13 / 14 / 15 / 20 / 28 px, jedna sada odstupů (12 / 16 / 24), tři úrovně zvýraznění (ink / ink-soft / ink-muted). Žádné verzálky s prostrkem, nic pod 12 px.
- **Čísla**: tisíce s mezerou přes `format.ts`, změna proti minulému období se šipkou; barva jen když něco znamená (u nákladů je růst růžový), bez porovnání se nic nepíše.
- **Prázdný stav**: jedna věta v bloku, bez rámečku a ikony. **Chyba**: věta + Zkusit znovu. **Načítání**: skeleton ve stejném rozvržení (4 dlaždice, mřížka karet).
- **Tabulky**: čísla vpravo, řazení kliknutím na hlavičku, zvýraznění řádku, stránkování dole, prázdný stav s větou.
- **Akce s následky**: stropy AI na konec AI, Odebrat administrátora do rozbalené historie člena, přepínač Interní jen v detailu uživatele, export auditu na konec stránky; export grafu/tabulky zůstává u bloku (závisí na jeho přiblížení), ale v patičce bloku a s potvrzením.
- **Grafy**: legenda jen u více řad, nápověda k přiblížení jen jako tooltip ikony, tooltip s datem i hodnotou (zůstává), jedna paleta tokenů.
- **Klávesnice**: `/` do hledání, ⌘K přepínač sekcí, Esc zavře panel filtrů i přepínač.
- **Pozadí**: administrace na čistém plátně bez mřížky a září; sidebar přes celou výšku.
- **Nemění se**: brána, audit zápisy, datové dotazy, adresy sekcí, noindex; `src/features/admin/server` beze změny.

## Porovnání před a po

Snímky po: `after/<sekce>-1440.png` a `after/<sekce>-390.png`, stejný postup (`bun scripts/admin-redesign-shots.ts after`).

| | Před | Po |
|---|---|---|
| Menu | 14 položek v jedné řadě; na telefonu vodorovný pás | 5 skupin (Přehled · Lidé · Produkt · Provoz · Nastavení), sbalitelné skupiny i celé menu do lišty ikon (pamatuje se); na telefonu spodní lišta se skupinami a panelem stránek |
| Záhlaví stránky | ovládání nad nadpisem, nadpis 34 px + popis + věta o období; přilepené jen na širokých obrazovkách | jedna tenká lišta: název 20 px + věta + ovládání vpravo, přilepená při scrollu všude; období jen v ovládání (rozsah jako tooltip) |
| Klíčová čísla | 2–10 stejných dlaždic, „bez porovnání" v každé | nejvýš 4 velké dlaždice vždy na stejném místě, zbytek v jednom kompaktním pruhu; bez porovnání se nic nepíše |
| Typografie | 11 px verzálky s prostrkem, 10 px heatmapa, 34 px nadpis, 2xl čísla | škála 12 / 13 / 14 / 15 / 20 / 28 px, nic pod 12 px, bez verzálek |
| Změny | šipka a barva u všeho | šipka vždy, barva jen kde znamená (náklady: růst růžově) |
| Prázdný stav | rámeček s ikonou a dvěma větami v každém bloku (~130 px) | jedna věta v bloku; na Uživatelích a Auditu vlastní věta co dělat |
| Chyba bloku | věta | věta + Zkusit znovu |
| Načítání | kostry různých tvarů | kostry ve stejném rozvržení (4 dlaždice + pruh, mřížka karet) |
| Tabulky | bez řazení, bez zvýraznění, stránkování jako holé odkazy | řazení kliknutím na hlavičku (čísla od největšího), zvýraznění řádku, stránkování dole, čísla vpravo a přes `format.ts` |
| Grafy | legenda vždy, nápověda pod každým grafem, 2 ikony exportu nahoře | legenda jen u více řad, nápověda jako tooltip ikony, export v patičce bloku |
| Exporty | ikona mezi čísly, bez potvrzení | textový odkaz v patičce bloku, potvrzení s větou o auditu; export auditu na konci stránky |
| Akce s následky | stropy AI druhý blok shora, Interní v každém řádku seznamu, Odebrat vedle štítků | stropy AI na konci stránky v sekci Stropy, Interní jen v detailu účtu v sekci Změny účtu, Odebrat na konci rozbalené historie člena |
| Funkce | tabulka adopce první, záložky pod ní, čísla až třetí | záložky v přilepené liště, čísla záložky nahoře, trend + adopce vedle sebe |
| Zpětná vazba | dlaždice NPS v 280px sloupci, dva prázdné stavy v jedné kartě | NPS jako klíčové číslo, komentáře a hodnocení vedle sebe, nápady v jedné kartě |
| Pozadí | mřížka + záře aplikace; sidebar jen do výšky okna | čisté plátno; sidebar přes celou výšku |
| Klávesnice | nic | `/` do hledání (jinak na Uživatele), ⌘K přepínač sekcí, Esc zavře filtry i přepínač |
| Výška 1440 px | Přehled 1 117, Růst 2 409, AI 2 883, Retence 2 364 | Přehled 900, Růst 2 193, AI 2 083, Retence 2 019 |

Výjimky ze šablony (s důvodem v komentáři stránky): Uživatelé a Audit (seznam je obsah, bez dlaždic), Průzkumník (nejdřív dotaz, pak graf), detail uživatele (fakta místo dlaždic). Exporty grafů a tabulek zůstávají u svého bloku, protože závisí na jeho přiblížení a řazení; jsou v patičce a s potvrzením.

Co zůstalo: brána a druhý faktor, zápisy do auditu (každý pohled i export), datové dotazy v `src/features/admin/server`, adresy sekcí, noindex, filtry v adrese a jejich přenos mezi sekcemi.
