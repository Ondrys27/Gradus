# Průchod životem pracovníka (28.1)

Playwright `tests/e2e/66-worker-lifecycle-audit.spec.ts` (spouští se jen s `AUDIT=1`), produkční build, dvě varianty: čeština na 1440 px a angličtina na 390 px. Každý krok = snímek a řádek v `*-steps.json`; krok, který selže, se zapíše a průchod jde dál.

- `pred-*` = průchod kódem před 28.1 (commit bf86629) proti sdílené databázi, 22. 11. 2026. Z něj jsou nálezy níže.
- `po-*` = stejný průchod po 28.1 a migraci `20261126090000_company_members_invites.sql`, 22. 11. 2026. Prošly všechny kroky kromě dvou, které jsou vadou průchodu, ne aplikace: `worker-completes-task` (splněný úkol správně odjede do sbalených „Hotové 1“, viz Rozhodnutí; průchod hledá odškrtnutý řádek v otevřeném seznamu) a na 390 px `rights-live` (Pipeline se po změně práv objeví v panelu Více, ne ve spodní liště, takže ji průchod nevidí; na 1440 px krok prošel). E-mail s pozvánkou z mocku Resend, registrace z odkazu i pozvání přes @jméno už fungují. Spuštění znovu:

```
NEXT_DIST_DIR=.next-e2e bun run build
NEXT_DIST_DIR=.next-e2e bunx next start -p 3100
AUDIT=1 E2E_BUILD=1 E2E_BASE_URL=http://localhost:3100 bunx playwright test 66
```

Kroky: pozvání nového e-mailem (velká písmena a mezery kolem) → e-mail z mocku Resend a jeho odkaz → registrace → první přihlášení a prohlídka → přehled, úkoly, zprávy, firma, odměny pracovníka → přepínač firem → úkol od majitele → splnění → zpráva majiteli → pozvání existujícího přes @jméno (před 28.1 krátkým ID) → přijetí → druhá firma zve téhož člověka, který je sám majitelem své firmy → odmítnutí → změna práv za běhu → přesun pod jiného nadřízeného → odchod pracovníka → odebrání majitelem → co zůstane (Lidé, Ukončení, Odměny a výplaty, Skupiny, Zprávy, Úkoly) → opětovné pozvání téhož e-mailu.

## Nálezy

| Nález | Příčina | Oprava |
|---|---|---|
| Odměny a výplaty ukazují odebrané a nikdy nepřijaté jako karty „Neaktivní“ (`pred-cs-1440-33`) | `useWorkers()` čte `workers` bez stavu | Sdílený dotaz `active_members(space)` (`useActiveMembers` / `fetchActiveMembers`), přepínač „Zobrazit i bývalé“ (jen kdo pracoval a odešel), štítek „Bývalý pracovník“; bývalému nejde přidat nic, výplata jen do výše dluhu |
| Výběr členů skupiny nabízí odebrané i pozvané; odebraný zůstává ve skupině, v jejím počtu a v její konverzaci | Výběr bere celý `company_tree()`; ukončení nemaže `worker_group_members` | Výběr a karty skupin z `active_members`; trigger `workers_end_group_memberships` při ukončení (konverzace skupiny následuje přes `chat_group_members_sync`), úklid starých členství, DB odmítne bývalého ve skupině (`worker_inactive`) |
| Statistiky Cold Callingu (majitel) nabízejí odebrané | `useWorkspaceMembers()` bez stavu | `active_members` |
| Plánovač → Všichni ukazuje profily lidí, kteří odešli | `scheduler_profiles` prostoru bez členství | Jen profily aktivních členů |
| @ v poznámkách nabízí odebrané a pozvané | `global_search` vrací pracovníky všech stavů | Nabídka jen aktivních (staré čipy fungují dál) |
| Spouštěč v Systému odměn jde nastavit pro odebraného i pozvaného | `useWorkers()` bez stavu | Jen aktivní; spouštěč bývalého zůstane s „(už ve firmě není)“ |
| Přetažením ve stromu (filtr Ukončení) šlo dát někoho pod bývalého | `planManagerMove` ani DB stav nekontrolovaly | `planManagerMove` → `inactive`, trigger `workers_manager_active` |
| Úkoly, obchody, filtry Kdo / Pracovník, Grady `list_people` | Už dřív jen aktivní (`crm_task_assignees`), ale vlastním dotazem | Všechno přes `active_members`; `crm_task_assignees` zůstává jen pro staré klienty |
| Zprávy: majitel měl v „Lidé“ i pozvané bez účtu, @ nabízel i pozvané | `conversation-list` a `@` braly i stav `invited` | Nová konverzace a @ jen s aktivními členy; vedle jména @jméno |
| E-mail s pozvánkou testovacím účtům nikdy neodešel, ani do mocku Resend, takže průchod nemohl otevřít odkaz z e-mailu (`pred-*-05`, „no invite e-mail in the outbox“) | `isTestAddress()` zahodil všechny @gradus.local před odesláním | Pozvánka, nová pozvánka a odchod z firmy přes `deliverEmail` (e2e účty do mocku, ostatní @gradus.local nic) |
| Pole „Krátké ID nebo e-mail“ neumělo uživatelské jméno; „@jana“ se četlo jako e-mail | Jedno pole pro dvě různé věci | Dialog začíná volbou „Už používá Gradus“ (@jméno nebo krátké ID, jen přesná shoda, karta s fotkou, jménem a @jménem, nejvýš 10 neúspěchů a 40 hledání za hodinu) / „Ještě Gradus nemá“ (jméno + e-mail) |
| Štítky „má vlastní tarif“, „v ceně“, „navíc 290 Kč“, řádek Pracovníci v Předplatném, cena za pracovníka na kartách tarifů a webu, věta „Za práci ve firmě neplatíš“ na kartě pozvánky a v e-mailu (`pred-cs-1440-29`) | Placení za pracovníky se ukazovalo, i když neběží | Přepínač WORKER_BILLING_VISIBLE (`app_settings.worker_billing`, výchozí vypnuto); výpočet zůstal, Stripe pracovníky neúčtuje |
| Nápověda štítku „pozvánka vypršela“ mluví o placení | Text napsaný pro placení | Bez přepínače jen „Pošli mu novou, až bude chtít nastoupit.“ |
| Dashboard pracovníka: jméno a příjmení rozjeté do dvou polovin („E2E ⟷ Existující“), na počítači i telefonu (`pred-*-29`) | Pole jména v `grid-cols-2` | Pole široká podle textu vedle sebe (`EditableText fit`) |
| Uživatelské jméno šlo měnit libovolně často a staré hned převzal kdokoli | Bez pravidla | Změna nejvýš 1× za 30 dní (`username_changed_at`, razítkuje DB), staré jméno 30 dní rezervované (`username_reservations`); Nastavení → Účet řekne, kdy půjde změnit znovu |
| @jméno nebylo vidět vedle krátkého ID | Sekce měla jen ID | „Jak tě najdou“: krátké ID i @jméno, obojí s Kopírovat |
| Plánovač zakládal adresu stránky ze jména, ne z @jména | `handleFromName` | Nejdřív @jméno (`jana.novak` → `/s/jana-novak`), pak jako dřív |

