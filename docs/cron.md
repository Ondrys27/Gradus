# Naplánované úlohy

Všechny úlohy spouští Vercel Cron podle `vercel.json`. Běžíme na **Vercel Hobby**: každá úloha smí běžet nejvýš jednou denně a Vercel ji spustí kdykoli během zadané hodiny (ne přesně v minutu). Častější běh vrátit až po přechodu na Vercel Pro.

## Zabezpečení

- Každá úloha jde přes `runCron()` (`src/lib/analytics/instrument.ts`), který nejdřív ověří hlavičku `Authorization: Bearer <CRON_SECRET>` (`src/lib/cron/verify.ts`, porovnání v konstantním čase). Bez ní odpoví `401` a nic nespustí.
- **Bez nastaveného `CRON_SECRET` neproběhne nic.** Proměnnou nastav ve Vercelu (Production); Vercel ji sám posílá v hlavičce.
- Každý běh se zapíše do analytiky (`cron_run`: úloha, výsledek, doba, počet). Chyba úlohy jde do `error_events` a majiteli e-mailem jako každá jiná chyba.
- Hlídá to test `src/lib/cron/cron.test.ts`: každá route v `src/app/api/cron/*` jde přes `runCron`, každá je ve `vercel.json`, žádná neběží častěji než jednou denně a každá je v tomhle dokumentu.

## Přehled

Časy jsou v UTC (Vercel Cron jinak neumí). V Česku je to v zimě +1 h, v létě +2 h.

