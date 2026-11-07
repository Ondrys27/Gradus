# Role v administraci

Do administrace (`/admin`) smí **majitel** (`owner`, právě jeden) a **administrátor** (`admin`), oba za stejných podmínek: heslo + TOTP (aal2) + živá relace administrace (`admin_session_touch`, 30 min nečinnosti, 8 h celkem). Role jsou v `user_roles`, klient do ní nezapíše. Admina přidává jen pozvánka (`admin_invites`), odebírá ho jen majitel.

Co admin nesmí, se mu **neukáže** (ne zašedne): sekce Administrátoři chybí v menu a vrací 404, formuláře stropů AI nahrazují hodnoty jen ke čtení, tlačítka exportů s osobními údaji chybí. Server a databáze to vynucují i tak.

Pravidla v kódu: `src/features/admin/roles.ts` (`adminCan`, `mayExport`, `PERSONAL_DATA_EXPORTS`), stráž `requireOwnerFor` / `adminAccessFor` v `server/guard.ts`, v databázi `admin_require_owner()`.

## Serverové akce a routy (`src/features/admin/server`, `src/app/(admin)`)

| Akce / routa | Kdo | Proč |
|---|---|---|
| `mutations.toggleUserInternal` | owner + admin | údržba metrik, žádná osobní data ven |
| `account-support-actions.sendPasswordReset`, `resendEmailConfirmation`, `signOutEverywhere`, `requestEmailChange` | owner + admin; admin ne u účtu majitele ani jiného admina, nikdo u sebe (`accountSupportBlock`) | podpora z detailu uživatele; povinný důvod, řádek v `admin_audit` (`users.password_reset` / `users.confirmation_resend` / `users.sign_out` / `users.email_change`, `detail` = `{ user, reason }`) ještě před akcí, nejvýš 5 e-mailů za hodinu na účet; odkaz jde jen do e-mailu, nikdy do administrace ani auditu |
| `GET /admin/uzivatele/export` | owner | seznam účtů se jmény a e-maily (`users` v `PERSONAL_DATA_EXPORTS`); adminovi 404 |
| `auth/email-change-actions.confirmEmailChange` (stránka `/zmena-emailu`) | kdokoli s platným podepsaným odkazem | nová adresa potvrdí změnu, kterou spustila administrace; zapíše `users.email_change.confirmed` pod toho, kdo změnu spustil |
| `mutations.setFeatureRequestStatus` | owner + admin | třídění zpětné vazby |
| `ai-caps-actions.saveAiCaps` | owner | stropy AI; admin je vidí jen ke čtení |
| `ai-caps-actions.saveUserAiCap` | owner | výjimky AI; admin je vidí jen ke čtení |
| `jarvis-rules-actions.saveJarvisRules` | owner | pravidla Jarvise (přepínače typů a otázek, časování, Pokyny pro Jarvise); admin je vidí jen ke čtení |
| `POST /api/jarvis` `kind: rulesTest` | owner (aal2, živá relace) | „Vyzkoušet“ u pravidel, jedno placené volání modelu; ostatním 404 |
| `plans-actions.savePlanDraft`, `discardPlanDraft`, `planCatalogImpact`, `publishPlanCatalog`, `restorePlanVersion` | owner | katalog tarifů; admin vidí zveřejněnou verzi a historii jen ke čtení |
| `subscription-actions.saveUserSubscription` | owner | předplatné účtu ručně (tarif, období, stav, konec, zrušení); admin ho vidí jen ke čtení |
| `error-alerts-actions.saveErrorAlerts`, `sendErrorAlertsTest` | owner | adresy a režim e-mailů o chybách, zkušební e-mail; admin nastavení jen čte |
| `export-actions.recordExport` (grafy, tabulky čísel) | owner + admin | souhrnná čísla |
| `export-actions.recordExport` (`table.ai.top_users.csv`) | owner | jména a id uživatelů |
| `GET /admin/audit/export` | owner | jména a id lidí v auditu; adminovi 404 |
| `admins-actions.createAdminInvite` | owner | sekce Administrátoři |
| `admins-actions.sendAdminInviteEmail` | owner | sekce Administrátoři |
| `admins-actions.revokeAdminInvite` | owner | sekce Administrátoři |
| `admins-actions.removeAdmin` | owner | sekce Administrátoři |
| `login-actions.adminSignIn`, `startAdminEnrollment`, `verifyAdminCode`, `endAdminSession`, `adminHeartbeat` | owner + admin | přihlášení a relace |
| `login-actions.adminInviteSignIn` (+ `startAdminEnrollment` / `verifyAdminCode` s pozvánkou) | držitel platné pozvánky | přijetí pozvánky |
| zápis pohledů do `admin_audit` (`logAdminAction`) | owner + admin | každý pohled a export |

