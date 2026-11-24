# Google Kalendář: nastavení a ověření u Googlu

## 1. Co to je a proč

Od kroku 28.10 umí Gradus obousměrně propojit Google Kalendář: čte obsazené časy pro plánovač schůzek, ukazuje události z Googlu v kalendáři Gradusu a zapisuje do Googlu, co uživatel založí nebo změní v Gradusu. Gradus k tomu žádá Google o přístup ke kalendáři, a protože jde o citlivá data, musí aplikaci před spuštěním pro všechny **ověřit Google**. Do té doby funguje propojení jen pro vybrané účty a testovací uživatele.

Rozsah ověření: `calendar.events` je **citlivý** (sensitive) rozsah, ne omezený (restricted). Omezené jsou jen Gmail, Disk, Fit, Chat a pár dalších. Ověření proto znamená ověření značky a zdůvodnění rozsahů s videem, **bez bezpečnostního auditu (CASA)** a bez placení. Google uvádí, že kontrola citlivých rozsahů trvá zhruba 3–5 pracovních dní, počítej ale s rezervou až 2 týdny.

Gradus žádá **jen tyhle dva rozsahy**, nic víc (žádný e-mail ani profil):

| Rozsah | Co uživatel uvidí na souhlasu |
|---|---|
| `https://www.googleapis.com/auth/calendar.events` | View and edit events on all your calendars |
| `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | See the list of Google calendars you're subscribed to |

Plus offline přístup (refresh token), aby synchronizace běžela i bez otevřené aplikace.

Tři fáze:

| Fáze | Stav v Google Cloud | Kdo se propojí | Omezení |
|---|---|---|---|
| A. Beta | Testing | testovací uživatelé (nejvýš 100), v Gradusu jen povolené účty | propojení vyprší po 7 dnech, uživatel se musí propojit znovu |
| B. Čeká na ověření | In production, „Needs verification“ | totéž, v Gradusu pořád jen povolené účty | Google ukáže varování „Google hasn't verified this app“, nejvýš 100 nových uživatelů; propojení už nevyprší |
| C. Ověřeno | In production, ověřeno | všichni | žádné |

## 2. Postup krok za krokem

Všechno děláš v [Google Cloud Console](https://console.cloud.google.com) pod Google účtem, kterým se pak ověří i doména. Konzole má nastavení OAuth v sekci **Google Auth Platform** (levé menu: Overview, Branding, Audience, Clients, Data Access, Verification Center). Když něco nenajdeš, napiš anglický název do horního vyhledávání.

### 2.1 Projekt a Calendar API

1. Vpravo nahoře u výběru projektu → **New project**. Název `Gradus`, organizaci nech, jak je. Create.
2. Ověř, že je nový projekt vybraný (název nahoře).
3. **APIs & Services → Library** → najdi **Google Calendar API** → **Enable**.

### 2.2 Doména v Search Console

Google musí vědět, že `gradusgo.com` je tvoje. Udělej to hned, ověření značky bez toho neprojde.

1. Otevři [Google Search Console](https://search.google.com/search-console) **stejným Google účtem**, který je vlastník (Owner) projektu v Cloud Console.
2. Add property → **Domain** → `gradusgo.com`.
3. Search Console ukáže TXT záznam (`google-site-verification=…`). Přidej ho v DNS u registrátora domény (tam, kde máš `gradusgo.com`, případně ve Vercelu → Domains, pokud DNS spravuje Vercel).
4. Zpátky v Search Console **Verify**. DNS se může projevit až za pár hodin, pak to zkus znovu.

### 2.3 Branding (jak se aplikace představí)

**Google Auth Platform → Branding:**

1. **App name:** `Gradus`
2. **User support email:** tvoje adresa (stejná jako `CONTACT_EMAIL`, jinak `OWNER_EMAIL` ve Vercelu). Musí to být adresa tvého Google účtu nebo skupiny, kterou spravuješ.
3. **App logo:** čtvercové logo, 120 × 120 px, PNG nebo JPG, do 1 MB. Logo spouští ověření značky; když ho změníš později, ověřuje se znovu.
4. **App domain:**
   - Application home page: `https://gradusgo.com/en`
   - Application privacy policy link: `https://gradusgo.com/en/privacy`
   - Application terms of service link: `https://gradusgo.com/en/terms`

   (Anglické verze, protože tým Googlu čte anglicky. Musí to být stejná doména a domovská stránka musí mít viditelný odkaz na zásady: v patičce webu je „Privacy“, zkontroluj ho na `https://gradusgo.com/en` bez přihlášení.)
