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
| Automatické platby | `/api/cron/recurring-payments` | `0 3 * * *` | 4:00 | Zaúčtuje splatné opakované platby (`post_due_recurring_payments`) — jedna transakce na splatný den v pásmu uživatele, takže dvojí běh nic nezaúčtuje dvakrát. |
| Úklid analytiky | `/api/cron/analytics-retention` | `15 4 * * *` | 5:15 | Smaže události, relace, záznamy využití a statistiky klíčových slov starší než 13 měsíců (`purge_analytics`). |
| Koš poznámek | `/api/cron/notes-trash` | `30 4 * * *` | 5:30 | Natrvalo smaže poznámky, které jsou v koši 30 dní (`purge_deleted_notes`). |
| Ranní shrnutí Jarvise | `/api/jarvis?task=briefing` | `0 5 * * *` | 6:00 (v létě 7:00) | Napíše ranní shrnutí (Sonnet) uživatelům, kterým je v jejich pásmu 6–10 h a souhrn je podle frekvence dnes na řadě (denně; týdně první den týdne; měsíčně 1.), ne v den onboardingu a ne když ho dnes už vyřídil první příchod. Prázdný den = žádné volání modelu. Po vyčerpání rozpočtu AI se nepíše. |
| Chyby: souhrn a úklid | `/api/cron/error-alerts` | `0 7 * * *` | 8:00 | V režimu souhrnu pošle jeden e-mail s chybami, které čekaly; smaže záznamy chyb starší než 13 měsíců (`purge_error_events`). |
| Hlídání příležitostí (noční analýza) | `/api/jarvis?task=watch` | `0 10 * * *` | 11:00 | Dávková kontrola příležitostí pro všechny účty: zapíše návrhy do `jarvis_suggestions`. Po vyčerpání rozpočtu AI běží jen z pravidel bez modelu. Když není co říct, nic nezapíše. |

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