| Úloha | Cesta | Kdy (cron) | Kdy (Česko, zima) | Co dělá a proč |
|---|---|---|---|---|
| Metriky | `/api/cron/metrics-daily` | `45 1 * * *` | 2:45 | Uloží denní metriky za včerejšek (a předvčerejšek kvůli opožděným událostem) do `metrics_daily`, ať administrace načte rok najednou. Dnešek se počítá živě. |
| Graf času volání | `/api/cron/call-time-stats` | `30 2 * * *` | 3:30 | Přepočítá sdílený graf nejlepšího času volání (`refresh_call_time_stats`). Z jednoho uživatele započítá nejvýš 30 pokusů na hodinu a den; v `call_time_stats` jsou jen země, den, hodina, pokusy, schůzky. |
| Automatické platby | `/api/cron/recurring-payments` | `0 3 * * *` | 4:00 | Zaúčtuje splatné opakované platby (`post_due_recurring_payments`) — jedna transakce na splatný den v pásmu uživatele, takže dvojí běh nic nezaúčtuje dvakrát. Pak srovná předplatná se Stripe (`reconcile.ts`): nejvýš 200 běžících řádků s `provider=stripe` v režimu klíče, nejdéle nesrovnané první, načte předplatné ze Stripe a opraví odchylky po zmeškaném webhooku (DB nedovolí přepsat novější stav) a počet pracovníků navíc od dalšího období; souhrn (zkontrolováno, opraveno, pracovníci, chyby) do logu i odpovědi. Nakonec pošle majiteli aplikace souhrn prvních plateb a předplatných ukončených po posledním neúspěšném pokusu, které čekají (`billing_alerts_claim`, nejvýš jeden e-mail denně). Bez klíče Stripe jen zaúčtuje platby. |
| Odebírané kalendáře | `/api/cron/calendar-subscriptions` | `20 3 * * *` | 4:20 | Znovu stáhne tajné odkazy ICS odebíraných kalendářů (Nastavení → Kalendář), nejdéle nestažené první, nejvýš 200 za běh, po čtyřech najednou; uloží jen obsazené časy na 60 dní dopředu (`calendar_subscriptions.busy`), nikdy události. Zdroj, který selže, nechá poslední obsazené časy a zapíše kód chyby. Mimo cron se kalendář obnoví při otevření rezervační stránky (24.4) a v náhledu typu schůzky, když je starší než 10 minut. Potom rezervace (24.4): smaže vypršená držení termínu a počty návštěv starší dvou dnů (`scheduler_cleanup()`) a naplánuje v Resendu připomínky potvrzených schůzek, které byly při rezervaci dál než 30 dní a teď se do okna dostaly (nejvýš 500 rezervací za běh). |
| Úklid analytiky | `/api/cron/analytics-retention` | `15 4 * * *` | 5:15 | Smaže události, relace, záznamy využití a statistiky klíčových slov starší než 13 měsíců (`purge_analytics`). |
| Koš poznámek | `/api/cron/notes-trash` | `30 4 * * *` | 5:30 | Natrvalo smaže poznámky, které jsou v koši 30 dní (`purge_deleted_notes`). |
| Přílohy zpráv | `/api/cron/chat-attachments` | `45 4 * * *` | 5:45 | Přílohy Zpráv, které nikdo rok neotevřel, přesune do koše (`trash/…` v bucketu, majitel je může obnovit); smaže soubory smazaných zpráv a nahrané soubory, které žádná zpráva neodeslala (`chat_attachments_due`, `chat_orphan_uploads`). Zprávy samy se nemažou. |
| Ranní shrnutí Gradyho | `/api/grady?task=briefing` | `0 5 * * *` | 6:00 (v létě 7:00) | Napíše ranní shrnutí (Sonnet) uživatelům, kterým je v jejich pásmu 6–10 h a souhrn je podle frekvence dnes na řadě (denně; týdně první den týdne; měsíčně 1.), ne v den onboardingu a ne když ho dnes už vyřídil první příchod. Prázdný den = žádné volání modelu. Po vyčerpání rozpočtu AI se nepíše. |
| Chyby: souhrn a úklid | `/api/cron/error-alerts` | `0 7 * * *` | 8:00 | V režimu souhrnu pošle jeden e-mail s chybami, které čekaly; smaže záznamy chyb starší než 13 měsíců (`purge_error_events`). |
| Kurzy měn | `/api/cron/exchange-rates` | `15 16 * * *` | 17:15 | Stáhne kurzy proti EUR z ECB (frankfurter.app, ~30 měn) a pro ostatní z open.er-api.com (~160 měn), oba bez klíče, do `exchange_rates`; jak který zdroj dopadl, zapíše do `exchange_rate_sources` (Administrace → Zdraví). Zdroj, který selže, nechá poslední kurzy; kurz starší než 7 dní se pro cenu nepoužije (cena v EUR). Uložené částky nikdy nepřepočítává. |
| Hlídání příležitostí (noční analýza) | `/api/grady?task=watch` | `0 10 * * *` | 11:00 | Dávková kontrola příležitostí pro všechny účty: zapíše návrhy do `jarvis_suggestions`. Po vyčerpání rozpočtu AI běží jen z pravidel bez modelu. Když není co říct, nic nezapíše. |

## Co v seznamu není a proč

- **Fakturoid**: napojení bylo odstraněno, faktury jsou jen v aplikaci (CLAUDE.md → Faktury). Žádná úloha pro Fakturoid neexistuje a nemá se přidávat.
- **Nepotvrzené e-maily čekací listiny** starší 30 dní maže každé nové přihlášení na čekací listinu (`waitlist-actions.ts`), vlastní úlohu nepotřebují.
- **Půlnoční nulování časovače** neexistuje záměrně: denní součty se počítají z úseků oříznutých na den.

## Ruční spuštění

Pro kontrolu na produkci (nahraď tajemství a doménu):

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<doména>/api/cron/notes-trash
```

Bez hlavičky musí přijít `401 {"error":"unauthorized"}`. Ve Vercelu je ruční spuštění i v Settings → Cron Jobs → Run.

## Nová úloha

1. Route `src/app/api/cron/<název>/route.ts`, jen `GET`, celé tělo v `runCron("<job>", request, …)`.
2. Název úlohy do `CRON_JOBS` v `src/lib/analytics/events.ts`.
3. Záznam do `vercel.json` s během nejvýš jednou denně.
4. Řádek do tabulky výše (test kontroluje cestu i čas).
