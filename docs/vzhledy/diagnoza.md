# Vzhledy: přechod, editor a časová osa (30.7)

Snímky `bun scripts/appearance-shots.ts before|after` (dev server na :3000):
`appearance-*` celá stránka Nastavení → Vzhled, `timeline-*` časová osa rozvrhu,
`editor-*` editor vlastního vzhledu, `transition-*-<ms>` přechod do bloku Večer
(vzhled Západ) zachycený v několika okamžicích. Na 390 px skript měří snímky
za sekundu během přechodu.

## Před

- Přechod: tmavá plocha s bílým názvem, pod ní rozhraní nikdy nebylo vidět;
  směr „rozlití“ byl pevný kruh, barva jen z fialové a tyrkysové.
- Časová osa: nízký pruh, bloky skoro černé, pod každým stejný fialovo-tyrkysový
  proužek bez ohledu na vzhled, bez času u úchytu.
- Editor: systémový výběr barvy a HEX, náhled se měnil skokem, „Vygenerovat“
  tlačítkem, sekce Barvy otevřená vedle hlavní.
- Na telefonu stránka editoru ukazovala rozcestník nastavení (podstránka
  skupiny se nepočítala za skupinu).

## Po

- Přechod ve třech dějstvích (2,7 s): omytí barvou cílového vzhledu s jednou
  linkou světla na čele (ráno zdola, odpoledne zleva, večer a noc shora), název
  blokem písma vzhledu s jemným usazením, popisek; v 1,0 s se rozhraní pod
  omytím promění a omytí se rozpustí, název zůstává nad novým rozhraním; v 2,0 s
  odplouvá. Jen transform a opacity: na 390 px 169 snímků za 2,8 s, nejdelší
  mezera 17 ms. Reduced motion: totéž prolnutím.
- Časová osa: bloky v barvách svých vzhledů (povrch, pás akcentů nahoře,
  text), ikona denní doby, čas začátku, značky po 3 h, úchyt při tažení ukazuje
  přichycený čas (po 15 min).
- Editor: „Z jedné barvy“ jako hlavní sekce (základ, barva s živým
  přepočtem celé palety, šest výchozích bodů jako miniatury rozhraní), Barvy,
  Tvar a Písmo sbalené se souhrnem v záhlaví; vlastní výběr barvy (plocha,
  odstín, rychlé barvy, kapátko) v popoveru, na telefonu ve spodním panelu;
  náhled přechází plynule.
- Miniatury vzhledů jako malé rozhraní (lišta, menu, dlaždice, karta,
  tlačítko) bez rozmazání.
