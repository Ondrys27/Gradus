# Platby přes Stripe a veřejná registrace — kolo 16

Instrukce pro Claude Code. Proveď kroky 1 až 4 přesně a doslova. Obsah k vložení je vždy mezi řádky `=== ZAČÁTEK` a `=== KONEC`. Prompty samotné neprováděj — provedou se příkazem `/pokracuj` (nebo nočním během `scripts/noc.sh`).

Rozhodnutí majitele (8. 11.): Stripe Checkout + Customer Portal, prodávající je neplátce DPH (Stripe Tax vypnutý, DPH jde zapnout později), doklady vystavuje Stripe, zkušební období zůstává 14 dní bez karty.

---

## Krok 1 — Na konec `docs/plan.md` přidej tohle

=== ZAČÁTEK

---

# FÁZE 23 — Platby přes Stripe a veřejná registrace

*Navazuje na Předplatné (18.x), Tarify (15.5) a promo kódy (22.2). Pravidla, co kdy platí (vyšší tarif hned, nižší ke konci období, zrušení, jen pro čtení po expiraci), zůstávají v DB a v `state.ts`; Stripe je jen brána, která strhává peníze a hlásí výsledek. Databáze je jedna pro vývoj i produkci, Stripe má testovací a ostrý režim: nikdy je nesmíchat.*

## Prompt 23.1 — Stripe: ceny z katalogu, Checkout a webhook · **Opus 5.5**

