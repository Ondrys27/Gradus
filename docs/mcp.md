# Gradus jako server MCP (28.8)

Gradus jde připojit do Clauda (a jiných klientů MCP) jako **vlastní konektor**.
Uživatel pak z Clauda čte a mění svůj Gradus přesně v rozsahu svých práv.

- **Adresa serveru:** `https://<doména>/api/mcp` (v aplikaci Nastavení → Integrace, ke zkopírování).
- **Transport:** Streamable HTTP, bezstavově (každý požadavek samostatně, jak běží Vercel), odpovědi JSON;
  GET a DELETE vrací 405. Protokol podle SDK `@modelcontextprotocol/sdk` 1.32 (`2025-11-25`, starší
  verze přes vyjednání); Claude dnes otevírá spojení přes `initialize`. Origin z prohlížeče jen
  vlastní, `claude.ai`, `claude.com` (mimo produkci i localhost), jinak 403.
- **Kód:** `src/features/mcp/` (úrovně `levels.ts`, OAuth `oauth.ts`, nástroje `tools.ts`, výstup
  `output.ts`, server `server/handler.ts`, úložiště `server/store.ts`, relace `server/session.ts`),
  route `src/app/api/mcp`, `src/app/api/oauth/*`, `src/app/.well-known/*`, souhlas
  `src/app/(oauth)/oauth/authorize`. Migrace `20261202090000_mcp_server.sql`,
  `20261202100000_trash_restore.sql`.

## Jak připojit do Clauda

1. V Claudovi **Nastavení → Konektory** (claude.ai/customize/connectors).
2. **Přidat vlastní konektor**.
3. Název `Gradus`, adresa `https://<doména>/api/mcp`, **Přidat**.
4. **Připojit** → přihlášení do Gradusu (existující relací, s druhým faktorem, pokud ho účet má) →
   souhlas „Claude chce přístup k tvému Gradusu“: úroveň a firmy → **Povolit**.

V Claudu pro týmy přidává konektor vlastník organizace (Nastavení organizace → Konektory),
ostatní jen kliknou na Připojit. Claude Free dovolí jeden vlastní konektor.

## Autorizace (OAuth 2.1)

| Co | Kde |
|---|---|
| Metadata chráněného zdroje (RFC 9728) | `/.well-known/oauth-protected-resource/api/mcp` i `/.well-known/oauth-protected-resource` |
| Metadata autorizačního serveru (RFC 8414) | `/.well-known/oauth-authorization-server` (issuer = origin) |
| Dynamická registrace (RFC 7591) | `POST /api/oauth/register` — jen veřejní klienti, redirect https nebo loopback, 30 registrací/min celkem |
| Dokument metadat klienta (CIMD) | `client_id` = https adresa dokumentu; server ho stáhne (jen veřejné IP, bez přesměrování, 5 s, 64 kB), drží den |
| Souhlas | `/oauth/authorize` (chráněná stránka, bez rámování) |
| Token | `POST /api/oauth/token` — `authorization_code` + PKCE S256, `refresh_token` s rotací |
| Odvolání (RFC 7009) | `POST /api/oauth/revoke` |

- Výzva 401: `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/api/mcp", scope="gradus.read gradus.write gradus.delete"`.
- Rozsahy: `gradus.read` · `gradus.write` · `gradus.delete`; úroveň z souhlasu určuje, co token má
  (požadovaný `scope` jen předvybere úroveň).
- Tokeny: přístupový 1 h, obnovovací 60 dní, kód 5 min. Ukládá se jen SHA-256. Obnovovací se použije
  jednou; použitý znovu po víc než 60 s = podvržení, celé připojení se zruší.
- Vazba: token na připojení (`mcp_grants`: uživatel, povolené firmy `space_ids`, aktivní firma
  `space_id`, úroveň) a na zdroj `…/api/mcp` (RFC 8707, jiný `resource` = `invalid_target`).
- Uživatelská relace: každé připojení má vlastní relaci Supabase (vznikne při souhlasu, obnovuje se
  jejím refresh tokenem, uložená šifrovaně AES-256-GCM pod `INTEGRATIONS_ENCRYPTION_KEY`). Každé
  volání nástroje běží s tokenem té relace, takže platí RLS, strážci a režim jen pro čtení přesně
  jako v aplikaci. Admin klient jen čte token, počítá volání a píše historii.