5. **Authorized domains:** `gradusgo.com`
6. **Developer contact information:** tvůj e-mail. Sem Google posílá všechno k ověření, sleduj ho.
7. Save. Ověření značky spustíš až později (oddíl 3), teď stačí uložit.

### 2.4 Audience (kdo smí aplikaci používat)

**Google Auth Platform → Audience:**

1. **User type: External.**
2. **Publishing status** nech zatím **Testing**.
3. **Test users → Add users:** přidej Google e-mail každého, kdo má v betě propojit kalendář (začni sebou). Nejvýš **100** adres. Kdo tu není, uvidí „Access blocked“.

Pravidla fáze Testing, která musíš znát:

- Testovací uživatel uvidí před souhlasem varování, že aplikace není ověřená; klikne na **Continue**.
- **Propojení vyprší 7 dní po souhlasu.** Platí to i pro refresh token, takže synchronizace se po týdnu zastaví a uživatel musí v Gradusu dát **Propojit** znovu. Řekni to testerům dopředu. Skončí to, až aplikaci zveřejníš (fáze B).

### 2.5 Data Access (rozsahy)

**Google Auth Platform → Data Access → Add or remove scopes:**

1. Do filtru napiš `calendar.events` a zaškrtni přesně `https://www.googleapis.com/auth/calendar.events` (ne `calendar.events.readonly`, ne `calendar.events.owned`, ne celé `calendar`).
2. Do filtru napiš `calendarlist` a zaškrtni `https://www.googleapis.com/auth/calendar.calendarlist.readonly`.
3. **Update**, pak **Save**.
4. Konzole rozsahy rozdělí do skupin. `calendar.events` bude mezi **Your sensitive scopes**. Kdyby tam byl i `calendarlist.readonly`, nevadí: zdůvodnění v oddílu 3 máš pro oba.
5. Nic dalšího nepřidávej. Aplikace o jiné rozsahy nežádá a Google by se ptal, proč je máš.

### 2.6 OAuth klient

**Google Auth Platform → Clients → Create client:**

1. **Application type: Web application**, název `Gradus web`.
2. **Authorized JavaScript origins:** nech prázdné (přihlášení ke Googlu běží přes server).
3. **Authorized redirect URIs**, každou zvlášť přes **Add URI**:
   - `https://gradusgo.com/api/integrations/google/callback`
   - `http://localhost:3000/api/integrations/google/callback` (vývoj na počítači)
   - jen pokud doména ještě neběží: aktuální produkční adresa Vercelu, např. `https://<projekt>.vercel.app/api/integrations/google/callback`

   Aplikace pošle Googlu tu adresu, která odpovídá `NEXT_PUBLIC_SITE_URL` daného prostředí. Musí sedět znak po znaku (https, žádné lomítko na konci). Adresu `vercel.app` po spuštění domény smaž, k ověření ji Google nepustí, protože doména `vercel.app` není tvoje.
4. **Create.** Hned zkopíruj **Client ID** a **Client secret** (nebo stáhni JSON). Tajemství potom konzole celé neukáže; když ho ztratíš, přidáš v detailu klienta nové a staré smažeš.

### 2.7 Proměnné ve Vercelu

Vercel → Project → Settings → **Environment Variables**:

| Proměnná | Hodnota | Prostředí |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Client ID (`….apps.googleusercontent.com`) | Production, Preview, Development |
| `GOOGLE_CLIENT_SECRET` | Client secret (`GOCSPX-…`) | Production, Preview, Development |
| `INTEGRATIONS_ENCRYPTION_KEY` | 32 náhodných bajtů | Production, Preview, Development, **všude stejná** |

