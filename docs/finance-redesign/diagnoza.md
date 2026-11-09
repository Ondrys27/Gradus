# Finance → Měsíc — diagnóza před úpravou (prompt 21.2)

Snímky před: `before/month-1440.png`, `before/month-390.png` (listopad 2026 s čísly majitele), `before/actual-1440.png` (pohled Skutečnost), `before/empty-1440.png`, `before/empty-390.png` (měsíc bez plánu). Pořízené 9. 11. 2026 z dev serveru přihlášený jako jednorázový majitel v tool režimu (`bun scripts/finance-redesign-shots.ts before`), celá stránka, `prefers-reduced-motion: reduce`.

## Co je vidět

1. **Tabulka funguje, ale nevypadá jako nástroj na čísla.** Všechna čísla mají stejnou váhu a stejný podklad: řádky položek, součty, bilance i kapitál se liší jen tučností. Součtové řádky nemají horní linku, bloky Příjmy / Výdaje nemají vlastní podklad, názvy bloků jsou verzálky s prostrkem (`micro-label`), které administrace už opustila.
2. **Co se zadává a co se počítá** se pozná jen barvou čísla (fialová vs. bílá). Nápověda pod tabulkou říká „černá se počítají“, což v tmavém tématu není pravda.
3. **Aktuální týden** má podklad `violet/5`, který na tmavém pozadí skoro není vidět a soupeří se stejnou fialovou zadaných čísel. **Minulé týdny** nejsou nijak ztlumené; malé šedé „0“ skutečnosti pod plánem minulého týdne je další číslo ve stejné buňce.
4. **Hlavička sloupců** se při rolování odroluje; u delšího seznamu položek člověk nevidí, ve kterém je týdnu.
5. **Měna**: u názvu měsíce je štítek „CZK“, v tabulce měna nikde, ve shrnutí „Kč“ šestkrát za sebou.
6. **Shrnutí měsíce** je šest stejných karet pod sebou (na telefonu 2 sloupce) + rezerva. Konečný kapitál, kvůli kterému tabulka existuje, je jedna z nich, jen o něco větší. Vývoj po týdnech jde vyčíst jen z řádku Konečný kapitál v tabulce.
7. **Záporné hodnoty** jsou růžové, ale nejnižší stav pod nulou / pod rezervou v tabulce nijak nevyniká (jen ve shrnutí se obarví karta).
8. **Nový měsíc** po založení je prázdná tabulka s nulami: Počáteční kapitál 0, dva bloky bez řádků, „+ Nová položka“. Nikde není řečeno, co udělat první.
9. **Zadání čísla** přepočítá součty, bilanci i kapitál bez jakékoli odezvy, takže není vidět, co se změnilo.
10. **Telefon** (390): shrnutí zabere celou obrazovku, než přijde tabulka; v tabulce je vidět sloupec názvů (úchyt + název + nabídka) a půl týdne.

## Směr

- Tabulka: tabulární číslice, vše vpravo, měna jednou v rohu hlavičky („Částky v CZK“); řádky položek s jemným opaque podkladem (jde o sticky sloupec), součty tučně s horní linkou, názvy bloků bez verzálek; hlavička přilepená nahoru v rámci posuvné tabulky; aktuální týden jako celý sloupec (světlý tón + linka v hlavičce), minulé týdny ztlumené; fialová („modrá“ v textech) jen pro zadávané hodnoty; záporné růžově; nejnižší stav pod nulou / rezervou jako zvýrazněná buňka Konečného kapitálu.
- Shrnutí: jeden klidný panel vpravo (na telefonu nahoře): konečný kapitál jako hlavní číslo, pod ním sparkline konečného kapitálu po týdnech (nula, rezerva, aktuální týden, nejnižší bod), ostatní čísla v jedné dvousloupcové tabulce, varování a rezerva pod tím.
- Prázdný měsíc: tři kroky přímo v tabulce (Zadej počáteční kapitál → přidej první příjem → první výdaj), hotové kroky odškrtnuté, další krok zvýrazněný, klik vede do správné buňky.
- Mikrointerakce: po uložení čísla se přepočítané buňky na okamžik rozsvítí (jen přes `motion-safe`), nic nemění rozměry.

## Po úpravě

Snímky po: `after/month-1440.png`, `after/month-390.png`, `after/actual-1440.png`, `after/fresh-1440.png` (čerstvě založený měsíc s průvodcem), `after/empty-1440.png`, `after/empty-390.png` (`bun scripts/finance-redesign-shots.ts after`).

- Tabulka (`plan-grid.tsx`): měna jednou v rohu hlavičky („Částky v CZK“, štítek u názvu měsíce zmizel), hlavička přilepená nahoru (tabulka má na počítači vlastní posuv do výšky okna), řádky položek s opaque tónem `plan-row-tint`, součty a Konečný kapitál s horní linkou, názvy bloků bez verzálek, aktuální týden jako celý sloupec s linkou v hlavičce, uplynulé týdny na 65 %, nejnižší stav pod nulou / rezervou jako růžová buňka Konečného kapitálu s názvem v `title`.
- Shrnutí (`summary-panel.tsx`, `capital-sparkline.tsx`): jeden panel, konečný kapitál 32 px, sparkline konečného kapitálu po týdnech (nula, rezerva čárkovaně, aktuální týden plný bod, nejnižší bod růžově při varování; každý bod má název týdne a hodnotu), ostatní čísla ve dvou sloupcích, varování a rezerva dole. Stejné `data-testid` jako dřív, E2E 53 beze změny.
- Průvodce (`guide` v `PlanGrid`): tři kroky v řádku pod Počátečním kapitálem, dokud nejsou hotové; klik vede do buňky nebo do pole nové položky.
- Mikrointerakce: po uložení čísla uživatelem se změněné počítané buňky rozsvítí (`--animate-plan-flash`, 0,9 s, jen `motion-safe`); načtení, změna pohledu nebo měsíce nic nerozsvítí. Vrstva je absolutně umístěná, rozměry se nemění.
