-- =============================================================================
-- Game paths (step 9.3): three paths by industry, each in four chapters
--   1 Basics: trade licence, account, offer and price list
--   2 First clients: contacts, outreach, first meeting
--   3 Getting going: first jobs, invoices, steady income
--   4 Growth: repeat clients, a helper, a system
-- Sections unlock in this order along every path: Contacts (end of chapter 1)
-- -> Cold Calling -> Pipeline -> Calendar (chapter 2) -> Finance (first job).
-- Workers unlock at level 10, not through a path.
-- =============================================================================

create function pg_temp.seed_path(_key text, _position integer, _icon text, _industries text[], _name jsonb, _description jsonb)
returns void
language sql
as $$
  insert into public.paths (key, position, icon, industries, name, description)
  values (_key, _position, _icon, _industries, _name, _description);
$$;

-- _tasks: [{"en": "...", "cs": "..."}, ...] in order.
create function pg_temp.seed_milestone(
  _path text, _chapter integer, _position integer, _key text, _xp integer, _unlock text,
  _title jsonb, _description jsonb, _reward_hint jsonb, _tasks jsonb
)
returns void
language plpgsql
as $$
declare
  _id uuid;
begin
  insert into public.path_milestones (path_key, chapter, position, key, xp, unlock_key, title, description, reward_hint)
  values (_path, _chapter, _position, _key, _xp, _unlock, _title, _description, _reward_hint)
  returning id into _id;

  insert into public.path_tasks (path_milestone_id, position, title)
  select _id, t.ordinality, t.value
  from jsonb_array_elements(_tasks) with ordinality as t(value, ordinality);
end;
$$;

-- =============================================================================
-- General business
-- =============================================================================

select pg_temp.seed_path('general', 1, 'briefcase', array['ecommerce', 'agency', 'realEstate', 'other'],
  $j${"en": "General business", "cs": "Obecné podnikání"}$j$,
  $j${"en": "From a trade licence to steady income and your first helper. For anyone selling a product or a service.", "cs": "Od živnosti po pravidelný příjem a prvního pomocníka. Pro každého, kdo prodává produkt nebo službu."}$j$);

select pg_temp.seed_milestone('general', 1, 1, 'trade_license', 100, null,
  $j${"en": "Get your trade licence", "cs": "Založ si živnost"}$j$,
  $j${"en": "Without a trade licence you cannot invoice legally. One morning is enough.", "cs": "Bez živnostenského oprávnění nemůžeš legálně fakturovat. Stačí na to jedno dopoledne."}$j$,
  null,
  $j$[
    {"en": "Pick your trade type (general or craft) and check the requirements at rzp.cz", "cs": "Vyber druh živnosti (volná, nebo řemeslná) a ověř podmínky na rzp.cz"},
    {"en": "Register the trade at the trade licensing office or online via the Citizen Portal", "cs": "Ohlas živnost na živnostenském úřadě nebo online přes Portál občana"},
    {"en": "Register as self-employed with the social security office (OSSZ) by the 8th of the following month", "cs": "Přihlas se na OSSZ jako OSVČ do 8. dne následujícího měsíce"},
    {"en": "Tell your health insurer within 8 days that you started self-employment", "cs": "Do 8 dnů oznam zdravotní pojišťovně zahájení činnosti"},
    {"en": "Set up a business data box (datová schránka)", "cs": "Zřiď si datovou schránku podnikající fyzické osoby"}
  ]$j$);

select pg_temp.seed_milestone('general', 1, 2, 'business_account', 100, null,
  $j${"en": "Business account and bookkeeping", "cs": "Podnikatelský účet a evidence"}$j$,
  $j${"en": "Keep business money apart from private money from day one and decide how you will pay taxes.", "cs": "Od prvního dne oddělit firemní peníze od soukromých a rozhodnout, jak budeš platit daně."}$j$,
  null,
  $j$[
    {"en": "Compare fees at 3 banks and open a business account", "cs": "Porovnej poplatky u 3 bank a otevři si podnikatelský účet"},
    {"en": "Choose between the flat-rate tax and tax records, and write down why", "cs": "Vyber mezi paušální daní a daňovou evidencí a zapiš si proč"},
    {"en": "Choose an invoicing tool or connect Fakturoid", "cs": "Vyber fakturační program nebo připoj Fakturoid"},
    {"en": "Set up a standing order that puts aside a reserve for taxes and contributions every month", "cs": "Nastav trvalý příkaz, který každý měsíc odloží rezervu na daně a odvody"}
  ]$j$);

