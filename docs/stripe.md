# Stripe: co nastavit v dashboardu

Platby předplatného běží přes Stripe (kroky 23.1 a 23.2). Většinu řeší kód, ale doklady, opakování neúspěšných plateb a e-maily zákazníkům se nastavují ručně v dashboardu Stripe, **zvlášť v testovacím a zvlášť v ostrém režimu** (přepínač Test mode vpravo nahoře). Názvy položek se v dashboardu občas mění; když něco nenajdeš, hledej v horním vyhledávání Stripe podle anglického názvu v závorce.

Co dělá Gradus a co Stripe:

| Věc | Kdo | Kde |
|---|---|---|
| Ceny, změna tarifu, zrušení, obnovení | Gradus | Nastavení → Předplatné (pravidla v `state.ts`) |
| Karta, fakturační adresa, seznam dokladů | Stripe Customer Portal | „Spravovat platební metodu a doklady“ v Předplatném |
| Doklad o platbě (číslo, údaje prodávajícího, PDF, e-mail) | Stripe Invoicing | nastavení níže |
| Opakování neúspěšné platby a e-maily o ní | Stripe (Smart Retries) | nastavení níže |
| Stav předplatného v Gradusu, banner „Platba se nepovedla“, režim jen pro čtení | Gradus z webhooku | `/api/stripe/webhook` |
| E-mail tobě o první platbě a o ukončení po posledním pokusu | Gradus, nejvýš 1× denně souhrnem | Resend, účty @gradus.local nic |

## 1. Customer Portal

Konfiguraci portálu dělá kód, ne dashboard: jen **změna karty**, **fakturační adresa** a **seznam dokladů**; změna tarifu, zrušení a pozastavení jsou vypnuté (řeší je Gradus podle svých pravidel).

1. Jednou pro každý režim spusť:
   ```bash
   bun run stripe:portal                              # testovací klíč z .env.local
   STRIPE_SECRET_KEY=sk_live_… bun run stripe:portal  # ostrý režim (klíč jen do příkazu, nikam ho neukládej)
   ```
   Vypíše `created`, `updated` nebo `kept` a id konfigurace (`bpc_…`). Je to bezpečné spouštět opakovaně. Když to nespustíš, aplikace konfiguraci založí sama při prvním otevření portálu.
2. Konfigurace se pozná podle metadat `app=gradus`, `portal=v1`. **Neměň ji v dashboardu** (Settings → Billing → Customer portal): při dalším spuštění by ji kód vrátil zpátky. Výchozí konfiguraci portálu Stripe Gradus nepoužívá.
3. Odkazy na podmínky a ochranu soukromí bere portál z `NEXT_PUBLIC_SITE_URL` (`/podminky`, `/soukromi`).

Pozor: fakturační adresu změněnou v portálu Gradus zpátky nenačítá. Když zákazník potom uloží Fakturační údaje v Gradusu, přepíšou ty ve Stripe.

## 2. Neúspěšné platby (Smart Retries a e-maily)

Settings → Billing → **Subscriptions and emails** (v novějším rozhraní Billing → **Revenue recovery**):

1. **Retries** (Manage failed payments): zapni **Smart Retries**, doporučeno „8 pokusů během 2 týdnů“ (výchozí návrh Stripe je v pořádku).
2. **If all retries for a payment fail → Subscription status: Cancel the subscription.** Tohle je důležité: Gradus pozná konec podle události `customer.subscription.deleted` a teprve pak přepne účet do režimu jen pro čtení. Při volbě „mark as unpaid“ by předplatné zůstalo navždy po splatnosti a účet by běžel dál.
3. **Invoice status** po posledním pokusu: „Mark the invoice as uncollectible“ (doklad zůstane v historii jako nezaplacený).
4. **Customer emails** (Settings → Billing → Subscriptions and emails → Manage failed payments, příp. Settings → Business → **Customer emails**):
   - zapni **Send emails when card payments fail** (e-mail o selhání s odkazem na zaplacení / změnu karty),
   - u odkazu v e-mailu vyber **Customer portal** (Use your customer portal), ať zákazník mění kartu tam, kde ji Gradus nabízí,
   - volitelně **Send reminders when cards are about to expire** (Expiring cards).
5. Během opakování má účet stav `past_due`: aplikace běží dál, majitel vidí nad obsahem banner „Platba se nepovedla, aktualizuj kartu“ s odkazem do portálu, pracovník nic. Jarvis to v rozhovoru jednou připomene. Jakmile projde opakování (`invoice.paid`), banner zmizí.
6. Po posledním neúspěšném pokusu Stripe předplatné zruší: v Gradusu skončí k tomu okamžiku (ne ke konci nezaplaceného období), účet je jen pro čtení jako po zkušebce, data se nemažou a „Zaplatit a pokračovat“ založí nové předplatné. Tobě přijde e-mail v denním souhrnu.

Vyzkoušení v testovacím režimu: karta `4000 0000 0000 0341` se k zákazníkovi připojí, ale každá platba selže. Opakování za 2 týdny jde zrychlit přes **Test clocks** (Billing → Subscriptions → Test clocks), nebo ručně: v detailu faktury Retry / v detailu předplatného Cancel subscription.

## 3. Doklady (Stripe Invoicing)

Doklad ke každé platbě vystavuje Stripe; Gradus ukazuje v Historii plateb odkaz Doklad (`hosted_invoice_url`). Nastav jednou pro každý režim:

