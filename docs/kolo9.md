# Faktury a hlášení chyb — kolo 9

Instrukce pro Claude Code. Proveď kroky 1 až 3 přesně a doslova. Obsah k vložení je vždy mezi řádky `=== ZAČÁTEK` a `=== KONEC`. Prompty samotné neprováděj — provedou se příkazem `/pokracuj` (nebo nočním během `scripts/noc.sh`).

---

## Krok 1 — Na konec `docs/plan.md` přidej tohle

=== ZAČÁTEK

---

# FÁZE 16 — Faktury a chyby

## Prompt 16.1 — Chyba GR-KQHYBN a neklikatelná tlačítka · **Opus 5.5**

```
Uživatel dostal u faktur obrazovku chyby s kódem GR-KQHYBN a na její
tlačítka nešlo pořádně kliknout.

1. Najdi hlášení s kódem GR-KQHYBN v bug_reports a v záznamech chyb
   (reportClientError) a zjisti, co u faktur spadlo. Reprodukuj to
   v Playwrightu (pravděpodobně detail obchodu → vystavit fakturu,
   nebo Finance → faktury po odstranění Fakturoidu: faktura bez
   čísla, bez kontaktu, nebo bývalá fakturoidová faktura s null).
   Oprav příčinu, přidej test, který by chybu odhalil.
2. Tlačítka na obrazovce chyby: reprodukuj na 1440 px i 390 px,
   v aplikaci (uvnitř layoutu s Jarvisem a dokem) i na webu. Hledej
   překrytí průhledným prvkem (Jarvisův dok, overlay prohlídky,
   pointer-events, z-index), dvojité vykreslení error boundary, nebo
   tlačítko, které se po kliknutí odmontuje dřív, než doběhne
   handler. Oprav tak, aby obrazovka chyby byla vždy nad vším
   ostatním a ostatní overlaye se při chybě zavřely.
3. E2E: vyvolaná chyba na stránce s otevřeným Jarvisem → tlačítka
   Zkusit znovu, Kopírovat kód i Odeslat zpětnou vazbu fungují
   na první klik.
```

---

## Prompt 16.2 — E-mail majiteli o každé chybě · **Opus 5.5**

```
Majitel chce e-mail pokaždé, když kterémukoli uživateli vyskočí
chyba, a chce v administraci nastavit, na které adresy to chodí.

1. NASTAVENÍ. V app_settings klíč error_alerts: { emails: string[],
   mode: "every" | "digest", digest_minutes: 15 }. Administrace →
   Nastavení → Upozornění na chyby: seznam adres (přidat, odebrat,
   validace e-mailu, nejvýš 10), přepínač „každá chyba zvlášť" /
   „souhrn každých N minut", tlačítko „Poslat zkušební e-mail".
   Výchozí hodnota při první migraci: e-mail majitelského účtu,
   režim every. Zápis jen majitel s aal2 a živou relací, do
   admin_audit.
2. ODESÍLÁNÍ. Při každém zachycení chyby na serveru i klientovi
   (reportClientError, error boundary, serverové akce, API routy,
   cron) se po zápisu záznamu pošle e-mail přes Resend s předmětem
   „[Gradus] Chyba GR-XXXXXX · <stránka>" a obsahem: kód, čas
   (Europe/Prague i UTC), stránka a akce, zpráva chyby a prvních 10
   řádků stacku, uživatel (jméno, e-mail, ID, tarif, interní ano/ne;
   u anonyma „nepřihlášený"), prohlížeč a zařízení, verze nasazení
   (Vercel commit), kolikrát se stejná chyba (stejná zpráva + stejné
   místo) stala za 24 h, odkaz do administrace na hlášení. Nikdy
   obsah uživatelových dat (názvy kontaktů, texty poznámek, částky).
3. OCHRANA PŘED ZÁPLAVOU. Stejná chyba (otisk ze zprávy + místa)
   se e-mailem pošle nejvýš jednou za 15 minut, další výskyty se
   přičtou k počítadlu a objeví se v dalším e-mailu nebo souhrnu.
   Celkem nejvýš 30 e-mailů za hodinu; při překročení jeden e-mail
   „Chyb je víc, podívej se do administrace". Režim digest sbírá
   chyby a posílá jeden souhrn přes cron (Vercel Hobby: souhrn
   jednou denně v 7:00 UTC; při každé chybě se navíc pošle hned,
   pokud za posledních digest_minutes nic nešlo — bez cronu
   s minutovou frekvencí).
4. Odesílání nesmí zpomalit ani shodit odpověď uživateli: po
   zápisu záznamu, bez čekání (waitUntil / after), chyba odeslání
   se jen zaloguje.
5. Dokud RESEND_FROM nemá ověřenou doménu, Resend doručí jen na
   adresu účtu Resend — napiš to v nastavení jako upozornění.
   Vitest pro otisk, limity a šablonu; E2E: chyba → záznam v DB →
   odeslání zavolané s očekávanými poli (mock Resend).
   Doplň CLAUDE.md.
```

