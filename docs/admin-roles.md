# Role v administraci

Do administrace (`/admin`) smí **majitel** (`owner`, právě jeden) a **administrátor** (`admin`), všichni za stejných podmínek: heslo + TOTP (aal2) + živá relace administrace (`admin_session_touch`, 30 min nečinnosti, 8 h celkem). Role jsou v `user_roles`, klient do ní nezapíše. Admina přidává jen pozvánka (`admin_invites`), odebírá ho jen majitel.

**Úrovně administrátora** (27.2, `user_roles.level`, `admin_invites.level`): **plný** smí všechno jako majitel kromě sekce Administrátoři (zvát, měnit úroveň, odebírat) a čehokoli, co by majitele odebralo nebo převedlo vlastnictví; **omezený** je dnešní chování (vidí všechno, nastavení jen čte, osobní údaje neexportuje). Úroveň volí majitel při pozvání a mění ji v sekci Administrátoři (`admin_set_level`); platí od dalšího požadavku, brána ji čte z DB pokaždé. Řádek admin bez úrovně = omezený, majitel je vždy plný. Stávající admin (Váša) je plný od migrace `20261120090000_admin_levels_error_log.sql`.

Co kdo nesmí, se mu **neukáže** (ne zašedne): sekce Administrátoři chybí v menu i v Nápovědě a ⌘K a vrací 404, formuláře nastavení u omezeného ukazují hodnoty jen ke čtení, tlačítka exportů s osobními údaji chybí. Server a databáze to vynucují i tak.

Pravidla v kódu: `src/features/admin/roles.ts` (`adminCan(actor, power)`, `mayExport`, `PERSONAL_DATA_EXPORTS`, mocnosti `AdminPower`; jen `manageAdmins` zůstává majiteli), stráž `requireAdminPower` / `adminAccessFor` v `server/guard.ts`, v databázi `admin_require_owner()` (= majitel **nebo plný admin**, jméno zůstalo, volají ho všechny zapisující funkce) a `admin_require_sole_owner()` (= jen majitel, sekce Administrátoři). **Nová akce nebo funkce administrace = nový řádek tady** a výchozí volba „majitel a plný admin“; jen majiteli patří jen správa administrátorů a vlastnictví.

Sloupce: **M** = majitel · **P** = plný administrátor · **O** = omezený administrátor. ✓ = smí, čte = vidí jen ke čtení, – = nevidí (404 / chybí v menu).

## Serverové akce a routy (`src/features/admin/server`, `src/app/(admin)`)