- Odpojení (Nastavení → Integrace) smaže tokeny a kódy a ukončí relaci hned.

## Úrovně

| Úroveň | Rozsahy | Nástroje |
|---|---|---|
| **Jen čtení** | `gradus.read` | čtecí nástroje (hledat, číst, seznamy, „co hoří“, finance, faktury, tým, koš) |
| **Čtení a zápis** | + `gradus.write` | navíc zakládání a úpravy (vratné změny) |
| **Plný přístup** | + `gradus.delete` | navíc mazání do koše, odeslání e-mailu a zprávy, vystavení / storno / zaplacení faktury, rezervace, lidé |

Nad úrovní platí vždy práva uživatele v aktivní firmě (`toolsFor`, stejně jako aplikace a Grady):
pracovník dostane jen nástroje svých práv, ve firmě jen pro čtení jen čtení. Kde jsou připojené
aplikace vypnuté (přepínač majitele ve Správě firmy `mcp_space_settings`, právo pracovníka
„Integrace: MCP“, přepínač `mcp` tarifu v katalogu), zbudou jen `whoami` a `switch_space`;
rozhoduje DB `mcp_space_open()` při každém požadavku.

## Bezpečnost

- **Koš:** smazané přes MCP i Gradyho jde obnovit (`list_trash`, `restore_from_trash`, Nastavení →
  Integrace → Koš). Obchody a kontakty čekají s `deleted_at` (skryté pro všechny dotazy klientů
  i s úkoly, termínem a záznamy, které na nich jen visí), ostatní jako snímek v `trash_items`.
  Uchování `app_settings.trash_retention` (výchozí 7 dní, Administrace → AI a Grady → Pravidla),
  poznámky mají vlastní koš 30 dní. Denně `purge_trash()`.
- **Nevratné navenek** (`send_*`, `issue_invoice`, `cancel_invoice`, `mark_invoice_paid`, rezervace):
  jen v Plném přístupu, `destructiveHint` + `openWorldHint` a v popisu, že se má klient zeptat uživatele.
- **Data, ne instrukce:** výsledek je JSON uvnitř `<gradus_data>…</gradus_data>` s větou, že jde o data;
  každé `<`, `>` a `&` je escapované, takže text uživatele blok nezavře. Stejný objekt jde jako
  `structuredContent`; odkazy do aplikace jsou absolutní.
- **Limit rychlosti:** 120 volání za minutu na připojení (`mcp_rate_hit`), pak 429 s `Retry-After`.
- **Záznam:** každé volání v `mcp_calls` (nástroj, úroveň, výsledek, řádek karty; 180 dní),
  změny dat v `activity_log` s `via = mcp` a `mcp_grant_id` (hlavička `x-gradus-mcp-grant` platí jen
  pro živé připojení přihlášeného účtu) — ve Správě firmy „přes Claude“.
- **Jiná firma:** token platí jen ve firmách povolených při souhlasu; `switch_space` jinam odmítne
  (`spaceNotAllowed`). Nástroje filtrují podle aktivní firmy tokenu.

## Nástroje

Generují se z katalogu operací Gradyho (`GRADY_TOOLS`, `docs/grady-operace.md`); popisy anglicky,
vstupy zod → JSON Schema, seznamy po 25 s `offset`. Vlastní nástroje serveru:

| Nástroj | Co dělá |
|---|---|
| `whoami` | Uživatel, firma, role, práva, úroveň připojení, jen pro čtení. |
| `switch_space` | Bez argumentu vypíše povolené firmy, se `spaceId` přepne aktivní firmu připojení. |

### Jen čtení (`read`)

