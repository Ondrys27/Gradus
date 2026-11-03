# Správa firmy, chat, sbalené menu — kolo 12

Instrukce pro Claude Code. Proveď kroky 1 až 3 přesně a doslova. Obsah k vložení je vždy mezi řádky `=== ZAČÁTEK` a `=== KONEC`. Prompty samotné neprováděj — provedou se příkazem `/pokracuj` (nebo nočním během `scripts/noc.sh`).

---

## Krok 1 — Na konec `docs/plan.md` přidej tohle

=== ZAČÁTEK

---

# FÁZE 19 — Správa firmy

*Pořadí: hierarchie a skupiny (19.2) jsou základ pro dashboard pracovníka (19.3) i chat (19.4).*

## Prompt 19.1 — Sbalitelné menu · **Opus 5.5**

```
Levé menu jde sbalit na samotné ikony.

1. Na širokých obrazovkách (lg+) přepínač ve spodní části menu
   (ikona PanelLeftClose / PanelLeftOpen) a zkratka ⌘/Ctrl+B.
   Sbalený stav = stejná šířka a vzhled, jaký má menu dnes na md
   (jen ikony, --spacing(19)); rozbalený = dnešní lg. Obsah
   stránky se přizpůsobí šířce (app-shell padding), s plynulým
   přechodem 200 ms, reduced motion bez animace.
2. Ve sbaleném stavu tooltip s názvem položky při najetí a fokusu,
   aktivní položka zvýrazněná stejně, odznaky (nepřečtené) zůstanou
   viditelné jako tečka u ikony.
3. Volba se pamatuje v user_settings (sidebar_collapsed) a platí
   napříč zařízeními; první vykreslení už respektuje uloženou
   hodnotu (bez probliknutí — stav do HTML ze serveru).
4. Pracovník i majitel. Na md se nic nemění, na telefonu spodní
   lišta beze změny. E2E: sbalit → obnovit stránku → zůstalo
   sbalené → ⌘B rozbalí.
```

---

## Prompt 19.2 — Správa firmy: hierarchie a skupiny · **Opus 5.5**

```
Sekce Pracovníci se mění na Správa firmy: kompletní správa lidí
ve firmě s hierarchií a skupinami.

1. PŘEJMENOVÁNÍ. Menu: CS „Správa firmy", EN „Company". Adresa
   /app/firma, /app/pracovnici přesměruje. Ikona Building2.
   Jarvis, nápovědy, analytika a CLAUDE.md přejmenovat.
2. HIERARCHIE. Sloupec workers.manager_id (null = přímo pod
   majitelem). Majitel je vždy kořen (není v tabulce workers;
   zobrazuje se jako uzel „ty" nahoře). Cyklus zakázaný (kontrola
   v DB funkci i v UI). Pracovník může mít pod sebou další
   pracovníky; hloubka neomezená, UI počítá s 5+.
3. DVA POHLEDY, přepínač jako u milníků (seznam / mapa) s pamětí
   volby:
   - Seznam: strom s odsazením, sbalování větví, u každého: foto,
     jméno, pozice, skupiny (štítky), počet otevřených úkolů
     a obchodů, stav (aktivní / pozvaný / ukončený). Přesun pod
     jiného nadřízeného tažením nebo nabídkou „Přesunout pod…"
     (stejný princip jako úkoly v 18.1).
   - Mapa: organizační strom shora dolů (majitel nahoře), uzly
     jako karty s fotem a jménem, hrany, zoom a posun
     (react-zoom-pan-pinch jako mapa úkolů), přesun tažením uzlu
     na nového nadřízeného; podstrom se přesouvá s ním. Na
     telefonu jeden prst scrolluje stránku, mapa se posouvá dvěma.
   Klik na pracovníka v obou pohledech otevře dashboard z 19.3.
4. SKUPINY. Tabulky worker_groups (owner_id, name, color, description,
   position) a worker_group_members (group_id, worker_id). Pracovník
   může být v libovolném počtu skupin nebo v žádné. Správa skupin:
   panel/záložka „Skupiny" v sekci — založit, přejmenovat, barva,
   popis, členové (přidat/odebrat), smazat (členství zaniká,
   pracovníci zůstávají). Filtr seznamu i mapy podle skupiny.
5. Dnešní obsah sekce (pozvánky, odměny, výplaty, čas) zůstává
   dostupný: pozvánka jako tlačítko „+ Pozvat pracovníka" nahoře
   (s výběrem nadřízeného a skupin), odměny/výplaty/čas se
   přesouvají do dashboardu pracovníka (19.3) a do souhrnné
   záložky „Odměny a výplaty" v sekci.
6. Práva: hierarchii, skupiny a dashboardy vidí a mění majitel;
   pracovník vidí v Správě firmy jen svou větev (sebe a podřízené,
   jen čtení) a svůj dashboard — pokud mu majitel nedá právo
   „správa firmy: upravovat" (viz 19.3, bod 4).
7. RLS, Vitest pro cyklus a přesun podstromu, E2E: pozvat
   pracovníka pod jiného → mapa ukazuje strom → přesun tažením →
   seznam souhlasí → skupina založená, pracovník přidán, filtr.
   Doplň CLAUDE.md sekci Správa firmy.
```

