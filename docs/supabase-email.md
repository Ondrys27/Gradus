# E-maily přihlašování přes Resend

Supabase bez vlastního SMTP pošle jen pár e-mailů za hodinu a jen členům týmu projektu — testerům by nedošlo obnovení hesla ani potvrzení e-mailu. Tenhle postup přepojí Supabase Auth na Resend SMTP a nahraje šablony ve vzhledu Gradusu (česky i anglicky v jedné šabloně).

Potřebuješ: přístup do Supabase (projekt `windrrvugkpzrvpkdpgu`), účet Resend a vlastní doménu.

## 1. Doména v Resendu

1. Resend → **Domains** → **Add Domain** → zadej doménu (doporučeně subdoménu, např. `mail.<doména>`), region **EU (Ireland)**.
2. U registrátora domény přidej DNS záznamy, které Resend ukáže (SPF `TXT`, DKIM `TXT`, `MX` pro návratovou adresu). Volitelně DMARC: `TXT _dmarc.<doména>` = `v=DMARC1; p=none;`.
3. Počkej, až je doména **Verified** (obvykle do hodiny).
4. Stejnou doménu použij i v proměnné `RESEND_FROM` aplikace (Vercel → Settings → Environment Variables), např. `Gradus <no-reply@mail.<doména>>`.

## 2. API klíč pro Supabase

1. Resend → **API Keys** → **Create API Key**.
2. Název `supabase-auth`, oprávnění **Sending access**, doména jen ta ověřená.
3. Klíč (`re_…`) si zkopíruj, Resend ho ukáže jen jednou. Je to jiný klíč než `RESEND_API_KEY` aplikace; když ho budeš měnit, nerozbiješ tím druhý.

## 3. SMTP v Supabase

Supabase → **Authentication → Emails → SMTP Settings** → zapni **Enable Custom SMTP** a vyplň:

| Pole | Hodnota |
|---|---|
| Sender email | `no-reply@mail.<doména>` (musí být na ověřené doméně) |
| Sender name | `Gradus` |
| Host | `smtp.resend.com` |
| Port number | `465` |
| Minimum interval between emails being sent | `60` (sekund, výchozí) |
| Username | `resend` |
| Password | API klíč z kroku 2 |

Ulož (**Save changes**).

## 4. Limity

- Supabase → **Authentication → Rate Limits** → **Rate limit for sending emails**: po zapnutí vlastního SMTP je výchozí 30 za hodinu pro celý projekt. Pro betu nastav `100`.
- Resend zdarma: 100 e-mailů denně, 3 000 měsíčně. Na betu stačí; e-maily aplikace (faktury, upozornění na chyby, uvítání) se počítají do stejného limitu.

## 5. Šablony

Supabase → **Authentication → Emails → Templates**. Šablona umí jen jeden text pro všechny, proto každá obsahuje češtinu i angličtinu a vybírá podle `user_metadata.locale` účtu (nastavuje ho registrace; účty bez něj dostanou češtinu).

U každé ze tří šablon vlož **Subject** a **Message body** (záložka Source, přepsat celý obsah):

| Šablona v Supabase | Message body (celý soubor) | Subject |
|---|---|---|
| Confirm signup | `docs/email-templates/confirm-signup.html` | 2. řádek bloku „Confirm signup“ v `docs/email-templates/subjects.txt` |
| Reset Password | `docs/email-templates/reset-password.html` | 2. řádek bloku „Reset Password“ |
| Change Email Address | `docs/email-templates/change-email.html` | 2. řádek bloku „Change Email Address“ |

Ostatní šablony (Invite user, Magic Link, Reauthentication) aplikace nepoužívá, nech je být.

Soubory `*.cs.html` a `*.en.html` jsou jen náhledy jednoho jazyka (otevři je v prohlížeči). Šablony se generují z překladů (`email.auth` v `src/locales/*.json`) příkazem `bun scripts/email-templates.ts`; ručně je neupravuj, test hlídá, že sedí s kódem.