select pg_temp.seed_milestone('general', 1, 3, 'offer_pricing', 150, 'section_contacts',
  $j${"en": "Write your offer and price list", "cs": "Sepiš nabídku a ceník"}$j$,
  $j${"en": "Say clearly what you sell, to whom and for how much. You cannot approach anyone without it.", "cs": "Jasně řekni, co prodáváš, komu a za kolik. Bez toho se nedá nikoho oslovit."}$j$,
  $j${"en": "An evening off with a good film", "cs": "Večer bez práce s dobrým filmem"}$j$,
  $j$[
    {"en": "Describe your ideal customer in five sentences", "cs": "Popiš svého ideálního zákazníka v pěti větách"},
    {"en": "List your 3 main services or products, each with a one-line benefit", "cs": "Sepiš 3 hlavní služby nebo produkty, ke každé jednu větu o přínosu"},
    {"en": "Look up the prices of 3 competitors in your area", "cs": "Zjisti ceny 3 konkurentů ve svém okolí"},
    {"en": "Work out your minimum hourly rate: monthly costs + contributions + your pay, divided by 100 hours", "cs": "Spočítej minimální hodinovou sazbu: měsíční náklady + odvody + tvoje mzda, děleno 100 hodinami"},
    {"en": "Write a one-page price list and save it as a PDF", "cs": "Napiš ceník na jednu stránku a ulož ho jako PDF"}
  ]$j$);

select pg_temp.seed_milestone('general', 2, 1, 'contact_list', 150, 'section_cold_calling',
  $j${"en": "Build a list of 30 prospects", "cs": "Sestav seznam 30 potenciálních klientů"}$j$,
  $j${"en": "Warm contacts first, then companies from your target field. Each with a phone number.", "cs": "Nejdřív lidé, kteří tě znají, pak firmy z cílového oboru. U každého telefon."}$j$,
  null,
  $j$[
    {"en": "Write down 10 people you know who could need or recommend your services", "cs": "Zapiš 10 známých, kteří by tvoje služby mohli potřebovat nebo doporučit"},
    {"en": "Find 20 businesses in your target field, by hand or with contact generation", "cs": "Najdi 20 firem z cílového oboru, ručně nebo generováním kontaktů"},
    {"en": "Add a phone number and the decision maker's name to each contact", "cs": "U každého kontaktu doplň telefon a jméno toho, kdo rozhoduje"},
    {"en": "Split the contacts into warm (they know you) and cold", "cs": "Rozděl kontakty na teplé (znají tě) a studené"}
  ]$j$);

select pg_temp.seed_milestone('general', 2, 2, 'first_outreach', 200, 'section_pipeline',
  $j${"en": "Reach out to your first 20 contacts", "cs": "Oslov prvních 20 kontaktů"}$j$,
  $j${"en": "Calls and personal messages, every outcome written down. A no is an answer too.", "cs": "Hovory a osobní zprávy, každý výsledek zapsaný. I ne je odpověď."}$j$,
  null,
  $j$[
    {"en": "Write a call script: who you are, what you offer, one question, a meeting proposal", "cs": "Napiš si scénář hovoru: kdo jsi, co nabízíš, jedna otázka, návrh schůzky"},
    {"en": "Call 10 cold contacts in one block with the timer running", "cs": "Zavolej 10 studeným kontaktům v jednom bloku se spuštěným časovačem"},
    {"en": "Send 10 warm contacts a personal message or e-mail", "cs": "Pošli 10 teplým kontaktům osobní zprávu nebo e-mail"},
    {"en": "Record every outcome by moving the contact to the right table", "cs": "Každý výsledek zapiš přesunem kontaktu do správné tabulky"},
    {"en": "Follow up after 3 days with everyone who did not answer", "cs": "Za 3 dny se ozvi všem, kdo neodpověděli"}
  ]$j$);

select pg_temp.seed_milestone('general', 2, 3, 'first_meeting', 200, 'section_calendar',
  $j${"en": "Hold your first sales meeting", "cs": "Absolvuj první obchodní schůzku"}$j$,
  $j${"en": "A meeting with a date, prepared questions and a clear next step.", "cs": "Schůzka s datem, připravenými otázkami a jasným dalším krokem."}$j$,
  $j${"en": "Lunch at a place you have wanted to try", "cs": "Oběd v podniku, který chceš dlouho vyzkoušet"}$j$,
  $j$[
    {"en": "Book a meeting with a specific date and time", "cs": "Domluv schůzku na konkrétní den a hodinu"},
    {"en": "Prepare 5 questions about the client's needs", "cs": "Připrav si 5 otázek na potřeby klienta"},
    {"en": "At the meeting, listen more than you talk and take notes", "cs": "Na schůzce víc poslouchej, než mluv, a dělej si poznámky"},
    {"en": "Send a summary and the next step within 24 hours", "cs": "Do 24 hodin pošli shrnutí a další krok"}
  ]$j$);

select pg_temp.seed_milestone('general', 3, 1, 'first_job', 250, 'section_finance',
  $j${"en": "Win and deliver your first job", "cs": "Získej a dokonči první zakázku"}$j$,
  $j${"en": "A written quote, a confirmation, a deposit and delivery on time.", "cs": "Písemná nabídka, potvrzení, záloha a dodání v termínu."}$j$,
  null,
  $j$[
    {"en": "Send a quote with scope, price and deadline", "cs": "Pošli cenovou nabídku s rozsahem, cenou a termínem"},
    {"en": "Get the job confirmed in writing; an e-mail with the client's agreement is enough", "cs": "Nech si zakázku potvrdit písemně, stačí e-mail se souhlasem"},
    {"en": "Agree a deposit of at least 30%", "cs": "Domluv si zálohu aspoň 30 %"},
    {"en": "Deliver on time and ask for feedback", "cs": "Dodej v termínu a požádej o zpětnou vazbu"}
  ]$j$);

