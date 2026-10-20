# Poznámky z testování — kolo 8

Instrukce pro Claude Code. Proveď kroky 1 až 3 přesně a doslova. Obsah k vložení je vždy mezi řádky `=== ZAČÁTEK` a `=== KONEC`. Prompty samotné neprováděj — provedou se příkazem `/pokracuj` (nebo nočním během `scripts/noc.sh`).

---

## Krok 1 — Na konec `docs/plan.md` přidej tohle

=== ZAČÁTEK

---

# FÁZE 15 — Připomínky z třetího testování

## Prompt 15.1 — Jedno upozornění Jarvise naráz · **Opus 5.5**

```
Když má Jarvis víc proaktivních upozornění, překrývají chat a není
vidět. Nově se zobrazuje vždy jen jedno.

1. V src/components/jarvis/proactive-jarvis.tsx (a souvisejícím
   stavu v overlay-store / proactive-queries) nahraď stoh karet
   jednou kartou s frontou: zobrazí se první upozornění v pořadí
   (nejnaléhavější první, pak podle času). Zavření nebo splnění ho
   odebere a na jeho místě se objeví další, s krátkým přechodem
   (Framer Motion, respektuj reduced motion). Žádný posun rozvržení
   chatu — karta má pevné místo.
2. Listování: v hlavičce karty „2 z 5", šipky ‹ › a klávesy ←/→
   když má karta fokus; tečky nejvýš do 5. Přeskočené upozornění
   zůstává ve frontě. Na telefonu swipe do stran.
3. Zavřené upozornění se už neukáže (dnešní chování zachovej);
   splněné (akce proběhla) zmizí hned a zapíše reakci jako dnes.
4. Karta nikdy nepřekrývá vstupní pole chatu ani poslední zprávu:
   zkontroluj na 390 px i 1440 px, s otevřeným chatem i zavřeným.
5. Vitest pro řazení a frontu, E2E: tři upozornění → vidím jedno,
   zavřu → vidím druhé, šipkou zpět → první je přeskočené, ne
   zavřené.
```

---

## Prompt 15.2 — Stránka chyby se zpětnou vazbou · **Opus 5.5**

```
Když v aplikaci nastane chyba, uživatel má vidět omluvu, kód chyby
a tlačítko, kterým chybu jedním klikem nahlásí.

1. Kód chyby: krátký čitelný identifikátor (např. GR-7K3M9Q) se
   vygeneruje při zachycení chyby, pošle se s hlášením přes
   reportClientError (bez obsahu dat) a uloží k záznamu, takže
   podle kódu se v administraci dá chyba dohledat.
2. Obrazovka chyby (src/app/(app)/error.tsx, přidej i
   src/app/global-error.tsx a error.tsx pro (marketing) a (admin)
   s odpovídajícím vzhledem): nadpis „Omlouváme se, něco se
   pokazilo", věta, že o tom víme, kód chyby s tlačítkem Kopírovat,
   tlačítka Zkusit znovu a Odeslat zpětnou vazbu, pod tím odkaz na
   nástěnku. Jarvis na téhle stránce není. i18n CS/EN.
3. Odeslat zpětnou vazbu: založí hlášení v bug_reports (nebo ve
   stejné tabulce, kterou používá tlačítko Nahlásit problém; když
   12.4 ještě neproběhlo, tabulku bug_reports s RLS založ teď podle
   popisu promptu 12.4 a prompt 12.4 ji pak jen rozšíří) s kódem
   chyby, stránkou, prohlížečem, verzí nasazení a volitelným
   popisem od uživatele (textové pole se objeví po kliknutí, odeslat
   jde i prázdné). Po odeslání se na místě tlačítka ukáže: „Děkujeme.
   O chybě teď díky vám víme a co nejrychleji ji vyřešíme." Jedno
   hlášení na jeden kód chyby — opakované kliknutí nic nepošle.
   Funguje i bez přihlášení (anonymní hlášení s limitem podle IP).
4. Administrace → Zpětná vazba (nebo Hlášení chyb): nový řádek je
   vidět s kódem, hledání podle kódu.
5. Rozhoď chybu uměle v E2E (testovací stránka jen v development
   nebo přepínač v URL dostupný jen pro @gradus.local) a ověř celý
   průchod včetně záznamu v databázi.
```

---

## Prompt 15.3 — Poznámky: koš s potvrzením a odkazy na záznamy · **Opus 5.5**