| Akce / routa | M | P | O | Poznámka |
|---|---|---|---|---|
| `mutations.toggleUserInternal` | ✓ | ✓ | ✓ | údržba metrik, žádná osobní data ven |
| `account-support-actions.sendPasswordReset`, `resendEmailConfirmation`, `signOutEverywhere` | ✓ | ✓ | ✓ | admin (obě úrovně) ne u účtu majitele ani jiného admina, nikdo u sebe (`accountSupportBlock`); povinný důvod, řádek v `admin_audit` (`users.password_reset` / `users.confirmation_resend` / `users.sign_out`, `detail` = `{ user, reason }`) ještě před akcí, nejvýš 5 e-mailů za hodinu na účet; odkaz jde jen do e-mailu |
| `account-support-actions.requestEmailChange` | ✓ | ✓ | – | `changeEmails`; omezenému se tlačítko neukáže a akce vrátí `forbidden`; u účtu majitele nikdy, u adminů jen majitel (`accountSupportBlock`, převod účtu), nikdo u sebe; důvod, audit `users.email_change` před akcí, odkaz jen do e-mailu na novou adresu |
| `auth/email-change-actions.confirmEmailChange` (stránka `/zmena-emailu`) | kdokoli s platným podepsaným odkazem | | | ověří, že ten, kdo změnu spustil, ji smí spustit i teď (role i úroveň); zapíše `users.email_change.confirmed` pod něj |
| `GET /admin/uzivatele/export` | ✓ | ✓ | – | jména a e-maily (`users` v `PERSONAL_DATA_EXPORTS`); omezenému 404 |
| `mutations.setFeatureRequestStatus` | ✓ | ✓ | ✓ | třídění zpětné vazby |
| `ai-caps-actions.saveAiCaps` | ✓ | ✓ | čte | stropy AI; po uložení e-mail ostatním (`notifyPeers`, `aiCaps`) |
| `ai-caps-actions.saveUserAiCap` | ✓ | ✓ | čte | výjimky AI; po uložení e-mail ostatním (`aiUserCap`) |
| `grady-rules-actions.saveGradyRules` | ✓ | ✓ | čte | pravidla Gradyho |
| `grady-models-actions.saveGradyModels` | ✓ | ✓ | čte | `editGradyModels`: model každé funkce, přednastavení, úsporný režim ručně, velké rozbory v chatu; DB ověří znovu (`admin_set_app_setting` `grady_models`), audit `settings.grady_models` z → na |
| `showcase-actions.saveShowcaseMode` | ✓ | ✓ | čte | `editShowcase`: ukázkový režim zapnout / vypnout; DB ověří znovu (`admin_set_app_setting` `showcase_mode`, `valid_showcase_mode`), audit `settings.showcase_mode` z → na |
| `calendar-sync-actions.*` | ✓ | ✓ | čte | `editCalendarSync`: kdo smí propojit Google a Apple kalendář (režim, datum, ručně přidané účty); DB ověří znovu (`admin_set_app_setting` `calendar_sync`, `valid_calendar_sync`), audit `settings.calendar_sync` |
| `POST /api/grady` `kind: rulesTest` a `kind: ping` | ✓ | ✓ | – | `testGrady`, jedno placené volání modelu; ostatním 404 |
| `POST /api/grady` `kind: modelCompare` (AI a Grady → Modely → Porovnat modely, 28.9) | ✓ | ✓ | – | `compareModels`: jeden vzorek jedné funkce na jednom modelu a krátké hodnocení (dvě placená volání, `model_compare` a `compare_judge`, z rozpočtu aplikace, ne z odpovědí tarifu); funkce, vzorek a model jen ze seznamů v kódu; každý běh do `admin_audit` (`ai.models.compare`); ostatním 404 |
| `plans-actions.savePlanDraft`, `discardPlanDraft`, `planCatalogImpact` | ✓ | ✓ | čte | koncept katalogu tarifů |
| `plans-actions.publishPlanCatalog`, `restorePlanVersion` | ✓ | ✓ | čte | zveřejnění a vrácení verze; po něm e-mail ostatním (`plansPublished` / `plansRestored`) |
| `promo-actions.savePromoCode`, `setPromoCodeActive` | ✓ | ✓ | ✓ | promo kódy partnerů; DB ověří znovu (`admin_promo_code_save` / `_set_active`), audit `settings.promo_codes` bez jména a e-mailu partnera |
| `promo-actions.setPayoutStatus` | ✓ | ✓ | čte | výplaty provizí (`managePayouts`) |
| `GET /admin/promo-kody/[id]/export` | ✓ | ✓ | – | jméno a e-mail partnera (`promo_payouts` v `PERSONAL_DATA_EXPORTS`) |
| `subscription-actions.saveUserSubscription` | ✓ | ✓ | čte | předplatné účtu ručně; u předplatného ve Stripe varuje, že ruční změna Stripe nezmění |
| `subscription-actions.syncUserSubscriptionWithStripe` | ✓ | ✓ | – | `editSubscriptions`, aal2, živá relace; řádek `admin_audit` `users.subscription_sync` před akcí |
| `error-alerts-actions.saveErrorAlerts`, `sendErrorAlertsTest` | ✓ | ✓ | čte | adresy a režim e-mailů o chybách, zkušební e-mail |
| `GET /api/admin-reports/new` („Obnovit · N nových“ v Hlášeních) | ✓ | ✓ | ✓ | jen počet hlášení od vykreslení, nepočítá se jako aktivita relace, bez `admin_audit` |
| `error-log-actions.setErrorGroupStatus` | ✓ | ✓ | ✓ | stav chyby v logu (Nová · Řeší se · Vyřešená · Ignorovat), třídění jako u zpětné vazby; admin klient po stráži, audit `errors.status` (zkrácený otisk, z → na) |
| `error-log-actions.setPeerNotices` | ✓ | ✓ | – | vlastní přepínač e-mailů „X změnil…“ (`peerNotices`, `admin_notify_prefs`), audit `admins.notify` |
| `export-actions.recordExport` (grafy, tabulky čísel) | ✓ | ✓ | ✓ | souhrnná čísla |
| `export-actions.recordExport` (`table.ai.top_users.csv`, `table.ai.top_spaces.csv`) | ✓ | ✓ | – | jména a id lidí / majitelů prostorů |
| `GET /admin/audit/export` | ✓ | ✓ | – | jména a id lidí v auditu; omezenému 404 |
| `admins-actions.createAdminInvite` (s úrovní), `sendAdminInviteEmail`, `revokeAdminInvite`, `setAdminLevel`, `removeAdmin` | ✓ | – | – | sekce Administrátoři; plný admin ani přes RPC (`admin_require_sole_owner`) |
| `login-actions.adminSignIn`, `startAdminEnrollment`, `verifyAdminCode`, `endAdminSession`, `adminHeartbeat` | ✓ | ✓ | ✓ | přihlášení a relace |
| `login-actions.adminInviteSignIn` (+ `startAdminEnrollment` / `verifyAdminCode` s pozvánkou) | držitel platné pozvánky | | | přijetí pozvánky |
| zápis pohledů do `admin_audit` (`logAdminAction`) | ✓ | ✓ | ✓ | každý pohled a export; audit ukazuje jméno toho, kdo akci udělal, nikdy roli |
| `GET /api/admin/widgets/<key>` (data widgetů přehledu, 29.2) | ✓ | ✓ | ✓ / – | widgety Peníze (tržby, platící podle tarifu, předplatné, neúspěšné platby, promo kódy a provize, náklady vs. tržby) jen M a P (`viewMoney`), omezenému 404 a v galerii chybí; stejné serverové dotazy jako sekce, nepočítá se jako aktivita relace, bez `admin_audit` (pohled přehledu se zapíše jednou při otevření stránky) |
| `GET /api/admin/errors/badge` (odznak nových chyb, titulek karty, zvonek) | ✓ | ✓ | ✓ | jen počet a posledních 5 nových skupin (kód, zpráva, stránka), nepočítá se jako aktivita, bez auditu |
| `dashboard/server/layout-actions.saveAdminLayout`, `createAdminLayout`, `renameAdminLayout`, `deleteAdminLayout`, `resetAdminMainLayout` | ✓ | ✓ | ✓ | vlastní záložky přehledu v `admin_dashboard_layouts` (jen server, admin klient po stráži, vždy `user_id` ze session), bez auditu (osobní rozložení) |
| `dashboard/server/layout-actions.setAdminDashboardDefault` | ✓ | ✓ | – | `setDashboardDefault`: výchozí přehled pro nové administrátory (`app_settings.admin_dashboard_default` přes `admin_set_app_setting`, audit `settings.admin_dashboard_default` s počty widgetů) |

