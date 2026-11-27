# Slovník rozhraní

Jedna věc má v celé aplikaci jedno jméno, v češtině i v angličtině. Tabulka je
závazná pro texty v `src/locales/cs.json` a `en.json`, pro Gradyho i pro
dokumentaci. Synonyma v závorce smí být jen v klíčových slovech hledání
(`search.keywords.*`, `tutorial.ui.*.keywords`), nikdy na obrazovce.

## Věci

| Věc | CS | EN | Nepoužívat na obrazovce |
|---|---|---|---|
| Záznam v pipeline | **obchod** | **deal** | příležitost, zakázka, opportunity, order |
| Fáze pipeline | **fáze** | **stage** | sloupec, krok, column |
| Očekávané datum uzavření obchodu | **Close Date** (CS i EN) | **Close Date** | datum uzavření, termín obchodu |
| Datum realizace obchodu | **datum realizace** | **delivery date** | deadline |
| Úkol milníku (`tasks`) | **úkol** | **task** | krok, položka, to-do |
| Obchodní úkol (`crm_tasks`) | **úkol** (u obchodu / kontaktu) | **task** | CRM úkol, aktivita, activity |
| Úkol od majitele pracovníkovi (`worker_tasks`) | **úkol** se štítkem původu | **task** | zadání, assignment |
| Milník | **milník** | **milestone** | cíl, goal, projekt |
| Cesta oboru | **cesta** | **path** | šablona, program, track |
| Poznámka | **poznámka** | **note** | dokument, zápisek, page |
| Myšlenková mapa | **myšlenková mapa** (krátce **mapa**) | **mind map** (**map**) | strom, diagram, outline |
| Kontakt | **kontakt** | **contact** | lead, zákazník (jen tabulka Klienti), person |
| Tabulka kontaktů | **tabulka** | **table** | seznam, list, složka, skupina |
| Vyhraný kontakt | **klient** (tabulka Klienti) | **client** (Clients) | zákazník, customer |
| Volání ze seznamu | **Cold Calling** (CS i EN) | **Cold Calling** | obvolávání, prospecting, dialer |
| Hovor | **hovor** | **call** | telefonát, volání |
| Položka v kalendáři | **událost** | **event** | item, entry, položka |
| Událost s druhým člověkem | **schůzka** | **meeting** | jednání, appointment, call |
| Termín zarezervovaný hostem přes plánovač | **rezervace** | **booking** | objednávka, appointment, slot |
| Typ schůzky v plánovači | **typ schůzky** | **meeting type** | event type, služba, produkt |
| Veřejná stránka plánovače | **rezervační stránka** | **booking page** | profil, landing page |
| Pracovní doba plánovače | **dostupnost** / **pracovní doba** | **availability** / **working hours** | hours, schedule |
| Obsazený čas | **obsazenost** / **obsazeno** | **busy** | zaneprázdněn, unavailable |
| Příjem / výdaj | **transakce** | **transaction** | pohyb, platba (jen Automatická platba), záznam |
| Opakující se platba | **automatická platba** | **recurring payment** | trvalý příkaz, subscription |
| Plán měsíce (tabulka) | **plán měsíce** | **month plan** | rozpočet, cash flow, sheet |
| Faktura | **faktura** | **invoice** | doklad (jen doklady Stripe), účtenka, bill |
| Dobropis | **dobropis** | **credit note** | storno faktura |
| Odběratel na faktuře | **odběratel** | **customer** | zákazník, klient, buyer |
| Dodavatel na faktuře | **dodavatel** | **supplier** | vystavitel, issuer |
| Člověk ve firmě (`workers`) | **pracovník** | **worker** | zaměstnanec, člen, uživatel, kolega, employee, teammate |
| Majitel prostoru | **majitel** | **owner** | admin, šéf, správce, manager |
| Nadřízený pracovníka | **nadřízený** | **manager** | vedoucí, supervisor, boss |
| Skupina pracovníků | **skupina** | **group** | tým, oddělení, team, department |
| Sekce Pracovníci | **Správa firmy** | **Company** | Pracovníci, Tým, Workers, Team |
| Prostor účtu | **firma** (Moje firma / cizí firma) | **company** | workspace, prostor (jen v kódu), space |
| Člen konverzace ve Zprávách | **člen** | **member** | účastník, participant, user |
| Účet v administraci | **uživatel** | **user** | účet (jen „Účet“ jako sekce), account |
| Ten, kdo rezervuje přes plánovač | **host** | **guest** | klient, zákazník, invitee |
| Odměna pracovníka | **odměna** | **reward** | bonus, provize (jen partnerům), commission |
| Provize partnera promo kódu | **provize** | **commission** | odměna |
| Tarif | **tarif** | **plan** | předplatné (jen sekce Předplatné), balíček, subscription, package, tier |
| Zkušební období | **zkušební období** / **zkušebka** | **trial** | demo, free period |
| Ukázková data tutoriálu | **ukázka** / **ukázková data** | **sample** / **sample data** | demo (jen v kódu), test |
| Průvodce sekcí (30.8) | **průvodce** (Rychlá ukázka · Všechno o této sekci) | **guide** (Quick look · Everything about this section) | tutoriál (jen úvodní), tour, walkthrough |
| Úvodní tutoriál | **tutoriál** | **tutorial** | průvodce, onboarding |
| Grady | **Grady** | **Grady** | asistent, AI, Jarvis, bot |
| Vzhled (téma) | **vzhled** | **theme** | téma, skin, motiv |
| Krátké ID účtu | **krátké ID** / **tvé ID** | **short ID** / **your ID** | identifikátor, kód účtu, token |
| Uživatelské jméno | **@jméno** / **uživatelské jméno** | **@name** / **username** | handle, nick, login |