## Stránky

| Stránka | Kdo |
|---|---|
| Přehled, Růst, Aktivace, Retence, Funkce, Hra, Náklady, Zdraví, Zpětná vazba, Uživatelé, Průzkumník, Audit | owner + admin |
| AI a Jarvis — karta stropů | owner upravuje, admin čte |
| AI a Jarvis — karta Vyzkoušet připojení (jedno volání modelu přes `/api/jarvis`, `kind: ping`) | owner; adminovi se neukáže |
| AI a Jarvis → Pravidla (`/admin/ai?tab=rules`) | owner upravuje, admin čte; „Vyzkoušet“ (`kind: rulesTest`) jen owner, adminovi se neukáže |
| Detail uživatele — karta Účet (e-mail, registrace, poslední přihlášení, zařízení, tarif, zkouška, akce podpory) a Hlášení | owner + admin; akce podpory podle řádku výše, jinak jen věta, kdo účet spravuje |
| Uživatelé — sloupec E-mail | owner + admin; Export CSV jen owner |
| Detail uživatele — výjimka AI | owner upravuje, admin čte |
| Detail uživatele — Předplatné | owner upravuje, admin čte |
| Tarify — Účty na tarifech | owner + admin |
| Tarify (`/admin/tarify`) | owner upravuje a zveřejňuje, admin čte zveřejněnou verzi a historii |
| Upozornění na chyby (`/admin/upozorneni`) | owner upravuje a posílá zkušební e-mail, admin čte |
| Zpětná vazba — karta Záznam chyby (hledání podle kódu) | owner + admin |
| Zpětná vazba → Hlášení (seznam, filtry, detail, změna stavu) | owner + admin; snímek obrazovky ve detailu jen owner (adminovi se ukáže jen, že je přiložen) |
| Administrátoři (`/admin/administratori`) | owner; adminovi 404, v menu chybí |
| `/admin/prihlaseni`, `/admin/pozvanka/<token>` | kdokoli (stránka sama ověřuje heslo, roli nebo token) |

## Funkce v databázi (SECURITY DEFINER `admin_*` a související)