## Stránky

| Stránka | M | P | O | Poznámka |
|---|---|---|---|---|
| Přehled, Růst, Aktivace, Retence, Funkce, Hra, Náklady, Zdraví, Zpětná vazba, Uživatelé, Průzkumník, Audit, Nápověda (`/admin/napoveda`) | ✓ | ✓ | ✓ | Nápověda a ⌘K ukazují jen to, co dotyčný smí (`helpFor`) |
| Přehled (`/admin`, plocha widgetů, 29.2) | ✓ | ✓ | ✓ | každý si skládá vlastní záložky; widgety Peníze jen M a P (`viewMoney`), omezený je nemá ani ve výchozím rozložení; „Výchozí pro nové administrátory“ jen M a P; widget Rychlé akce ukazuje Zveřejnit tarify jen s `editPlans`, Čeká na mě výplaty provizí jen s `managePayouts` a koncept tarifů jen s `editPlans` |
| Provoz → Chyby (`/admin/chyby`, log) | ✓ | ✓ | ✓ | seznam, detail s výskyty, e-maily a hlášeními, změna stavu; jen technická data |
| Provoz → Chyby → Upozornění e-mailem (`?tab=alerts`, dřív `/admin/upozorneni`, přesměruje) | ✓ | ✓ | čte | adresy, režim, zkušební e-mail; karta E-maily o změnách jen M a P |
| AI a Grady — karta stropů | ✓ | ✓ | čte | pod kartou „Naposledy změnil(a) jméno, datum“ |
| AI a Grady — karta Vyzkoušet připojení | ✓ | ✓ | – | |
| AI a Grady → Pravidla (`/admin/ai?tab=rules`) | ✓ | ✓ | čte | „Vyzkoušet“ jen M a P |
| AI a Grady → Modely (`/admin/ai?tab=models`) | ✓ | ✓ | čte | tabulka funkcí s útratou a odhady vidí všichni, výběr modelů, přednastavení a přepínače jen M a P; karta Kde ušetřit vidí všichni, Použít jen M a P; Porovnat modely jen M a P (`compareModels`) |
| AI a Grady — karta Cena Gradyho na uživatele (28.9) | ✓ | ✓ | ✓ | `admin_ai_efficiency()` za období z horní lišty, jen čísla |
| AI a Grady — export nejnákladnějších uživatelů a prostorů | ✓ | ✓ | – | |
| Detail uživatele — karta Účet a Hlášení | ✓ | ✓ | ✓ | akce podpory podle tabulky výše (Změnit e-mail jen M a P), jinak věta, kdo účet spravuje |
| Uživatelé — sloupec E-mail | ✓ | ✓ | ✓ | Export CSV jen M a P |
| Detail uživatele — výjimka AI | ✓ | ✓ | čte | |
| Detail uživatele — Předplatné | ✓ | ✓ | čte | odkazy do Stripe a poslední platby vidí všichni, „Srovnat se Stripe“ jen M a P |
| Tarify — Účty na tarifech | ✓ | ✓ | ✓ | |
| Tarify (`/admin/tarify`) | ✓ | ✓ | čte | upravuje a zveřejňuje M a P, omezený čte zveřejněnou verzi a historii |
| Promo kódy (`/admin/promo-kody`, detail) | ✓ | ✓ | ✓ / čte | kódy zakládají, upravují a deaktivují všichni; výplaty schvaluje, označuje a exportuje jen M a P |
| Zpětná vazba — karta Záznam chyby (hledání podle kódu) | ✓ | ✓ | ✓ | |
| Zpětná vazba → Hlášení (seznam, filtry, detail, změna stavu, „Obnovit · N nových“) | ✓ | ✓ | ✓ | všichni vidí totéž; snímek obrazovky v detailu jen M a P (`viewScreenshots`), omezený vidí, že je přiložen |
| Administrátoři (`/admin/administratori`) | ✓ | – | – | plnému i omezenému 404, v menu chybí |
| Modely AI (27.3), Jazyky | ✓ | ✓ | čte / – | až vzniknou: zápis přes `admin_require_owner()` a `adminCan` jako ostatní nastavení |
| Ukázkový režim (`/admin/ukazka`, 27.4) | ✓ | ✓ | čte | přepínač `app_settings.showcase_mode` mění M a P (`editShowcase`, `admin_set_app_setting` s aal2), omezený vidí stav; se zapnutým režimem mají ukázku v aplikaci (`/app/ukazka`, karta v tutoriálu) majitel i admin obou úrovní |
| Integrace (`/admin/integrace`, 28.10) | ✓ | ✓ | čte | `app_settings.calendar_sync` mění M a P (`editCalendarSync`, `admin_set_app_setting` s aal2), omezený vidí stav bez ovládání; Zdraví má kartu Proměnné prostředí (jen jestli jsou nastavené, nikdy hodnoty) |
| Koš Gradyho a připojených aplikací (AI a Grady → Pravidla, 28.8) | ✓ | ✓ | čte | `app_settings.trash_retention` (1–90 dní, výchozí 7) mění M a P (`editGradyRules`, `admin_set_app_setting` s aal2), omezený vidí hodnotu |
| `/admin/prihlaseni`, `/admin/pozvanka/<token>` | kdokoli | | | stránka sama ověřuje heslo, roli nebo token |