Ke klíči `INTEGRATIONS_ENCRYPTION_KEY`:

- Tímhle klíčem Gradus šifruje (AES-256-GCM) přístupové tokeny ke Googlu a tajné adresy odebíraných kalendářů. Po odstranění Fakturoidu z Vercelu zmizel a **je potřeba ho přidat zpátky**.
- Vygeneruj ho v Terminálu: `openssl rand -base64 32`
- Databáze je jedna pro vývoj i produkci, proto musí být **stejný ve všech prostředích**, jinak náhled nepřečte, co zapsala produkce. Pokud už klíč máš v `.env.local` na počítači (kvůli odebíraným kalendářům), dej do Vercelu ten samý; jinak vygeneruj nový a požádej Claude Code, ať ho zapíše i do `.env.local`.
- Klíč už potom neměň. Změna = všichni uživatelé musí Google i odebírané kalendáře propojit znovu.
- Ulož si ho do správce hesel.

Proměnné jsou jen pro server, nikdy s předponou `NEXT_PUBLIC_`. Po uložení dej **Deployments → poslední nasazení → Redeploy**, jinak se neprojeví.

### 2.8 Vyzkoušet v Gradusu

1. Přihlas se do Gradusu účtem, který smí propojit kalendář (založený před nasazením kroku 28.10, nebo přidaný v administraci, viz 2.9).
2. **Nastavení → Kalendář → Google Kalendář → Propojit s Googlem.**
3. Vyber Google účet (musí být v Test users), u varování o neověřené aplikaci **Continue**, potvrď oba rozsahy.
4. Zpátky v Gradusu vyber kalendáře, ze kterých se čte (obsazenost pro plánovač a zobrazení v kalendáři Gradusu), a jeden kalendář, do kterého se zapisuje.
5. Kontrola: událost z Googlu je v kalendáři Gradusu; událost založená v Gradusu je za chvíli v Google Kalendáři; změna v Googlu se do Gradusu propíše sama (Google posílá upozornění na `https://gradusgo.com/api/integrations/google/push`, kanály obnovuje denní cron).
6. Když se objeví „Propojení kalendářů teď není dostupné“, chybí některá proměnná, viz oddíl 6.

### 2.9 Povolit další účty

Do ověření je propojení zapnuté jen pro účty založené před nasazením kroku 28.10 a pro účty, které přidáš ručně:

1. **Administrace → Nastavení → Integrace** (`/admin/integrace`) → přidej účet.
2. Jeho **Google e-mail** (ten, kterým se bude propojovat, nemusí být stejný jako e-mail v Gradusu) přidej v Google Cloud do **Audience → Test users**. Bez toho Google ukáže „Access blocked“.

Ostatní uživatelé mají dál odebírané kalendáře přes tajnou adresu iCal.

## 3. Co poslat Googlu k ověření

Ověření se podává ve dvou krocích: nejdřív značka (Branding), potom přístup k datům (Data Access) ve **Verification Center**. Než začneš, musí být hotové:

- [ ] doména `gradusgo.com` ověřená v Search Console (2.2)
- [ ] web běží na `https://gradusgo.com`, domovská stránka je veřejná, popisuje Gradus a má v patičce odkaz na zásady
- [ ] zásady ochrany osobních údajů mají oddíl o Google Kalendáři a větu o Limited Use (3.4)
- [ ] ukázkové video na YouTube (oddíl 4)
- [ ] v klientovi zůstala jen redirect URI na `gradusgo.com` a `localhost`

### 3.1 Ověření značky

1. **Branding** → zkontroluj údaje z 2.3 → **Verify branding**.
2. Automatická kontrola trvá obvykle pár minut, ruční 2–3 pracovní dny. Během ní nejde Branding upravovat (jen přes Cancel).
3. Když se ukáže **Ready to publish**, klikni **Publish branding** do 7 dnů, jinak se ověřuje znovu.

### 3.2 Zveřejnit aplikaci (fáze B)

Google přijme žádost o ověření citlivých rozsahů jen u aplikace, která už není v Testing.

