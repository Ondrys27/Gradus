# E2E test hlavních cest (prompt 12.3)

`bun run e2e` — Playwright, `tests/e2e/`. Testy si zakládají interní účty `e2e-…@gradus.local`
(is_internal = true) a po sobě je mažou (i po pádu: úklid před a po celém běhu). Každý test
padá na jakékoliv chybě v konzoli prohlížeče, nezachycené výjimce i odpovědi serveru 5xx.

Poslední běhy (13. 10. 2026), 21 testů (14 cest + 7 starších):

- proti dev serveru: **21 passed**
- proti produkčnímu buildu (`E2E_BUILD=1`, viz `playwright.config.ts`): **21 passed**, bez jediné výjimky

| Cesta | Výsledek | Co bylo opraveno |
|---|---|---|
| 1. Web odhlášený → Vyzkoušet / čekací listina podle `PUBLIC_SIGNUP_ENABLED` | prošlo (varianta „off“: čekací listina, bez souhlasu server odmítne) | — |
| 2. Registrace s kódem → onboarding (hra, obor) → průvodce Jarvisem → dashboard | prošlo | Průvodce: bublina s tlačítkem Další na kroku „Jarvis“ pořád ujížděla, protože tlačítko Jarvise se pohupuje a bublina ho následovala. Během průvodce teď tlačítko stojí (`jarvis-button.tsx`). |
| 3. Totéž v běžném režimu, anglicky | prošlo | (jako 2) |
| 4. Milník → 3 úkoly, podúkol → zamčení/odemčení nadřazeného → dokončení → oslava | prošlo | — (test počítá s mezioslavou „Nový odznak!“) |
| 5. Kontakt ručně → Domluvená schůzka s otázkami → událost v kalendáři | prošlo | — |
| 6. Obchod → přetažení až do Vyhráno → oslava → kontakt v Klientech → příjem ve financích | prošlo | Chyba testu (čekal na text, který obsahovalo i tlačítko „Založit kontakt“, a obchod se tak uložil bez kontaktu). Test teď navíc ověřuje kontakt a výhru v DB. Průzkum „Jak schůzka dopadla?“ test přeskočí. |
| 7. Cold calling: časovač start/pauza, přesun z Neoslovených, graf ukazuje dnešek | prošlo | — |
| 8. ⌘K najde kontakt bez diakritiky a podle části telefonu | prošlo | — |
| 9. Pracovník přes pozvánku: s právem na kontakty je vidí, finance ne | prošlo | — |
| 10. Jarvis odpoví na zprávu | prošlo (klíč je nastaven) | Hydratace pro lidi s omezeným pohybem: `jarvis.tsx` četl `useReducedMotionConfig`, styl záře se lišil od HTML ze serveru. |
| 11. Generování kontaktů | prošlo (klíč je nastaven) | Pole „Kolik kontaktů“: číslo napsané dřív, než se načetly limity, se srazilo na 1 s hláškou o limitu. Nově `fitCount` (+ Vitest). |
| 12. Nastavení: jazyk, měna, pásmo | prošlo | Chyba testu: uložená částka si nese vlastní měnu (nic se nepřepočítává); test teď ověřuje náhled a výchozí měnu nového obchodu. |
| 13. Telefon 390 px: dashboard, pipeline, cold calling, kalendář | prošlo | — |
| 14. /admin pro běžného uživatele → 404 | prošlo | — |

## Opravy napříč aplikací

- **Hydratace s omezeným pohybem (prefers-reduced-motion):** komponenty větvily vykreslení podle
  `useReducedMotion` z framer-motion, který zná nastavení už při prvním vykreslení v prohlížeči
  → hydratace selhala (u tlačítka Jarvise se strom celý překresloval). Nový hook
  `useReducedMotionSafe` (`src/lib/use-media-query.ts`) v 21 komponentách aplikace.
  Vynecháno `src/features/workers/worker-task-list.tsx` (rozpracované jiným agentem).
- **AppShell jako jedna klientská komponenta:** devět sourozenců přicházelo ze serveru jako
  samostatné klientské reference a jejich (ne)načtení posouvalo `useId`.
- **`next.config.ts`:** vypnutý vývojový segment explorer (v dev přidával uzly a posouval `useId`);
  `NEXT_DIST_DIR` dovolí sestavit build vedle běžícího dev serveru.

## Známé výjimky a poznámky

- **Posun `useId` jen v `next dev`:** pod zátěží dev server občas hydratuje s jinými `useId`
  (Base UI `base-ui-_R_…`, gradienty Jarvise `jv_R_…`). Liší se jen tato id. Ověřeno: celý běh
  proti produkčnímu buildu je bez jediné hydratační hlášky. Proto proti dev serveru (a jen tehdy)
  test tuto jednu hlášku vypíše („Dev-only useId hydration shift … (not counted)“) a nepočítá ji;
  jakýkoliv jiný rozdíl v hydrataci dál shodí test. Proti buildu (`E2E_BUILD=1`) platí bez výjimky.
- **Nikdy dva `next dev` ve stejné složce:** běžely dva (VS Code na :3001 a další na :3000), sdílely
  `.next` a dev server pak náhodně vracel 500 („module factory is not available“). Pokud už
  dev server běží na jiném portu, spouštěj `E2E_BASE_URL=http://localhost:3001 bun run e2e`.
- Jarvis (cesta 10) a generování (11) volají placená API (Anthropic, Google Places); bez klíčů
  se přeskočí. Vytvoření milníku navíc spouští Jarvisovo hodnocení (volání modelu).