select pg_temp.seed_milestone('general', 3, 2, 'first_invoice', 250, null,
  $j${"en": "Invoice and get paid", "cs": "Vystav fakturu a dostaň zaplaceno"}$j$,
  $j${"en": "Money on the account, income and expenses written down.", "cs": "Peníze na účtu, příjmy a výdaje zapsané."}$j$,
  null,
  $j$[
    {"en": "Issue your first invoice with all required details (company ID, dates, due date)", "cs": "Vystav první fakturu se všemi náležitostmi (IČO, data, splatnost)"},
    {"en": "Record the income in Finance", "cs": "Zapiš příjem do Financí"},
    {"en": "If the payment is late, send a polite reminder the day after the due date", "cs": "Když platba nedorazí, pošli den po splatnosti zdvořilou upomínku"},
    {"en": "Record all expenses from the past month", "cs": "Zapiš všechny výdaje za poslední měsíc"}
  ]$j$);

select pg_temp.seed_milestone('general', 3, 3, 'recurring_income', 300, null,
  $j${"en": "Reach a steady monthly income", "cs": "Dosáhni pravidelného měsíčního příjmu"}$j$,
  $j${"en": "A target based on your costs, ongoing work and a full pipeline.", "cs": "Cíl podle nákladů, pravidelná spolupráce a plná pipeline."}$j$,
  $j${"en": "A weekend away", "cs": "Víkend mimo domov"}$j$,
  $j$[
    {"en": "Set a monthly income target based on your costs", "cs": "Stanov si měsíční cíl příjmu podle svých nákladů"},
    {"en": "Offer an existing client ongoing work or a monthly retainer", "cs": "Nabídni stávajícímu klientovi pravidelnou spolupráci nebo paušál"},
    {"en": "Fill your pipeline to at least 5 open deals", "cs": "Doplň pipeline aspoň na 5 otevřených obchodů"},
    {"en": "Hit your monthly target two months in a row", "cs": "Splň měsíční cíl dva měsíce po sobě"}
  ]$j$);

select pg_temp.seed_milestone('general', 4, 1, 'repeat_clients', 300, null,
  $j${"en": "Turn clients into repeat clients", "cs": "Udělej z klientů stálé klienty"}$j$,
  $j${"en": "A client who comes back costs far less than a new one.", "cs": "Klient, který se vrátí, stojí mnohem méně než nový."}$j$,
  null,
  $j$[
    {"en": "Call 3 past clients and ask what they are working on now", "cs": "Zavolej 3 bývalým klientům a zeptej se, co teď řeší"},
    {"en": "Ask 3 happy clients for a referral or a review", "cs": "Požádej 3 spokojené klienty o doporučení nebo recenzi"},
    {"en": "Prepare a follow-up offer for finished jobs", "cs": "Připrav navazující nabídku k hotovým zakázkám"},
    {"en": "Win a second job from the same client", "cs": "Získej druhou zakázku od stejného klienta"}
  ]$j$);

select pg_temp.seed_milestone('general', 4, 2, 'first_helper', 350, null,
  $j${"en": "Hand work off to a helper", "cs": "Předej práci pomocníkovi"}$j$,
  $j${"en": "Free your hands for selling: hand off what someone else can do.", "cs": "Uvolni si ruce na obchod: předej, co zvládne někdo jiný."}$j$,
  null,
  $j$[
    {"en": "List the tasks that slow you down and someone else could do", "cs": "Sepiš úkoly, které tě zdržují a zvládne je někdo jiný"},
    {"en": "Work out how much you can pay a helper from your margin", "cs": "Spočítej, kolik můžeš pomocníkovi zaplatit z marže"},
    {"en": "Find a part-timer or a freelancer for a first trial task", "cs": "Najdi brigádníka nebo kolegu na IČO na první zkušební úkol"},
    {"en": "Give them a clear brief with a deadline and check the result", "cs": "Dej mu jasné zadání s termínem a výsledek zkontroluj"}
  ]$j$);

select pg_temp.seed_milestone('general', 4, 3, 'business_system', 400, null,
  $j${"en": "Build a system that runs without you", "cs": "Postav systém, který běží i bez tebe"}$j$,
  $j${"en": "Procedures, templates and a weekly routine, so a week off does not stop the business.", "cs": "Postupy, šablony a týdenní rutina, aby týden volna nezastavil firmu."}$j$,
  $j${"en": "A week of real holiday", "cs": "Týden opravdové dovolené"}$j$,
  $j$[
    {"en": "Write a step-by-step procedure for your most common job", "cs": "Sepiš postup krok za krokem pro nejčastější zakázku"},
    {"en": "Prepare templates for the quote, the contract and the post-meeting e-mail", "cs": "Připrav šablony nabídky, smlouvy a e-mailu po schůzce"},
    {"en": "Block one hour a week for finances and the pipeline", "cs": "Vyhraď si hodinu týdně na finance a pipeline"},
    {"en": "Raise prices by 10% for new clients", "cs": "Zvyš ceny pro nové klienty o 10 %"},
    {"en": "Take a week off and note what got stuck", "cs": "Vezmi si týden volna a zapiš si, co se zaseklo"}
  ]$j$);

-- =============================================================================
-- Craftsman
-- =============================================================================