```
Dvě úpravy Poznámek.

A) KOŠ Z SEZNAMU. V levém seznamu má každá poznámka vpravo červenou
   ikonu popelnice (Trash2 z lucide, barva danger z tokenů), na
   počítači viditelnou při hoveru a fokusu, na telefonu vždy. Klik
   otevře potvrzení „Přesunout poznámku „<název>" do koše?" s
   tlačítky Zrušit a Přesunout do koše. Po potvrzení se poznámka
   přesune do koše, seznam přejde na sousední poznámku, dole se
   ukáže „Přesunuto do koše · Zpět" na 6 s. Koš maže položky
   starší než 30 dní — ověř, že to denní cron dělá, a text o 30
   dnech ukaž v koši. Klávesová zkratka Delete/Backspace na vybrané
   poznámce v seznamu dělá totéž (s potvrzením).

B) ODKAZY NA ZÁZNAMY. V textu poznámky jde odkázat na kontakt,
   obchod, událost v kalendáři nebo pracovníka.
   1. Napsáním @ se otevře našeptávač (Tiptap Mention) s hledáním
      napříč kontakty, obchody, událostmi a pracovníky uživatele
      (využij src/features/search), seskupené podle typu, s ikonou.
      Odkaz jde vložit i přes tlačítko „Odkázat na…" v panelu.
   2. V dokumentu se uloží jako uzel { type, id, label }; vykreslí
      se jako čip s ikonou typu a názvem, klik otevře detail
      záznamu (kontakt, obchod v pipeline, událost v kalendáři,
      pracovník). Když záznam zanikl, čip je přeškrtnutý s tooltipem
      „Záznam už neexistuje", poznámka se nerozbije.
   3. Název v čipu se při otevření poznámky obnoví podle aktuálního
      stavu záznamu (přejmenovaný kontakt), uložený label je jen
      záloha.
   4. Zpětná vazba: v detailu kontaktu, obchodu, události a
      pracovníka sekce „Zmíněno v poznámkách" s odkazy na poznámky
      (tabulka note_mentions: note_id, target_type, target_id;
      RLS podle vlastníka; plní se při uložení z obsahu).
   5. Jarvis dostává v kontextu poznámek čipy jako text
      „[kontakt: Jan Novák]", aby věděl, o kom se mluví.
   6. content_text pro hledání obsahuje label čipu.
   Vitest pro serializaci a note_mentions, E2E: vložení @kontakt,
   klik otevře detail, kontakt zobrazí „Zmíněno v poznámkách".
   Doplň CLAUDE.md sekci Poznámky.
```

---

## Prompt 15.4 — Náklady AI podle vybraného období · **Opus 5.5**

```
V administraci AI a Jarvis:

1. Ukazatel rozpočtu se řídí obdobím zvoleným v horní liště:
   - období 30 dní / kalendářní měsíc → měsíční strop jako dnes,
   - 7 dní → týdenní strop = měsíční × 7 / počet dní v aktuálním
     měsíci, útrata za vybraných 7 dní,
   - dnes → denní strop = měsíční / počet dní v měsíci,
   - 90 dní, 12 měsíců, vlastní rozsah → strop přepočítaný na
     délku rozsahu stejným způsobem; u rozsahu přes víc měsíců
     součet denních stropů jednotlivých měsíců.
   Karta říká, co ukazuje: „Útrata za 7 dní: 12,40 USD z týdenního
   limitu 20,16 USD" a vedle „měsíční strop 90,00 USD" jako kotva.
   Stejně se přepočítá strop na uživatele a práh upozornění
   v grafu. Nastavení stropu v databázi zůstává měsíční — mění se
   jen zobrazení a výpočet pro zvolené období. Kontrola před voláním
   modelu (budget.ts) se nemění.
2. Všechny částky za AI v administraci (karta rozpočtu, stropy,
   náklady, detail uživatele, průzkumník, exporty) se zobrazují
   vždy se dvěma desetinnými místy v USD podle src/lib/format.ts
   (0,00 USD; nikdy 0 ani 1,2). Projdi formatMetric a decimalsFor:
   pro měnu USD u AI vrať vždy 2.
3. Vitest pro přepočet stropů (7 dní v únoru vs. v březnu, rozsah
   přes dva měsíce, dnes) a formátování. Doplň CLAUDE.md u Měsíčního
   rozpočtu.
```

---

## Prompt 15.5 — Tarify v administraci se zveřejněním · **Opus 5.5**

