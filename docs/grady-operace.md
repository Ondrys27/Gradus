# Co Grady umí v aplikaci (operace)

Zásada: **Grady smí u každého uživatele přesně to, co smí ten uživatel, a nic víc.**
Každá operace běží pod identitou uživatele v aktivním prostoru: klient Supabase
přihlášeného uživatele (nikdy admin klient pro uživatelská data), takže platí
ochrana řádků, strážci v DB i režim jen pro čtení. Id, které pošle model, server
vždy nejdřív přečte přes RLS. Kdo nemá právo, tomu se nástroj modelu vůbec
nenabídne (`toolsFor` v `src/features/grady/tools/access.ts`), a kdyby přesto
přišel, server ho odmítne znovu při spuštění i při potvrzení.

Jedna definice, dvě použití: katalog `GRADY_TOOLS`
(`src/features/grady/tools/catalog.ts`) nese u každé operace název, popis,
schéma vstupu (zod), právo z katalogu práv a úroveň (`toolLevel`). Z něj má
nástroje Grady v chatu a z něj vzniknou nástroje MCP serveru (28.8):

- **čtení** (`read`) — jen čte, v MCP úroveň „Jen čtení“,
- **zápis** (`write`) — změna, kterou jde vrátit, v MCP „Čtení a zápis“,
- **mazání** (`delete`) — smazání, odeslání lidem, peníze nebo rezervace,
  v MCP jen „Plný přístup“.

**Vratná?** = karta má Vrátit (24 h, nic nepřepíše, když se záznam mezitím
změnil). Smazání přes Gradyho i přes připojenou aplikaci (MCP, 28.8) jde do
koše: obchod a kontakt zůstanou v tabulce s `deleted_at` (`trash_record()`,
skryté pro všechny dotazy klientů i s tím, co na nich jen visí), úkoly,
události, ruční transakce, automatické platby a úkoly milníku jako snímek
v `trash_items`. Obnovit jde kartou Vrátit, operací `restore_from_trash` nebo
v Nastavení → Integrace → Koš po dobu z administrace (výchozí 7 dní,
`app_settings.trash_retention`); pak je `purge_trash()` smaže natrvalo.
Poznámka jde do koše poznámek (30 dní).

**Potvrzení**: mazání, odeslání, finanční kroky faktur, lidé, rezervace,
dokončení milníku, sdílení a hromadné změny (víc než 5) čekají na Potvrdit
(sloupec Úroveň `delete`, nebo „potvrzení“ u zápisu).

Sloupce **Majitel** a **Asistent** říkají, zda operaci dostane majitel ve svém
prostoru a pracovník se šablonou práv Asistent (milníky, kontakty, úkoly všech
s přiřazováním, kalendář všech, správa firmy: zobrazit svou větev). Hlídá to
Vitest `src/features/grady/tools/parity.test.ts`: tabulka musí sedět
s katalogem (každá operace právě jednou, právo, úroveň, vratnost) a s tím, co
`toolAllowed` pro obě role opravdu povolí.

## Operace

