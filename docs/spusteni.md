# Spuštění prodeje: kontrolní seznam

Pro tebe, bez kódu. Projdi to shora dolů, každý bod odškrtni až po ověření. Kód je hotový (kroky 23.1 až 23.3); tady jde jen o účty, nastavení a proměnné. Podrobnosti ke Stripe jsou v `docs/stripe.md`, k e-mailům Supabase v `docs/supabase-email.md`.

Proměnné prostředí se mění ve Vercelu → Project → Settings → Environment Variables. U každé hlídej prostředí **Production** (ostré) a **Preview** (testovací). Po změně proměnných dej **Redeploy** posledního nasazení, jinak se neprojeví.

## 1. Vercel

- [ ] **Přejdi na Vercel Pro.** Hobby se nesmí používat komerčně; jakmile se prodává, musí to být Pro (Vercel → Settings → Billing → Upgrade).
- [ ] Doména `gradusgo.com` je u projektu a má platný certifikát (Settings → Domains).
- [ ] `NEXT_PUBLIC_SITE_URL=https://gradusgo.com` v Production (odkazy v e-mailech, návrat ze Stripe, podmínky v portálu).

## 2. Stripe: účet a klíče

- [ ] **Ověřený účet Stripe** (Activate payments): údaje o podnikání, bankovní účet pro výplaty, ověření totožnosti. Dokud není ověřený, ostré platby nejdou.
- [ ] Settings → Business → **Public details**: název, e-mail podpory, web `https://gradusgo.com` a **URL obchodních podmínek** `https://gradusgo.com/podminky` (Checkout bez ní souhlas s podmínkami neukáže).
- [ ] **Live klíče ve Vercelu, jen Production:** `STRIPE_SECRET_KEY=sk_live_…` a `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…`. Produkce testovací klíč odmítne a platby nepustí; Preview a vývoj si nech testovací (`sk_test_…`, `pk_test_…`).
- [ ] `BILLING_VAT_MODE=none` v Production (ceny katalogu jsou konečné, Stripe Tax vypnutý), pokud ses s účetní nedomluvil jinak.

## 3. Stripe: webhook

- [ ] V **ostrém** režimu Developers → Webhooks → Add endpoint: `https://gradusgo.com/api/stripe/webhook`.
- [ ] Události (stejné jako v testovacím režimu, krok 23.1): `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`.
- [ ] Podpisové tajemství endpointu (`whsec_…`) do `STRIPE_WEBHOOK_SECRET` v Production. Testovací endpoint a jeho tajemství zůstávají v Preview.
- [ ] Po prvním nasazení s live klíči v dashboardu u endpointu zkontroluj, že doručení končí kódem 200.

## 4. Stripe: doklady, portál, neúspěšné platby

Všechno v **ostrém** režimu (testovací nastavení se nepřenáší), podle `docs/stripe.md`:

- [ ] **Invoicing** (oddíl 3): údaje prodávajícího na dokladu, číslování, jazyk, e-mail dokladu po platbě. **Patička dokladu: „Nejsem plátce DPH.“** (Settings → Billing → Invoices → Default footer), dokud nejsi plátce.
- [ ] **Customer Portal** (oddíl 1): `STRIPE_SECRET_KEY=sk_live_… bun run stripe:portal` (klíč jen do příkazu, nikam ho neukládej), nebo nech konfiguraci založit aplikaci při prvním otevření portálu. V dashboardu ji neměň.
- [ ] **Smart Retries a e-maily o neúspěšné platbě** (oddíl 2), hlavně „po posledním pokusu zrušit předplatné“.

## 5. E-maily

- [ ] **Resend:** ověřená doména `gradusgo.com` (DNS záznamy SPF a DKIM v Resend → Domains svítí zeleně).
- [ ] `RESEND_FROM` na té doméně, např. `Gradus <ahoj@gradusgo.com>`, v Production. Bez něj Resend doručí jen na adresu tvého účtu Resend.
- [ ] **Supabase → Authentication → Emails → SMTP Settings:** vlastní SMTP přes Resend (host `smtp.resend.com`, port 465, uživatel `resend`, heslo = API klíč Resendu, odesílatel na doméně). Vestavěná pošta Supabase pošle jen pár e-mailů za hodinu.
- [ ] Šablony e-mailů Supabase podle `docs/supabase-email.md` (potvrzení registrace, obnova hesla).
- [ ] **Supabase → Authentication → Sign In / Providers → Confirm email: zapnout** (až po SMTP). Aplikace to čte sama; dokud je vypnuté a veřejná registrace zapnutá, administrace na Přehledu ukazuje žluté varování.
- [ ] Supabase → Authentication → URL Configuration: Site URL `https://gradusgo.com`, v Redirect URLs `https://gradusgo.com/**`.

## 6. Podmínky a zásady

- [ ] Ve Vercelu (Production i Preview) vyplň `LEGAL_NAME`, `LEGAL_COMPANY_ID`, `LEGAL_ADDRESS`, `CONTACT_EMAIL` a `LEGAL_BACKUP_DAYS` (tabulka v `docs/stripe.md`, oddíl 5). Dokud něco chybí, **build v produkci selže** a na webu by bylo [DOPLNIT].
- [ ] Údaje sedí s tím, co je ve Stripe (Public details) a na dokladech.
- [ ] Podmínky (`/podminky`) a zásady (`/soukromi`) přečetl právník, hlavně oddíly Odstoupení spotřebitele, Reklamace a Automatické obnovování.

## 7. Otevřít registraci

- [ ] `PUBLIC_SIGNUP_ENABLED=true` v Production, Redeploy.
- [ ] V anonymním okně na `https://gradusgo.com`: hlavní tlačítko je „Vyzkoušet zdarma“ (ne čekací listina), na `/cenik` vede tlačítko tarifu na registraci s vybraným tarifem.
- [ ] Registrace bez kódu chce zaškrtnout souhlas s podmínkami, přijde potvrzovací e-mail, po potvrzení je účet ve zkušebním období 14 dní a v Nastavení → Předplatné je „Vybraný tarif …, zaplatíš po zkušebce“.
- [ ] Administrace → Přehled bez žlutého varování o potvrzení e-mailu.

## 8. Ostrý zkušební nákup

Ostrý režim smí platit jen účet, který není interní a není @gradus.local; tvůj vlastní účet je interní, proto si na nákup založ nový účet s jinou svou adresou (třeba `ondrej+test@…`).

- [ ] Zaregistruj nový účet z webu, v Předplatném **Zaplatit a pokračovat**, zaplať **svou kartou** (Solo měsíčně stačí).
- [ ] Ve Stripe (ostrý režim) je platba, zákazník a předplatné; webhook doručen s 200.
- [ ] V Gradusu: tarif aktivní, v Historii plateb řádek s dokladem, doklad přišel e-mailem a má patičku „Nejsem plátce DPH.“ a tvoje údaje.
- [ ] Přišel ti souhrn o první platbě (denní souhrn plateb majiteli).
- [ ] **Vrať si peníze:** Stripe → Payments → detail platby → Refund (celá částka). V Historii plateb se řádek změní na **Vráceno**.
- [ ] Předplatné zkušebního účtu zruš (v Předplatném, nebo ve Stripe Cancel subscription), ať se příští měsíc nic nestrhne. Účet pak můžeš smazat v Nastavení → Soukromí a data.

Až je všechno odškrtnuté, zaškrtni v `docs/progress.md` položku 23.4.