---

## Prompt 16.3 — Vystavení faktury s vlastními údaji · **Opus 5.5**

```
Vystavování faktur je dnes nepřehledné a uživatel neví, jak na ně.
Přestav to.

1. ÚDAJE DODAVATELE. Tabulka invoice_profiles (1 na prostor):
   název / jméno, IČO, DIČ (nepovinné, přepínač plátce DPH),
   adresa (ulice, město, PSČ, země), e-mail, telefon, bankovní účet
   (číslo účtu + kód banky pro CZ, IBAN + BIC pro ostatní),
   výchozí splatnost ve dnech (14), výchozí měna, číselná řada
   (prefix + rok + pořadí, např. 2026-0001; pořadí se nikdy
   nepřeskakuje ani neopakuje — generuj v DB funkci v transakci),
   text v patičce (např. „Nejsem plátce DPH"). RLS podle prostoru.
   Při prvním otevření faktur (Finance → Faktury nebo tlačítko
   Vystavit fakturu v detailu obchodu) se otevře průvodce „Než
   vystavíš první fakturu" s těmito údaji; potom jsou v Nastavení →
   Faktury. Když si uživatel vyplnil IČO, nabídni předvyplnění
   z ARES (veřejné API, server, bez klíče) — jen pro CZ.
2. VYSTAVENÍ. Tlačítko „Vystavit fakturu" ve Financích → Faktury
   a v detailu obchodu (tam předvyplní odběratele z kontaktu a jednu
   položku z hodnoty obchodu). Formulář na jedné stránce:
   - odběratel: výběr z kontaktů s hledáním, nebo ručně (název,
     IČO, DIČ, adresa, e-mail); změny se uloží i do kontaktu, když
     uživatel zaškrtne,
   - položky: název, počet, jednotka, cena za kus, u plátce DPH
     sazba (0/12/21 % pro CZ, jinak volná) — přidat, odebrat,
     přetáhnout; součet bez DPH, DPH, celkem, zaokrouhlení,
   - datum vystavení, datum zdanitelného plnění (jen plátce),
     splatnost, variabilní symbol (výchozí = číslo faktury),
     měna, poznámka na fakturu,
   - živý náhled vpravo (na telefonu záložka Náhled),
   - Uložit koncept / Vystavit. Vystavená faktura je neměnná
     (číslo, částky); jde ji stornovat (vznikne dobropis se
     záporným číslem řady) nebo označit Zaplaceno jako dnes.
   Stávající tabulka invoices se rozšíří přidávacími sloupci
   (supplier snapshot JSON, customer snapshot JSON, items JSON,
   vat_mode, subtotal, vat_total, total, variable_symbol, note,
   style, qr_enabled, pdf_path); staré faktury dostanou snapshot
   z profilu a jednu položku z částky.
3. PDF. Generuj na serveru (zvol knihovnu bez prohlížeče, např.
   @react-pdf/renderer nebo pdf-lib; ne Puppeteer — Vercel Hobby).
   Uložit do Supabase Storage (bucket invoices, RLS podle prostoru),
   tlačítka Stáhnout PDF a Poslat e-mailem (přes Resend, s PDF
   v příloze, text předvyplněný, odběrateli s kopií uživateli).
   Fonty s plnou češtinou (vlož TTF do projektu). Bez vodoznaku,
   nikde ani v patičce text o Gradusu.
4. QR PLATBA. Pro uživatele s country_code CZ přepínač v Nastavení →
   Faktury „QR kód pro platbu (QR Platba, standard ČBA)", výchozí
   zapnuto pro CZ, pro ostatní země se nenabízí. Na faktuře i
   v náhledu QR kód podle specifikace Short Payment Descriptor
   (SPD*1.0*ACC:<IBAN>*AM:<částka>*CC:CZK*X-VS:<VS>*MSG:<číslo
   faktury>); IBAN se spočítá z čísla účtu + kódu banky (přidej
   výpočet s testy proti známým příkladům). QR jen pro CZK; u jiné
   měny se nevykreslí a nastavení to vysvětlí.
5. STYLY. V Nastavení → Faktury výběr ze 4 stylů s miniaturami:
   Čistý (jen typografie), Linka (barevná linka a akcent z barvy
   značky uživatele, volitelná barva), Blok (tmavá hlavička),
   Klasický (tabulkový, pro konzervativní odběratele). Všechny
   se stejnou strukturou dat, rozdíl jen v šabloně. Styl se ukládá
   k faktuře při vystavení, změna nastavení nemění už vystavené.
   Vzhled podle skillu frontend-design, náhledy všech 4 ulož do
   docs/invoices/*.png.
6. Seznam faktur ve Financích: číslo, odběratel, vystaveno,
   splatnost, částka, stav (koncept / vystavená / po splatnosti /
   zaplacená / stornovaná), filtr podle stavu, hledání, řazení,
   po splatnosti červeně; Jarvis o fakturách po splatnosti ví
   (přidej do souhrnu situace a proaktivních návrhů).
7. Práva: pracovník s právem upravovat finance smí vystavit,
   nastavení dodavatele mění jen majitel. Analytika: invoice_issued,
   invoice_sent, invoice_paid, invoice_cancelled — bez částek
   a jmen.
8. Vitest pro číselnou řadu (souběh), výpočty DPH a zaokrouhlení,
   IBAN, SPD řetězec; E2E: průvodce údaji → vystavení z obchodu →
   PDF existuje a obsahuje číslo a částku (unpdf) → označení
   Zaplaceno → příjem ve financích. Doplň CLAUDE.md sekci Faktury.
```

