# Ukázkový režim: scénáře videí

Podklad pro Vášu a střih (krok 27.4). Aplikace se v ukázce ovládá sama: kurzor jezdí, kliká a píše,
dole běží titulky. Všechno se odehrává ve skutečné aplikaci nad ukázkovými daty v dočasném
ukázkovém účtu (po skončení se smaže), volání Gradyho i hledání firem mají připravené odpovědi,
takže video vypadá pokaždé stejně a nic nestojí.

## Jak video vzniká

- **Ručně:** Administrace → Nastavení → Ukázkový režim → zapnout. Pak v aplikaci
  `/app/ukazka?scenar=a&jazyk=cs&velikost=1920x1080` (nebo třetí volba „Ukázka (Beta)“ v tutoriálu),
  Spustit ukázku. Spuštěním se odhlásíš, ukázka běží v ukázkovém účtu. Odpočet 3-2-1, pak hraje.
  Mezerník = pauza, R = znovu s čerstvými daty, Esc = konec a smazání dat. Velikost plátna nastav
  oknem prohlížeče (vývojářské nástroje → režim zařízení: 1920 × 1080, 1080 × 1920, 1080 × 1080).
- **Bez člověka:** `bun run demo:record -- --scenar f --jazyk cs,en --velikost 1920x1080,1080x1920`
  (běžící `bun run dev`). Výstup `marketing/videa/<scenar>-<jazyk>-<velikost>.mp4` (bez ffmpeg
  `.webm`) a titulky `.srt` se stejnými texty a časy. Převod webm → mp4:
  `ffmpeg -i in.webm -c:v libx264 -pix_fmt yuv420p -crf 18 out.mp4`. Video z `.webm` začíná
  ~4,5 s před prvním krokem (načtení a odpočet), `.srt` s tím počítá.
- Titulky jsou v aplikaci vypálené v obraze; `.srt` slouží pro sítě, které chtějí titulky zvlášť
  (nebo pro střih bez vypálených titulků).

Časy níže jsou od prvního kroku (po odpočtu), naměřené na vývojovém serveru v češtině při
1920 × 1080. V angličtině se liší o pár sekund (jiné délky psaných textů).

## a) Od nápadu k prvnímu klientovi (~55 s)

| Čas | Co se děje | Titulek CS | Titulek EN |
|---|---|---|---|
| 0–13 s | Milníky → milník „Získat prvních 5 klientů“, kurzor dopíše úkol „Oslovit 10 kaváren v centru“, přepne na mapu úkolů | Velký cíl rozdělený na malé kroky | A big goal split into small steps |
| 13–26 s | Kontakty → Vygenerovat: „kavárny“, „Brno“ → nalezené firmy → Ukázat nové | Firmy k oslovení najdeš jedním klikem | Find businesses to contact in one click |
| 26–35 s | Cold Calling → Kavárna Pod Lípou → Přesunout do → Domluvená schůzka → Dnes → Přesunout | Volej a posouvej kontakty dál | Call and move contacts along |
| 35–38 s | Nabídka „Založit obchod“ → Vytvořit | Ze schůzky rovnou obchod | From a meeting straight to a deal |
| 38–54 s | Pipeline → obchod se přetáhne do Vyhráno → oslava s konfetami a XP | Vyhraný obchod? Pořádně ho oslav! | Won a deal? Celebrate it properly! |

Příspěvek CS: „Od prvního nápadu k prvnímu klientovi. Rozděl cíl na kroky, najdi firmy k oslovení,
volej a každý vyhraný obchod pořádně oslav. Takhle vypadá podnikání v Gradusu.“
EN: “From the first idea to the first client. Split the goal into steps, find businesses to call,
pick up the phone and celebrate every deal you win. This is running a business in Gradus.”

## b) Grady (~43 s)

| Čas | Co se děje | Titulek CS | Titulek EN |
|---|---|---|---|
| 0–8 s | Poznámky → „Ideální zákazník“ | Všechno o podnikání máš v poznámkách | Everything about your business in notes |
| 8–20 s | Grady → dotaz „Jak mám oslovit ideálního zákazníka?“ → odpověď z poznámky (připravená, stejná pokaždé) | Zeptej se Gradyho, odpoví z poznámek | Ask Grady, he answers from your notes |
| 20–28 s | Uložit do poznámek → Nová poznámka → otevřít ji | Dobrou radu uložíš jedním klikem | Save good advice in one click |
| 28–38 s | Přehled → Grady přiletí s ranním souhrnem → Díky | Ráno tě čeká souhrn dne | A summary of the day every morning |

Příspěvek CS: „Grady zná tvoje poznámky. Zeptáš se ho a odpoví podle toho, co sis o svém podnikání
zapsal. Dobrou radu uložíš jedním klikem a ráno tě čeká souhrn dne.“
EN: “Grady knows your notes. Ask him and he answers from what you wrote about your business. Save a
good answer in one click, and start each morning with a summary of the day.”

## c) Plánovač schůzek (~40 s)