select pg_temp.seed_path('craftsman', 2, 'hammer', array['trades'],
  $j${"en": "Craftsman", "cs": "Řemeslník"}$j$,
  $j${"en": "Electricians, plumbers, carpenters, builders. From a craft licence to a full calendar and an apprentice.", "cs": "Elektrikáři, instalatéři, truhláři, stavaři. Od řemeslné živnosti po plný kalendář a učně."}$j$);

select pg_temp.seed_milestone('craftsman', 1, 1, 'trade_license', 100, null,
  $j${"en": "Get your craft trade licence", "cs": "Získej řemeslnou živnost"}$j$,
  $j${"en": "A craft trade needs proof of qualification. Sort it out once and properly.", "cs": "Řemeslná živnost potřebuje doklad o kvalifikaci. Vyřiď to jednou a pořádně."}$j$,
  null,
  $j$[
    {"en": "Check what training or practice your craft requires (apprenticeship certificate, years of practice)", "cs": "Ověř, jaké vzdělání nebo praxi tvoje řemeslo vyžaduje (výuční list, roky praxe)"},
    {"en": "Register the craft trade and attach proof of qualification", "cs": "Ohlas řemeslnou živnost a přilož doklad o kvalifikaci"},
    {"en": "Register as self-employed with social security and your health insurer", "cs": "Přihlas se jako OSVČ na OSSZ a u zdravotní pojišťovny"},
    {"en": "Take out liability insurance for damage caused by your work", "cs": "Sjednej pojištění odpovědnosti za škodu způsobenou prací"},
    {"en": "Set up a business data box", "cs": "Zřiď si datovou schránku"}
  ]$j$);

select pg_temp.seed_milestone('craftsman', 1, 2, 'business_account', 100, null,
  $j${"en": "Account, tools and van", "cs": "Účet, nářadí a auto"}$j$,
  $j${"en": "A business account, the tools you are missing and a trade account at the wholesaler.", "cs": "Podnikatelský účet, chybějící nářadí a firemní účet ve velkoobchodě."}$j$,
  null,
  $j$[
    {"en": "Open a business bank account", "cs": "Otevři si podnikatelský účet"},
    {"en": "List the tools you have and what you need to buy", "cs": "Sepiš nářadí, které máš, a co musíš dokoupit"},
    {"en": "Decide whether to claim your car with the flat allowance or a logbook", "cs": "Rozhodni, jestli auto uplatníš paušálem, nebo knihou jízd"},
    {"en": "Open a trade account with a discount at a building materials wholesaler", "cs": "Založ si ve velkoobchodě s materiálem firemní účet se slevou"}
  ]$j$);

select pg_temp.seed_milestone('craftsman', 1, 3, 'offer_pricing', 150, 'section_contacts',
  $j${"en": "Price list for work and materials", "cs": "Ceník práce a materiálu"}$j$,
  $j${"en": "An hourly rate that pays for travel and tools, a materials markup and photos of your work.", "cs": "Hodinová sazba, která zaplatí dopravu i nářadí, přirážka na materiál a fotky práce."}$j$,
  $j${"en": "A new tool you have wanted for a long time", "cs": "Nové nářadí, po kterém dlouho pokukuješ"}$j$,
  $j$[
    {"en": "Work out an hourly rate that includes travel, tools and contributions", "cs": "Spočítej hodinovou sazbu včetně dopravy, nářadí a odvodů"},
    {"en": "Set your materials markup (typically 10–20%)", "cs": "Stanov přirážku na materiál (obvykle 10–20 %)"},
    {"en": "Price your 10 most common jobs (e.g. replacing a tap, fitting a socket)", "cs": "Naceň 10 nejčastějších úkonů (např. výměna baterie, montáž zásuvky)"},
    {"en": "Set a call-out fee and a minimum job charge", "cs": "Urči cenu za výjezd a minimální zakázku"},
    {"en": "Photograph 5 finished jobs for your portfolio", "cs": "Nafoť 5 hotových prací do portfolia"}
  ]$j$);

select pg_temp.seed_milestone('craftsman', 2, 1, 'contact_list', 150, 'section_cold_calling',
  $j${"en": "Get on the map and build a client list", "cs": "Dostaň se na mapu a sestav seznam klientů"}$j$,
  $j${"en": "People search for tradespeople on maps. Then go after builders and property managers.", "cs": "Řemeslníka lidé hledají na mapách. Pak se zaměř na stavební firmy a správce domů."}$j$,
  null,
  $j$[
    {"en": "Create a business profile on Google and Mapy.cz with photos and a phone number", "cs": "Založ si profil firmy na Googlu a Mapy.cz s fotkami a telefonem"},
    {"en": "Write down 10 people you know who are building or renovating", "cs": "Zapiš 10 známých, kteří staví nebo rekonstruují"},
    {"en": "Find 15 builders, developers and property managers in your area", "cs": "Najdi 15 stavebních firem, developerů a správců domů ve svém okolí"},
    {"en": "Add them all to Contacts with a phone number", "cs": "Přidej je všechny do Kontaktů s telefonem"}
  ]$j$);