```
Napoj platební bránu Stripe. Dnes se změny tarifu jen zapíšou
(TODO(payments) v src/features/subscription/actions.ts), teď se
za ně opravdu zaplatí. Kód v src/features/billing/stripe/, SDK
stripe (server only, nikdy do prohlížeče kromě publishable key).

1. REŽIMY. STRIPE_SECRET_KEY určuje režim (sk_test_ / sk_live_).
   Každý řádek, který Stripe ovlivní, nese stripe_mode test|live
   (nové sloupce s výchozí hodnotou: subscriptions, payments,
   billing_customers, stripe_events). Testovací režim smí měnit jen
   účty @gradus.local a interní účty; ostrý jen ostatní, nikdy
   @gradus.local. Produkce (VERCEL_ENV=production) má jen live
   klíč, vývoj a preview jen test klíč; jinak server odmítne start
   platby s jasnou hláškou v logu.
2. CENY. Zveřejněná verze katalogu (getPublishedPlans) je jediný
   zdroj cen. Při zveřejnění verze (admin_plan_catalog_publish) a
   lazy při prvním Checkoutu server vytvoří ve Stripe Product na
   tarif a Price na tarif × měna (CZK, EUR) × období (měsíc, rok)
   s lookup_key plan:<key>:<měna>:<období>:v<verze>; existující
   nemění (Price je ve Stripe neměnná), starou verzi jen archivuje.
   Ceny katalogu jsou konečné (neplátce DPH, Stripe Tax vypnutý),
   ale tax_behavior=unspecified a jeden přepínač
   BILLING_VAT_MODE=none|stripe_tax připravený na později.
   Cena za pracovníka navíc (22.5) = druhá položka předplatného
   s quantity, aktualizovaná při změně počtu (proration od dalšího
   období, stejně jako pravidlo 22.5).
3. ZÁKAZNÍK. billing_customers (user_id = prostor, stripe_mode,
   stripe_customer_id unikátní; RLS bez klientského přístupu).
   Zákazník vzniká při prvním Checkoutu s údaji z billing_profiles
   (jméno/firma, adresa, země, e-mail pro doklady, DIČ jako tax id
   eu_vat, IČO do metadata a custom field dokladu); změna
   fakturačních údajů v Gradusu se propíše do Stripe.
4. CHECKOUT. Server akce startCheckout(plan, billing): jen majitel
   prostoru, ověří changeBlock / plannedChange jako dnes, vytvoří
   Checkout Session mode=subscription, customer, line_items z Price,
   client_reference_id = prostor, metadata {workspace, plan, billing,
   catalog_version}, locale podle jazyka, success/cancel URL na
   PLAN_PATH, consent_collection.terms_of_service=required (odkaz
   na /podminky), custom_text s větou o okamžitém začátku služby
   (texty v překladech). Zkušebka bez karty zůstává: po registraci
   se nic neplatí; tlačítko „Zaplatit a pokračovat" v Předplatném,
   v banneru posledních 3 dnů zkušebky a v režimu jen pro čtení
   po expiraci. Zaplacením během zkušebky začne placené období
   hned po jejím konci (trial_end = trial_ends_at), po expiraci
   hned. Beta tarif a tarify mimo katalog Checkout nenabízí.
5. PROMO KÓDY (22.2). Výhoda kódu uživatele se promítne do
   Checkoutu: percent_off_first = Stripe Coupon duration=once,
   months_free = coupon 100 % duration=repeating na N měsíců,
   trial_days_extra = posune trial_end. Kupony vytváří server
   (idempotentně podle kódu a verze), uživatel ve Stripe jiné kódy
   zadat nemůže (allow_promotion_codes=false).
6. WEBHOOK POST /api/stripe/webhook: ověření podpisu
   (STRIPE_WEBHOOK_SECRET, raw body), idempotence přes stripe_events
   (event id unikátní, payload jen identifikátory a stav, bez
   osobních údajů), zápis jen admin klientem přes nové SECURITY
   DEFINER funkce billing_apply_subscription / billing_record_payment
   (service role). Zpracuj checkout.session.completed,
   customer.subscription.created|updated|deleted, invoice.paid,
   invoice.payment_failed, charge.refunded: subscriptions (plan_key,
   billing, status trialing|active|past_due|cancelled,
   current_period_start/end, cancel_at_period_end, provider=stripe,
   provider_ref = id předplatného), payments (částka, měna, paid_at,
   paid|failed|refunded, invoice_url = hosted_invoice_url,
   provider_ref = id faktury). Události mimo pořadí: rozhoduje
   event.created a stav objektu načtený ze Stripe, nikdy starší
   přepíše novější. První zaplacená platba s promo kódem založí
   partner_payouts (22.2, z částky bez DPH = celé částky).
   Neznámý prostor nebo špatný režim = 200 a záznam do error_events
   (GR kód), nikdy 500 smyčka opakování.
7. TODO(payments) nahraď: vyšší tarif / rok místo měsíce u běžícího
   předplatného = subscription update s prorací hned (jako dnes
   „platí hned"); nižší tarif = Subscription Schedule ke konci
   období (scheduled_plan_* se drží v souladu); zrušení =
   cancel_at_period_end přes API (důvod a poznámka zůstávají
   v Gradusu); obnovení = zrušení cancel_at_period_end. Bez
   předplatného ve Stripe (zkušebka, expirace) = Checkout. Stav
   a období dál mění jen webhook a administrace.
8. Cron „automatické platby" (1× denně) se změní na srovnání:
   pro aktivní řádky s provider=stripe načte předplatné ze Stripe
   a opraví odchylky (zmeškaný webhook), nejvýš 200 za běh, zápis
   do logu cronu.
9. Analytika (server): checkout_started (tarif, období, měna, z kód
   ano/ne, odkud), checkout_completed, payment_succeeded (tarif,
   období, měna, první ano/ne), payment_failed (pokus), payment_
   refunded; nikdy částky u jména ani e-mail. Metriky v docs/
   metrics.md: platící účty, MRR po měnách (měny se nesčítají),
   konverze zkušebka → platba, neúspěšné platby.
10. Vitest: mapování událostí na stav (fixtures v tests/fixtures/
    stripe/), mimo pořadí, idempotence, režimy test/live, výpočet
    kuponu z promo kódu. E2E bez sítě do Stripe: test podepíše
    syntetickou událost testovacím STRIPE_WEBHOOK_SECRET a pošle ji
    na webhook (jen @gradus.local mimo produkci) → Předplatné ukáže
    aktivní tarif, Historie plateb řádek s odkazem; selhaná platba
    → past_due banner. Doplň .env.example (STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    BILLING_VAT_MODE), CLAUDE.md sekci Předplatné (platby přes
    Stripe, režimy) a tabulku Prostředí.
```

---

## Prompt 23.2 — Správa plateb: Portál, neúspěšné platby, doklady · **Opus 5.5**