---

## Prompt 19.3 — Dashboard pracovníka · **Opus 5.5**

```
Klik na pracovníka ve Správě firmy otevře velké okno (jako detail
obchodu z 17.2: modal ~960 px, na telefonu celá obrazovka se
záložkami) s jeho přehledným dashboardem. Vzhled podle CLAUDE.md
a skillu frontend-design: hlavička s fotem a jménem, pod ní
záložky Přehled · Práva · Obchody a úkoly · Dokumenty · Tým.

1. INFORMACE: jméno, příjmení (rozděl dnešní name na first_name
   a last_name přidávacími sloupci, name zůstane synchronizované),
   e-mail, telefon, pozice, fotografie (nahrání do bucketu
   worker-avatars, ořez, max 2 MB). Vše editovatelné na místě
   majitelem; pracovník si může upravit vlastní foto a telefon.
2. POPIS: volný text (workers.description), markdown jednoduchý.
3. SKUPINY: štítky s možností přidat/odebrat (výběr ze skupin
   z 19.2), odkaz na správu skupin.
4. PRÁVA (záložka Práva): seznam všech sekcí aplikace (nástěnka,
   milníky, poznámky, kontakty, pipeline, úkoly, cold calling,
   kalendář, finance, faktury, správa firmy, nastavení) — u každé
   přepínač „vidí sekci" a po rozkliknutí jemná práva pro tu
   sekci. Zaveď katalog práv v kódu
   (src/features/workers/permissions-catalog.ts), např.:
   kontakty: zobrazit / zakládat / upravovat / mazat / exportovat /
   generovat; pipeline: zobrazit vše / jen své obchody / zakládat /
   měnit fázi / měnit částku / mazat / vidět částky; úkoly: zobrazit
   vše / jen své / zakládat / přiřazovat jiným / mazat; finance:
   zobrazit / zapisovat / vidět souhrny / vystavovat faktury;
   kalendář: zobrazit vše / jen své / zakládat; cold calling:
   volat / vidět statistiky ostatních; správa firmy: zobrazit svou
   větev / zobrazit vše / upravovat; nastavení: žádné (vlastní
   účet vždy). Tabulka worker_permission_grants (worker_id,
   section, action, allowed) vedle dnešní worker_permissions;
   can_view/can_edit se z ní odvozují (migrace převede dnešní
   stav: can_edit = všechny akce sekce, can_view = jen zobrazit).
   useCan(section, action) v klientu i na serveru; každá serverová
   akce a RLS kontroluje jemné právo. Šablony: „Obchodník",
   „Asistent", „Účetní", „Vše" — jedním klikem přednastaví.
5. OBCHODY: seznam obchodů, kde je pracovník assignee (z 17.2):
   název, fáze, částka, Close Date; klik otevře obchod.
6. ÚKOLY: otevřené nahoře, pod nimi historie všech úkolů
   pracovníka (crm_tasks i úkoly od majitele): název, termín,
   výsledek — splněno v termínu zeleně, splněno po termínu
   oranžově, nesplněno (otevřený po termínu) červeně; filtr
   podle výsledku a období.
7. DOKUMENTY: bucket worker-documents (soukromý, podepsané URL,
   max 20 MB/soubor, PDF/obrázky/office), tabulka worker_documents
   (name, path, size, mime, uploaded_by, created_at). Nahrát
   přetažením, přejmenovat, stáhnout, smazat. Vidí majitel a ten
   pracovník (jen čtení); nikdo jiný, ani jeho nadřízený, pokud
   nemá právo „správa firmy: upravovat".
8. TÝM: podřízení pracovníci (přímí i celá větev s počtem), klik
   otevře jejich dashboard; nadřízený s odkazem.
9. GRAFY (záložka Přehled): a) splněné úkoly v čase — sloupce
   po dnech/týdnech podle horizontu, barvy jako v bodě 6;
   b) obchody v péči a jak dopadly — vyhráno / ztraceno / otevřeno
   v čase a součet hodnoty; u obou přepínač horizontu týden ·
   měsíc · kvartál · rok · vlastní rozsah. Recharts podle skillu
   dataviz, stejný styl jako administrace. Nahoře 4 čísla: otevřené
   úkoly, po termínu, otevřené obchody, vyhráno za horizont.
10. ODSTRANIT Z FIRMY: dole v červené zóně, potvrzení s dopadem
    (kolik obchodů a úkolů má v péči → nabídka přiřadit jinému
    pracovníkovi nebo majiteli), ukončí přístup okamžitě, data
    zůstávají, pracovník má stav „ukončený" a je vidět ve filtru.
11. Odměny, výplaty a čas (dnešní panely) jako další záložka
    „Odměny" ve stejném okně.
12. RLS všeho, Vitest pro výpočet výsledku úkolu a grafů, E2E:
    otevřít dashboard → změnit foto a pozici → nastavit šablonu
    Obchodník → přihlásit se jako pracovník a ověřit, co vidí
    a nevidí → nahrát dokument → odstranit pracovníka s přiřazením
    obchodů majiteli.
```