select pg_temp.seed_milestone('craftsman', 2, 2, 'first_outreach', 200, 'section_pipeline',
  $j${"en": "Offer your capacity", "cs": "Nabídni svou kapacitu"}$j$,
  $j${"en": "Builders always need reliable subcontractors. Tell them you have free capacity.", "cs": "Stavební firmy pořád shánějí spolehlivé subdodavatele. Dej jim vědět, že máš volno."}$j$,
  null,
  $j$[
    {"en": "Call 10 builders and tell them you have capacity as a subcontractor", "cs": "Zavolej 10 stavebním firmám, že máš volnou kapacitu jako subdodavatel"},
    {"en": "Visit 5 property managers or housing associations with your card and price list", "cs": "Obejdi 5 správců domů nebo SVJ s vizitkou a ceníkem"},
    {"en": "Tell friends and social media that you are taking jobs", "cs": "Dej vědět známým a na sociálních sítích, že bereš zakázky"},
    {"en": "Brand your van or print business cards with your number", "cs": "Polep auto nebo si nech udělat vizitky s telefonem"}
  ]$j$);

select pg_temp.seed_milestone('craftsman', 2, 3, 'first_meeting', 200, 'section_calendar',
  $j${"en": "First site visit", "cs": "První obhlídka"}$j$,
  $j${"en": "Measure, photograph, ask about budget and deadline, and send the quote fast.", "cs": "Změřit, nafotit, zeptat se na rozpočet a termín a rychle poslat nabídku."}$j$,
  $j${"en": "A good dinner after the first visit", "cs": "Dobrá večeře po první obhlídce"}$j$,
  $j$[
    {"en": "Book a site visit for a specific day and time", "cs": "Domluv obhlídku na konkrétní den a hodinu"},
    {"en": "Measure and photograph everything on site", "cs": "Na místě všechno změř a nafoť"},
    {"en": "Ask about the deadline, the budget and who decides", "cs": "Zeptej se na termín, rozpočet a kdo rozhoduje"},
    {"en": "Send a quote itemising labour and materials within 48 hours", "cs": "Do 48 hodin pošli nabídku s rozpisem práce a materiálu"}
  ]$j$);

select pg_temp.seed_milestone('craftsman', 3, 1, 'first_job', 250, 'section_finance',
  $j${"en": "First job done", "cs": "První hotová zakázka"}$j$,
  $j${"en": "An order in writing, a deposit for materials and a signed handover.", "cs": "Objednávka písemně, záloha na materiál a podepsané předání."}$j$,
  null,
  $j$[
    {"en": "Agree a simple work contract or a confirmed order with the client", "cs": "Sepiš s klientem jednoduchou smlouvu o dílo nebo potvrzenou objednávku"},
    {"en": "Take a deposit for materials", "cs": "Vyber zálohu na materiál"},
    {"en": "Walk the client through the work at handover and sign a handover note", "cs": "Při předání projdi práci s klientem a podepište předávací protokol"},
    {"en": "Photograph the finished job for your portfolio", "cs": "Nafoť hotovou práci do portfolia"}
  ]$j$);

select pg_temp.seed_milestone('craftsman', 3, 2, 'first_invoice', 250, null,
  $j${"en": "Invoice and paperwork", "cs": "Faktura a papíry"}$j$,
  $j${"en": "A correct invoice, receipts for materials kept per job and an eye on the VAT threshold.", "cs": "Správná faktura, doklady za materiál ke každé zakázce a pohled na limit DPH."}$j$,
  null,
  $j$[
    {"en": "Issue an invoice with the right VAT rate, or without VAT if you are not registered", "cs": "Vystav fakturu se správnou sazbou DPH, nebo bez DPH, pokud nejsi plátce"},
    {"en": "Keep the material receipts for every job together", "cs": "Uschovej doklady za materiál ke každé zakázce pohromadě"},
    {"en": "Record income and expenses in Finance", "cs": "Zapiš příjmy a výdaje do Financí"},
    {"en": "Check how close your turnover is to the VAT registration threshold", "cs": "Zkontroluj, jak blízko je tvůj obrat limitu pro registraci k DPH"}
  ]$j$);

select pg_temp.seed_milestone('craftsman', 3, 3, 'recurring_income', 300, null,
  $j${"en": "A full calendar for the next month", "cs": "Plný kalendář na další měsíc"}$j$,
  $j${"en": "Regular subcontracting and service contracts, so you do not hunt for work every week.", "cs": "Pravidelné subdodávky a servisní smlouvy, abys nesháněl práci každý týden."}$j$,
  $j${"en": "A day off in the middle of the week", "cs": "Den volna uprostřed týdne"}$j$,
  $j$[
    {"en": "Agree regular subcontracting with a builder", "cs": "Domluv se se stavební firmou na pravidelné subdodávce"},
    {"en": "Offer a property manager a service contract (inspections, maintenance)", "cs": "Nabídni správci domů servisní smlouvu (revize, údržba)"},
    {"en": "Plan jobs in the calendar 4 weeks ahead", "cs": "Naplánuj zakázky v kalendáři na 4 týdny dopředu"},
    {"en": "Set a monthly revenue target and hit it", "cs": "Stanov si měsíční cíl obratu a splň ho"}
  ]$j$);