```
Navazuje na 23.1.

1. PORTÁL. V Nastavení → Předplatné „Spravovat platební metodu
   a doklady" otevře Stripe Customer Portal (server vytvoří session,
   return_url = PLAN_PATH). Konfigurace portálu kódem (idempotentně
   při startu nebo skriptem bun run stripe:portal): jen změna karty,
   fakturační adresa a seznam dokladů; změnu tarifu a zrušení
   v portálu vypnout, ty řeší Gradus podle svých pravidel.
2. NEÚSPĚŠNÁ PLATBA. past_due: banner v aplikaci (jen majitel,
   pracovník nic) „Platba se nepovedla, aktualizuj kartu" s odkazem
   do portálu; Stripe Smart Retries a jeho e-maily o selhání
   zapnout (popiš v docs/stripe.md, nastavuje se v dashboardu).
   Během opakování aplikace běží; když Stripe předplatné po
   posledním pokusu zruší (subscription.deleted), platí expirace
   a režim jen pro čtení jako po zkušebce, data se nemažou.
   Jarvis v <plans> ví o past_due a jednou to připomene.
3. DOKLADY. Doklad vystavuje Stripe (Invoicing): v docs/stripe.md
   přesný postup pro majitele — údaje prodávajícího (jméno, IČO,
   adresa), patička „Nejsem plátce DPH.", číselná řada, jazyk,
   e-mail dokladu po platbě. Historie plateb v Předplatném: datum,
   tarif, období, částka přes format.ts, stav, odkaz Doklad
   (invoice_url). Refundace = řádek se stavem vráceno.
4. ADMINISTRACE. Detail uživatele → karta Předplatné: odkaz na
   zákazníka a předplatné ve Stripe (dashboard URL podle režimu),
   poslední platby, ruční „Srovnat se Stripe" (jen majitel, aal2,
   admin_audit). Náklady / Metriky: tržby po měnách, platící účty,
   neúspěšné platby za období (z payments, bez interních).
   admin_subscription_set u účtu s provider=stripe varuje, že
   ruční změna Stripe nezmění.
5. E-MAIL majiteli aplikace při první platbě nového účtu a při
   selhání po posledním pokusu (Resend, nejvýš 1× denně souhrnem,
   @gradus.local nic).
6. Vitest pro banner a stav (state.ts), E2E se syntetickými
   událostmi: payment_failed → banner → invoice.paid → banner zmizí;
   subscription.deleted → jen pro čtení. Doplň CLAUDE.md.
```

---

## Prompt 23.3 — Veřejná registrace a spuštění prodeje · **Opus 5.5**

```
Otevři Gradus veřejnosti: kdokoli se zaregistruje, má 14 dní
zdarma bez karty a pak zaplatí.

1. REGISTRACE. S PUBLIC_SIGNUP_ENABLED=true registrace bez kódu
   (pozvánky a beta kódy fungují dál, beta zůstává zdarma).
   Povinné zaškrtnutí souhlasu s obchodními podmínkami a zásadami
   ochrany osobních údajů (odkazy) — uloží se terms_accepted_at
   a terms_version do profilu (server, ne klient); marketingový
   souhlas zvlášť a nepovinný. Limit neúspěšných pokusů o
   pozvánkový / promo kód podle IP a e-mailu (jako přihlášení
   administrace), pokud ještě není. Potvrzení e-mailu: aplikace
   ho čte z Supabase (isEmailConfirmationRequired); když je
   veřejná registrace zapnutá a potvrzení vypnuté, administrace
   ukáže varování.
2. WEB. /cenik a / : tlačítka tarifů vedou na registraci s
   předvybraným tarifem (?tarif=pro&obdobi=rok), po registraci se
   tarif ukáže v Předplatném jako „Vybraný tarif, zaplatíš po
   zkušebce". Čekací listina se při veřejné registraci schová.
   Žádná vymyšlená čísla ani recenze (pravidlo Web).
3. PODMÍNKY. /podminky a /soukromi: doplň oddíly, které platby
   vyžadují — prodávající (z konfigurace, ne natvrdo), cena a
   platba přes Stripe, automatické obnovování, zrušení, odstoupení
   spotřebitele do 14 dnů a souhlas se začátkem služby, reklamace,
   Stripe jako zpracovatel. Místa, která musí doplnit majitel
   (IČO, adresa, kontakt), nech jako [DOPLNIT] a vypiš je v
   docs/stripe.md; web je s [DOPLNIT] nesmí ukázat v produkci —
   build v produkci selže, dokud nějaké zůstane.
4. KONTROLNÍ SEZNAM docs/spusteni.md pro majitele (bez kódu):
   Vercel Pro (Hobby nesmí komerčně), Stripe ověřený účet a live
   klíče ve Vercelu, webhook na https://gradusgo.com/api/stripe/
   webhook s událostmi z 23.1, Invoicing a patička, portál, SMTP
   a potvrzení e-mailu v Supabase, RESEND_FROM na doméně,
   PUBLIC_SIGNUP_ENABLED=true, zkušební nákup kartou v live
   režimu a vrácení peněz.
5. Analytika: signup_completed s odkud (web, ceník, pozvánka,
   kód), metrika registrace → platba v Aktivaci. Vitest pro
   výběr tarifu z adresy a kontrolu [DOPLNIT], E2E: veřejná
   registrace bez kódu (@gradus.local, PUBLIC_SIGNUP_ENABLED
   v testu) → souhlas povinný → zkušebka 14 dní → vybraný tarif
   v Předplatném. Doplň CLAUDE.md (Zkušební období, Web) a přesuň
   z „Do prosince nepatří" pryč veřejnou registraci, prodejní web
   a platby předplatného.
```

