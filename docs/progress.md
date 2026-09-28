# Postup přestavby

Příkaz `/pokracuj` bere první nezaškrtnutou položku. Nic tu nemaž, jen zaškrtávej.

Formát: `- [ ] ID | agent | požadavek`

- [x] 0.1 až 3.7 | ručně | hotovo před zavedením automatizace
- [x] 3.8 | builder | 2026-09-28 Dashboard se šesti dlaždicemi, kartou Co dnes udělat a dotazníkem o schůzkách.
- [x] K3 | reviewer | 2026-09-28 Audit fáze 3: opraveno stránkování Klientů, načítání obchodů v Pipeline a Zavolat zpět, doplněny testy.
- [x] STOP | Konec fáze 3. Proklikej všech osm sekcí na počítači i telefonu: milníky s podúkoly a mapou, pipeline, kontakty s tabulkami a přesuny, cold calling s časovačem, kalendář, finance, dashboard. Co nesedí, napiš Claude Code rovnou, pak znovu /pokracuj.
- [ ] 4.1 | architect | env: ANTHROPIC_API_KEY
- [ ] 4.2 | architect | env: RESEND_API_KEY
- [ ] STOP | Konec fáze 4. Vyzkoušej Jarvise: rozhovor, nahrání PDF a obrázku, návrhy v panelu, hodnocení nového milníku, nápad na novou funkci (musí přijít e-mail). Podívej se do Supabase do tabulky ai_usage, jestli se zapisuje spotřeba.
- [ ] 5.1 | architect |
- [ ] 5.2 | architect |
- [ ] 5.3 | builder | env: RESEND_API_KEY
- [ ] STOP | Konec fáze 5. Založ testovacího pracovníka přes pozvánku ve druhém prohlížeči, zadej mu úkol a ověř, že vidí jen svoje. Připoj Fakturoid a vystav testovací fakturu. Pošli si e-mail z detailu kontaktu.
- [ ] 6.1 | builder |
- [ ] 6.2 | builder |
- [ ] 6.3 | architect |
- [ ] STOP | Konec fáze 6. Založ úplně nový účet a projdi aplikaci jako nový uživatel od onboardingu, v obou jazycích, na telefonu.
- [ ] 7.1 | RUČNĚ | Nasazení vyžaduje tvoje přihlášení do Vercelu a nastavení v jeho administraci. Spusť ho interaktivně: přepni /model na Sonnet a vlož prompt 7.1 z docs/plan.md.