1. **Audience → Publish app** → potvrď. Stav bude **In production** a u citlivých rozsahů „Needs verification“.
2. Co se tím změní: propojení už po 7 dnech nevyprší. Uživatelé uvidí obrazovku „Google hasn't verified this app“ a pokračují přes **Advanced → Go to gradusgo.com (unsafe)**. Google pustí nejvýš 100 nových uživatelů, dokud ověření neprojde.
3. V Gradusu nech přepínač na povolených účtech (`/admin/integrace`). Pro všechny ho zapneš až po ověření.

### 3.3 Žádost o ověření rozsahů

**Verification Center** (nebo Data Access → **Prepare for verification**). Vyplň:

| Pole | Hodnota |
|---|---|
| App name | Gradus |
| Logo | stejné jako v Branding |
| Homepage | `https://gradusgo.com/en` |
| Privacy policy | `https://gradusgo.com/en/privacy` |
| Terms of service | `https://gradusgo.com/en/terms` |
| Authorized domains | `gradusgo.com` |
| Support e-mail | `CONTACT_EMAIL` (jinak `OWNER_EMAIL`) |
| Demo video | odkaz na neveřejné (Unlisted) video na YouTube |
| Odkazy na dokumentaci (až 3) | `https://gradusgo.com/en`, `https://gradusgo.com/en/pricing` |

Zdůvodnění rozsahů vlož anglicky. Texty jsou připravené ke zkopírování:

**`https://www.googleapis.com/auth/calendar.events`**

```text
Gradus is a web app that helps beginning entrepreneurs run their business: tasks, sales pipeline, contacts, a calendar and a meeting scheduler (a public booking page where clients book meetings with the user). The user connects Google Calendar in Settings → Calendar → Google to keep both calendars in sync.

We use calendar.events to:
1. Read events from the calendars the user selects, to show them in the Gradus calendar and to compute busy times so the user's booking page never offers a time that is already taken.
2. Write to the one calendar the user selects: events the user creates or changes in Gradus are created or updated in Google Calendar immediately, and events that came from Google can be edited in Gradus and are written back.
3. Create an event for each meeting booked through the Gradus scheduler, with the guest as an attendee and, if the user enables it, a Google Meet link (conferenceData).
4. Keep the data current with incremental sync (syncToken) and push notifications (events.watch) to our HTTPS endpoint.

All of these are visible, user-initiated features. The user can disconnect at any time; we then revoke the token at Google and delete the imported events from Gradus.
```

**`https://www.googleapis.com/auth/calendar.calendarlist.readonly`**

```text
After connecting, Gradus shows the user the list of their Google calendars so they can choose which calendars to read (for busy times and display in Gradus) and which single calendar Gradus writes to. calendar.calendarlist.readonly is the narrowest scope that returns the list of calendars the user owns or is subscribed to, with their names, colors and access roles. We only read the list; we never add, remove or change calendars.
```

**Proč nestačí užší rozsahy** (vlož k `calendar.events`, pole „Why are narrower scopes insufficient“, nebo na konec zdůvodnění):

```text
Narrower scopes do not cover the feature:
- calendar.events.readonly cannot create or update events, so meetings booked in Gradus and events created in Gradus could not be written to Google Calendar.
- calendar.events.owned only covers calendars the user owns. Many of our users run their schedule in a shared team or business calendar owned by a colleague or the company; they need busy times from it and need Gradus to write booked meetings into it.
- calendar.freebusy / calendar.events.freebusy only return busy intervals. They cannot show events in the Gradus calendar, cannot edit them, and cannot create the booked meeting with the guest and the Meet link.
- calendar.app.created only works with secondary calendars created by the app, not with the user's existing calendars, which is where their real schedule lives.
We do not request the full calendar scope: Gradus never changes calendar sharing, settings or calendars themselves.
```

**Prohlášení o nakládání s daty** (pokud se formulář ptá na užití dat, nebo do odpovědi na e-mail od Googlu):

