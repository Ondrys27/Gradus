# E-maily, které Gradus posílá

Všechny e-maily aplikace odcházejí jedním místem, `sendEmail()` v `src/lib/email/resend.ts` (přímo, přes `deliverEmail()` v `src/lib/email/e2e-outbox.ts`, nebo přes `deliverBookingMail()` v `src/features/scheduler/server/mail.ts`). Každé odeslání nese povinný `kind` a zapíše se do `email_log` (druh, otisk příjemce, čas, stav). Widget administrace „E-maily“ ukazuje dnešek a měsíc proti limitu Resendu: zdarma 3 000 měsíčně a 100 denně, Pro 50 000 měsíčně. Adresy z vyhrazených domén (`example.com`, `.test` …) se nikdy neposílají, e2e-…@gradus.local mimo produkci zachytí mock.

Dokument jen popisuje dnešní stav a navrhuje úspory. V kódu se nic nemění, rozhodne majitel (oddíl 5).

## 1. Přehled druhů

Odhady jsou měsíční. „Uživatel“ = aktivní majitel prostoru. Předpoklady: 25 % nových účtů měsíčně, třetina uživatelů posílá faktury (~4 měsíčně), třetina má plánovač (~6 rezervací), čtvrtina má tým. Výchozí typ schůzky má 2 připomínky (24 h a 1 h, `DEFAULT_REMINDERS`), každou hostovi i hostiteli.