---

## Prompt 19.4 — Chat: skupiny a přímé zprávy · **Opus 5.5**

```
Chat uvnitř firmy jako WhatsApp: skupinové konverzace podle skupin
pracovníků a přímé zprávy mezi lidmi ve firmě (majitel i
pracovníci).

1. DATA. chat_channels (owner_id prostor, kind group|direct,
   group_id pro skupinové — 1:1 se skupinou z 19.2, název
   a barva ze skupiny; pro direct dvojice členů, unikátní),
   chat_members (channel_id, member — majitel nebo worker_id,
   last_read_at, muted), chat_messages (id, channel_id, sender,
   body text max 4 000 znaků, attachments JSON — obrázky a soubory
   v bucketu chat-attachments max 10 MB, created_at, edited_at,
   deleted_at). Skupinový kanál vzniká a mění členy automaticky
   se skupinou; přímý kanál vzniká při první zprávě. RLS: jen
   členové kanálu; majitel je člen všech skupinových kanálů;
   nikdo mimo prostor. Jarvis chat nečte. Realtime přes Supabase
   Realtime (postgres_changes na chat_messages s RLS) — zapni
   publikaci pro tabulku v migraci.
2. ROZHRANÍ. Sekce Zprávy v menu (ikona MessageCircle, EN
   „Messages", CS „Zprávy") s odznakem počtu nepřečtených; na
   telefonu i ve spodní liště. Rozvržení jako WhatsApp Web: vlevo
   seznam konverzací (skupiny a lidé, poslední zpráva, čas,
   nepřečtené, hledání, připnutí), vpravo konverzace: bubliny
   (vlastní vpravo), seskupení po odesílateli a čase, oddělovače
   dnů, „přečteno" u skupin počtem, psaní (Enter odešle, Shift+Enter
   nový řádek), příloha, náhled obrázků, odpověď na zprávu
   (citace), úprava a smazání vlastní zprávy do 15 minut
   („zpráva smazána"), @zmínka člena s našeptávačem. Odkaz na
   obchod/kontakt/úkol vložený jako URL se vykreslí jako čip
   (jako v poznámkách 15.3). Na telefonu seznam → konverzace,
   klávesnice bez skákání (use-keyboard-inset).
3. OZNÁMENÍ. Nepřečtené v menu a v titulku karty; zvuk volitelný;
   při @zmínce nebo přímé zprávě, když je uživatel offline déle
   než 10 minut, e-mail přes Resend (souhrn, max jeden za hodinu
   na uživatele, vypnutelné v nastavení Jarvise/oznámení).
   Zprávy od majitele pracovníkovi, který ještě nepřijal pozvánku,
   počkají v kanálu.
4. SPRÁVA. Majitel může skupinový chat ztišit pro všechny
   (oznámení), smazat zprávu kohokoli, exportovat konverzaci
   (CSV, do admin_audit není potřeba — to je prostor uživatele,
   ne administrace Gradusu). Odstraněný pracovník ztrácí přístup
   hned, jeho zprávy zůstávají se jménem.
5. Výkon: stránkování po 50 zprávách nahoru, virtualizace
   seznamu, optimistické odeslání s opakováním při výpadku,
   indexy na (channel_id, created_at). Retence: zprávy se
   nemažou; přílohy po 1 roce bez otevření do koše (cron denně).
6. Analytika jen počty (chat_message_sent, s kind), nikdy obsah.
   Vitest pro nepřečtené a vznik kanálů; E2E ve dvou prohlížečích
   (majitel + pracovník): zpráva dorazí bez obnovení, odznak,
   přečteno, @zmínka, skupinový kanál po přidání do skupiny.
   Doplň CLAUDE.md sekci Zprávy.
```

