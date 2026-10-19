# Role v administraci

Do administrace (`/admin`) smí **majitel** (`owner`, právě jeden) a **administrátor** (`admin`), oba za stejných podmínek: heslo + TOTP (aal2) + živá relace administrace (`admin_session_touch`, 30 min nečinnosti, 8 h celkem). Role jsou v `user_roles`, klient do ní nezapíše. Admina přidává jen pozvánka (`admin_invites`), odebírá ho jen majitel.

Co admin nesmí, se mu **neukáže** (ne zašedne): sekce Administrátoři chybí v menu a vrací 404, formuláře stropů AI nahrazují hodnoty jen ke čtení, tlačítka exportů s osobními údaji chybí. Server a databáze to vynucují i tak.

Pravidla v kódu: `src/features/admin/roles.ts` (`adminCan`, `mayExport`, `PERSONAL_DATA_EXPORTS`), stráž `requireOwnerFor` / `adminAccessFor` v `server/guard.ts`, v databázi `admin_require_owner()`.

## Serverové akce a routy (`src/features/admin/server`, `src/app/(admin)`)

| Akce / routa | Kdo | Proč |
|---|---|---|
| `mutations.toggleUserInternal` | owner + admin | údržba metrik, žádná osobní data ven |
| `mutations.setFeatureRequestStatus` | owner + admin | třídění zpětné vazby |
| `ai-caps-actions.saveAiCaps` | owner | stropy AI; admin je vidí jen ke čtení |
| `ai-caps-actions.saveUserAiCap` | owner | výjimky AI; admin je vidí jen ke čtení |
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
| Detail uživatele — výjimka AI | owner upravuje, admin čte |
| Administrátoři (`/admin/administratori`) | owner; adminovi 404, v menu chybí |
| `/admin/prihlaseni`, `/admin/pozvanka/<token>` | kdokoli (stránka sama ověřuje heslo, roli nebo token) |

## Funkce v databázi (SECURITY DEFINER `admin_*` a související)

| Funkce | Kdo | Poznámka |
|---|---|---|
| `admin_session_touch` | owner + admin (aal2) | vrací i `role` |
| `admin_session_end` | přihlášený, jen vlastní relace | |
| `admin_set_app_setting` | owner | dřív stačila živá relace, teď `admin_require_owner()` |
| `admin_set_ai_user_cap` | owner | totéž |
| `admin_invite_create` | owner | ukládá jen SHA-256 tokenu, píše `admin_audit` |
| `admin_invite_revoke` | owner | píše `admin_audit` |
| `admin_remove` | owner | nikdy majitele ani sebe; ukončí živé relace admina, píše `admin_audit` |
| `admin_invite_accept` | pozvaný účet s aal2 | spotřebuje token a přidělí roli v jedné transakci, píše `admin_audit` |
| `admin_require_owner` | jen uvnitř funkcí výše | bez práva EXECUTE pro klienty |
| `admin_members`, `admin_people`, `metric_admin_users` | jen service role (server po stráži) | čtou `auth.users` |
| `app_overview` | owner | v aplikaci, ne v administraci; beze změny |