| Funkce | Kdo | Poznámka |
|---|---|---|
| `admin_session_touch` | owner + admin (aal2) | vrací i `role` |
| `admin_session_end` | přihlášený, jen vlastní relace | |
| `admin_set_app_setting` | owner | dřív stačila živá relace, teď `admin_require_owner()`; klíče `ai_caps`, `error_alerts` (audit bez adres) a `jarvis_rules` (`valid_jarvis_rules()`, audit z → na) |
| `admin_set_ai_user_cap` | owner | totéž |
| `admin_invite_create` | owner | ukládá jen SHA-256 tokenu, píše `admin_audit` |
| `admin_invite_revoke` | owner | píše `admin_audit` |
| `admin_remove` | owner | nikdy majitele ani sebe; ukončí živé relace admina, píše `admin_audit` |
| `admin_invite_claim` | účet právě založený na stránce pozvánky (stačí aal1) | zabere pozvánku (`claimed_by`) jedním podmíněným UPDATE; jiný účet ji už nezabere, týž účet smí znovu; píše `admin_audit` při prvním zabrání |
| `admin_invite_accept` | pozvaný účet s aal2 | spotřebuje token a přidělí roli v jedné transakci, píše `admin_audit` |
| `admin_plan_catalog_save_draft`, `_discard_draft`, `_publish`, `_restore` | owner | katalog tarifů, advisory lock, píše `admin_audit` (`settings.plans`, `settings.plans.draft`) |
| `plan_catalog_impact`, `plan_overage`, `published_plan` | jen service role (server po stráži) | počty účtů a překročení limitů |
| `admin_subscription_set` | owner | předplatné účtu ručně, zruší naplánovanou změnu, píše `admin_audit` (`users.subscription`, z čeho na co) |
| `admin_plan_user_counts` | jen service role (server po stráži) | účty na tarifech bez interních |
| `admin_require_owner` | jen uvnitř funkcí výše | bez práva EXECUTE pro klienty |
| `admin_members`, `admin_people`, `metric_admin_users` | jen service role (server po stráži) | čtou `auth.users` |
| `admin_user_sign_out` | jen service role (server po stráži a auditu) | smaže relace a obnovovací tokeny účtu v `auth`, ukončí jeho živou relaci administrace |
| `admin_email_taken` | jen service role (server po stráži) | zda adresu už používá jiný účet, před změnou e-mailu |
| `error_event_record`, `error_alert_claim`, `error_alert_digest_claim`, `purge_error_events` | jen service role (server) | záznamy chyb a rozhodnutí o e-mailech, bez klientského přístupu |
| `admin_bug_report_list`, `admin_bug_report_set_status` | jen service role (server po stráži) | Zpětná vazba → Hlášení: seznam s filtry a detail; změna stavu (`feedback.report`), při prvním „Opraveno“ vrátí autora pro e-mail s poděkováním; owner + admin |
| `bug_report_create` | jen service role (server) | hlášení z dialogu Nahlásit problém, hodinový limit na účet |
| `admin_bug_reports` | jen service role (server po stráži) | Zpětná vazba → Hlášení chyb, hledání podle kódu chyby; owner + admin |
| `app_overview` | owner | v aplikaci, ne v administraci; beze změny |

## Životní cyklus pozvánky

1. **Vytvoření** (`admin_invite_create`): majitel dostane odkaz `/admin/pozvanka/<token>`, v DB je jen SHA-256 tokenu. Pozvánka není svázaná s e-mailem.
2. **Nový účet** (`adminInviteSignIn`, režim „Nový účet“): server ověří, že pozvánka je otevřená a nikdo ji ještě nezabral, založí účet, přihlásí ho a tímto účtem zavolá `admin_invite_claim`. Když ji mezitím zabral jiný účet, právě založený účet se hned smaže a odpověď je tatáž neutrální hláška jako u neplatného odkazu. Přes jednu pozvánku tak vznikne nejvýš jeden nový účet. Smazáním zabírajícího účtu se pozvánka zase uvolní (`on delete set null`).
3. **Přihlášení k existujícímu účtu** (režim „Mám účet“): nic nezabírá ani nekontroluje `claimed_by`, takže návrat na odkaz dokončí přerušené TOTP.
4. **Přijetí** (`admin_invite_accept`, po TOTP s aal2): spotřebuje token a přidělí roli v jedné transakci. Pak už odkaz nefunguje pro nikoho.
5. **Zrušení / vypršení** (7 dní): odkaz nefunguje, zabrání se nemění.

Limit pokusů: neplatný nebo zabraný odkaz, existující e-mail i špatné heslo se počítají do téhož zámku (5 neúspěchů za 15 minut podle IP i e-mailu → 15 minut pauza). Hláška „e-mail už existuje“ se tak ukáže jen pár krát za sebou.