---

## Kontrola fáze 19 · **Opus 5.5**

```
Zkontroluj fázi 19 podle CLAUDE.md:
- jemná práva: každá serverová akce a RLS používá
  worker_permission_grants; projdi katalog a ověř, že pro každou
  akci existuje kontrola na serveru, ne jen v UI; pracovník se
  šablonou Asistent nesmí vidět částky ani finance ani přes
  přímé URL a RPC,
- hierarchie bez cyklu i při souběhu, odstranění pracovníka
  s podřízenými (podřízení přejdou pod jeho nadřízeného),
- dokumenty a přílohy chatu: podepsané URL s krátkou platností,
  nikdo mimo členy/majitele, typ a velikost ověřené na serveru,
- chat: RLS na chat_messages i přes Realtime (zkus odběr cizího
  kanálu), ztráta spojení neztratí rozepsanou ani odesílanou
  zprávu, smazaná zpráva nejde číst přes API,
- sbalené menu bez probliknutí a bez posunu rozvržení,
- migrace jen přidávací, bun run lint, test, build a e2e projdou.
```

=== KONEC

---

## Krok 2 — Do `docs/progress.md` vlož tyhle řádky těsně PŘED řádek začínající `- [ ] 7.1`

=== ZAČÁTEK
- [ ] 19.1 | architect |
- [ ] 19.2 | architect |
- [ ] 19.3 | architect |
- [ ] 19.4 | architect | env: RESEND_API_KEY
- [ ] K19 | reviewer |
- [ ] STOP | Konec fáze 19. Sbal menu ⌘B a obnov stránku. Ve Správě firmy pozvi dva pracovníky (druhý pod prvního), přepni seznam/mapa, přesuň tažením, založ skupinu. Otevři dashboard pracovníka: změň foto, dej šablonu Obchodník, nahraj dokument, podívej se na grafy s různým horizontem. Přihlas se jako pracovník a ověř, co vidí. Ve Zprávách si napiš ve dvou prohlížečích v přímé i skupinové konverzaci, zkus @zmínku, přílohu a smazání zprávy. Co nesedí, napiš Claude Code rovnou, pak /pokracuj.
=== KONEC

---

## Krok 3 — Dokončení

Ověř `git check-ignore -v .env.local`, commitni, pushni a napiš uživateli česky, kolik položek přibylo a že může spustit `caffeinate -i bash scripts/noc.sh --bez-zastavek` nebo `/clear` a `/pokracuj`. První poběží 19.1.