```text
Data use: Google Calendar data is used only to provide the calendar sync and meeting scheduler features visible in Gradus. Access and refresh tokens are stored encrypted (AES-256-GCM) on our servers. We never sell the data, never use it for advertising, and never use it to train or improve AI or machine learning models. Gradus includes an AI assistant (Grady, built on the Anthropic API); when the user asks the assistant about their schedule inside their own account, the relevant calendar events are sent to the Anthropic API only to generate that answer for that user. This is a user-facing feature, disclosed in our privacy policy, and Anthropic does not use API data to train its models. Humans do not read the data except with the user's explicit permission (for example a support request), for security, or to comply with the law. Disconnecting deletes the tokens and the imported events from Gradus and revokes access at Google.

Gradus's use and transfer of information received from Google APIs to any other app will adhere to Google API Services User Data Policy, including the Limited Use requirements.
```

### 3.4 Co musí být v zásadách ochrany osobních údajů

Google kontroluje, že zásady na webu popisují přesně to, co aplikace s daty z Googlu dělá, a že je na webu věta o Limited Use. Texty zásad jsou v `src/locales/cs.json` a `src/locales/en.json` pod `marketing.legal` (zásady = `privacy`). **Požádej Claude Code**, ať přidá do zásad nový oddíl „Google Kalendář“ s těmito texty (v souborech se místo „Gradus“ píše `{appName}`, kontakt přes `{email}`) a zvýší `TERMS_VERSION`:

Česky (`/soukromi`):

> **Google Kalendář.** Když si v Gradusu propojíš Google Kalendář, získáme od Googlu s tvým souhlasem přístup k událostem tvých kalendářů a k seznamu tvých kalendářů. Používáme je jen k tomu, co v aplikaci vidíš: ukazujeme události z kalendářů, které vybereš, počítáme z nich obsazené časy pro tvou rezervační stránku a do jednoho vybraného kalendáře zapisujeme události založené nebo upravené v Gradusu a schůzky z plánovače (s hostem jako účastníkem a případně s odkazem na Google Meet). Přístupové tokeny ukládáme šifrovaně. Když se na kalendář zeptáš Gradyho, pošleme potřebné události společnosti Anthropic jen k tomu, aby ti odpověděl. Data z Googlu neprodáváme, nepoužíváme k reklamě ani k trénování umělé inteligence. Po odpojení smažeme tokeny i události převzaté z Googlu (v Google Kalendáři zůstane vše) a přístup u Googlu zrušíme; zrušit ho můžeš i sám na myaccount.google.com/permissions.
>
> Používání a předávání informací získaných z Google API do jakékoli jiné aplikace se v Gradusu řídí zásadami Google API Services User Data Policy, včetně požadavků Limited Use.

Anglicky (`/en/privacy`):

> **Google Calendar.** When you connect Google Calendar in Gradus, Google gives us, with your consent, access to the events in your calendars and to the list of your calendars. We use them only for features you see in the app: we show events from the calendars you choose, compute busy times for your booking page from them, and write events you create or change in Gradus and meetings booked through the scheduler (with the guest as an attendee and, optionally, a Google Meet link) to the one calendar you choose. Access tokens are stored encrypted. When you ask Grady about your calendar, we send the relevant events to Anthropic only to answer you. We never sell data from Google and never use it for advertising or to train artificial intelligence. When you disconnect, we delete the tokens and the events imported from Google (everything stays in Google Calendar) and revoke our access at Google; you can also revoke it yourself at myaccount.google.com/permissions.
>
> Gradus's use and transfer of information received from Google APIs to any other app will adhere to Google API Services User Data Policy, including the Limited Use requirements.

Odkaz na zásady Googlu u druhého odstavce: `https://developers.google.com/terms/api-services-user-data-policy`.

## 4. Scénář ukázkového videa

Požadavky Googlu: video na YouTube jako **Unlisted** (neveřejné), celý průběh od přihlášení po použití každého rozsahu, souhlasná obrazovka Googlu **celá a v angličtině** (jazyk vlevo dole na obrazovce Googlu přepni na English), v adresním řádku musí být vidět **client_id**, ukázat se musí stejná aplikace a značka jako v žádosti. Komentář nebo titulky pomáhají.

Příprava:

