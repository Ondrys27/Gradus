# Postup přestavby

Příkaz `/pokracuj` bere první nezaškrtnutou položku. Nic tu nemaž, jen zaškrtávej.

Formát: `- [ ] ID | agent | požadavek`

- [x] 0.1 až 3.7 | ručně | hotovo před zavedením automatizace
- [x] 3.8 | builder | 2026-09-28 Dashboard se šesti dlaždicemi, kartou Co dnes udělat a dotazníkem o schůzkách.
- [x] K3 | reviewer | 2026-09-28 Audit fáze 3: opraveno stránkování Klientů, načítání obchodů v Pipeline a Zavolat zpět, doplněny testy.
- [x] STOP | Konec fáze 3. Proklikej všech osm sekcí na počítači i telefonu: milníky s podúkoly a mapou, pipeline, kontakty s tabulkami a přesuny, cold calling s časovačem, kalendář, finance, dashboard. Co nesedí, napiš Claude Code rovnou, pak znovu /pokracuj.
- [x] 4.1 | architect | env: ANTHROPIC_API_KEY | 2026-09-28 Jarvis napojený přes jedinou route /api/jarvis se streamováním, routingem modelů, měřením spotřeby a panelem (živě neověřeno, čeká na kredity).
- [x] 4.2 | architect | env: RESEND_API_KEY | 2026-09-28 Soubory v chatu, hlídání příležitostí, hodnocení milníků, nápady s e-mailem a AI rozbor schůzek (živě neověřeno, čeká na kredity).
- [x] STOP | Konec fáze 4. Vyzkoušej Jarvise: rozhovor, nahrání PDF a obrázku, návrhy v panelu, hodnocení nového milníku, nápad na novou funkci (musí přijít e-mail). Podívej se do Supabase do tabulky ai_usage, jestli se zapisuje spotřeba.
- [x] 5.1 | architect | 2026-09-28 Sekce Pracovníci: karty, pozvánky, systém odměn se stromovým editorem a vlastní prostředí pracovníka.
- [x] 5.2 | architect | 2026-09-28 Napojení Financí na Fakturoid: OAuth připojení, vystavení faktury, denní synchronizace stavu.
- [x] 5.3 | builder | env: RESEND_API_KEY | 2026-09-28 Odesílání e-mailů z kontaktu a obchodu přes Resend, přesun do Odeslán e-mail a AI návrh odpovědi.
- [x] STOP | Konec fáze 5. Založ testovacího pracovníka přes pozvánku ve druhém prohlížeči, zadej mu úkol a ověř, že vidí jen svoje. Připoj Fakturoid a vystav testovací fakturu. Pošli si e-mail z detailu kontaktu.
- [x] 6.1 | builder | 2026-09-29 Dopamin na skutečných událostech (milník, obchod, odemčení, rekord, první kontakty, desátá schůzka), XP a úroveň s pulzující pilulkou, série, odemykání sekcí s motivačními texty, přepínače animací a zvuku.
- [x] 6.2 | builder | 2026-09-29 Onboarding při prvním přihlášení: obor, země a měna, první milník s úkoly, první kontakt, představení Jarvise.
- [x] 6.3 | architect | 2026-09-29 Kompletní průchod v obou jazycích, opravy rozbitých míst, bezpečná zóna a spodní panely na telefonu, výkonové úpravy (lazy loading, next/image).
- [ ] STOP | Konec fáze 6. Založ úplně nový účet a projdi aplikaci jako nový uživatel od onboardingu, v obou jazycích, na telefonu.
- [ ] 7.1 | RUČNĚ | Nasazení vyžaduje tvoje přihlášení do Vercelu a nastavení v jeho administraci. Spusť ho interaktivně: přepni /model na Sonnet a vlož prompt 7.1 z docs/plan.md.