| Akce v aplikaci | Operace Gradyho | Právo | Úroveň | Vratná? | Majitel | Asistent |
|---|---|---|---|---|---|---|
| Hledání ⌘K | `search_records` | dashboard | read | ne | ano | ano |
| Otevřít záznam (detail) | `get_record` | dashboard | read | ne | ano | ano |
| Milníky: seznam | `list_milestones` | milestones.view | read | ne | ano | ano |
| Milník: úkoly a mapa | `list_milestone_tasks` | milestones.view | read | ne | ano | ano |
| Úkoly: seznam a filtry | `list_crm_tasks` | tasks.view | read | ne | ano | ano |
| Pipeline: tabule a filtry | `list_deals` | pipeline.view | read | ne | ano | ne |
| Kalendář: období | `list_events` | calendar.view | read | ne | ano | ano |
| Kalendář: kdy mají lidé čas (jen v rozsahu sdílení) | `people_availability` | calendar.view | read | ne | ano | ano |
| Finance: měsíc a souhrny | `finance_month` | finance.summaries | read | ne | ano | ne |
| Faktury po splatnosti | `list_overdue_invoices` | invoices.view | read | ne | ano | ne |
| Kontakty / Cold Calling: tabulky | `list_contact_tables` | contacts.view | read | ne | ano | ano |
| Výběr „Kdo“ u úkolu | `list_people` | tasks.view | read | ne | ano | ano |
| Nový milník (i s úkoly) | `create_milestone` | milestones.update | write | ano | ano | ano |
| Upravit milník (název, popis, termín, odměna) | `update_milestone` | milestones.update | write | ano | ano | ano |
| Přidat úkoly a podúkoly | `add_tasks` | milestones.update | write | ano | ano | ano |
| Upravit úkol milníku | `update_task` | milestones.update | write | ano | ano | ano |
| Odškrtnout / vrátit úkol milníku | `set_task_status` | milestones.update | write | ano | ano | ano |
| Přesunout úkol (mapa, seznam) | `move_task` | milestones.update | write | ano | ano | ano |
| Smazat úkol s podúkoly | `delete_task` | milestones.update | delete | ano | ano | ano |
| Dokončit milník | `complete_milestone` | milestones.update | write | ano | ano | ano |
| Nová poznámka (text nebo mapa) | `create_note` | notes | write | ano | ano | ano |
| Připsat do poznámky („Uložit do poznámek“) | `append_to_note` | notes | write | ano | ano | ano |
| Upravit poznámku | `update_note` | notes | write | ano | ano | ano |
| Připnout poznámku | `pin_note` | notes | write | ano | ano | ano |
| Propojit poznámku s úkolem, milníkem, obchodem | `link_note` | notes | write | ano | ano | ne |
| Poznámka do koše | `trash_note` | notes | delete | ano | ano | ano |
| Nová složka poznámek | `create_note_folder` | notes | write | ano | ano | ano |
| Přesunout poznámku do složky | `move_note_to_folder` | notes | write | ano | ano | ano |
| Obnovit poznámku z koše | `restore_note` | notes | write | ano | ano | ano |
| Sdílet poznámku (člověk, skupina, firma) | `share_note` | notes | write | ne | ano | ano |
| Nový kontakt | `create_contact` | contacts.create | write | ano | ano | ano |
| Upravit kontakt | `update_contact` | contacts.update | write | ano | ano | ano |
| Přesunout kontakt do tabulky (Cold Calling) | `move_contact` | contacts.update | write | ne | ano | ano |
| Zapsat hovor, e-mail, schůzku, SMS, poznámku | `add_contact_activity` | contacts.update | write | ano | ano | ano |
| Smazat kontakt (do koše) | `delete_contact` | contacts.delete | delete | ano | ano | ne |
| Nový obchod | `create_deal` | pipeline.create | write | ano | ano | ne |
| Upravit obchod (pole, Close Date, částka) | `update_deal` | pipeline.update | write | ano | ano | ne |
| Lidé na obchodu | `set_deal_people` | pipeline.update | write | ano | ano | ne |
| Přesunout obchod do fáze (výhra, prohra) | `move_deal_stage` | pipeline.change_stage | write | ano | ano | ne |
| Přidat kontakt k obchodu | `add_deal_contact` | pipeline.update | write | ano | ano | ne |
| Smazat obchod (do koše) | `delete_deal` | pipeline.delete | delete | ano | ano | ne |
| Zápis do historie obchodu (shrnutí schůzky) | `add_deal_history_entry` | contacts.update | write | ano | ano | ano |
| Přepis schůzky jako příloha obchodu | `save_deal_attachment` | pipeline.update | write | ano | ano | ne |
| Nový obchodní úkol | `create_crm_task` | tasks.create | write | ano | ano | ano |
| Upravit obchodní úkol | `update_crm_task` | tasks.update | write | ano | ano | ano |
| Hotovo s poznámkou | `complete_crm_task` | tasks.view | write | ano | ano | ano |
| Vrátit mezi otevřené | `reopen_crm_task` | tasks.view | write | ano | ano | ano |
| Smazat obchodní úkol | `delete_crm_task` | tasks.delete | delete | ano | ano | ne |
| Nová událost v kalendáři | `create_event` | calendar.create | write | ano | ano | ano |
| Upravit / přesunout událost | `update_event` | calendar.update | write | ano | ano | ano |
| Smazat událost | `delete_event` | calendar.update | delete | ano | ano | ano |
| Plánovač: rezervace | `list_bookings` | scheduler.view | read | ne | ano | ne |
| Plánovač: upravit typ schůzky | `update_event_type` | scheduler.own | write | ano | ano | ne |
| Plánovač: jiná doba / blokovaný den | `block_days` | scheduler.own | write | ano | ano | ne |
| Plánovač: schválit rezervaci | `confirm_booking` | scheduler.own | delete | ne | ano | ne |
| Plánovač: odmítnout rezervaci | `decline_booking` | scheduler.own | delete | ne | ano | ne |
| Plánovač: zrušit rezervaci | `cancel_booking` | scheduler.own | delete | ne | ano | ne |
| Nová / upravená transakce | `save_transaction` | finance.write | write | ano | ano | ne |
| Smazat transakci | `delete_transaction` | finance.write | delete | ano | ano | ne |
| Nová / upravená automatická platba | `save_recurring_payment` | finance.write | write | ano | ano | ne |
| Smazat automatickou platbu | `delete_recurring_payment` | finance.write | delete | ano | ano | ne |
| Plán měsíce: buňka | `set_plan_cell` | finance.write | write | ano | ano | ne |
| Koncept faktury (i z obchodu) | `save_invoice_draft` | invoices.issue | write | ano | ano | ne |
| Vystavit fakturu | `issue_invoice` | invoices.issue | delete | ne | ano | ne |
| Poslat fakturu e-mailem | `send_invoice` | invoices.issue | delete | ne | ano | ne |
| Zaplaceno (zaúčtuje příjem) | `mark_invoice_paid` | invoices.issue | delete | ne | ano | ne |
| Stornovat fakturu (dobropis) | `cancel_invoice` | invoices.issue | delete | ne | ano | ne |
| Zprávy: konverzace a lidé | `list_conversations` | chat | read | ne | ano | ano |
| Zprávy: poslat zprávu | `send_chat_message` | chat | delete | ne | ano | ano |
| Správa firmy: lidé a skupiny | `list_workers` | company.view | read | ne | ano | ano |
| Přesunout pracovníka pod jiného nadřízeného | `move_worker` | company.update | write | ano | ano | ne |
| Skupina (založit, upravit, členové) | `save_worker_group` | company.update | write | ano | ano | ne |
| Práva pracovníka | `set_worker_permissions` | company.update | write | ano | ano | ne |
| Odstranit z firmy | `remove_worker` | company.update | delete | ne | ano | ne |
| Odměny: čeká na schválení / výplatu | `list_reward_entries` | company.rewards | read | ne | ano | ne |
| Odměny: schválit / zamítnout | `review_reward_entries` | company.rewards | write | ano | ano | ne |
| Odměny: přidat ručně (i srážka) | `add_manual_reward` | company.rewards | delete | ne | ano | ne |
| Odměny: plán a pravidla pracovníka | `get_reward_plan` | company.rewards | read | ne | ano | ne |
| Odměny: vyzkoušet pravidlo (30 dní, nic nezapíše) | `try_reward_rule` | company.rewards | read | ne | ano | ne |
| Odměny: nastavit pravidla (přidat, změnit, odebrat) | `save_reward_rules` | company.rewards | write | ano | ano | ne |
| Přehled: přidat widget | `place_widget` | dashboard | write | ano | ano | ano |
| Přehled: odebrat widget | `hide_widget` | dashboard | write | ano | ano | ano |
| Nastavení (vzhled, formáty, Grady) | `update_settings` | settings | write | ano | ano | ne |
| Koš: co smazal Grady nebo připojená aplikace | `list_trash` | dashboard | read | ne | ano | ano |
| Koš: obnovit | `restore_from_trash` | dashboard | write | ne | ano | ano |