## Rozhodnutí (k potvrzení)

- **Bývalý pracovník a výplata:** nic nového (úkol, skupina, pravidlo), ale „Zaznamenat výplatu“ zůstává, dokud mu majitel něco dluží.
- **Pozvaný bez účtu ve Zprávách:** už se nenabízí (dřív mu mohl psát majitel). Rozepsané konverzace zůstávají.
- **Pozvaný zařazený do skupiny při pozvání** zůstává jejím členem, jen ho výběr ani karta skupiny neukazují, dokud nepřijme.
- **Lidé ve Správě firmy** ukazují pozvané dál (výchozí filtr „Aktivní a pozvaní“): je to správa pozvánek, ne výběr pracovníka.
- **Stripe:** s vypnutým přepínačem `extraWorkerQuantity` vrací 0, takže se pracovníci navíc neúčtují (dnes platby stejně běží jen v testu).
- **Karta nalezeného účtu** ukáže fotku, jméno a @jméno jen při přesné shodě a jen majiteli, který člověka může pozvat; kdo už ve firmě je nebo má pozvánku, dostane jen hlášku.
- **Tón:** přihlášení a registrace vykají („Vytvořte si účet“), aplikace i pruh pozvánky na téže obrazovce tykají. Nechal jsem, změna celé sekce `auth` je rozhodnutí pro Ondřeje.
- **Úkol od majitele** po splnění zmizí do sbalených „Hotové 1“ (`pred-cs-1440-17`); funguje, jen bez potvrzení navíc.
- **Odměna za splněný úkol** bez pravidel v Systému odměn nevznikne; plán odměn řeší 28.2.

## Návrh doplnění CLAUDE.md

CLAUDE.md jsem v běhu bez dozoru neměnil. Navrhuji:

- Správa firmy: „Všude, kde se vybírá nebo vypisuje pracovník, jen `active_members(space)` (`useActiveMembers`, `fetchActiveMembers`); Odměny a výplaty s ‚Zobrazit i bývalé‘; ukončení ruší členství ve skupinách (`workers_end_group_memberships`), bývalý nejde do skupiny ani nad nikoho (`worker_inactive`).“
- Pozvánka: „Dialog začíná volbou Už používá Gradus (@jméno nebo krátké ID, `invite_account_lookup`: jen přesná shoda, 10 neúspěchů / 40 hledání za hodinu, `account_lookup_attempts`) / Ještě Gradus nemá (jméno + e-mail).“
- Data / profil: „`profiles.username` mění klient nejvýš 1× za 30 dní, staré jméno 30 dní rezervované (`profiles_username_guard`, `username_reservations`); plánovač bere @jméno jako první adresu.“
- Tarify → Kdo za koho platí: „Vše o placení za pracovníky (štítky, řádek v Předplatném, cena na kartách a webu, e-mail pozvánky, položka ve Stripe) jen s WORKER_BILLING_VISIBLE (`app_settings.worker_billing`, výchozí vypnuto, `session.workerBilling`).“
- Zprávy: větu „Pozvanému (bez účtu) píše jen majitel, zprávy počkají“ nahradit „Nová konverzace a @ jen s aktivními členy prostoru.“
