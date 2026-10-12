# Domovský web — diagnóza před přestavbou (prompt 12.2)

Snímky před: `before/home-cs-1440.png`, `before/home-cs-390.png` (a anglické verze). Pořízené z dev serveru 12. 10. 2026, celá stránka, `prefers-reduced-motion: reduce`.

## Co působí strojově

Potvrzené znaky ze zadání:

1. **Záře všude.** Pozadí má dvě trvalé záře (fialová vlevo dole, tyrkysová vpravo nahoře, `blur-[140px]`), úvodní snímek další (`blur-[90px]`), Jarvis `blur-[60px]`, ukázka hry `blur-[70px]`, závěr `blur-[110px]`. K tomu `shadow-glow` / `shadow-glow-strong` na každé kartě, snímku, číslech kroků i tlačítku. Celá stránka tím dostává jednotný „neonový" nádech, který je dnes poznávací znak vygenerovaných landing pages.
2. **Nadpis se skládá slovo po slově** (`WordReveal`), podtitulek také, tlačítka vyjíždějí po něm. Čtenář čeká skoro dvě sekundy, než si může přečíst, o co jde.
3. **Jedna šablona pro každou sekci:** `SectionHeading` (volitelný malý tyrkysový nadpisek, vycentrovaný nadpis, vycentrovaný podtitulek) + mřížka karet. Platí pro bolesti, funkce, jak to funguje, obory, ceník i otázky.
4. **Sekce bolestí:** řečnická otázka „Zní ti to povědomě?" a čtyři karty s ikonou v barevném kroužku. Typický generovaný blok, nic konkrétního neříká.
5. **Deset sekcí se stejnou vahou** a stejným nástupem (`Reveal`: posun o 28 px a zesvětlení, u skupin s rozestupem). Všechno vjíždí stejně, nic není důležitější než ostatní. Na 1440 px má stránka 12 177 px výšky.
6. **Inter na všem.** Nadpisy i text stejnou rodinou, liší se jen velikostí a tučností. Nic nemá charakter.
7. **Dokonalá symetrie:** `max-w-6xl`, všechno na střed, šest funkcí střídavě 5/7 a 7/5 se stejnými rozestupy, kroky 1-2-3 na spojovací čáře s přechodem fialová–tyrkysová–zlatá.
8. **Textové vzorce AI:** trojice („Plán, obchody, kontakty"; „Úkoly, kontakty, schůzky, obchody"; tři body u Jarvise, tři body u hry, tři kroky), řečnické otázky („Zní ti to povědomě?", „Nechceš hrát?"), vzorec „Ne X. Y." („Tohle není hotový produkt velké firmy — je to nástroj…"), obecná slovesa bez konkrétního obsahu („Nic se neztratí", „všechno spolu mluví").

Co jsem našel navíc:

9. **Ikona u každého bodu.** Šest funkcí, čtyři bolesti, tři body Jarvise, tři body hry, osm oborů — všechny mají ikonu z lucide v barevném zaobleném čtverci. Ikony nic nenesou, jen vyplňují místo.
10. **Barvy bez hierarchie.** Fialová, tyrkysová, zlatá, zelená, oranžová, růžová se na stránce střídají podle pořadí v poli (`tone`), ne podle významu. Výsledek je „duhové" a bez akcentu.
11. **Štítek nad nadpisem** s tyrkysovou tečkou se stínem („Teď v betě · otevíráme v prosinci") je přesně ten prvek, který dnes generuje každý nástroj.
12. **Snímky jsou malé a ve stejném rámečku.** Šest snímků v šířce 620 px, každý s falešným „oknem" se třemi barevnými tečkami, každý se rozmazává a zaostřuje při posunu (`DriftIntoFocus`). Detaily v aplikaci (28 dní ve fázi, 168 000 Kč v Záloha zaplacena, časovač, „Jarvis si všiml") nejsou vidět a nic na ně neukazuje.
13. **Obory jako otočné dlaždice** — osm stejných karet, které po najetí ukážou tři kroky; na telefonu se to musí klepat. Hezká mechanika, ale opět mřížka ikon.
14. **Pravidelný rytmus odsazení** `py-24 md:py-36` na každé sekci; nic není blíž ničemu, stránka nemá tempo.
15. **Tlačítko Vyzkoušet třikrát** pod stejným textem (úvod, ceník ×3, závěr) a pokaždé se stejnou poznámkou pod ním.
16. **Založení jedné myšlenky na sekci** vedlo k tomu, že úvodní text slibuje totéž, co pak znovu říká sekce funkcí i sekce „jak to funguje".

## Směr přestavby

- Šest bloků: úvod se snímkem a jednou větou o problému; tři příběhy (pipeline, cold calling, Jarvis) s velkým snímkem a popisky ručním písmem přímo u detailů; hra se živou ukázkou; ceník; otázky spojené se závěrem a poznámkou zakladatele.
- Nadpisy v Bricolage Grotesque (grotesk s osobností, variabilní, s češtinou, self-hostovaný přes `next/font`), text v Interu, popisky v Caveat. Nadpisy větší, těsnější, zarovnané vlevo.
- Jedna záře, jen v úvodu. Pozadí webu bez mřížky a bez září. Fialová jako jediný akcent, tyrkysová jen u Jarvise a postupu.
- Animace zůstávají tři: otáčení snímku pod úvodem (beze změny), ukázka milníku, Jarvisův chat. Žádné nástupy při posunu, žádné skládání slov.
- Fotka zakladatelů: `public/founders.jpg` neexistuje, sekce zůstává bez fotky.