select pg_temp.seed_milestone('craftsman', 4, 1, 'repeat_clients', 300, null,
  $j${"en": "Reviews and referrals", "cs": "Recenze a doporučení"}$j$,
  $j${"en": "Most craft jobs come by word of mouth. Help it along.", "cs": "Většina řemeslných zakázek přijde po doporučení. Pomoz tomu."}$j$,
  null,
  $j$[
    {"en": "Ask 5 happy clients for a Google review", "cs": "Požádej 5 spokojených klientů o recenzi na Googlu"},
    {"en": "Call clients after six months and offer an inspection or maintenance", "cs": "Po půl roce zavolej klientům a nabídni kontrolu nebo údržbu"},
    {"en": "Give referrers a small reward or a discount", "cs": "Dej doporučitelům malou odměnu nebo slevu"},
    {"en": "Win a job from a referral", "cs": "Získej zakázku z doporučení"}
  ]$j$);

select pg_temp.seed_milestone('craftsman', 4, 2, 'first_helper', 350, null,
  $j${"en": "Take on a helper", "cs": "Vezmi si pomocníka"}$j$,
  $j${"en": "When jobs slip away because you are booked up, it is time for a second pair of hands.", "cs": "Když ti utíkají zakázky pro plný kalendář, je čas na druhé ruce."}$j$,
  null,
  $j$[
    {"en": "Count how many jobs you turned down last month for lack of time", "cs": "Spočítej, kolik zakázek jsi minulý měsíc odmítl pro nedostatek času"},
    {"en": "Find an apprentice, a part-timer or a self-employed tradesperson", "cs": "Najdi učně, brigádníka nebo řemeslníka na IČO"},
    {"en": "Give them a trial day on a small job", "cs": "Dej mu zkušební den na menší zakázce"},
    {"en": "Agree the rules: hourly rate, tools, responsibility for the work", "cs": "Domluv pravidla: hodinovka, nářadí, odpovědnost za práci"}
  ]$j$);

select pg_temp.seed_milestone('craftsman', 4, 3, 'business_system', 400, null,
  $j${"en": "Run jobs like a company", "cs": "Řiď zakázky jako firma"}$j$,
  $j${"en": "Templates, checklists and a weekly plan, so nothing is forgotten in the van.", "cs": "Šablony, checklisty a týdenní plán, aby se nic nezapomnělo v autě."}$j$,
  $j${"en": "A week of holiday without the phone", "cs": "Týden dovolené bez telefonu"}$j$,
  $j$[
    {"en": "Prepare templates for quotes and handover notes", "cs": "Připrav šablony nabídky a předávacího protokolu"},
    {"en": "Make a tools and materials checklist for a typical job", "cs": "Udělej si checklist nářadí a materiálu na typickou zakázku"},
    {"en": "Plan the next week every Friday", "cs": "Každý pátek naplánuj další týden"},
    {"en": "Raise prices for new clients in line with your costs", "cs": "Zvyš ceny pro nové klienty podle svých nákladů"}
  ]$j$);

-- =============================================================================
-- Consultant and freelancer
-- =============================================================================

select pg_temp.seed_path('consultant', 3, 'presentation', array['coaching', 'freelanceIt'],
  $j${"en": "Consultant and freelancer", "cs": "Konzultant a freelancer"}$j$,
  $j${"en": "Coaches, consultants, developers, designers. From a sharp offer to retainers and a productised service.", "cs": "Kouči, konzultanti, vývojáři, designéři. Od jasné nabídky po paušály a službu jako produkt."}$j$);

select pg_temp.seed_milestone('consultant', 1, 1, 'trade_license', 100, null,
  $j${"en": "Set up as a freelancer", "cs": "Živnost pro konzultanta"}$j$,
  $j${"en": "A general trade licence covers most consulting and IT work. Done online in an hour.", "cs": "Volná živnost pokryje většinu poradenství i IT. Online za hodinu."}$j$,
  null,
  $j$[
    {"en": "Choose the general trade fields that cover your work (e.g. consulting, IT services)", "cs": "Vyber obory volné živnosti, které pokrývají tvou práci (např. poradenství, IT služby)"},
    {"en": "Register the trade online via the Citizen Portal", "cs": "Ohlas živnost online přes Portál občana"},
    {"en": "Register with social security and your health insurer", "cs": "Přihlas se na OSSZ a u zdravotní pojišťovny"},
    {"en": "Work out whether the flat-rate tax pays off for your expected income", "cs": "Spočítej, jestli se ti při očekávaném příjmu vyplatí paušální daň"}
  ]$j$);

select pg_temp.seed_milestone('consultant', 1, 2, 'business_account', 100, null,
  $j${"en": "Account, contract and tools", "cs": "Účet, smlouva a nástroje"}$j$,
  $j${"en": "A business account, a contract template with payment terms and time tracking.", "cs": "Podnikatelský účet, vzor smlouvy s platebními podmínkami a měření času."}$j$,
  null,
  $j$[
    {"en": "Open a business bank account", "cs": "Otevři si podnikatelský účet"},
    {"en": "Prepare a service agreement template with payment terms", "cs": "Připrav vzor smlouvy o spolupráci s platebními podmínkami"},
    {"en": "Set up invoicing and time tracking", "cs": "Nastav si fakturaci a měření odpracovaného času"},
    {"en": "Set up a professional e-mail on your own domain", "cs": "Zřiď si profesionální e-mail na vlastní doméně"}
  ]$j$);