- Gradus přepni do angličtiny (Settings → language), ať je celé video anglicky.
- Testovací Google účet bez soukromých událostí, přidaný v Test users; v Google Kalendáři 2–3 smyšlené události na tento týden.
- Gradus účet povolený v `/admin/integrace`, s nastaveným plánovačem (typ schůzky „Intro call“, 30 min, místo Google Meet).
- Druhé okno prohlížeče (anonymní) pro hosta na rezervační stránce.
- Nahrávej celou obrazovku (QuickTime → Nový záznam obrazovky), prohlížeč s viditelným adresním řádkem, zvětšení stránky klidně 110 %.

Délka zhruba 3–4 minuty. Titulky / komentář anglicky:

| # | Čas | Co je na obrazovce | Titulek / komentář |
|---|---|---|---|
| 1 | 0:00 | `https://gradusgo.com/en`, posun k patičce s odkazem Privacy | „This is Gradus, a web app for beginning entrepreneurs. Our privacy policy is linked here.“ |
| 2 | 0:15 | Přihlášení do Gradusu e-mailem a heslem | „I sign in to Gradus with a test account.“ |
| 3 | 0:25 | Settings → Calendar → Google → **Connect** | „In Settings, Calendar, I connect Google Calendar.“ |
| 4 | 0:35 | Obrazovka Googlu, výběr účtu. **Zastav se na adresním řádku a zvětši ho (⌘ +), ať je čitelné `client_id=…apps.googleusercontent.com`.** | „The browser address bar shows our OAuth client ID.“ |
| 5 | 0:50 | Jazyk vlevo dole = English. Souhlasná obrazovka s názvem Gradus a oběma rozsahy; pomalu ji celou ukaž, pak **Continue / Allow** | „The consent screen shows the app name Gradus and the two scopes we request: view and edit events on all your calendars, and see the list of your calendars.“ |
| 6 | 1:10 | Zpět v Gradusu: seznam kalendářů, zaškrtnout kalendáře ke čtení a vybrat jeden k zápisu | „calendarlist.readonly: Gradus lists my calendars. I choose which ones to read and the one calendar Gradus writes to.“ |
| 7 | 1:30 | Kalendář Gradusu s událostí z Googlu; vedle Google Kalendář se stejnou událostí | „calendar.events (read): an event from Google Calendar appears in the Gradus calendar.“ |
| 8 | 1:45 | V Gradusu změnit čas nebo název té události, přepnout do Google Kalendáře, obnovit | „calendar.events (write): I edit the event in Gradus and the change is written back to Google Calendar.“ |
| 9 | 2:05 | V Gradusu založit novou událost, ukázat ji v Google Kalendáři | „A new event created in Gradus is created in Google Calendar right away.“ |
| 10 | 2:20 | Scheduler → rezervační stránka v anonymním okně; den s událostí z Googlu nemá v tu dobu volný termín | „Busy times from Google Calendar are respected on the public booking page.“ |
| 11 | 2:40 | Host si rezervuje termín (jméno, testovací e-mail) | „A guest books a meeting.“ |
| 12 | 2:55 | Google Kalendář: nová událost, host mezi účastníky, odkaz Google Meet | „The booking creates a Google Calendar event with the guest as an attendee and a Google Meet link.“ |
| 13 | 3:15 | Settings → Calendar → Google → **Disconnect** → potvrdit; kalendář Gradusu bez událostí z Googlu | „Disconnect revokes access at Google and removes the imported events from Gradus. Google Calendar keeps all events.“ |
| 14 | 3:30 | Volitelně myaccount.google.com/permissions bez Gradusu | „Gradus no longer has access.“ |

Nahraj na YouTube (YouTube Studio → Create → Upload), viditelnost **Unlisted**, a odkaz vlož do žádosti. Pokud Google video vrátí, opravené pošli jako odpověď na jejich e-mail.

## 5. Po ověření