## Akce

| Akce | CS | EN | Nepoužívat |
|---|---|---|---|
| Založit nový záznam | **Nový …** (Nový obchod, Nový kontakt, Nový úkol) | **New …** | Vytvořit, Přidat (jen pro přidání do existujícího: Přidat fázi, Přidat úkol k milníku), Create, Add |
| Uložit změny | **Uložit** | **Save** | Potvrdit, OK, Apply, Submit |
| Zrušit dialog | **Zrušit** | **Cancel** | Zavřít (jen pro panely bez formuláře), Zpět |
| Odstranit záznam | **Smazat** | **Delete** | Odstranit (jen „Odstranit z firmy“), Remove, Vymazat |
| Ukončit pracovníka | **Odstranit z firmy** | **Remove from the company** | Smazat, Deaktivovat |
| Vrátit poslední akci | **Zpět** | **Undo** | Vrátit, Revert |
| Vrátit hotové do rozpracovaného | **Znovu otevřít** | **Reopen** | Odznačit, Vrátit |
| Splnit úkol | **Hotovo** | **Done** | Dokončit (jen milník), Splnit, Complete |
| Dokončit milník | **Dokončit milník** | **Complete milestone** | Hotovo, Uzavřít |
| Posunout obchod | **Přesunout** (do fáze) | **Move** | Změnit fázi, Posunout |
| Druhotné akce stránky | **⋯ Další možnosti** | **⋯ More options** | Více, Nástroje, Menu, Options |
| Nahrát soubor | **Nahrát** | **Upload** | Vložit, Importovat (jen pro mapy a CSV) |
| Spustit průvodce | **Rychlá ukázka** · **Všechno o této sekci** | **Quick look** · **Everything about this section** | Tour, Tutorial |

## Technická slova, která na obrazovku nepatří

| Slovo | Místo něj |
|---|---|
| token, API klíč | „tajný odkaz“, „adresa“, „heslo pro aplikace“ (Apple) |
| sync, synchronizováno (jako stav uložení) | „Uloženo“; jen u Google / Apple kalendáře zůstává „synchronizace“ jako název funkce |
| ID (kromě „krátké ID“ / „tvé ID“ a „Apple ID“) | název záznamu, nikdy identifikátor |
| cache, session, cookie | „paměť“, „přihlášení“, pravidla v Soukromí |
| RLS, trigger, webhook, cron | nikdy; stav popsat lidsky („aplikace to hlídá sama“) |
| workspace, space, prostor | „firma“, „Moje firma“ |
| CRM | nikdy; „obchody a kontakty“ |
| demo (v rozhraní) | „ukázka“ |
| error, exception | „chyba“ s kódem GR-… jen v hlášení problému |

## Pravidlo

Nový text používá slovo z tabulky. Nová věc = nový řádek sem a do CLAUDE.md
(sekce Rozhraní). Před přidáním jiného slova pro totéž: hledat v `cs.json`,
jak se to už jmenuje.