| Druh | Kdy se posílá | Komu | Odhad za měsíc | Soubor |
|---|---|---|---|---|
| `auth_confirmation` | Registrace s potvrzováním e-mailu (od 27.1 posílá aplikace, ne Supabase) a „Poslat odkaz znovu“, nejvýš 1× za minutu na účet | uživatel | ~0,3 na uživatele (nové účty + občas znovu) | `src/features/auth/server/confirmation.ts` |
| `account_support` | Administrace → detail uživatele: reset hesla, nové potvrzení, změna e-mailu (na novou adresu); ručně, nejvýš 5 za hodinu na účet | uživatel | 0–5 celkem | `src/features/admin/server/account-support-actions.ts` |
| `admin_login` | Každé přihlášení do administrace (heslo + TOTP, ne krok zálohy) | administrátor, který se přihlásil | ~20 na administrátora | `src/features/admin/server/login-email.ts` |
| `admin_invite` | Majitel ručně pošle pozvánku administrátora e-mailem | pozvaný | ~0 | `src/features/admin/server/admins-actions.ts` |
| `admin_peer_notice` | Zveřejnění nebo vrácení tarifů, změna stropu AI nebo výjimky uživatele; vypnutelné v `admin_notify_prefs` | ostatní z majitele a plných adminů | ~2–5 na administrátora | `src/features/admin/server/peer-notices.ts` |
| `admin_digest` | Souhrn „Gradus včera“ (30.1): cron `admin-digest` jednou denně, Resend `scheduled_at` na 6:00 v pásmu administrátora (nastavitelné), jeden na člověka a den (`admin_digest_sends`), volba „jen když je co hlásit“, ukázka z nastavení nejvýš 5 za hodinu | každý administrátor | 30 na administrátora (méně s volbou) | `src/features/admin/digest/server/send.ts` |
| `error_alert` | Zachycená chyba podle režimu `off` (výchozí od 29.2) / `critical` / `digest` / `every`; stejná chyba nejvýš 1× za 15 min, nejvýš 30 za hodinu, digest denně v 7:00 UTC, zkušební nejvýš 5/h; každá adresa zvlášť (až 10) | adresy z nastavení | 0 při `off`; při `every` až stovky | `src/features/errors/alerts/server/dispatch.ts` |
| `ai_budget` | Od prahu upozornění jednou „úsporný režim“ za měsíc, pak stav jednou denně (`near_limit`); při 100 % nebo vyčerpaném kreditu jednou denně `paused` (`jarvis_budget_alerts`) | majitel aplikace | 0 běžně; 10–20 v měsíci nad prahem | `src/features/grady/server/budget.ts` |
| `billing_alert` | Webhook Stripe zapíše první platbu účtu nebo předplatné zrušené po posledním pokusu; nejvýš 1 e-mail denně, zbytek pošle cron `recurring-payments` | majitel aplikace | 0–30 (dny s událostí) | `src/features/billing/owner-alerts-server.ts` |
| `plan_request` | Každá žádost o změnu tarifu v Předplatném (i se Stripe), nejvýš 1× za hodinu na osobu, tarif a období; @gradus.local nic | majitel aplikace | ~0,1 na uživatele | `src/features/plan/server-interest.ts` |
| `feature_request` | Haiku v chatu Gradyho pozná nápad na funkci; každý nápad, bez stropu | majitel aplikace | ~0,1 na uživatele | `src/features/grady/server/feature-requests.ts` |
| `bug_report_owner` | Každé hlášení problému (aplikace, ⌘⇧B) i veřejný formulář podpory `/api/support`; strop 20 hlášení za hodinu na účet | majitel aplikace | ~0,3 na uživatele v betě, později ~0,1 | `src/features/feedback/server/notify.ts` |
| `bug_report_thanks` | První stav „Opraveno“ u hlášení, jednou | autor hlášení | ~0,1 na uživatele | `src/features/feedback/server/notify.ts` |
| `welcome_beta` | Registrace s beta kódem nebo pozvánkou pracovníka | nový tester / pracovník | ~0,1 na uživatele (jen beta) | `src/features/feedback/server/notify.ts` |
| `waitlist_confirm` | Zápis na čekací listinu (jen bez veřejné registrace), opakovaně jen po pauze `mayResend` | návštěvník webu | podle webu, po spuštění registrace ~0 | `src/features/marketing/waitlist-actions.ts` |
| `worker_invite` | Pozvánka pracovníka na krátké ID / e-mail (existující účet i odkaz na registraci), „Poslat znovu“; nejvýš 30 e-mailů za hodinu na majitele | pracovník | ~0,1 na uživatele | `src/features/workers/server/invites.ts` (`mailInvite`) |
| `worker_left` | Pracovník sám odejde z firmy | majitel prostoru | ~0,02 na uživatele | `src/features/workers/server/invites.ts` (`mailInvite`) |
| `chat_notification` | Přímá zpráva nebo @zmínka, příjemce 10 min bez heartbeatu, nejvýš 1× za hodinu na příjemce (`chat_email_claim`), vypnutelné | člen konverzace | ~2 na uživatele (jen týmy, ~8 na člena týmu) | `src/features/chat/server/notify.ts` |
| `invoice` | „Poslat e-mailem“ u vystavené faktury, PDF v příloze, volitelná kopie sobě (`ccSelf`) | klient (+ kopie uživateli) | ~1,3 na uživatele, s kopií až 2,6 | `src/features/invoices/server/send.ts` |
| `contact_email` | Uživatel píše kontaktu z aplikace (i návrh od Gradyho), s přílohami; **bez stropu** | kontakt | ~5 na uživatele, jednotlivci i 100+ | `src/features/email/actions.ts` |
| `booking_guest` | Rezervace: potvrzeno / čeká na schválení / schváleno / odmítnuto / zrušeno / přesunuto / nový odkaz na schůzku, s .ics | host (klient) | ~2,5 na uživatele | `src/features/scheduler/server/bookings.ts`, `booking-emails.ts` |
| `booking_host` | Nová rezervace, žádost o schválení, host zrušil nebo přesunul | hostitel (uživatel) | ~2,2 na uživatele | `src/features/scheduler/server/bookings.ts` |
| `booking_reminder` | Každá připomínka typu schůzky, zvlášť hostovi a hostiteli, naplánovaná v Resendu (`scheduledAt`, do 30 dní; dál dosadí denní cron), přesun i zrušení je zruší | host i hostitel | ~8 na uživatele (4 na rezervaci) | `src/features/scheduler/server/bookings.ts`, `booking/reminders.ts` |