| Nástroj | Co dělá v aplikaci | Právo |
|---|---|---|
| `search_records` | Hledání ⌘K | dashboard |
| `get_record` | Otevřít záznam (detail) | dashboard |
| `list_milestones` | Milníky: seznam | milestones.view |
| `list_milestone_tasks` | Milník: úkoly a mapa | milestones.view |
| `list_crm_tasks` | Úkoly: seznam a filtry | tasks.view |
| `list_deals` | Pipeline: tabule a filtry | pipeline.view |
| `list_events` | Kalendář: období | calendar.view |
| `finance_month` | Finance: měsíc a souhrny | finance.summaries |
| `list_overdue_invoices` | Faktury po splatnosti | invoices.view |
| `list_contact_tables` | Kontakty / Cold Calling: tabulky | contacts.view |
| `list_people` | Výběr „Kdo“ u úkolu | tasks.view |
| `list_bookings` | Plánovač: rezervace | scheduler.view |
| `list_conversations` | Zprávy: konverzace a lidé | chat |
| `list_workers` | Správa firmy: lidé a skupiny | company.view |
| `list_reward_entries` | Odměny: čeká na schválení / výplatu | company.rewards |
| `get_reward_plan` | Odměny: plán a pravidla pracovníka | company.rewards |
| `try_reward_rule` | Odměny: vyzkoušet pravidlo (30 dní, nic nezapíše) | company.rewards |
| `list_trash` | Koš: co smazal Grady nebo připojená aplikace | dashboard |

### Čtení a zápis (`write`)

| Nástroj | Co dělá v aplikaci | Právo |
|---|---|---|
| `create_milestone` | Nový milník (i s úkoly) | milestones.update |
| `update_milestone` | Upravit milník (název, popis, termín, odměna) | milestones.update |
| `add_tasks` | Přidat úkoly a podúkoly | milestones.update |
| `update_task` | Upravit úkol milníku | milestones.update |
| `set_task_status` | Odškrtnout / vrátit úkol milníku | milestones.update |
| `move_task` | Přesunout úkol (mapa, seznam) | milestones.update |
| `complete_milestone` | Dokončit milník | milestones.update |
| `create_note` | Nová poznámka (text nebo mapa) | notes |
| `append_to_note` | Připsat do poznámky („Uložit do poznámek“) | notes |
| `update_note` | Upravit poznámku | notes |
| `pin_note` | Připnout poznámku | notes |
| `link_note` | Propojit poznámku s úkolem, milníkem, obchodem | notes |
| `create_note_folder` | Nová složka poznámek | notes |
| `move_note_to_folder` | Přesunout poznámku do složky | notes |
| `restore_note` | Obnovit poznámku z koše | notes |
| `share_note` | Sdílet poznámku (člověk, skupina, firma) | notes |
| `create_contact` | Nový kontakt | contacts.create |
| `update_contact` | Upravit kontakt | contacts.update |
| `move_contact` | Přesunout kontakt do tabulky (Cold Calling) | contacts.update |
| `add_contact_activity` | Zapsat hovor, e-mail, schůzku, SMS, poznámku | contacts.update |
| `create_deal` | Nový obchod | pipeline.create |
| `update_deal` | Upravit obchod (pole, Close Date, částka) | pipeline.update |
| `set_deal_people` | Lidé na obchodu | pipeline.update |
| `move_deal_stage` | Přesunout obchod do fáze (výhra, prohra) | pipeline.change_stage |
| `add_deal_contact` | Přidat kontakt k obchodu | pipeline.update |
| `add_deal_history_entry` | Zápis do historie obchodu (shrnutí schůzky) | contacts.update |
| `save_deal_attachment` | Přepis schůzky jako příloha obchodu | pipeline.update |
| `create_crm_task` | Nový obchodní úkol | tasks.create |
| `update_crm_task` | Upravit obchodní úkol | tasks.update |
| `complete_crm_task` | Hotovo s poznámkou | tasks.view |
| `reopen_crm_task` | Vrátit mezi otevřené | tasks.view |
| `create_event` | Nová událost v kalendáři | calendar.create |
| `update_event` | Upravit / přesunout událost | calendar.update |
| `update_event_type` | Plánovač: upravit typ schůzky | scheduler.own |
| `block_days` | Plánovač: jiná doba / blokovaný den | scheduler.own |
| `save_transaction` | Nová / upravená transakce | finance.write |
| `save_recurring_payment` | Nová / upravená automatická platba | finance.write |
| `set_plan_cell` | Plán měsíce: buňka | finance.write |
| `save_invoice_draft` | Koncept faktury (i z obchodu) | invoices.issue |
| `move_worker` | Přesunout pracovníka pod jiného nadřízeného | company.update |
| `save_worker_group` | Skupina (založit, upravit, členové) | company.update |
| `set_worker_permissions` | Práva pracovníka | company.update |
| `review_reward_entries` | Odměny: schválit / zamítnout | company.rewards |
| `save_reward_rules` | Odměny: nastavit pravidla (přidat, změnit, odebrat) | company.rewards |
| `place_widget` | Přehled: přidat widget | dashboard |
| `hide_widget` | Přehled: odebrat widget | dashboard |
| `update_settings` | Nastavení (vzhled, formáty, Grady) | settings |
| `restore_from_trash` | Koš: obnovit | dashboard |