1. **Údaje prodávajícího** — Settings → Business → **Public details** (Business name = tvoje jméno nebo firma, adresa sídla, e-mail a telefon podpory, **Terms of service URL** = `https://<doména>/podminky`; bez té URL Checkout nevyžádá souhlas s podmínkami). Totéž zkontroluj v Settings → Business → **Business details** (právní jméno a adresa, které jdou na doklad).
2. **IČO** — Settings → Billing → **Invoices** → Default custom fields (Invoice template): přidej pole `IČO` s hodnotou svého IČO. (IČO zákazníka doplňuje Gradus sám jako custom field zákazníka z Fakturačních údajů.)
3. **Patička** — tamtéž **Default footer**: `Nejsem plátce DPH.` (dokud nejsi plátce; DPH je vypnuté, `BILLING_VAT_MODE=none`, ceny katalogu jsou konečné).
4. **Číselná řada** — tamtéž **Invoice numbering**: „Sequentially across your account“ (jedna nepřerušená řada pro celý účet) a prefix, např. `GRADUS-`. Stripe čísluje sám a čísla nepřeskakuje; řada je oddělená od faktur, které vystavuješ v Gradusu svým zákazníkům.
5. **Jazyk** — doklad se vystaví v jazyce zákazníka: Gradus mu nastavuje `preferred_locales` podle jazyka aplikace (cs / en). Výchozí jazyk účtu (Settings → Business → Account details → Default language) dej Čeština.
6. **E-mail dokladu po platbě** — Settings → Business → **Customer emails**: zapni **Successful payments** (potvrzení s dokladem po každé platbě) a v Settings → Billing → Subscriptions and emails **Email finalized invoices to customers**. E-mail jde na adresu zákazníka ve Stripe = „E-mail pro doklady“ z Fakturačních údajů, jinak e-mail účtu.
7. **Vrácení peněz** — refundace v dashboardu (Payments → detail → Refund) celé platby přijde webhookem `charge.refunded` a v Historii plateb se řádek ukáže se stavem **Vráceno**. Částečná refundace stav nemění.

## 4. Webhook a klíče

- Endpoint `https://<doména>/api/stripe/webhook` (Developers → Webhooks), události: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`. Podpisové tajemství (`whsec_…`) do `STRIPE_WEBHOOK_SECRET`.
- Lokálně: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
- Produkce bere jen ostrý klíč (`sk_live_…`), vývoj a preview jen testovací; testovací režim mění jen interní účty a @gradus.local, ostrý jen ostatní.
- Denní cron `recurring-payments` srovná předplatná se Stripe (zmeškaný webhook) a pošle ti souhrn plateb, pokud ho ten den ještě neposlal webhook. V administraci → Uživatelé → detail → Předplatné je odkaz na zákazníka a předplatné ve Stripe a tlačítko **Srovnat se Stripe** (jen majitel).
- Ruční změna předplatného v administraci u účtu, který platí přes Stripe, Stripe nezmění a další událost ze Stripe ji přepíše. Takové předplatné měň ve Stripe, nebo ho nech změnit uživatele v Předplatném.

## 5. Podmínky a soukromí: co musíš doplnit ([DOPLNIT])

Obchodní podmínky (`/podminky`, `/en/terms`) a zásady ochrany osobních údajů (`/soukromi`, `/en/privacy`) mají od kroku 23.3 oddíly, které platby vyžadují: prodávající, zkušební období, cena a platba přes Stripe, automatické obnovování, zrušení předplatného, odstoupení spotřebitele do 14 dnů se souhlasem se začátkem služby, reklamace a Stripe mezi zpracovateli. Údaje o tobě v textu nejsou, berou se z proměnných prostředí. Dokud některá chybí, stránka na jejím místě ukáže **[DOPLNIT]** a **build v produkci (`VERCEL_ENV=production`) selže** s výpisem chybějících proměnných, takže se [DOPLNIT] nikdy neukáže zákazníkům. Ve vývoji a preview se stránky vykreslí i s [DOPLNIT].

Nastav ve Vercelu → Settings → Environment Variables → **Production** (a ideálně i Preview, ať náhledy sedí):

| Proměnná | Kde se ukáže | Příklad |
|---|---|---|
| `LEGAL_NAME` | prodávající v podmínkách, správce v zásadách | `Ondřej Otava` nebo název firmy |
| `LEGAL_COMPANY_ID` | IČO prodávajícího a správce | `12345678` |
| `LEGAL_ADDRESS` | sídlo prodávajícího a správce | `Ulice 1, 110 00 Praha 1` |
| `CONTACT_EMAIL` (jinak `OWNER_EMAIL`) | kontakt pro reklamace, odstoupení, osobní údaje a patička webu | `ahoj@gradusgo.com` |
| `LEGAL_BACKUP_DAYS` | za kolik dní smazaný účet zmizí ze záloh databáze (zásady, Jak dlouho je uchováváme) | `7` (Supabase Pro drží denní zálohy 7 dní; ověř ve svém tarifu Supabase) |

Změna se projeví až novým nasazením (stránky se generují při buildu). Údaje musí sedět s tím, co máš ve Stripe (Settings → Business → Public details) a na dokladech. Texty podmínek nese verze `TERMS_VERSION` (`src/config/legal.ts`); každá změna obsahu = nové datum, registrace ukládá, kterou verzi kdo přijal (`profiles.terms_version`). Před spuštěním je projde právník (na stránce je o tom poznámka).