---

## Kontrola fáze 16 · **Opus 5.5**

```
Zkontroluj fázi 16 podle CLAUDE.md:
- e-maily o chybách nikdy nenesou obsah uživatelových dat, limity
  proti záplavě fungují, odesílání neblokuje odpověď,
- adresy upozornění mění jen majitel s aal2, do auditu,
- faktury: číselná řada bez děr při souběhu, vystavená faktura
  neměnná, storno jen dobropisem, RLS invoices a invoice_profiles
  a bucketu invoices (pracovník bez práva nevidí PDF ani přes přímý
  odkaz, podepsané URL s krátkou platností),
- QR Platba jen pro CZ + CZK, IBAN správně pro všechny české banky
  z testů, PDF s českou diakritikou ve všech 4 stylech, bez
  vodoznaku,
- ARES volán jen ze serveru, s timeoutem, bez pádu při výpadku,
- chyba GR-KQHYBN už nejde reprodukovat,
- migrace jen přidávací, bun run lint, test, build a e2e projdou.
```

=== KONEC

---

## Krok 2 — Do `docs/progress.md` vlož tyhle řádky těsně PŘED řádek začínající `- [ ] 12.4`

=== ZAČÁTEK
- [ ] 16.1 | architect |
- [ ] 16.2 | architect | env: RESEND_API_KEY
- [ ] 16.3 | architect | env: RESEND_API_KEY
- [ ] K16 | reviewer |
- [ ] STOP | Konec fáze 16. Vyvolej chybu a zkontroluj, že ti přišel e-mail s kódem a uživatelem; v administraci přidej druhou adresu a pošli zkušební e-mail. Faktury: projdi průvodce údaji, vystav fakturu z obchodu i z Financí, zkus všechny 4 styly, stáhni PDF, zaplať testovací QR kód bankovní aplikací (nebo ho aspoň naskenuj a zkontroluj částku a VS), pošli fakturu e-mailem sám sobě, označ Zaplaceno. Co nesedí, napiš Claude Code rovnou, pak /pokracuj.
=== KONEC

---

## Krok 3 — Dokončení

Ověř `git check-ignore -v .env.local`, commitni, pushni a napiš uživateli česky, kolik položek přibylo a že může spustit `caffeinate -i bash scripts/noc.sh` nebo `/clear` a `/pokracuj`. První poběží 16.1.