| Čas | Co se děje | Titulek CS | Titulek EN |
|---|---|---|---|
| 0–6 s | Plánovač schůzek → typ „Úvodní konzultace“ | Klient si schůzku zarezervuje sám | Clients book the meeting themselves |
| 6–12 s | Kopírovat odkaz → vedle se otevře okno klienta s veřejnou stránkou | Pošli mu odkaz na svůj kalendář | Send them a link to your calendar |
| 12–27 s | V okně klienta: den → čas → jméno a e-mail → Rezervovat → potvrzení | Vybere si termín, který ti sedí | They pick a time that suits you |
| 27–31 s | Kalendář se schůzkou | Schůzka je hned v kalendáři | The meeting is in your calendar |
| 31–35 s | Kontakty → nový kontakt z rezervace | A klient rovnou v kontaktech | And the client is in your contacts |

Příspěvek CS: „Přestaň si s klienty psát o termínu. Pošli odkaz, klient si vybere čas, který ti
sedí, a schůzka je hned v kalendáři i s kontaktem.“
EN: “Stop emailing back and forth about a time. Send a link, your client picks a slot that suits
you, and the meeting lands in your calendar with the contact.”

## d) Firma (~57 s)

| Čas | Co se děje | Titulek CS | Titulek EN |
|---|---|---|---|
| 0–6 s | Správa firmy, strom lidí | Celá firma na jednom místě | Your whole company in one place |
| 6–20 s | Pozvat pracovníka: jméno, e-mail → Vytvořit → odkaz pozvánky | Kolegu pozveš jedním odkazem | Invite a colleague with one link |
| 20–26 s | Pozvánka → Dál → role Obchodník (krok „Co bude moci“) | Práva nastavíš jedním klikem | Set their rights in one click |
| 26–41 s | Úkoly → Nový úkol: název, U čeho, Kdo = Tomáš → Vytvořit | Úkol mu předáš s termínem | Hand them a task with a deadline |
| 41–53 s | Zprávy → Tomáš → zpráva → odeslat | A domluvíte se ve zprávách | And talk it over in messages |

Příspěvek CS: „Až přibude první kolega: pozveš ho odkazem, práva nastavíš jedním klikem, předáš mu
úkol s termínem a domluvíte se ve zprávách. Všechno v jedné aplikaci.“
EN: “When your first colleague joins: invite them with a link, set their rights in one click, hand
them a task with a deadline and talk it over in messages. All in one app.”

## e) Peníze (~35 s)

| Čas | Co se děje | Titulek CS | Titulek EN |
|---|---|---|---|
| 0–13 s | Pipeline → vyhraný obchod „Čekárna kliniky“ → Vystavit fakturu → koncept s náhledem | Faktura z obchodu jedním klikem | An invoice from a deal in one click |
| 13–19 s | Vystavit → potvrdit → faktura 2026-0001 s QR platbou (v angličtině bez QR, QR Platba je česká) | S QR platbou, klient jen naskenuje | Issued and ready to send |
| 19–30 s | Finance → Měsíc → plánovací tabulka, kurzor zapíše částku do Marketingu ve 4. týdnu | Peníze naplánované na týdny dopředu | Money planned weeks ahead |

Příspěvek CS: „Faktura z vyhraného obchodu jedním klikem, s QR platbou, kterou klient jen naskenuje.
A v plánu peněz vidíš týden po týdnu, kolik ti na účtu zůstane.“
EN: “An invoice straight from a won deal, in one click. And the money plan shows week by week how
much will be left in your account.”

## f) Celý Gradus za 60 sekund (~56 s)

| Čas | Co se děje | Titulek CS | Titulek EN |
|---|---|---|---|
| 0–2 s | Přehled | Podnikání jako hra. Krok za krokem. | Business as a game. Step by step. |
| 2–10 s | Milník a jeho mapa úkolů | Plán rozdělený na úkoly v mapě | A plan split into tasks on a map |
| 10–25 s | Pipeline → „Rekonstrukce recepce“ do Vyhráno → oslava | Každý vyhraný obchod oslavíš | Celebrate every deal you win |
| 25–40 s | Grady: dotaz a odpověď z poznámek | AI pomocník, který zná tvoje podnikání | An AI assistant who knows your business |
| 40–48 s | Finance, plán měsíce | Peníze naplánované na týdny dopředu | Money planned weeks ahead |
| 48–52 s | Zpět na přehled | Vyzkoušej to na svém podnikání | Try it on your own business |
| konec | Závěrečná karta: logo, Gradus, „Podnikání jako hra. Krok za krokem.“ | | |

Příspěvek CS: „Celý Gradus za minutu: plán rozdělený na úkoly, obchody, které oslavíš, AI pomocník,
který zná tvoje podnikání, a peníze naplánované na týdny dopředu.“
EN: “All of Gradus in a minute: a plan split into tasks, deals worth celebrating, an AI assistant who
knows your business, and money planned weeks ahead.”

## Co je v ukázce vymyšlené

Všechna jména firem a lidí, e-maily (jen `@example.com`, kam žádná pošta nedojde), adresy a částky.
České kontakty nemají telefon (v českém plánu není rozsah čísel vyhrazený pro fikci), anglické mají
čísla z rozsahu Ofcomu pro filmy a seriály (+44 7700 900xxx). Účet na faktuře má kód banky 0000,
který žádná banka nemá, takže QR platba nikam nepošle peníze. Grady odpovídá připravenými texty,
generování kontaktů vrací připravené firmy (Google se nevolá).