**Mimo kód aplikace, ale možná stejný účet Resend:**
- **Supabase Auth** přes Resend SMTP (`docs/supabase-email.md`): dnes posílá jen obnovu hesla z formuláře „Zapomenuté heslo“ (`resetPasswordForEmail`), potvrzení registrace už posílá aplikace a magic link / pozvánky Supabase se nepoužívají (`generateLink` nic neposílá). Počítá se do stejné kvóty účtu Resend (jiný API klíč, stejný účet). ~0,05 na uživatele. V `email_log` není.
- **Stripe** posílá vlastní e-maily (doklady o platbě, neúspěšná platba a Smart Retries, končící karta) svou poštou, ne Resendem. Do limitu se nepočítají.

## 2. Odhad celkem

Na aktivního uživatele vychází ~22 e-mailů měsíčně: rezervace ~13 (z toho připomínky 8), `contact_email` ~5, faktury ~1,3–2,6, chat ~2, zbytek pod 1. Administrace se 2 administrátory přidá ~120 měsíčně (`admin_digest` 60, `admin_login` 40, ostatní do 20); e-maily majiteli aplikace (`bug_report_owner`, `feature_request`, `plan_request`) rostou s uživateli.

| Scénář | Uživatelé | Administrace | Celkem za měsíc | Průměr za den | Proti Resend zdarma |
|---|---|---|---|---|---|
| 50 uživatelů | ~1 100 | ~150 | **~1 250** | ~42 | vejde se do 3 000; denních 100 může přetéct ve špičce |
| 200 uživatelů | ~4 400 | ~200 | **~4 600** | ~150 | nad měsíčním i denním limitem, nutný Pro nebo úspory |
| 1 000 uživatelů | ~22 000 | ~400 | **~22 400** | ~750 | jen Pro (50 000) |

Převažují: `booking_reminder` (~35 %), `contact_email` (~22 %), `booking_guest` + `booking_host` (~20 %), `invoice` (~8 %), `chat_notification` (~8 %).

**Denní strop 100 je větší riziko než měsíční.** Po jeho vyčerpání Resend odmítne i potvrzení registrace, faktury klientům a potvrzení rezervací. Špičky: jeden uživatel rozešle desítky `contact_email` za den (strop žádný), připomínky se plánují dopředu a odejdou ve dni schůzek (pondělí ráno, hromadné termíny), chat se zmínkami v týmu, `error_alert` v režimu `every` při výpadku (až 30 za hodinu × počet adres).

## 3. Doporučení, kde ušetřit

Seřazeno podle úspory.

