# Vášovy připomínky z telefonu: mobilní zobrazení, cena chatu, e-maily u kontaktů — kolo 21

Instrukce pro Claude Code. Proveď kroky 1 až 3 přesně a doslova. Obsah k vložení je vždy mezi řádky `=== ZAČÁTEK` a `=== KONEC`. Prompty samotné neprováděj — provedou se příkazem `/pokracuj` (nebo nočním během `scripts/noc.sh`).

---

## Krok 1 — Do `docs/plan.md` přidej tohle PŘED sekci `## Odloženo` (když tam není, na konec)

=== ZAČÁTEK

---

# FÁZE 31 — Vášovo testování na telefonu (27.–28. 11.)

## Prompt 31.1 — Chat s Gradym je drahý: najít proč a zkrotit · **Opus 5.5**

```
Váša: čtyři otázky v chatu a jedno přečtené PDF stály 0,80 USD.
To je řádově víc, než má (cíl: běžná zpráva do 0,01 USD, zpráva
s přílohou do 0,05 USD). Nejdřív změř, pak opravuj.

1. DIAGNÓZA. Najdi v ai_usage Vášovy záznamy z 27. 11. (podle
   času a funkce chat, jen čtení) a rozepiš u každého volání:
   model, vstupní tokeny (z toho cache čtení/zápis), výstupní
   tokeny, cena, zda šla příloha. Zjisti, co cenu udělalo:
   PDF poslané modelu celé jako dokument při KAŽDÉ další zprávě
   v konverzaci? Chybějící nebo nefunkční cache promptu? Příliš
   velký kontext (situace, poznámky, katalog operací a nástrojů)
   v každém volání? Smyčka nástrojů (víc volání na jednu
   odpověď)? Automatický výběr modelu (27.3) zvolil Sonnet/Opus?
   Napiš do docs/ai-naklady-chat.md tabulku a jednu větu příčiny
   u každé položky. Bez téhle diagnózy nepokračuj.
2. PŘÍLOHY LEVNĚ. PDF a dokumenty se modelu neposílají jako
   soubor: na serveru se z nich vytáhne text (unpdf, docx),
   omezí se (výchozí prvních 20 stran / 15 000 znaků, s
   poznámkou „dokument zkrácen"), uloží se k příloze a do
   konverzace jde jen jednou; v dalších zprávách se posílá
   krátké shrnutí (vytvořené jednou levným modelem) a plný text
   jen když se na dokument uživatel znovu ptá. Skeny bez textu
   a obrázky: zmenšit na rozumné rozlišení, nejvýš 3 na zprávu.
   Před odesláním velké přílohy ukaž uživateli „dlouhý dokument,
   zpracuji prvních 20 stran".
3. KONTEXT A CACHE. Systémový prompt, pravidla a katalog operací
   jako jeden cacheovaný blok (ověř v odpovědi API, že se cache
   opravdu čte — cache_read_input_tokens > 0 od druhé zprávy;
   test na to). Situace a poznámky: posílej jen části relevantní
   k dotazu (záměr určí pravidla bez modelu), historie
   konverzace: posledních N zpráv + průběžné shrnutí starších.
   Nástroje/operace: do volání jen ty, které odpovídají záměru
   a sekci, ne celý katalog. Strop výstupních tokenů pro chat.
   Smyčka operací nejvýš 4 kroky na zprávu.
4. NASTAVENÍ V ADMINISTRACI → AI a Grady → Chat (majitel i plný
   admin): přílohy v chatu zapnuto / vypnuto (výchozí ZAPNUTO
   s limity; Váša je chce vypnout — nech přepínač, ať to rozhodnou
   podle čísel po opravě), povolené typy, nejvyšší počet stran
   a velikost, model pro zprávy s přílohou (výchozí Haiku),
   model chatu (pevný / automaticky), strop ceny jedné zprávy
   (výchozí 0,05 USD — když by odhad před voláním vyšel výš,
   zkrátí kontext nebo přejde na levnější model), strop ceny
   jedné konverzace za den na uživatele. Když jsou přílohy
   vypnuté, tlačítko sponky v chatu zmizí a vložení souboru
   řekne proč.
5. VIDITELNOST. V administraci u uživatele a ve widgetu Spotřeba
   AI: průměrná a nejdražší zpráva chatu, podíl cache, deset
   nejdražších volání týdne s rozpadem. Upozornění v denním
   souhrnu, když průměrná cena zprávy překročí cíl.
6. Zopakuj Vášův scénář (4 otázky + stejné nebo podobné PDF)
   po opravě a napiš do souhrnu cenu před a po. Testy: příloha
   jde modelu jen jednou; cache se čte; strop zprávy drží.
```

---

## Prompt 31.2 — Telefon: oříznuté texty a překryvy · **Fable 5.1**