select pg_temp.seed_milestone('consultant', 1, 3, 'offer_pricing', 150, 'section_contacts',
  $j${"en": "Define your offer and rates", "cs": "Definuj nabídku a sazby"}$j$,
  $j${"en": "A narrow specialisation sells better than \"I can do anything\". Packages and proof included.", "cs": "Úzká specializace se prodává lépe než „umím všechno“. S balíčky a důkazy."}$j$,
  $j${"en": "A book or course you have been putting off", "cs": "Kniha nebo kurz, který dlouho odkládáš"}$j$,
  $j$[
    {"en": "Pick one narrow specialisation and one type of client", "cs": "Vyber jednu úzkou specializaci a jeden typ klienta"},
    {"en": "Design 3 packages: consultation, project, monthly retainer", "cs": "Navrhni 3 balíčky: konzultace, projekt, měsíční paušál"},
    {"en": "Set a day rate and check it with 3 people in your field", "cs": "Stanov denní sazbu a ověř ji u 3 lidí z oboru"},
    {"en": "Write 2 case studies from your past work", "cs": "Sepiš 2 případové studie z dosavadní práce"},
    {"en": "Update your LinkedIn profile to match the offer", "cs": "Uprav profil na LinkedInu podle nabídky"}
  ]$j$);

select pg_temp.seed_milestone('consultant', 2, 1, 'contact_list', 150, 'section_cold_calling',
  $j${"en": "Map your network", "cs": "Zmapuj svou síť"}$j$,
  $j${"en": "Your first clients are usually people who already know your work.", "cs": "První klienti jsou obvykle lidé, kteří už tvou práci znají."}$j$,
  null,
  $j$[
    {"en": "Go through LinkedIn and list 20 former colleagues and clients", "cs": "Projdi LinkedIn a vypiš 20 bývalých kolegů a klientů"},
    {"en": "Find 10 companies that are hiring for your specialisation", "cs": "Najdi 10 firem, které hledají lidi s tvou specializací"},
    {"en": "Add name, role and how you know each other to Contacts", "cs": "Doplň do Kontaktů jméno, roli a odkud se znáte"},
    {"en": "Pick 5 people who can refer you", "cs": "Vyber 5 lidí, kteří tě mohou doporučit"}
  ]$j$);

select pg_temp.seed_milestone('consultant', 2, 2, 'first_outreach', 200, 'section_pipeline',
  $j${"en": "Tell people you are available", "cs": "Dej vědět, že jsi k dispozici"}$j$,
  $j${"en": "Personal messages, one public post and a few calls to companies that need you.", "cs": "Osobní zprávy, jeden veřejný příspěvek a pár hovorů firmám, které tě potřebují."}$j$,
  null,
  $j$[
    {"en": "Send 15 former colleagues a personal message about what you now offer", "cs": "Napiš 15 bývalým kolegům osobní zprávu, co teď nabízíš"},
    {"en": "Publish a post about your new practice with one concrete result", "cs": "Zveřejni příspěvek o své nové práci s jedním konkrétním výsledkem"},
    {"en": "Sign up on 2 freelance platforms for your field", "cs": "Zaregistruj se na 2 platformách pro freelancery ve svém oboru"},
    {"en": "Call 10 companies that are hiring for your specialisation", "cs": "Zavolej 10 firmám, které hledají tvou specializaci"}
  ]$j$);

select pg_temp.seed_milestone('consultant', 2, 3, 'first_meeting', 200, 'section_calendar',
  $j${"en": "First discovery call", "cs": "První úvodní hovor"}$j$,
  $j${"en": "Thirty minutes about the client's goal, budget and timeline, ending with a next step.", "cs": "Třicet minut o cíli, rozpočtu a termínu klienta, zakončených dalším krokem."}$j$,
  $j${"en": "Coffee and cake at your favourite café", "cs": "Káva a dort v oblíbené kavárně"}$j$,
  $j$[
    {"en": "Book a 30-minute discovery call", "cs": "Domluv 30minutový úvodní hovor"},
    {"en": "Prepare questions about the project's goal, budget and timeline", "cs": "Připrav otázky na cíl, rozpočet a termín projektu"},
    {"en": "End the call with a specific next step", "cs": "Na konci hovoru navrhni konkrétní další krok"},
    {"en": "Send a proposal with scope and price within 2 days", "cs": "Do 2 dnů pošli nabídku s rozsahem a cenou"}
  ]$j$);

select pg_temp.seed_milestone('consultant', 3, 1, 'first_job', 250, 'section_finance',
  $j${"en": "First paid project", "cs": "První placený projekt"}$j$,
  $j${"en": "A signed scope, a deposit upfront and regular updates.", "cs": "Podepsaný rozsah, záloha předem a pravidelné informace o postupu."}$j$,
  null,
  $j$[
    {"en": "Sign a contract with scope, price and number of revisions", "cs": "Podepiš smlouvu s rozsahem, cenou a počtem revizí"},
    {"en": "Invoice a 30–50% deposit upfront", "cs": "Vyfakturuj předem zálohu 30–50 %"},
    {"en": "Agree a weekly progress update with the client", "cs": "Domluv s klientem týdenní shrnutí postupu"},
    {"en": "Ask for a testimonial after delivery", "cs": "Po předání požádej o referenci"}
  ]$j$);