Odkazy v šablonách vedou na `/auth/confirm?token_hash=…&type=…` — fungují v jakémkoli prohlížeči (výchozí odkaz Supabase jen v tom, kde uživatel o e-mail požádal):

- potvrzení: `type=email`, pak `/app`
- obnova hesla: `type=recovery`, pak `/nove-heslo` (anglicky `/en/reset-password`)
- změna e-mailu: `type=email_change`, pak `/app`

Platnost odkazu: **Authentication → Emails → Email OTP Expiration** nech na `3600` sekund (šablona obnovy hesla říká „platí hodinu“).

## 6. Adresy

Supabase → **Authentication → URL Configuration**:

- **Site URL**: produkční adresa, např. `https://<doména>` (šablony z ní skládají odkaz).
- **Redirect URLs**: `https://<doména>/auth/confirm` a pro vývoj `http://localhost:3000/auth/confirm`. Přesné adresy, bez hvězdiček.

Ve Vercelu ať `NEXT_PUBLIC_SITE_URL` ukazuje na stejnou adresu.

## 7. Zapnutí potvrzování e-mailu

Supabase → **Authentication → Sign In / Providers → Email** → zapni **Confirm email**. Zároveň nech zapnuté **Secure email change** a vypnuté **Allow new users to sign up** (účty zakládá jen server aplikace).

Aplikace přepínač čte sama (`/auth/v1/settings`, `src/features/auth/email-confirmation.ts`, nejvýš minutu stará hodnota), nic dalšího se nemění:

- **Registrace** s potvrzováním založí účet nepotvrzený (s pozvánkou, betou i nastavením), Supabase pošle e-mail „Confirm signup“ a formulář místo přihlášení ukáže „Zkontrolujte e-mail“ s tlačítkem Poslat odkaz znovu.
- **Přihlášení** nepotvrzeného účtu ukáže „E-mail zatím není potvrzený“ a tlačítko Poslat odkaz znovu (odpověď neprozradí, jestli účet existuje).
- **Klik na odkaz** účet potvrdí, přihlásí a pošle do aplikace (průvodce novým účtem). Použitý nebo vypršelý odkaz vede na přihlášení s hláškou, že si může poslat nový.
- **Existující účty** jsou potvrzené už od založení, nic se jim nemění.

## 8. Kontrola

1. Na přihlášení klikni Zapomenuté heslo a zadej svůj e-mail. Do minuty musí přijít „Gradus: obnova hesla“ v češtině, odesílatel `Gradus <no-reply@…>`, tlačítko vede na `https://<doména>/auth/confirm?...type=recovery` a otevře Nové heslo.
2. Totéž s účtem registrovaným anglicky (z `/en/register`): e-mail musí přijít anglicky. Jazyk šablony se řídí jazykem při registraci, ne pozdější změnou v Nastavení. Adresy `@gradus.local` doručit nejdou, použij skutečnou.
3. Se zapnutým potvrzováním zaregistruj nový účet na svou druhou adresu s pozvánkovým kódem: formulář ukáže „Zkontrolujte e-mail“, přijde „Gradus: potvrď svůj e-mail“, odkaz tě přihlásí do průvodce. Zkus se přihlásit ještě před klikem: musí přijít hláška o nepotvrzeném e-mailu.
4. Resend → **Emails**: všechny tři e-maily jsou ve stavu Delivered.

## Když něco nejde

- **V předmětu jsou vidět složené závorky** (`{{ $en := false }}…`): Supabase předmět jako šablonu nevyhodnotil. Vlož místo něj pevný předmět z řádku `cs:` v `subjects.txt`.
- **Nepřišel potvrzovací e-mail po registraci**: Supabase → **Logs → Auth** (hledej `/resend`). Kdyby Supabase odmítal posílat potvrzení kvůli vypnutým registracím, přihlášení nepotvrzeného účtu nabídne Poslat odkaz znovu; účet se dá potvrdit i ručně v Authentication → Users → … → Confirm email.
- **E-mail skončil ve spamu**: zkontroluj v Resendu, že doména má zelené SPF i DKIM, a přidej DMARC.
- **Odkaz vede na localhost**: Site URL v kroku 6.