```
Váša testuje na telefonu a posílá snímky (šířka kolem 390–430 px,
česky):
- Přehled: ve widgetu „Čeká na tebe" je text „Nic nečeká" uříznutý
  spodní hranou; titulky widgetů se zkracují na „SPLNĚNÉ ÚKOL…"
  a „ÚKOLY PO TER…",
- widget Rychlé akce: tlačítka ukazují „Nový…", „Nový…", „Nová…"
  místo celého textu (na šířku čtyři vedle sebe),
- Kalendář: přepínač Den / Týden / Měsíc překrývá název měsíce
  a rok v liště s šipkami.

1. Oprav tyhle tři věci u příčiny: widgety velikosti S a M na
   úzké šířce — titulek se zalomí na dva řádky nebo použije
   kratší variantu názvu (každý widget má v registru krátký
   název do 14 znaků, CS i EN), obsah se nikdy neuřízne (výška
   podle obsahu, ne pevná); Rychlé akce na telefonu v mřížce 2×2
   s ikonou nad textem, text na dva řádky, ve velikosti S jen
   ikony s popiskem pod; lišta kalendáře na úzké šířce ve dvou
   řadách (šipky + Dnes + měsíc a rok / přepínač pohledů přes
   celou šířku), měsíc nikdy nepřekrytý.
2. PROJDI CELOU APLIKACI NA TELEFONU. Playwright, šířky 360, 390
   a 430 px, čeština i angličtina (a němčina jako nejdelší
   jazyk, pokud je zapnutá): každá sekce, každý widget ve všech
   velikostech, dialogy, nastavení, administrace. Automatická
   kontrola: žádný prvek s textem nesmí mít scrollWidth >
   clientWidth bez záměru (označené výjimky), žádné dva klikací
   prvky se nesmí překrývat, nic nesmí přetékat vodorovně,
   klikací plochy aspoň 44 px, nic schované pod spodní lištou
   ani pod Gradym. Nálezy do docs/mobil/nalezy.md se snímky
   před/po a všechny oprav.
3. Přidej tuhle kontrolu jako trvalý E2E test (bun run e2e:mobil),
   který poběží s ostatními, ať se to nevrací.
4. Grady na telefonu: plovoucí tlačítko nesmí zakrývat poslední
   položku seznamu ani spodní lištu — ověř odsazení obsahu.
```

---

## Prompt 31.3 — E-mail u vygenerovaných kontaktů · **Opus 5.5**

```
Generování kontaktů (Google Places) vrací název, telefon, adresu
a web. Váša chce i e-mail, když to jde. Places e-maily nedává;
dá se dohledat na webu firmy.

1. Po vygenerování se u kontaktů s webem na pozadí dohledá
   e-mail: stáhni úvodní stránku a nejvýš 2 další (odkazy
   obsahující kontakt / contact / o-nas / about / impressum),
   najdi adresy v mailto: odkazech a v textu (i zapsané jako
   „info (at) firma.cz"), vyber nejlepší: přednost má adresa na
   doméně webu a obecná schránka (info@, kontakt@, obchod@,
   office@), ne noreply, ne adresy třetích stran (wix, sentry,
   příklad@…), ne obrázky. Ulož do kontaktu s označením zdroje
   („nalezeno na webu", adresa stránky) a jistotou; víc adres
   ulož jako další e-maily.
2. Slušnost a bezpečnost: respektuj robots.txt, jeden požadavek
   za sekundu na doménu, timeout 5 s, limit 500 kB na stránku,
   jen http(s), ochrana proti SSRF (žádné interní a privátní
   adresy, přesměrování hlídaná), vlastní User-Agent Gradusu.
   Běží po dávkách na pozadí (Vercel: krátké funkce, fronta
   v tabulce, zpracování při otevření seznamu a denním cronem),
   uživatel vidí „hledám e-maily… 12 z 40" a kontakty se
   doplňují průběžně. Žádné volání AI, žádné placené služby.
3. Rozhraní: sloupec E-mail v tabulce kontaktů a v Cold Callingu
   se štítkem „z webu"; u kontaktu bez e-mailu tlačítko „Zkusit
   najít e-mail" (ručně, pro starší kontakty i hromadně pro
   vybrané). Přepínač v nastavení generování „Hledat i e-maily"
   (výchozí zapnuto). Limit dohledání podle tarifu připrav
   v katalogu (výchozí bez omezení).
4. Právo: ukládej jen firemní kontaktní adresy zveřejněné na
   webu firmy; do nápovědy u hromadného e-mailu krátké
   upozornění, že obchodní sdělení se řídí pravidly země
   (v ČR souhlas nebo oprávněný zájem u firemních kontaktů) —
   text obecný, bez právní rady. Doplň docs/funkce.md a stránku
   o soukromí o zdroj údajů.
5. Vitest pro výběr adresy (20 vzorových HTML v tests/fixtures/
   emails/), SSRF a robots; E2E s místním testovacím webem.
```

---

## Kontrola fáze 31 · **Opus 5.5**

```
Zkontroluj fázi 31:
- chat: příloha jde modelu jednou, cache se opravdu čte, strop
  ceny zprávy drží, vypnuté přílohy nejdou obejít přes API,
  Vášův scénář je pod cílovou cenou (čísla v souhrnu),
- telefon: e2e:mobil prochází na 360/390/430 px v cs i en,
- dohledání e-mailů: SSRF, robots, limity, žádná smyčka
  přesměrování, žádné osobní adresy třetích stran, fronta se
  nezasekne při chybě jedné domény,
- migrace jen přidávací, bun run lint, test, build a e2e projdou.
```

=== KONEC

---

## Krok 2 — Do `docs/progress.md` vlož tyhle řádky těsně PŘED řádek začínající `- [ ] 23.4 | RUČNĚ`

=== ZAČÁTEK
- [ ] 31.1 | architect | env: ANTHROPIC_API_KEY
- [ ] 31.2 | designer |
- [ ] 31.3 | architect | env: GOOGLE_MAPS_API_KEY
- [ ] K31 | reviewer |
- [ ] STOP | Konec fáze 31. Přečti docs/ai-naklady-chat.md (co chat zdražovalo a cena před/po) a s Vášou rozhodněte v administraci, jestli přílohy v chatu nechat. Pošli Vášovi, ať znovu projde aplikaci na telefonu. Vygeneruj 20 kontaktů a zkontroluj dohledané e-maily. Co nesedí, napiš Claude Code rovnou, pak /pokracuj.
=== KONEC

---

## Krok 3 — Dokončení

Ověř `git check-ignore -v .env.local`, commitni, pushni a napiš uživateli česky, kolik položek přibylo a že může spustit `caffeinate -i bash scripts/noc.sh --bez-zastavek`.