## Funkce v databázi (SECURITY DEFINER `admin_*` a související)

| Funkce | M | P | O | Poznámka |
|---|---|---|---|---|
| `admin_session_touch` | ✓ | ✓ | ✓ | (aal2) vrací `role` a `level` (majitel `full`, admin bez úrovně `limited`) |
| `admin_session_end` | ✓ | ✓ | ✓ | jen vlastní relace |
| `admin_require_owner` | | | | jen uvnitř funkcí: propustí M a P s živou relací a aal2; bez práva EXECUTE pro klienty |
| `admin_require_sole_owner` | | | | jen uvnitř funkcí sekce Administrátoři: jen M; bez EXECUTE pro klienty |
| `admin_set_app_setting` | ✓ | ✓ | – | `admin_require_owner()`; klíče `ai_caps`, `error_alerts` (audit bez adres; režimy off · critical · digest · every, výchozí off), `jarvis_rules`, `grady_models`, `showcase_mode`, `trash_retention`, `calendar_sync`, `admin_dashboard_default` (audit jen počty widgetů) |
| `admin_set_ai_user_cap` | ✓ | ✓ | – | totéž |
| `admin_invite_create` (`_level` full / limited, výchozí limited) | ✓ | – | – | ukládá jen SHA-256 tokenu, audit `admins.invite` s úrovní |
| `admin_invite_revoke` | ✓ | – | – | audit |
| `admin_set_level` | ✓ | – | – | nikdy majitele ani sebe, jen držitele role admin; audit `admins.level` z → na |
| `admin_remove` | ✓ | – | – | nikdy majitele ani sebe; ukončí živé relace admina, audit |
| `admin_invite_claim` | účet právě založený na stránce pozvánky (stačí aal1) | | | zabere pozvánku jedním podmíněným UPDATE |
| `admin_invite_accept` | pozvaný účet s aal2 | | | spotřebuje token a přidělí roli **s úrovní pozvánky** v jedné transakci, audit |
| `admin_plan_catalog_save_draft`, `_discard_draft`, `_publish`, `_restore` (+ `_full` varianty s doplňky) | ✓ | ✓ | – | `admin_require_owner()`, advisory lock, audit `settings.plans` |
| `plan_catalog_impact`, `plan_overage`, `published_plan` | | | | jen service role (server po stráži) |
| `admin_subscription_set` | ✓ | ✓ | – | `admin_require_owner()`, audit `users.subscription` |
| `admin_promo_code_save`, `admin_promo_code_set_active` | ✓ | ✓ | ✓ | živá relace s aal2; audit `settings.promo_codes` |
| `admin_partner_payout_set_status` | ✓ | ✓ | – | `admin_require_owner()`; audit `settings.promo_payouts` |
| `admin_promo_code_stats`, `admin_promo_code_users` | | | | jen service role (server po stráži) |
| `promo_check`, `promo_redeem`, `promo_account_status`, `promo_code_state` | | | | jen service role (server, uživatel ze session) |
| `admin_plan_user_counts` | | | | jen service role (server po stráži) |
| `admin_members` (s `level`), `admin_people`, `metric_admin_users` | | | | jen service role (server po stráži); čtou `auth.users` |
| `admin_user_sign_out` | | | | jen service role (server po stráži a auditu) |
| `admin_email_taken` | | | | jen service role (server po stráži) |
| `error_event_record`, `error_alert_claim`, `error_alert_digest_claim`, `purge_error_events` | | | | jen service role (server); bez klientského přístupu |
| `admin_error_groups`, `admin_error_group_reports` | | | | jen service role (server po stráži): skupiny logu chyb podle otisku a hlášení s kódem skupiny |
| `admin_error_overview`, `admin_error_badge`, `admin_users_at_risk` | | | | jen service role (server po stráži): čísla widgetů Chyby a Uživatelé v ohrožení a odznak nových chyb |
| `error_alert_critical`, `error_alert_critical_place` | | | | jen service role, uvnitř `error_alert_claim` v režimu „jen kritické“ |
| `error_events_reopen_group` (trigger) | | | | vyřešená chyba, která se objeví znovu, je zase Nová s `returned_at` („vrátila se“); ignorovaná zůstane |
| `admin_bug_report_list`, `admin_bug_report_set_status`, `admin_bug_reports` | | | | jen service role (server po stráži); M, P i O |
| `bug_report_create`, `bug_report_support` | | | | jen service role (server) |
| `app_overview` | | | | v aplikaci, ne v administraci; beze změny |