1. **`booking_reminder` hostiteli vypnout nebo jen jednu** (hostitel má schůzku v kalendáři aplikace a Grady ji má v souhrnu dne). Úspora ~4 na uživatele, ~18 % všeho. Riziko: hostitel, který aplikaci neotevře, zapomene; zmírní to ponechat hostiteli jen připomínku 1 h.
2. **Výchozí připomínka hostovi jen jedna (24 h)**, 1 h jen na vyžádání v typu schůzky. Úspora ~2 na uživatele, ~9 %. Riziko: víc nedorazivších hostů; dá se měřit přes `no_show_at`.
3. **`booking_host` nahradit zvonkem a bublinou Gradyho**, e-mail jen pro „čeká na schválení“ a jen když hostitel 10 min neposlal heartbeat (jako chat). Úspora ~1,5 na uživatele, ~7 %. Riziko: hostitel mimo aplikaci se o rezervaci dozví později.
4. **`contact_email` denní strop na účet** (např. 50 za den, nad ním hláška). Průměr to nesníží, ale chrání denní limit všech ostatních. Dlouhodobě posílat ze schránky uživatele (vlastní SMTP / Gmail), mimo naši kvótu. Riziko: omezí uživatele, kteří aplikací rozesílají nabídky.
5. **`invoice` kopie sobě ve výchozím stavu vypnutá** (PDF je v aplikaci). Úspora až ~1,3 na uživatele, ~5 %. Ověřit, zda Resend počítá kopii (`cc`) jako další e-mail; pokud ne, úspora je nulová a nechat. Faktura klientovi zůstává.
6. **`chat_notification` nejvýš jeden souhrn denně místo za hodinu**, případně jen přímé zprávy, ne @zmínky ve skupinách. Úspora ~1 na uživatele, ~4 %. Riziko: pomalejší odpovědi v týmu; heartbeat (jen nepřítomným) už platí.
7. **Do `admin_digest` sloučit** `bug_report_owner`, `feature_request`, `plan_request`, `billing_alert`, `admin_peer_notice` a denní stav `ai_budget` (`near_limit`). Okamžitě nechat jen `ai_budget` `paused` / vyčerpaný kredit a jednorázové „úsporný režim“. Úspora ~0,5 na uživatele + ~40 za měsíc v administraci. Riziko: zpoždění až 24 h; v betě je okamžité hlášení chyb od testerů užitečné (vrátit do digestu po betě, nebo ho v betě nechat zvlášť). `plan_request` se Stripe ztratil smysl, informace je v Předplatném i ve Stripe.
8. **`admin_login` jen z nového zařízení nebo adresy**, ostatní jen v auditu a v `admin_digest`. Úspora ~30 za měsíc. Riziko: slabší bezpečnostní signál; nové zařízení zůstává e-mailem, takže malé.
9. **`welcome_beta` spojit s `auth_confirmation`**, když se e-mail potvrzuje (uvítání v potvrzovacím e-mailu). Úspora ~0,1 na uživatele. Riziko nízké.
10. **`worker_invite` pro existující účet** jen když pozvaný 10 min nepracoval v aplikaci (zvonek a bublina Gradyho už existují). Úspora malá. Pozvánka na e-mail bez účtu zůstává.
11. **`error_alert` nechat `off` nebo `critical`**, nikdy `every` na víc adres. Úspora: zabrání špičce, která sebere denní limit.

**Nechat beze změny (povinné transakční):** `auth_confirmation`, obnova hesla Supabase, `account_support`, `admin_invite`, `invoice` klientovi, `booking_guest` (potvrzení, zrušení, přesun), `waitlist_confirm` (dvojí souhlas), `worker_invite` na e-mail bez účtu, `bug_report_thanks` (jednou, levné).

**Bez programování:** při ~150 aktivních uživatelích nebo prvním dni nad 80 e-maily přejít na Resend Pro (50 000 měsíčně, bez denního stropu 100). Body 1–3 dohromady ušetří ~1/3 objemu a přechod oddálí zhruba na dvojnásobek uživatelů.

## 4. Rozhodne majitel

- [ ] Hostiteli vypnout připomínky schůzek (1), nebo nechat jen 1 h?
- [ ] Výchozí připomínky hostovi jen 24 h (2)?
- [ ] E-mail hostiteli o nové rezervaci jen když není v aplikaci, a jen při schvalování (3)?
- [ ] Denní strop `contact_email` na účet (4)? Kolik?
- [ ] Kopie faktury sobě ve výchozím stavu vypnutá (5)? (napřed ověřit, zda Resend počítá `cc`)
- [ ] Chat: souhrn nejvýš jednou denně místo za hodinu (6)?
- [ ] Sloučit e-maily majiteli aplikace do `admin_digest` (7)? Hlášení problémů v betě nechat okamžitě?
- [ ] Zrušit `plan_request` úplně (Stripe ho nahradil)?
- [ ] `admin_login` jen z nového zařízení (8)?
- [ ] `admin_digest` ve výchozím stavu „jen když je co hlásit“?
- [ ] Spojit uvítání bety s potvrzením e-mailu (9)?
- [ ] Při jaké hranici (měsíc / den) přejít na Resend Pro?