---

## Kontrola fáze 23 · **Opus 5.5**

```
Zkontroluj fázi 23 podle CLAUDE.md:
- tajné klíče Stripe nikdy v prohlížeči ani v logu, webhook bez
  platného podpisu = 400, raw body, idempotence (stejná událost
  dvakrát = jeden zápis), události mimo pořadí nepřepíšou novější
  stav,
- testovací režim nikdy nezmění ostrý účet a naopak, produkce
  odmítne test klíč,
- ceny jen ze zveřejněné verze katalogu, koncept nikdy; klient
  nemůže poslat vlastní cenu ani Price id,
- pravidla změn tarifu jsou stejná v DB, state.ts a ve Stripe
  (vyšší hned, nižší ke konci období, zrušení a obnovení),
- po zrušení nebo neúspěšném posledním pokusu režim jen pro čtení,
  nic se nemaže; beta a pracovníci bez vlastního tarifu nic neplatí,
- promo kód se uplatní jednou, provize jen z první platby,
- analytika bez částek u jmen a bez e-mailů, měny se nesčítají,
- migrace jen přidávací, stávající účty a testeři na betě beze
  změny, bun run lint, test, build a e2e projdou.
```

=== KONEC

---

## Krok 2 — Do `docs/progress.md` vlož tyhle řádky těsně PŘED řádek začínající `- [ ] 7.1`

=== ZAČÁTEK
- [ ] 23.0 | RUČNĚ | Založ účet na stripe.com (zatím stačí testovací režim). Do .env.local dej STRIPE_SECRET_KEY (sk_test_…) a NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (pk_test_…). Nainstaluj Stripe CLI (brew install stripe/stripe-cli/stripe), přihlas se (stripe login) a spusť stripe listen --forward-to localhost:3000/api/stripe/webhook; vypsaný whsec_… dej do .env.local jako STRIPE_WEBHOOK_SECRET. Stejné tři testovací hodnoty dej ve Vercelu do Preview. Pak tuhle položku zaškrtni a pusť /pokracuj.
- [ ] 23.1 | architect | env: STRIPE_SECRET_KEY
- [ ] 23.2 | architect | env: STRIPE_SECRET_KEY
- [ ] 23.3 | architect |
- [ ] K23 | reviewer |
- [ ] STOP | Konec fáze 23. V testovacím režimu: zaregistruj nový účet @gradus.local bez kódu, v Předplatném „Zaplatit a pokračovat", zaplať testovací kartou 4242 4242 4242 4242, zkontroluj aktivní tarif a doklad v Historii plateb. Zkus kartu 4000 0000 0000 0341 (selže) a banner, změnu karty v portálu, přechod na vyšší tarif a zrušení. Zkus promo kód VASA50 v Checkoutu. Co nesedí, napiš Claude Code rovnou, pak /pokracuj.
- [ ] 23.4 | RUČNĚ | Spuštění prodeje podle docs/spusteni.md: Vercel Pro, ověřený Stripe účet, live klíče a webhook ve Vercelu (Production), Invoicing s patičkou „Nejsem plátce DPH.", doplněné [DOPLNIT] v podmínkách, SMTP a potvrzení e-mailu v Supabase, PUBLIC_SIGNUP_ENABLED=true. Udělej jeden ostrý nákup vlastní kartou a vrať si peníze. Pak tuhle položku zaškrtni.
=== KONEC

---

## Krok 3 — `CLAUDE.md`

Nic neměň; prompty 23.1–23.3 si CLAUDE.md doplní samy (23.3 přesune veřejnou registraci, prodejní web a platby předplatného z „Do prosince nepatří").

---

## Krok 4 — Dokončení

Ověř `git check-ignore -v .env.local`, commitni, pushni a napiš uživateli česky, kolik položek přibylo, že první je ruční 23.0 (Stripe účet a testovací klíče) a že fáze 23 přijde na řadu až po fázi 22.