```
Cenové balíčky jsou dnes napevno v src/config/pricing.ts. Majitel je
chce upravovat v administraci a zveřejnit až tlačítkem.

1. DATA. Tabulka plan_catalog_versions: id, created_at, created_by,
   status (draft | published | archived), published_at, published_by,
   payload JSON (pole tarifů: klíč, název CS/EN, ceny CZK/EUR
   měsíčně a ročně, cena za pracovníka, limity — generování denně,
   AI, pracovníci, úložiště —, seznam vlastností CS/EN s příznakem
   zvýraznit, štítek „Nejoblíbenější", pořadí). Právě jeden řádek
   published; nejvýš jeden draft. Zápis jen SECURITY DEFINER funkcemi
   pro majitele s aal2 a živou relací, do admin_audit. První
   migrace založí published verzi ze současného pricing.ts, takže
   web se při nasazení nezmění.
2. ČTENÍ. Serverová funkce getPublishedPlans() s cache (revalidate
   přes tag při zveřejnění) nahradí přímé čtení PAID_PLANS na webu
   (/, /cenik, SEO offers), v aplikaci (/app/tarif, trial-notice,
   limity v plan.ts) i v Jarvisově znalosti tarifů. pricing.ts
   zůstane jen jako výchozí seed a typy. Limity uživatelů se čtou
   z published verze při každém vyhodnocení (žádné kopírování do
   profilu).
3. ADMINISTRACE → Nastavení → Tarify: editor draftu — karty tří
   tarifů vedle sebe jako na webu, vše editovatelné na místě,
   přidat/odebrat vlastnost, přetažením řadit; validace (ceny
   kladné, roční ≤ 12× měsíční, klíče neměnné solo/pro/team);
   živý náhled „Takto to uvidí návštěvník" v CS i EN. Tlačítka:
   Uložit koncept (nezveřejní nic), Zahodit koncept, Zveřejnit
   (potvrzení s rozdílem proti současné verzi: co se mění, kolik
   uživatelů má tarif, kterého se změna limitu dotkne). Historie
   verzí s možností vrátit předchozí (= zveřejní její kopii).
   Dokud není zveřejněno, web i aplikace ukazují starou verzi.
4. Když zveřejněná změna sníží limit pod to, co uživatel používá,
   nic se nemaže — platí pravidlo jen pro čtení z CLAUDE.md
   (read_only při překročení) až od dalšího dne, a v potvrzení
   zveřejnění se počet takových uživatelů ukáže.
5. Vitest pro validaci a diff, E2E: změna ceny v konceptu → web
   nezměněn → Zveřejnit → web změněn; vrácení verze. Doplň
   CLAUDE.md (Stack: pricing.ts je seed; sekce Tarify).
```

---

## Kontrola fáze 15 · **Opus 5.5**

```
Zkontroluj fázi 15 podle CLAUDE.md:
- plan_catalog_versions: zápis jen majitel s aal2, přesně jedna
  published verze (ověř souběh dvou zveřejnění), web čte vždy
  published, koncept nikdy neunikne do veřejné cache ani SEO,
- note_mentions a čipy: RLS, čip na cizí záznam nejde vložit ani
  ručně v JSON, zaniklý záznam poznámku nerozbije, Jarvis dostává
  čipy jako text uvnitř <user_notes>,
- hlášení chyby: žádný obsah dat uživatele, limit pro anonymy,
  jeden kód = jedno hlášení,
- fronta upozornění Jarvise nepřekrývá chat na 390 px,
- přepočet stropů podle období nemění kontrolu v budget.ts,
  všechny částky AI se dvěma desetinnými místy,
- migrace jen přidávací, bun run lint, test, build a e2e projdou.
```

=== KONEC

---

## Krok 2 — Do `docs/progress.md` vlož tyhle řádky těsně PŘED řádek začínající `- [ ] 12.4`

=== ZAČÁTEK
- [ ] 15.1 | architect |
- [ ] 15.2 | architect |
- [ ] 15.3 | architect |
- [ ] 15.4 | architect |
- [ ] 15.5 | architect |
- [ ] K15 | reviewer |
- [ ] STOP | Konec fáze 15. Projdi: Jarvis s víc upozorněními (jedno naráz, listování). Vyvolej chybu a odešli zpětnou vazbu, najdi ji v administraci podle kódu. V poznámkách smaž poznámku popelnicí (potvrzení, Zpět), vlož @kontakt a klikni na čip, otevři kontakt a najdi „Zmíněno v poznámkách". V administraci AI přepni období na 7 dní a dnes a zkontroluj přepočet a dvě desetinná místa. V Tarifech změň cenu, ověř, že web se nezměnil, zveřejni a ověř web i /app/tarif. Co nesedí, napiš Claude Code rovnou, pak /pokracuj.
=== KONEC

---

## Krok 3 — Dokončení

Ověř `git check-ignore -v .env.local`, commitni, pushni a napiš uživateli česky, kolik položek přibylo a že může spustit `caffeinate -i bash scripts/noc.sh` nebo `/clear` a `/pokracuj`. První poběží 15.1.