Poznámky k právům:

- **Kontakty a Cold Calling** sdílejí tabulky: `list_contact_tables` otevře i
  `cold_calling.view`, `move_contact`, `add_contact_activity` a
  `add_deal_history_entry` i `cold_calling.call` (stejně jako ochrana řádků
  `contact_activities`). Zápis do historie obchodu navíc čte obchod přes RLS,
  takže bez práva vidět obchod skončí `notFound`.
- **Poznámky, přehled a nastavení** nemají řádek v katalogu práv: poznámky jsou
  vlastní a sdílené (role čtenář / editor se ověřuje u každé poznámky),
  přehled je osobní, nastavení jen ve vlastním prostoru. `link_note` jen ve
  vlastním prostoru (`note_links` jsou majitelovy).
- **Zprávy** jdou po konverzacích (`chat_is_member`), práva katalogu nemají.
- **Odměny** (`company.rewards`) spravují lidi, které uživatel vidí, nikdy sebe
  (`reward_can_manage` v DB u každého záznamu znovu). Pravidla plánu (29.1)
  jdou přes stejný tvar jako věty v plánu (`definitionSchema`, kontroly
  `definitionErrors`, jen tabulky a fáze prostoru); `save_reward_rules` vždy
  s Potvrdit, `try_reward_rule` je suchý běh nad `reward_history()`.