select pg_temp.seed_milestone('consultant', 3, 2, 'first_invoice', 250, null,
  $j${"en": "Invoice and know your real rate", "cs": "Faktura a skutečná sazba"}$j$,
  $j${"en": "Get paid on time and find out what you really earned per hour.", "cs": "Dostat zaplaceno včas a zjistit, kolik sis doopravdy vydělal na hodinu."}$j$,
  null,
  $j$[
    {"en": "Issue an invoice with a 14-day due date", "cs": "Vystav fakturu se splatností 14 dní"},
    {"en": "Compare the hours worked with the price and work out your real hourly rate", "cs": "Porovnej odpracované hodiny s cenou a spočítej skutečnou hodinovou sazbu"},
    {"en": "Record income and expenses in Finance", "cs": "Zapiš příjmy a výdaje do Financí"},
    {"en": "Send a reminder the day the invoice becomes overdue", "cs": "V den po splatnosti pošli upomínku"}
  ]$j$);

select pg_temp.seed_milestone('consultant', 3, 3, 'recurring_income', 300, null,
  $j${"en": "A monthly retainer", "cs": "Měsíční paušál"}$j$,
  $j${"en": "Retainers turn feast and famine into a predictable month.", "cs": "Paušály udělají z nejistých měsíců předvídatelný příjem."}$j$,
  $j${"en": "Something nice for your workspace", "cs": "Něco hezkého na pracovní stůl"}$j$,
  $j$[
    {"en": "Offer a finished client monthly support for a retainer", "cs": "Nabídni klientovi po projektu měsíční podporu za paušál"},
    {"en": "Write down what the retainer includes and how many hours", "cs": "Sepiš, co paušál obsahuje a kolik hodin"},
    {"en": "Sign your first retainer client", "cs": "Získej prvního paušálního klienta"},
    {"en": "Cover at least half of your monthly costs with retainers", "cs": "Pokryj paušály aspoň polovinu měsíčních nákladů"}
  ]$j$);

select pg_temp.seed_milestone('consultant', 4, 1, 'repeat_clients', 300, null,
  $j${"en": "Referrals and authority", "cs": "Doporučení a autorita"}$j$,
  $j${"en": "Visible expertise and people who recommend you bring clients without cold calls.", "cs": "Viditelná odbornost a lidé, kteří tě doporučí, přivedou klienty bez studených hovorů."}$j$,
  null,
  $j$[
    {"en": "Ask 3 clients for a LinkedIn recommendation", "cs": "Požádej 3 klienty o doporučení na LinkedInu"},
    {"en": "Publish 4 expert posts in one month", "cs": "Publikuj za měsíc 4 odborné příspěvky"},
    {"en": "Agree mutual referrals with 2 peers in a related field", "cs": "Domluv se se 2 kolegy z příbuzného oboru na vzájemném doporučování"},
    {"en": "Win a new client from a referral", "cs": "Získej nového klienta z doporučení"}
  ]$j$);

select pg_temp.seed_milestone('consultant', 4, 2, 'first_helper', 350, null,
  $j${"en": "Delegate the routine", "cs": "Deleguj rutinu"}$j$,
  $j${"en": "Your hours are worth most with clients. Hand off admin and smaller parts of projects.", "cs": "Tvoje hodiny mají největší cenu u klientů. Předej administrativu a menší části projektů."}$j$,
  null,
  $j$[
    {"en": "Measure for one week how much time admin takes", "cs": "Změř týden, kolik času ti zabírá administrativa"},
    {"en": "Find a virtual assistant or a junior for part of the work", "cs": "Najdi virtuální asistentku nebo juniora na část práce"},
    {"en": "Hand over the first recurring task with written instructions", "cs": "Předej první opakovaný úkol s písemným návodem"},
    {"en": "Subcontract one part of a project to a peer", "cs": "Zadej jednu část projektu kolegovi jako subdodávku"}
  ]$j$);

select pg_temp.seed_milestone('consultant', 4, 3, 'business_system', 400, null,
  $j${"en": "Productise your service", "cs": "Udělej ze služby produkt"}$j$,
  $j${"en": "A repeatable process and a fixed-price product scale better than hours.", "cs": "Opakovatelný postup a produkt s pevnou cenou rostou lépe než hodiny."}$j$,
  $j${"en": "A proper holiday, laptop at home", "cs": "Pořádná dovolená, notebook doma"}$j$,
  $j$[
    {"en": "Write down the project process from the first call to delivery", "cs": "Sepiš postup projektu od prvního hovoru po předání"},
    {"en": "Prepare templates for the proposal, the contract and the final report", "cs": "Připrav šablony nabídky, smlouvy a závěrečné zprávy"},
    {"en": "Create a fixed-price product (an audit, a workshop)", "cs": "Vytvoř produkt s pevnou cenou (audit, workshop)"},
    {"en": "Raise your rate for new clients by 15%", "cs": "Zvyš sazbu pro nové klienty o 15 %"}
  ]$j$);