### Plný přístup (`delete`)

| Nástroj | Co dělá v aplikaci | Právo |
|---|---|---|
| `delete_task` | Smazat úkol s podúkoly | milestones.update |
| `trash_note` | Poznámka do koše | notes |
| `delete_contact` | Smazat kontakt (do koše) | contacts.delete |
| `delete_deal` | Smazat obchod (do koše) | pipeline.delete |
| `delete_crm_task` | Smazat obchodní úkol | tasks.delete |
| `delete_event` | Smazat událost | calendar.update |
| `confirm_booking` | Plánovač: schválit rezervaci | scheduler.own |
| `decline_booking` | Plánovač: odmítnout rezervaci | scheduler.own |
| `cancel_booking` | Plánovač: zrušit rezervaci | scheduler.own |
| `delete_transaction` | Smazat transakci | finance.write |
| `delete_recurring_payment` | Smazat automatickou platbu | finance.write |
| `issue_invoice` | Vystavit fakturu | invoices.issue |
| `send_invoice` | Poslat fakturu e-mailem | invoices.issue |
| `mark_invoice_paid` | Zaplaceno (zaúčtuje příjem) | invoices.issue |
| `cancel_invoice` | Stornovat fakturu (dobropis) | invoices.issue |
| `send_chat_message` | Zprávy: poslat zprávu | chat |
| `remove_worker` | Odstranit z firmy | company.update |
| `add_manual_reward` | Odměny: přidat ručně (i srážka) | company.rewards |

## Příklady vět

- „Zapiš mi tenhle přepis schůzky k obchodu Novák a založ úkoly.“ → `search_records`, `add_deal_history_entry`, `create_crm_task` ×N
- „Co mi dnes hoří?“ → `list_deals`, `list_crm_tasks` (po termínu), `list_overdue_invoices`
- „Naplánuj schůzku s Janou Novou ve čtvrtek v 10.“ → `search_records`, `create_event`
- „Hotovo s úkolem Zavolat Novákovi, poznámka: chce nabídku do pátku.“ → `list_crm_tasks`, `complete_crm_task`
- „Přidej do milníku Web tři úkoly…“ → `list_milestones`, `add_tasks`
- „Kolik mám tento měsíc příjmů a výdajů?“ → `finance_month`
- „Smaž obchod Test.“ (Plný přístup) → `delete_deal` → v koši 7 dní; „Vrať ho.“ → `list_trash`, `restore_from_trash`
- „Pošli fakturu 2026-0012 e-mailem.“ (Plný přístup, Claude se zeptá) → `send_invoice`

## Testy

- `src/features/mcp/tools.test.ts`: každý nástroj × úroveň × role (majitel, jen pro čtení, Asistent,
  Obchodník, Účetní) přesně podle práv aplikace; pracovník nic nad práva.
- `src/features/mcp/server/mcp-flow.test.ts`: klient ze SDK proti routám aplikace (registrace →
  autorizace → tools/list → volání → odpojení), rotace a podvržený refresh token, pracovník a jiná firma.
- `src/lib/supabase/mcp-schema.test.ts`: tabulky jen pro server, vlastní řádky, přepínač firmy,
  právo, aktivita s klientem, koš (skrytí, obnova, mazání po době).
- `src/features/mcp/oauth.test.ts`, `output.test.ts`, `src/features/trash/trash.test.ts`.