- **Majitel** v cizí firmě je pracovník: platí jeho práva tam. Režim jen pro
  čtení nechá jen operace `read`.

## Jen v rozhraní (Grady neumí, záměrně)

| Akce v aplikaci | Proč ne přes Gradyho |
|---|---|
| Předplatné, platby, promo kódy, fakturační údaje | Peníze účtu a souhlas s podmínkami dělá jen člověk (CLAUDE.md, Grady). |
| Smazání účtu, heslo, e-mail, druhý faktor | Bezpečnost účtu. |
| Administrace, role, export dat účtu | Mimo katalog Gradyho. |
| Pozvat pracovníka, přijmout / odmítnout pozvánku, odejít z firmy | Mění, kdo do firmy patří a kam účet patří; vyhledání účtu podle e-mailu dělá jen server s ověřením. Grady na pozvánku odkáže. |
| Výplata odměn (záznam výplaty do Financí) | Zaúčtuje výdaj a zamkne záznamy; dělá se v Odměnách a výplatách. |
| Upravit a smazat zprávu, ztišit konverzaci | Zprávy jsou mezi lidmi; Grady chat nečte. |
| Generovat kontakty (Google Places) | Placené volání s denním limitem; spouští ho uživatel. |
| Časovač volání a práce | Měří čas člověka; spustit / pozastavit jen on. |
| Odeslat e-mail kontaktu | Návrh odpovědi Grady napíše (`emailReply`), odeslat musí uživatel. |
| Import a export myšlenkové mapy, PNG | Práce se soubory v prohlížeči. |
| Údaje dodavatele na fakturách, číselná řada | Jen majitel ve Faktury → Nastavení; QR a IBAN ověřuje formulář. |
| Typ schůzky: založit / smazat, odebírané kalendáře | Tarifní limit a tajné adresy (šifrované) jen přes formulář. |
| Rozložení přehledu firmy a skupin, widgety pro pracovníky | Majitel ve Správě firmy → Přehledy. |
| Tutoriál, ukázková data | Spouští uživatel. |

## Zápis ze schůzky

„Vložit zápis ze schůzky“ (detail obchodu, kontaktu a schůzky v kalendáři)
nepoužívá nový zápisový kanál: Grady (`meeting_notes`, výchozí Sonnet) jen
navrhne změny, uživatel je zaškrtne a upraví, a po Potvrdit se provedou
operacemi z tabulky výše (`add_deal_history_entry`, `create_crm_task`,
`update_deal`, `move_deal_stage`, `create_contact`, `add_deal_contact`,
`create_note`, `save_deal_attachment`) jako jedna akce s jedním Vrátit
(`runBundle` v `src/features/grady/server/tools/actions.ts`). Co uživatel
nesmí, se v návrhu neukáže a server to odmítne i tak.

## Aktivita ve firmě

Každý zápis z tabulky (i ruční v aplikaci) zapisuje DB do `activity_log`
(triggery u obchodů, kontaktů, přesunů, aktivit, úkolů, milníků, událostí,
faktur a transakcí). Klient Gradyho posílá hlavičku `x-gradus-via: grady`,
MCP (28.8) `mcp`; časová osa ve Správě firmy → Aktivita je označí „přes
Gradyho“ / „přes Claude“.