1. Ve Verification Center je stav ověřeno a v Audience **In production** bez upozornění. Zkontroluj na anonymním okně s Google účtem, který není v Test users: souhlasná obrazovka bez varování „not verified“.
2. **Administrace → Nastavení → Integrace** (`/admin/integrace`) → **Zapnout pro všechny.** Od té chvíle propojí Google Kalendář každý účet.
3. Na Test users už nezáleží. Seznam můžeš nechat, nebo vyčistit; ruční seznam povolených účtů v Gradusu nemusíš udržovat.
4. Testerům, kterým propojení během fáze Testing vypršelo, napiš, ať se propojí jednou znovu.
5. Nic v Brandingu ani rozsazích neměň bez potřeby: nový rozsah, jiné logo nebo název = nové ověření. Pokud by aplikace někdy potřebovala další rozsah, nejdřív se domluv s Claude Code a počítej s novou žádostí.

## 6. Časté potíže

| Co vidíš | Proč | Co udělat |
|---|---|---|
| Google: **Access blocked: Gradus has not completed the Google verification process** (Error 403: access_denied) | aplikace je v Testing a Google účet není v Test users | Audience → Test users → přidat přesně ten Google e-mail, kterým se uživatel propojuje |
| Google: **Error 400: redirect_uri_mismatch** | adresa, kterou poslal Gradus, není v klientovi | Clients → Gradus web → Authorized redirect URIs: přidat přesně `<NEXT_PUBLIC_SITE_URL>/api/integrations/google/callback` (https, bez lomítka na konci); zkontroluj `NEXT_PUBLIC_SITE_URL` ve Vercelu daného prostředí |
| Synchronizace se po týdnu zastaví, v logu `invalid_grant` | ve fázi Testing vyprší propojení 7 dní po souhlasu | uživatel dá v Gradusu Propojit znovu; natrvalo to vyřeší Publish app (3.2) |
| `invalid_grant` i po zveřejnění | uživatel zrušil přístup v Google účtu nebo změnil heslo / smazal účet | uživatel propojí znovu |
| Gradus: **„Propojení kalendářů teď není dostupné“** | ve Vercelu chybí `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` nebo `INTEGRATIONS_ENCRYPTION_KEY`, nebo nasazení neproběhlo po jejich přidání | Administrace → **Zdraví** ukáže, co chybí; doplň ve Vercelu a dej Redeploy |
| Tokeny nejdou přečíst, všichni musí propojit znovu | `INTEGRATIONS_ENCRYPTION_KEY` se změnil nebo se liší mezi prostředími | vrať původní klíč ze správce hesel; všude stejná hodnota |
| Uživatel v Gradusu nemá tlačítko Propojit | účet není povolený (založený po nasazení 28.10) | přidat v `/admin/integrace` |
| Google: **„Google hasn't verified this app“** | fáze B, aplikace je zveřejněná, ale ještě neověřená | očekávané; Advanced → Go to gradusgo.com (unsafe). Zmizí po ověření |
| Změny z Googlu se do Gradusu dostanou až za dlouho | push upozornění nechodí (v logu `Unauthorized WebHook callback channel` nebo kanál vypršel) | zkontroluj, že je `gradusgo.com` ověřená v Search Console stejným účtem, který vlastní projekt; denní cron kanály obnovuje a synchronizace dožene změny při dalším běhu |
| Branding nejde upravit | běží ověření značky | Branding → Cancel, upravit, znovu Verify branding |

---

Zdroje (ověřeno 24. 11. 2026):

- Sensitive scope verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- Brand verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
- Verification requirements: https://support.google.com/cloud/answer/13464321
- Submitting your app for verification: https://support.google.com/cloud/answer/13461325
- Demo video: https://support.google.com/cloud/answer/13804565
- Manage App Audience (Testing, 100 test users, 7 dní): https://support.google.com/cloud/answer/15549945
- Unverified apps (limit 100 nových uživatelů): https://support.google.com/cloud/answer/7454865
- Restricted scopes (Calendar mezi nimi není): https://support.google.com/cloud/answer/13464325
- Google API Services User Data Policy (Limited Use): https://developers.google.com/terms/api-services-user-data-policy
- Google Workspace API User Data and Developer Policy (zákaz trénování AI): https://developers.google.com/workspace/workspace-api-user-data-developer-policy
- Calendar API scopes: https://developers.google.com/workspace/calendar/api/auth
- Calendar push notifications: https://developers.google.com/workspace/calendar/api/guides/push