Tabulky jen pro server (bez pravidel a grantů): `admin_dashboard_layouts` (záložky přehledu administrátora, 29.2), `admin_invites`, `admin_notify_prefs` (přepínač e-mailů o změnách), `error_groups` (stav chyby v logu), `error_events`, `error_alert_sends` (nově `to_emails`: komu e-mail o chybě šel, adresy z nastavení upozornění).

## E-mail „X změnil…“

Když majitel nebo plný admin zveřejní tarify (i vrácení verze), změní strop AI nebo výjimku AI, dostanou ostatní, kdo totéž smí (majitel a plní admini, kromě toho, kdo změnu udělal), e-mail se jménem autora a odkazem na stránku a audit (`server/peer-notices.ts`, pravidla `peerRecipients` v `peer-notices.ts`, Vitest). Vypíná si ho každý sám v Provoz → Chyby → Upozornění e-mailem → E-maily o změnách. Změna testovacího účtu (@gradus.local) dojde jen jiným testovacím účtům. Běží po odpovědi, selhání se jen zaloguje.

## Životní cyklus pozvánky

1. **Vytvoření** (`admin_invite_create`): majitel dostane odkaz `/admin/pozvanka/<token>`, v DB je jen SHA-256 tokenu. Pozvánka není svázaná s e-mailem.
2. **Nový účet** (`adminInviteSignIn`, režim „Nový účet“): server ověří, že pozvánka je otevřená a nikdo ji ještě nezabral, založí účet, přihlásí ho a tímto účtem zavolá `admin_invite_claim`. Když ji mezitím zabral jiný účet, právě založený účet se hned smaže a odpověď je tatáž neutrální hláška jako u neplatného odkazu. Přes jednu pozvánku tak vznikne nejvýš jeden nový účet. Smazáním zabírajícího účtu se pozvánka zase uvolní (`on delete set null`).
3. **Přihlášení k existujícímu účtu** (režim „Mám účet“): nic nezabírá ani nekontroluje `claimed_by`, takže návrat na odkaz dokončí přerušené TOTP.
4. **Přijetí** (`admin_invite_accept`, po TOTP s aal2): spotřebuje token a přidělí roli v jedné transakci. Pak už odkaz nefunguje pro nikoho.
5. **Zrušení / vypršení** (7 dní): odkaz nefunguje, zabrání se nemění.

Limit pokusů: neplatný nebo zabraný odkaz, existující e-mail i špatné heslo se počítají do téhož zámku (5 neúspěchů za 15 minut podle IP i e-mailu → 15 minut pauza). Hláška „e-mail už existuje“ se tak ukáže jen pár krát za sebou.
