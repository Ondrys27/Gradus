-- =============================================================================
-- Game paths (step 9.5): five more industries, same shape as the first three
-- (4 chapters, 12 milestones, 3-6 tasks each, unlock_key in the same order:
-- Contacts -> Cold Calling -> Pipeline -> Calendar -> Finance). Helper
-- functions are re-declared because each migration file runs in its own
-- session and pg_temp does not carry over from the previous one.
--
-- 'ecommerce' and 'realEstate' used to fall back to the general path; now
-- that they have a dedicated one, general no longer claims them.
-- =============================================================================

create or replace function pg_temp.seed_path(_key text, _position integer, _icon text, _industries text[], _name jsonb, _description jsonb)
returns void
language sql
as $$
  insert into public.paths (key, position, icon, industries, name, description)
  values (_key, _position, _icon, _industries, _name, _description)
  on conflict (key) do update
    set position = excluded.position,
        icon = excluded.icon,
        industries = excluded.industries,
        name = excluded.name,
        description = excluded.description;
$$;

-- _tasks: [{"en": "...", "cs": "..."}, ...] in order. Re-running updates the
-- step and its tasks in place (ids stay, so copies keep their template_id).
create or replace function pg_temp.seed_milestone(
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
  on conflict (path_key, key) do update
    set chapter = excluded.chapter,
        position = excluded.position,
        xp = excluded.xp,
        unlock_key = excluded.unlock_key,
        title = excluded.title,
        description = excluded.description,
        reward_hint = excluded.reward_hint
  returning id into _id;

  insert into public.path_tasks (path_milestone_id, position, title)
  select _id, t.ordinality, t.value
  from jsonb_array_elements(_tasks) with ordinality as t(value, ordinality)
  on conflict (path_milestone_id, position) do update set title = excluded.title;

  delete from public.path_tasks
  where path_milestone_id = _id and position > jsonb_array_length(_tasks);
end;
$$;

update public.paths set industries = array['agency', 'other'] where key = 'general';

-- =============================================================================
-- E-commerce
-- =============================================================================

select pg_temp.seed_path('ecommerce', 4, 'shopping-cart', array['ecommerce'],
  $j${"en": "E-commerce", "cs": "E-shop a prodej online"}$j$,
  $j${"en": "From a trade licence to a shop that sells while you sleep. For anyone selling physical products online.", "cs": "Od živnosti po obchod, který prodává i ve spánku. Pro každého, kdo prodává fyzické produkty online."}$j$);

select pg_temp.seed_milestone('ecommerce', 1, 1, 'trade_license', 100, null,
  $j${"en": "Register your trade for online sales", "cs": "Založ živnost pro prodej online"}$j$,
  $j${"en": "A trade licence lets you sell legally and open a merchant account. One morning online is enough.", "cs": "Živnostenské oprávnění ti umožní legálně prodávat a otevřít si účet u platební brány. Stačí jedno dopoledne online."}$j$,
  null,
  $j$[
    {"en": "Pick the free trade field \"Retail and wholesale\" and check the conditions at rzp.cz", "cs": "Vyber obor volné živnosti „Maloobchod a velkoobchod“ a ověř podmínky na rzp.cz"},
    {"en": "Register the trade online via the Citizen Portal", "cs": "Ohlas živnost online přes Portál občana"},
    {"en": "Register as self-employed with social security (OSSZ) and your health insurer", "cs": "Přihlas se jako OSVČ na OSSZ a u zdravotní pojišťovny"},
    {"en": "Set up a business data box", "cs": "Zřiď si datovou schránku"}
  ]$j$);

select pg_temp.seed_milestone('ecommerce', 1, 2, 'business_account', 100, null,
  $j${"en": "Account, platform and payment gateway", "cs": "Účet, platforma a platební brána"}$j$,
  $j${"en": "Pick where your shop will run, how customers will pay, and keep business money apart from private.", "cs": "Vyber, kde poběží tvůj obchod, jak budou lidé platit, a odděl firemní peníze od soukromých."}$j$,
  null,
  $j$[
    {"en": "Open a business bank account", "cs": "Otevři si podnikatelský účet"},
    {"en": "Choose an e-shop platform (Shoptet, WooCommerce, Shopify) and set up the trial", "cs": "Vyber platformu pro e-shop (Shoptet, WooCommerce, Shopify) a založ si zkušební verzi"},
    {"en": "Connect a payment gateway (card, bank transfer, Apple/Google Pay)", "cs": "Připoj platební bránu (karta, bankovní převod, Apple/Google Pay)"},
    {"en": "Choose between the flat-rate tax and tax records, and write down why", "cs": "Vyber mezi paušální daní a daňovou evidencí a zapiš si proč"}
  ]$j$);

select pg_temp.seed_milestone('ecommerce', 1, 3, 'offer_pricing', 150, 'section_contacts',
  $j${"en": "Terms and conditions, shipping and your first products", "cs": "Obchodní podmínky, doprava a první produkty"}$j$,
  $j${"en": "Without terms and conditions and a shipping option you cannot legally sell. List your first products with real prices.", "cs": "Bez obchodních podmínek a způsobu dopravy nemůžeš legálně prodávat. Sepiš první produkty s reálnými cenami."}$j$,
  $j${"en": "An evening off with a good film", "cs": "Večer bez práce s dobrým filmem"}$j$,
  $j$[
    {"en": "Write terms and conditions covering the 14-day right of withdrawal and complaints", "cs": "Sepiš obchodní podmínky včetně 14denní lhůty na odstoupení a reklamačního řádu"},
    {"en": "Add a privacy policy and a cookie notice (GDPR)", "cs": "Doplň zásady ochrany osobních údajů a informaci o cookies (GDPR)"},
    {"en": "Pick 1-2 carriers (Zásilkovna, PPL, Česká pošta) and set shipping prices", "cs": "Vyber 1-2 dopravce (Zásilkovna, PPL, Česká pošta) a nastav ceny dopravy"},
    {"en": "List your first 10 products with photos, descriptions and prices", "cs": "Vlož prvních 10 produktů s fotkami, popisy a cenami"},
    {"en": "Calculate your margin per product after fees, shipping and packaging", "cs": "Spočítej marži na produkt po odečtení poplatků, dopravy a balení"}
  ]$j$);

select pg_temp.seed_milestone('ecommerce', 2, 1, 'contact_list', 150, 'section_cold_calling',
  $j${"en": "Build a list of suppliers and influencers", "cs": "Sestav seznam dodavatelů a influencerů"}$j$,
  $j${"en": "Before the first order you need stock and someone to tell people about your shop.", "cs": "Před první objednávkou potřebuješ zboží a někoho, kdo o tvém obchodu řekne dalším."}$j$,
  null,
  $j$[
    {"en": "Find 10 suppliers or wholesalers for your product category", "cs": "Najdi 10 dodavatelů nebo velkoobchodů pro svou kategorii zboží"},
    {"en": "Write down 15 micro-influencers or bloggers in your niche with contact details", "cs": "Zapiš 15 mikroinfluencerů nebo blogerů ve svém oboru s kontaktem"},
    {"en": "Add 10 local businesses that could resell your product", "cs": "Přidej 10 místních firem, které by mohly tvůj produkt prodávat dál"},
    {"en": "Split the list between warm contacts and cold ones", "cs": "Rozděl seznam na teplé a studené kontakty"}
  ]$j$);

select pg_temp.seed_milestone('ecommerce', 2, 2, 'first_outreach', 200, 'section_pipeline',
  $j${"en": "Reach your first suppliers and partners", "cs": "Oslov první dodavatele a partnery"}$j$,
  $j${"en": "Secure stock and the first promotion before you spend on ads.", "cs": "Zajisti si zboží a první propagaci dřív, než začneš platit za reklamu."}$j$,
  null,
  $j$[
    {"en": "Call 10 suppliers and ask about minimum order and wholesale price", "cs": "Zavolej 10 dodavatelům a zeptej se na minimální odběr a velkoobchodní cenu"},
    {"en": "Send 10 influencers a message offering a sample product for a review", "cs": "Napiš 10 influencerům nabídku vzorku produktu za recenzi"},
    {"en": "Record every outcome by moving the contact to the right table", "cs": "Každý výsledek zapiš přesunem kontaktu do správné tabulky"},
    {"en": "Follow up after 3 days with everyone who did not answer", "cs": "Za 3 dny se ozvi všem, kdo neodpověděli"}
  ]$j$);

select pg_temp.seed_milestone('ecommerce', 2, 3, 'first_meeting', 200, 'section_calendar',
  $j${"en": "First supplier or partnership call", "cs": "První hovor s dodavatelem nebo partnerem"}$j$,
  $j${"en": "Agree terms, prices and deadlines with a date in the calendar.", "cs": "Domluv podmínky, ceny a termíny se zapsaným datem v kalendáři."}$j$,
  $j${"en": "Lunch at a place you have wanted to try", "cs": "Oběd v podniku, který chceš dlouho vyzkoušet"}$j$,
  $j$[
    {"en": "Book a call with a date and time with a chosen supplier or influencer", "cs": "Domluv hovor na konkrétní den a hodinu s vybraným dodavatelem nebo influencerem"},
    {"en": "Prepare 5 questions about price, delivery time and return terms", "cs": "Připrav si 5 otázek na cenu, dodací lhůtu a podmínky vratek"},
    {"en": "Take notes during the call and agree the next step", "cs": "Během hovoru si dělej poznámky a domluv další krok"},
    {"en": "Send a summary and the agreed terms within 24 hours", "cs": "Do 24 hodin pošli shrnutí a domluvené podmínky"}
  ]$j$);

select pg_temp.seed_milestone('ecommerce', 3, 1, 'first_job', 250, 'section_finance',
  $j${"en": "Process your first order", "cs": "Vyřiď první objednávku"}$j$,
  $j${"en": "Confirmation, payment, packaging and dispatch, all within the time you promised.", "cs": "Potvrzení, platba, zabalení a odeslání, vše v čase, který jsi slíbil."}$j$,
  null,
  $j$[
    {"en": "Set up order confirmation and shipping e-mails", "cs": "Nastav e-maily s potvrzením objednávky a odeslání zásilky"},
    {"en": "Pack and send your first order within the promised time", "cs": "Zabal a odešli první objednávku v slíbeném čase"},
    {"en": "Track the shipment until the customer confirms delivery", "cs": "Sleduj zásilku, dokud zákazník nepotvrdí doručení"},
    {"en": "Ask the customer for a review after delivery", "cs": "Po doručení požádej zákazníka o recenzi"}
  ]$j$);

select pg_temp.seed_milestone('ecommerce', 3, 2, 'first_invoice', 250, null,
  $j${"en": "Invoice, VAT and your real margin", "cs": "Faktura, DPH a skutečná marže"}$j$,
  $j${"en": "Money on the account, a correct receipt and a check of what you really earned.", "cs": "Peníze na účtu, správný doklad a kontrola, kolik jsi doopravdy vydělal."}$j$,
  null,
  $j$[
    {"en": "Issue a receipt or invoice with all required details", "cs": "Vystav doklad nebo fakturu se všemi náležitostmi"},
    {"en": "Record the income and all costs (goods, shipping, fees) in Finance", "cs": "Zapiš příjem a všechny náklady (zboží, doprava, poplatky) do Financí"},
    {"en": "Check how close your turnover is to the VAT registration threshold", "cs": "Zkontroluj, jak blízko je tvůj obrat limitu pro registraci k DPH"},
    {"en": "Calculate your real margin per order after all fees", "cs": "Spočítej skutečnou marži na objednávku po odečtení všech poplatků"}
  ]$j$);

select pg_temp.seed_milestone('ecommerce', 3, 3, 'recurring_income', 300, null,
  $j${"en": "Steady orders every week", "cs": "Pravidelné objednávky každý týden"}$j$,
  $j${"en": "A target based on your costs, repeat customers and paid promotion that pays for itself.", "cs": "Cíl podle nákladů, vracející se zákazníci a placená propagace, která se vyplatí."}$j$,
  $j${"en": "A weekend away", "cs": "Víkend mimo domov"}$j$,
  $j$[
    {"en": "Set a weekly order target based on your costs", "cs": "Stanov si týdenní cíl objednávek podle svých nákladů"},
    {"en": "Run a small paid campaign (Meta or Google Ads) and track its return", "cs": "Spusť menší placenou kampaň (Meta nebo Google Ads) a sleduj její návratnost"},
    {"en": "Send an e-mail offer to past customers", "cs": "Pošli e-mailovou nabídku dřívějším zákazníkům"},
    {"en": "Hit your weekly order target two weeks in a row", "cs": "Splň týdenní cíl objednávek dva týdny po sobě"}
  ]$j$);

select pg_temp.seed_milestone('ecommerce', 4, 1, 'repeat_clients', 300, null,
  $j${"en": "Turn buyers into repeat customers", "cs": "Udělej z kupujících stálé zákazníky"}$j$,
  $j${"en": "A returning customer costs far less than a new one brought by ads.", "cs": "Vracející se zákazník stojí mnohem méně než nový přivedený reklamou."}$j$,
  null,
  $j$[
    {"en": "Set up a thank-you e-mail with a discount on the next order", "cs": "Nastav děkovný e-mail se slevou na další objednávku"},
    {"en": "Ask 5 happy customers for a review on the shop or Google", "cs": "Požádej 5 spokojených zákazníků o recenzi v obchodě nebo na Googlu"},
    {"en": "Create a loyalty discount for customers with 2+ orders", "cs": "Vytvoř věrnostní slevu pro zákazníky se 2 a více objednávkami"},
    {"en": "Win a second order from the same customer", "cs": "Získej druhou objednávku od stejného zákazníka"}
  ]$j$);

select pg_temp.seed_milestone('ecommerce', 4, 2, 'first_helper', 350, null,
  $j${"en": "Hand off packing or support", "cs": "Předej balení nebo zákaznickou podporu"}$j$,
  $j${"en": "Free your hands for growth: hand off what someone else can do.", "cs": "Uvolni si ruce na růst: předej, co zvládne někdo jiný."}$j$,
  null,
  $j$[
    {"en": "List tasks that slow you down (packing, replies, returns)", "cs": "Sepiš úkoly, které tě zdržují (balení, odpovídání, vratky)"},
    {"en": "Work out how much you can pay a helper from your margin", "cs": "Spočítej, kolik můžeš pomocníkovi zaplatit z marže"},
    {"en": "Find a part-timer for packing or customer support", "cs": "Najdi brigádníka na balení nebo podporu zákazníkům"},
    {"en": "Give them a clear brief and check the result on the first day", "cs": "Dej mu jasné zadání a první den zkontroluj výsledek"}
  ]$j$);

select pg_temp.seed_milestone('ecommerce', 4, 3, 'business_system', 400, null,
  $j${"en": "Run the shop with a system", "cs": "Řiď obchod podle systému"}$j$,
  $j${"en": "Automated e-mails, a restocking routine and no sold-out best-sellers.", "cs": "Automatizované e-maily, rutina na doplňování zboží a žádné vyprodané bestsellery."}$j$,
  $j${"en": "A week of real holiday", "cs": "Týden opravdové dovolené"}$j$,
  $j$[
    {"en": "Automate order, shipping and review-request e-mails", "cs": "Zautomatizuj e-maily s objednávkou, odesláním a žádostí o recenzi"},
    {"en": "Set a reorder point for your best-selling products", "cs": "Stanov hranici pro doobjednání u nejprodávanějších produktů"},
    {"en": "Prepare a weekly checklist for orders, stock and ads", "cs": "Připrav týdenní checklist pro objednávky, zásoby a reklamu"},
    {"en": "Raise prices by 5-10% where margin is tightest", "cs": "Zvyš ceny o 5-10 % tam, kde je marže nejnižší"},
    {"en": "Take a week off and check the shop ran without you", "cs": "Vezmi si týden volna a ověř, že obchod běžel i bez tebe"}
  ]$j$);

-- =============================================================================
-- Hospitality and café
-- =============================================================================

select pg_temp.seed_path('gastro', 5, 'utensils', array['gastro'],
  $j${"en": "Hospitality and café", "cs": "Gastronomie a kavárna"}$j$,
  $j${"en": "From a hygiene-ready kitchen to a full week of covers. For restaurants, cafés and catering.", "cs": "Od kuchyně připravené na hygienu po plný týden obsazenosti. Pro restaurace, kavárny a catering."}$j$);

select pg_temp.seed_milestone('gastro', 1, 1, 'trade_license', 100, null,
  $j${"en": "Register your food trade", "cs": "Založ živnost pro stravovací služby"}$j$,
  $j${"en": "Hospitality is a bound trade: you need the right qualification and a hygiene-ready kitchen.", "cs": "Hostinská činnost je vázaná živnost: potřebuješ odpovídající kvalifikaci a kuchyni připravenou na hygienu."}$j$,
  null,
  $j$[
    {"en": "Check the qualification required for the bound trade \"Hostinská činnost\" (certificate, practice)", "cs": "Ověř kvalifikaci potřebnou pro vázanou živnost „Hostinská činnost“ (osvědčení, praxe)"},
    {"en": "Register the trade and attach proof of qualification", "cs": "Ohlas živnost a přilož doklad o kvalifikaci"},
    {"en": "Register as self-employed with social security and your health insurer", "cs": "Přihlas se jako OSVČ na OSSZ a u zdravotní pojišťovny"},
    {"en": "Set up a business data box", "cs": "Zřiď si datovou schránku"}
  ]$j$);

select pg_temp.seed_milestone('gastro', 1, 2, 'business_account', 100, null,
  $j${"en": "Premises, hygiene and account", "cs": "Provozovna, hygiena a účet"}$j$,
  $j${"en": "Notify the hygiene station, set up your operating rules and open a business account before day one.", "cs": "Nahlas provozovnu hygienické stanici, sepiš provozní řád a otevři si podnikatelský účet ještě před prvním dnem."}$j$,
  null,
  $j$[
    {"en": "Notify the regional hygiene station (KHS) of your premises before opening", "cs": "Nahlas provozovnu krajské hygienické stanici (KHS) před otevřením"},
    {"en": "Write operating rules (provozní řád) covering cleaning and waste", "cs": "Sepiš provozní řád pro úklid a odpad"},
    {"en": "Set up a HACCP system for your kitchen", "cs": "Zaveď systém HACCP pro svou kuchyni"},
    {"en": "Open a business bank account", "cs": "Otevři si podnikatelský účet"}
  ]$j$);

select pg_temp.seed_milestone('gastro', 1, 3, 'offer_pricing', 150, 'section_contacts',
  $j${"en": "Menu, allergens and prices", "cs": "Menu, alergeny a ceny"}$j$,
  $j${"en": "Say what you serve, mark the allergens by law and price each dish to actually earn you money.", "cs": "Řekni, co vaříš, ze zákona označ alergeny a naceň každé jídlo tak, aby na něm bylo vydělané."}$j$,
  $j${"en": "An evening off with a good film", "cs": "Večer bez práce s dobrým filmem"}$j$,
  $j$[
    {"en": "Design a menu of 10-15 dishes or drinks", "cs": "Navrhni menu s 10-15 jídly nebo nápoji"},
    {"en": "Mark the 14 required allergens for every dish", "cs": "U každého jídla označ 14 povinných alergenů"},
    {"en": "Calculate food cost per dish and keep it under 30% of the price", "cs": "Spočítej food cost na jídlo a udrž ho pod 30 % ceny"},
    {"en": "Check prices at 3 nearby competitors", "cs": "Zjisti ceny u 3 konkurentů v okolí"},
    {"en": "Print the menu and the required price list by the entrance", "cs": "Vytiskni menu a povinný ceník u vchodu"}
  ]$j$);

select pg_temp.seed_milestone('gastro', 2, 1, 'contact_list', 150, 'section_cold_calling',
  $j${"en": "Build a list of suppliers and local partners", "cs": "Sestav seznam dodavatelů a místních partnerů"}$j$,
  $j${"en": "A reliable supplier and a few local allies matter more than ads on day one.", "cs": "Spolehlivý dodavatel a pár místních spojenců jsou na začátku důležitější než reklama."}$j$,
  null,
  $j$[
    {"en": "Find 10 food and drink suppliers in your area", "cs": "Najdi 10 dodavatelů potravin a nápojů ve svém okolí"},
    {"en": "Write down 10 nearby offices or shops for lunch deals or delivery", "cs": "Zapiš 10 kanceláří nebo obchodů v okolí pro oběd nebo rozvoz"},
    {"en": "Add 10 local food bloggers or reviewers with contact details", "cs": "Přidej 10 místních food blogerů nebo recenzentů s kontaktem"},
    {"en": "Create a Google and Mapy.cz profile with photos and opening hours", "cs": "Založ profil na Googlu a Mapy.cz s fotkami a otevírací dobou"}
  ]$j$);

select pg_temp.seed_milestone('gastro', 2, 2, 'first_outreach', 200, 'section_pipeline',
  $j${"en": "Get your first guests through the door", "cs": "Dostaň první hosty za dveře"}$j$,
  $j${"en": "A soft opening, a lunch offer for nearby offices and a sample for a reviewer.", "cs": "Zkušební otevření, obědová nabídka pro kanceláře v okolí a vzorek pro recenzenta."}$j$,
  null,
  $j$[
    {"en": "Offer 10 nearby offices a lunch menu or catering", "cs": "Nabídni 10 kancelářím v okolí obědové menu nebo catering"},
    {"en": "Invite 3 local reviewers or bloggers to a free tasting", "cs": "Pozvi 3 místní recenzenty nebo blogery na ochutnávku zdarma"},
    {"en": "Hold a soft opening for friends and neighbours", "cs": "Udělej zkušební otevření pro známé a sousedy"},
    {"en": "Post the opening on social media and local groups", "cs": "Zveřejni otevření na sociálních sítích a v místních skupinách"}
  ]$j$);

select pg_temp.seed_milestone('gastro', 2, 3, 'first_meeting', 200, 'section_calendar',
  $j${"en": "First catering or regular-order deal", "cs": "První zakázka na catering nebo pravidelný odběr"}$j$,
  $j${"en": "A booked date, agreed quantity and a clear price.", "cs": "Domluvený termín, množství a jasná cena."}$j$,
  $j${"en": "Lunch at a place you have wanted to try", "cs": "Oběd v podniku, který chceš dlouho vyzkoušet"}$j$,
  $j$[
    {"en": "Book a meeting with an office or event client about catering", "cs": "Domluv schůzku s kanceláří nebo klientem akce o cateringu"},
    {"en": "Agree the menu, quantity and delivery time", "cs": "Domluv menu, množství a čas doručení"},
    {"en": "Send a written price confirmation", "cs": "Pošli písemné potvrzení ceny"},
    {"en": "Deliver on the agreed day and ask for feedback", "cs": "Dodej v domluveném termínu a požádej o zpětnou vazbu"}
  ]$j$);

select pg_temp.seed_milestone('gastro', 3, 1, 'first_job', 250, 'section_finance',
  $j${"en": "Serve your first full day of guests", "cs": "Odbav první celý den s hosty"}$j$,
  $j${"en": "Open on time, keep the kitchen running and track what sold.", "cs": "Otevři včas, udrž kuchyň v chodu a sleduj, co se prodalo."}$j$,
  null,
  $j$[
    {"en": "Open on schedule with the full menu available", "cs": "Otevři podle plánu s celým menu k dispozici"},
    {"en": "Track which dishes sold out or did not sell at all", "cs": "Sleduj, která jídla se vyprodala a která se neprodávala vůbec"},
    {"en": "Collect feedback from the first guests", "cs": "Vyber si zpětnou vazbu od prvních hostů"},
    {"en": "Adjust the menu based on the first week's sales", "cs": "Uprav menu podle prodejů za první týden"}
  ]$j$);

select pg_temp.seed_milestone('gastro', 3, 2, 'first_invoice', 250, null,
  $j${"en": "Daily closing and real food cost", "cs": "Denní uzávěrka a skutečný food cost"}$j$,
  $j${"en": "Know exactly how much came in, what it cost you, and what is left.", "cs": "Vědět přesně, kolik přišlo, co tě to stálo a co zbylo."}$j$,
  null,
  $j$[
    {"en": "Do a daily cash and card closing and record it in Finance", "cs": "Udělej denní uzávěrku hotovosti a karet a zapiš ji do Financí"},
    {"en": "Keep supplier receipts for the month together", "cs": "Uschovej doklady od dodavatelů za měsíc pohromadě"},
    {"en": "Calculate real food cost against the planned 30%", "cs": "Spočítej skutečný food cost proti plánovaným 30 %"},
    {"en": "Check how close your turnover is to the VAT registration threshold", "cs": "Zkontroluj, jak blízko je tvůj obrat limitu pro registraci k DPH"}
  ]$j$);

select pg_temp.seed_milestone('gastro', 3, 3, 'recurring_income', 300, null,
  $j${"en": "A full week of covers", "cs": "Plný týden obsazenosti"}$j$,
  $j${"en": "Regular lunch guests, weekend bookings and a stock plan that avoids waste.", "cs": "Pravidelní oběďáři, víkendové rezervace a plán zásob bez zbytečného vyhazování."}$j$,
  $j${"en": "A weekend away", "cs": "Víkend mimo domov"}$j$,
  $j$[
    {"en": "Set a weekly revenue target based on your costs", "cs": "Stanov si týdenní cíl obratu podle svých nákladů"},
    {"en": "Launch a weekly lunch special to fill the quiet hours", "cs": "Spusť týdenní polední speciál na zaplnění slabších hodin"},
    {"en": "Open online or phone reservations for weekends", "cs": "Zaveď online nebo telefonické rezervace na víkendy"},
    {"en": "Hit your weekly revenue target two weeks in a row", "cs": "Splň týdenní cíl obratu dva týdny po sobě"}
  ]$j$);

select pg_temp.seed_milestone('gastro', 4, 1, 'repeat_clients', 300, null,
  $j${"en": "Turn guests into regulars", "cs": "Udělej z hostů štamgasty"}$j$,
  $j${"en": "A regular guest fills quiet hours and tells others.", "cs": "Štamgast zaplní slabší hodiny a řekne o tobě dalším."}$j$,
  null,
  $j$[
    {"en": "Start a simple loyalty card or discount for regulars", "cs": "Zaveď jednoduchou věrnostní kartičku nebo slevu pro štamgasty"},
    {"en": "Ask 5 happy guests for a Google review", "cs": "Požádej 5 spokojených hostů o recenzi na Googlu"},
    {"en": "Run a small event (tasting, live music) to bring guests back", "cs": "Uspořádej menší akci (ochutnávka, živá hudba), která hosty přivede zpět"},
    {"en": "Reach a 30% share of repeat guests in a month", "cs": "Dosáhni 30% podílu vracejících se hostů za měsíc"}
  ]$j$);

select pg_temp.seed_milestone('gastro', 4, 2, 'first_helper', 350, null,
  $j${"en": "Hire your first kitchen or service help", "cs": "Najmi prvního pomocníka do kuchyně nebo obsluhy"}$j$,
  $j${"en": "You cannot cook, serve and manage alone at full capacity.", "cs": "Sám nezvládneš vařit, obsluhovat a řídit provoz na plný výkon."}$j$,
  null,
  $j$[
    {"en": "Count the hours you turned down guests for lack of staff", "cs": "Spočítej hodiny, kdy jsi odmítl hosty pro nedostatek personálu"},
    {"en": "Find a part-timer for the kitchen or the floor", "cs": "Najdi brigádníka do kuchyně nebo na obsluhu"},
    {"en": "Give them a trial shift with clear instructions", "cs": "Dej mu zkušební směnu s jasnými instrukcemi"},
    {"en": "Train them on the hygiene rules and the HACCP log", "cs": "Zaškol ho na hygienická pravidla a záznamy HACCP"}
  ]$j$);

select pg_temp.seed_milestone('gastro', 4, 3, 'business_system', 400, null,
  $j${"en": "Run the kitchen with a system", "cs": "Řiď kuchyň podle systému"}$j$,
  $j${"en": "Recipe cards, a stock-ordering routine and a week off that does not close the doors.", "cs": "Receptury s gramáží, rutina na objednávání zásob a volno, které nezavře podnik."}$j$,
  $j${"en": "A week of real holiday", "cs": "Týden opravdové dovolené"}$j$,
  $j$[
    {"en": "Write recipe cards with exact quantities for every dish", "cs": "Sepiš receptury s přesnými gramážemi pro každé jídlo"},
    {"en": "Set a weekly ordering routine for your main suppliers", "cs": "Nastav týdenní rutinu objednávání u hlavních dodavatelů"},
    {"en": "Prepare an opening and closing checklist for staff", "cs": "Připrav checklist pro otevírání a zavírání pro personál"},
    {"en": "Raise prices by 5% where food cost runs highest", "cs": "Zvyš ceny o 5 % tam, kde je food cost nejvyšší"},
    {"en": "Take a day off with a trained staff member covering", "cs": "Vezmi si den volna, provoz zastoupí zaškolený pracovník"}
  ]$j$);

-- =============================================================================
-- Personal services (hairdressing, cosmetics, massage)
-- =============================================================================

select pg_temp.seed_path('personal_services', 6, 'scissors', array['personalServices'],
  $j${"en": "Personal services", "cs": "Osobní služby"}$j$,
  $j${"en": "Hairdressing, cosmetics, massage. From a bound trade licence to a fully booked calendar. For anyone working on a client's body.", "cs": "Kadeřnictví, kosmetika, masáže. Od vázané živnosti po plně obsazený kalendář. Pro každého, kdo pracuje na těle klienta."}$j$);

select pg_temp.seed_milestone('personal_services', 1, 1, 'trade_license', 100, null,
  $j${"en": "Register your personal-services trade", "cs": "Založ živnost pro osobní služby"}$j$,
  $j${"en": "Hairdressing, cosmetics and massage are bound trades needing proof of qualification.", "cs": "Kadeřnictví, kosmetika i masérské služby jsou vázané živnosti, které potřebují doklad o kvalifikaci."}$j$,
  null,
  $j$[
    {"en": "Check the qualification required for your bound trade (certificate, apprenticeship, course)", "cs": "Ověř kvalifikaci potřebnou pro tvou vázanou živnost (osvědčení, výuční list, kurz)"},
    {"en": "Register the trade and attach proof of qualification", "cs": "Ohlas živnost a přilož doklad o kvalifikaci"},
    {"en": "Register as self-employed with social security and your health insurer", "cs": "Přihlas se jako OSVČ na OSSZ a u zdravotní pojišťovny"},
    {"en": "Take out liability insurance for services on clients' bodies", "cs": "Sjednej pojištění odpovědnosti za služby poskytované na těle klienta"}
  ]$j$);

select pg_temp.seed_milestone('personal_services', 1, 2, 'business_account', 100, null,
  $j${"en": "Premises, hygiene and account", "cs": "Provozovna, hygiena a účet"}$j$,
  $j${"en": "Meet the hygiene rules for personal-care premises before your first client sits down.", "cs": "Splň hygienické požadavky na provozovnu dřív, než si sedne první klient."}$j$,
  null,
  $j$[
    {"en": "Check the hygiene requirements for premises (washable surfaces, sterilisation, waste)", "cs": "Ověř hygienické požadavky na provozovnu (omyvatelné plochy, sterilizace, odpad)"},
    {"en": "Buy a steriliser or disinfection kit for tools", "cs": "Pořiď sterilizátor nebo dezinfekční sadu na nástroje"},
    {"en": "Open a business bank account", "cs": "Otevři si podnikatelský účet"},
    {"en": "Set up a booking system (online calendar or app)", "cs": "Nastav si rezervační systém (online kalendář nebo aplikaci)"}
  ]$j$);

select pg_temp.seed_milestone('personal_services', 1, 3, 'offer_pricing', 150, 'section_contacts',
  $j${"en": "Price list and your service menu", "cs": "Ceník a nabídka služeb"}$j$,
  $j${"en": "List what you offer, how long it takes and for how much, including products used.", "cs": "Sepiš, co nabízíš, jak dlouho to trvá a za kolik, včetně použitých přípravků."}$j$,
  $j${"en": "An evening off with a good film", "cs": "Večer bez práce s dobrým filmem"}$j$,
  $j$[
    {"en": "List your 8-12 services with duration and price", "cs": "Sepiš 8-12 služeb s délkou a cenou"},
    {"en": "Check prices at 3 nearby salons or studios", "cs": "Zjisti ceny u 3 salonů nebo studií v okolí"},
    {"en": "Work out your minimum hourly rate covering rent, products and contributions", "cs": "Spočítej minimální hodinovou sazbu pokrývající nájem, přípravky a odvody"},
    {"en": "Photograph your work or premises for a portfolio", "cs": "Nafoť svou práci nebo provozovnu do portfolia"},
    {"en": "Print a price list for the premises", "cs": "Vytiskni ceník pro provozovnu"}
  ]$j$);

select pg_temp.seed_milestone('personal_services', 2, 1, 'contact_list', 150, 'section_cold_calling',
  $j${"en": "Build a client list from your network", "cs": "Sestav klientský seznam ze svého okolí"}$j$,
  $j${"en": "Your first clients are people who already trust you or live nearby.", "cs": "První klienti jsou lidé, kteří tě už znají, nebo bydlí poblíž."}$j$,
  null,
  $j$[
    {"en": "Write down 15 friends and acquaintances who could become clients", "cs": "Zapiš 15 známých, kteří by mohli být klienty"},
    {"en": "Create a Google and Instagram profile with photos and opening hours", "cs": "Založ profil na Googlu a Instagramu s fotkami a otevírací dobou"},
    {"en": "Find 10 nearby offices or gyms for a partnership (discount for their people)", "cs": "Najdi 10 kanceláří nebo fitness studií v okolí pro spolupráci (sleva pro jejich lidi)"},
    {"en": "Split the list between warm and cold contacts", "cs": "Rozděl seznam na teplé a studené kontakty"}
  ]$j$);

select pg_temp.seed_milestone('personal_services', 2, 2, 'first_outreach', 200, 'section_pipeline',
  $j${"en": "Fill your first week of bookings", "cs": "Naplň si první týden rezervací"}$j$,
  $j${"en": "An opening offer and personal messages fill the calendar faster than ads.", "cs": "Zahajovací nabídka a osobní zprávy naplní kalendář rychleji než reklama."}$j$,
  null,
  $j$[
    {"en": "Send 15 friends and acquaintances a personal message with an opening offer", "cs": "Napiš 15 známým osobní zprávu se zahajovací nabídkou"},
    {"en": "Post your opening and price list on social media", "cs": "Zveřejni otevření a ceník na sociálních sítích"},
    {"en": "Offer 5 nearby businesses a discount for their employees", "cs": "Nabídni 5 firmám v okolí slevu pro jejich zaměstnance"},
    {"en": "Record every booking and no-show", "cs": "Zapiš každou rezervaci i nedostavení se"}
  ]$j$);

select pg_temp.seed_milestone('personal_services', 2, 3, 'first_meeting', 200, 'section_calendar',
  $j${"en": "First paid appointment", "cs": "První placené ošetření"}$j$,
  $j${"en": "A booked slot, a client consultation and a clear next appointment.", "cs": "Domluvený termín, konzultace s klientem a jasně navržený další termín."}$j$,
  $j${"en": "Coffee and cake at your favourite café", "cs": "Káva a dort v oblíbené kavárně"}$j$,
  $j$[
    {"en": "Book the appointment with a specific day and time", "cs": "Domluv ošetření na konkrétní den a hodinu"},
    {"en": "Ask about allergies, skin type or health limits before starting", "cs": "Před zahájením se zeptej na alergie, typ pleti nebo zdravotní omezení"},
    {"en": "Recommend the next appointment or a home-care routine at the end", "cs": "Na konci doporuč další termín nebo domácí péči"},
    {"en": "Follow up with a message asking how the client is doing", "cs": "Napiš klientovi zprávu, jak se cítí"}
  ]$j$);

select pg_temp.seed_milestone('personal_services', 3, 1, 'first_job', 250, 'section_finance',
  $j${"en": "Deliver a full day of appointments", "cs": "Odbav celý den ošetření"}$j$,
  $j${"en": "A calendar without gaps and clients who leave satisfied.", "cs": "Kalendář bez děr a klienti, kteří odcházejí spokojeni."}$j$,
  null,
  $j$[
    {"en": "Fill a whole day with back-to-back appointments", "cs": "Naplň celý den po sobě navazujícími termíny"},
    {"en": "Confirm appointments by message the day before", "cs": "Potvrď termíny zprávou den předem"},
    {"en": "Ask each client how they felt about the result", "cs": "Zeptej se každého klienta, jak je spokojený s výsledkem"},
    {"en": "Keep notes on each client's preferences for next time", "cs": "Zapiš si preference klienta pro příště"}
  ]$j$);

select pg_temp.seed_milestone('personal_services', 3, 2, 'first_invoice', 250, null,
  $j${"en": "Record income and product costs", "cs": "Zapiš příjmy a náklady na přípravky"}$j$,
  $j${"en": "Know what each appointment really earned after products and rent.", "cs": "Vědět, co ti ošetření skutečně vydělalo po odečtení přípravků a nájmu."}$j$,
  null,
  $j$[
    {"en": "Issue a receipt or invoice for every paid appointment", "cs": "Vystav doklad nebo fakturu za každé placené ošetření"},
    {"en": "Record income and product/rent costs in Finance", "cs": "Zapiš příjmy a náklady na přípravky/nájem do Financí"},
    {"en": "Calculate your real hourly earnings after costs", "cs": "Spočítej skutečný hodinový výdělek po odečtení nákladů"},
    {"en": "Check how close your turnover is to the VAT registration threshold", "cs": "Zkontroluj, jak blízko je tvůj obrat limitu pro registraci k DPH"}
  ]$j$);

select pg_temp.seed_milestone('personal_services', 3, 3, 'recurring_income', 300, null,
  $j${"en": "A fully booked calendar every week", "cs": "Plně obsazený kalendář každý týden"}$j$,
  $j${"en": "Regular rebooking and a no-show policy that protects your income.", "cs": "Pravidelné objednávání na další termín a pravidla pro nedostavení se, která chrání tvůj příjem."}$j$,
  $j${"en": "Something nice for your workspace", "cs": "Něco hezkého na pracovní stůl"}$j$,
  $j$[
    {"en": "Set a weekly revenue target based on your costs", "cs": "Stanov si týdenní cíl obratu podle svých nákladů"},
    {"en": "Offer rebooking at the end of every appointment", "cs": "Nabízej objednání na další termín na konci každého ošetření"},
    {"en": "Set a deposit or cancellation rule for no-shows", "cs": "Zaveď zálohu nebo pravidlo pro zrušení u nedostavení se"},
    {"en": "Hit your weekly revenue target two weeks in a row", "cs": "Splň týdenní cíl obratu dva týdny po sobě"}
  ]$j$);

select pg_temp.seed_milestone('personal_services', 4, 1, 'repeat_clients', 300, null,
  $j${"en": "Turn clients into regulars", "cs": "Udělej z klientů stálé návštěvníky"}$j$,
  $j${"en": "A regular client who rebooks is worth more than one who comes once.", "cs": "Stálý klient, který se vrací, má větší hodnotu než ten, co přijde jen jednou."}$j$,
  null,
  $j$[
    {"en": "Start a loyalty card (e.g. every 6th visit discounted)", "cs": "Zaveď věrnostní kartičku (např. každá 6. návštěva se slevou)"},
    {"en": "Ask 5 happy clients for a Google or Instagram review", "cs": "Požádej 5 spokojených klientů o recenzi na Googlu nebo Instagramu"},
    {"en": "Offer a referral discount for bringing a friend", "cs": "Nabídni slevu za doporučení kamarádky nebo kamaráda"},
    {"en": "Win a second appointment from a referral", "cs": "Získej druhé ošetření z doporučení"}
  ]$j$);

select pg_temp.seed_milestone('personal_services', 4, 2, 'first_helper', 350, null,
  $j${"en": "Bring in a second pair of hands", "cs": "Přiber druhé ruce"}$j$,
  $j${"en": "When the calendar is full for weeks, it is time for a colleague or a rented chair.", "cs": "Když je kalendář plný na týdny dopředu, je čas na kolegu nebo pronájem křesla."}$j$,
  null,
  $j$[
    {"en": "Count how many clients you turned away last month for lack of time", "cs": "Spočítej, kolik klientů jsi minulý měsíc odmítl pro nedostatek času"},
    {"en": "Find a colleague to rent a chair or work part-time", "cs": "Najdi kolegyni nebo kolegu na pronájem křesla nebo brigádu"},
    {"en": "Agree the split of costs and bookings", "cs": "Domluv rozdělení nákladů a rezervací"},
    {"en": "Give them a trial week with your regular clients' feedback", "cs": "Dej jim zkušební týden a vyber zpětnou vazbu od stálých klientů"}
  ]$j$);

select pg_temp.seed_milestone('personal_services', 4, 3, 'business_system', 400, null,
  $j${"en": "Run the salon with a system", "cs": "Řiď salon podle systému"}$j$,
  $j${"en": "Automated reminders, a restocking routine and a week off that does not lose clients.", "cs": "Automatické připomínky, rutina na doplňování přípravků a volno, které tě nepřipraví o klienty."}$j$,
  $j${"en": "A proper holiday", "cs": "Pořádná dovolená"}$j$,
  $j$[
    {"en": "Turn on automatic booking reminders by SMS or app", "cs": "Zapni automatické připomínky rezervace přes SMS nebo aplikaci"},
    {"en": "Set a reorder point for your main products", "cs": "Stanov hranici pro doobjednání hlavních přípravků"},
    {"en": "Prepare a client record template (preferences, allergies, history)", "cs": "Připrav šablonu klientské karty (preference, alergie, historie)"},
    {"en": "Raise prices by 5-10% for new clients", "cs": "Zvyš ceny pro nové klienty o 5-10 %"},
    {"en": "Take a week off with bookings handled by a colleague or paused calendar", "cs": "Vezmi si týden volna, rezervace přebere kolegyně nebo kalendář pozastav"}
  ]$j$);

-- =============================================================================
-- Real estate agent
-- =============================================================================

select pg_temp.seed_path('real_estate', 7, 'home', array['realEstate'],
  $j${"en": "Real estate agent", "cs": "Realitní makléř"}$j$,
  $j${"en": "From a bound trade and insurance to a full pipeline of listings. For anyone brokering property sales.", "cs": "Od vázané živnosti a pojištění po plnou pipeline nabídek. Pro každého, kdo zprostředkovává prodej nemovitostí."}$j$);

select pg_temp.seed_milestone('real_estate', 1, 1, 'trade_license', 100, null,
  $j${"en": "Register as a real estate agent", "cs": "Založ živnost pro realitního makléře"}$j$,
  $j${"en": "Real estate brokerage is a bound trade: it needs qualification, insurance and an escrow account.", "cs": "Zprostředkování obchodu s nemovitostmi je vázaná živnost: potřebuje kvalifikaci, pojištění a svěřenecký účet."}$j$,
  null,
  $j$[
    {"en": "Check the qualification required under the Real Estate Act (education or the broker's exam)", "cs": "Ověř kvalifikaci podle zákona o realitním zprostředkování (vzdělání nebo makléřská zkouška)"},
    {"en": "Register the bound trade and attach proof of qualification", "cs": "Ohlas vázanou živnost a přilož doklad o kvalifikaci"},
    {"en": "Take out mandatory professional liability insurance", "cs": "Sjednej povinné pojištění odpovědnosti za škodu"},
    {"en": "Open a separate escrow account for client deposits", "cs": "Otevři oddělený svěřenecký účet pro klientské zálohy"}
  ]$j$);

select pg_temp.seed_milestone('real_estate', 1, 2, 'business_account', 100, null,
  $j${"en": "Account, contract templates and listing tools", "cs": "Účet, vzory smluv a nástroje na inzerci"}$j$,
  $j${"en": "A business account, a brokerage agreement template and the portals where listings get seen.", "cs": "Podnikatelský účet, vzor zprostředkovatelské smlouvy a portály, kde inzeráty uvidí lidé."}$j$,
  null,
  $j$[
    {"en": "Open a business bank account separate from the escrow account", "cs": "Otevři si podnikatelský účet oddělený od svěřeneckého účtu"},
    {"en": "Prepare a written brokerage agreement template meeting the legal requirements", "cs": "Připrav vzor zprostředkovatelské smlouvy splňující zákonné náležitosti"},
    {"en": "Register with the main listing portals (Sreality, Bezrealitky, Reality.cz)", "cs": "Zaregistruj se na hlavních inzertních portálech (Sreality, Bezrealitky, Reality.cz)"},
    {"en": "Set up a professional e-mail and a simple CRM for leads", "cs": "Zřiď si profesionální e-mail a jednoduché CRM pro poptávky"}
  ]$j$);

select pg_temp.seed_milestone('real_estate', 1, 3, 'offer_pricing', 150, 'section_contacts',
  $j${"en": "Define your commission and target area", "cs": "Definuj provizi a cílovou oblast"}$j$,
  $j${"en": "A clear commission, a chosen area and a sharp first listing to show what you do.", "cs": "Jasná provize, vybraná oblast a kvalitní první inzerát, který ukáže, co umíš."}$j$,
  $j${"en": "A book or course you have been putting off", "cs": "Kniha nebo kurz, který dlouho odkládáš"}$j$,
  $j$[
    {"en": "Set your commission rate (typically 3-5% of the sale price)", "cs": "Stanov svou provizi (obvykle 3-5 % z kupní ceny)"},
    {"en": "Pick a target area and 2-3 property types you focus on", "cs": "Vyber cílovou oblast a 2-3 typy nemovitostí, na které se zaměříš"},
    {"en": "Study prices of 10 comparable properties sold in the area recently", "cs": "Projdi ceny 10 srovnatelných nemovitostí prodaných v oblasti nedávno"},
    {"en": "Photograph and describe one sample listing to professional standard", "cs": "Nafoť a popiš jeden ukázkový inzerát na profesionální úrovni"},
    {"en": "Write a one-page overview of your services for sellers", "cs": "Napiš přehled svých služeb pro prodávající na jednu stránku"}
  ]$j$);

select pg_temp.seed_milestone('real_estate', 2, 1, 'contact_list', 150, 'section_cold_calling',
  $j${"en": "Build a list of potential sellers", "cs": "Sestav seznam potenciálních prodávajících"}$j$,
  $j${"en": "Owners thinking about selling, local notaries and developers are your first targets.", "cs": "Majitelé, kteří uvažují o prodeji, místní notáři a developeři jsou tvoje první cíle."}$j$,
  null,
  $j$[
    {"en": "Write down 10 people you know who might sell within a year", "cs": "Zapiš 10 známých, kteří by mohli do roka prodávat"},
    {"en": "Find 20 properties advertised privately (without an agent) in your area", "cs": "Najdi 20 nemovitostí inzerovaných soukromě (bez makléře) ve své oblasti"},
    {"en": "Add 10 local notaries, developers or property managers as referral partners", "cs": "Přidej 10 místních notářů, developerů nebo správců domů jako partnery pro doporučení"},
    {"en": "Add a phone number and situation note to each contact", "cs": "U každého kontaktu doplň telefon a poznámku k situaci"}
  ]$j$);

select pg_temp.seed_milestone('real_estate', 2, 2, 'first_outreach', 200, 'section_pipeline',
  $j${"en": "Reach out to owners selling privately", "cs": "Oslov majitele prodávající soukromě"}$j$,
  $j${"en": "Offer a free valuation; many private sellers struggle with the paperwork and negotiation.", "cs": "Nabídni bezplatný odhad ceny; hodně soukromých prodejců naráží na papírování a jednání."}$j$,
  null,
  $j$[
    {"en": "Call 15 owners advertising privately and offer a free valuation", "cs": "Zavolej 15 majitelům inzerujícím soukromě a nabídni bezplatný odhad ceny"},
    {"en": "Send 10 warm contacts a message about your new brokerage", "cs": "Napiš 10 teplým kontaktům zprávu o nové makléřské činnosti"},
    {"en": "Record every outcome by moving the contact to the right table", "cs": "Každý výsledek zapiš přesunem kontaktu do správné tabulky"},
    {"en": "Follow up after 3 days with everyone who did not answer", "cs": "Za 3 dny se ozvi všem, kdo neodpověděli"}
  ]$j$);

select pg_temp.seed_milestone('real_estate', 2, 3, 'first_meeting', 200, 'section_calendar',
  $j${"en": "First property viewing with an owner", "cs": "První schůzka s majitelem u nemovitosti"}$j$,
  $j${"en": "A viewing with a valuation estimate and a proposal to sign the brokerage agreement.", "cs": "Schůzka u nemovitosti s odhadem ceny a návrhem na podpis zprostředkovatelské smlouvy."}$j$,
  $j${"en": "Lunch at a place you have wanted to try", "cs": "Oběd v podniku, který chceš dlouho vyzkoušet"}$j$,
  $j$[
    {"en": "Book a viewing at the property with a specific date and time", "cs": "Domluv schůzku u nemovitosti na konkrétní den a hodinu"},
    {"en": "Assess the condition and prepare a price estimate before the meeting", "cs": "Zhodnoť stav a připrav odhad ceny před schůzkou"},
    {"en": "Explain the brokerage agreement terms and your commission clearly", "cs": "Jasně vysvětli podmínky zprostředkovatelské smlouvy a svou provizi"},
    {"en": "Send a written summary and the agreement draft within 24 hours", "cs": "Do 24 hodin pošli písemné shrnutí a návrh smlouvy"}
  ]$j$);

select pg_temp.seed_milestone('real_estate', 3, 1, 'first_job', 250, 'section_finance',
  $j${"en": "Sign your first brokerage agreement", "cs": "Podepiš první zprostředkovatelskou smlouvu"}$j$,
  $j${"en": "A written agreement with the required details and exclusivity terms.", "cs": "Písemná smlouva se zákonnými náležitostmi a podmínkami exkluzivity."}$j$,
  null,
  $j$[
    {"en": "Sign a brokerage agreement with price, commission and duration specified", "cs": "Podepiš zprostředkovatelskou smlouvu se stanovenou cenou, provizí a dobou trvání"},
    {"en": "Create a professional listing with photos, floor plan and description", "cs": "Vytvoř profesionální inzerát s fotkami, půdorysem a popisem"},
    {"en": "Publish the listing on at least 2 portals", "cs": "Zveřejni inzerát na alespoň 2 portálech"},
    {"en": "Organise and hold the first viewing with an interested buyer", "cs": "Zorganizuj a odbav první prohlídku se zájemcem"}
  ]$j$);

select pg_temp.seed_milestone('real_estate', 3, 2, 'first_invoice', 250, null,
  $j${"en": "Close the sale and invoice your commission", "cs": "Uzavři prodej a vyfakturuj provizi"}$j$,
  $j${"en": "Reservation agreement, deposit through the escrow account and a correct commission invoice.", "cs": "Rezervační smlouva, záloha přes svěřenecký účet a správně vystavená faktura za provizi."}$j$,
  null,
  $j$[
    {"en": "Draft a reservation agreement with the buyer and collect the deposit via the escrow account", "cs": "Sepiš rezervační smlouvu s kupujícím a vyber zálohu přes svěřenecký účet"},
    {"en": "Coordinate the purchase contract and the transfer at the land registry (katastr)", "cs": "Zkoordinuj kupní smlouvu a převod na katastru nemovitostí"},
    {"en": "Issue the commission invoice after the sale closes", "cs": "Vystav fakturu za provizi po uzavření prodeje"},
    {"en": "Record the income and all marketing costs in Finance", "cs": "Zapiš příjem a všechny náklady na marketing do Financí"}
  ]$j$);

select pg_temp.seed_milestone('real_estate', 3, 3, 'recurring_income', 300, null,
  $j${"en": "A steady pipeline of listings", "cs": "Stálý přísun nabídek k prodeji"}$j$,
  $j${"en": "A target based on your costs and enough listings to sell something every month.", "cs": "Cíl podle nákladů a dost nabídek, aby se každý měsíc něco prodalo."}$j$,
  $j${"en": "A weekend away", "cs": "Víkend mimo domov"}$j$,
  $j$[
    {"en": "Set a monthly income target based on your costs", "cs": "Stanov si měsíční cíl příjmu podle svých nákladů"},
    {"en": "Keep at least 5 active listings under exclusive agreement", "cs": "Udržuj alespoň 5 aktivních nabídek pod exkluzivní smlouvou"},
    {"en": "Follow up monthly with past leads who did not sell yet", "cs": "Jednou měsíčně se ozvi dřívějším zájemcům, kteří ještě neprodali"},
    {"en": "Hit your monthly income target two months in a row", "cs": "Splň měsíční cíl příjmu dva měsíce po sobě"}
  ]$j$);

select pg_temp.seed_milestone('real_estate', 4, 1, 'repeat_clients', 300, null,
  $j${"en": "Turn clients into referrals", "cs": "Udělej z klientů doporučitele"}$j$,
  $j${"en": "A satisfied seller refers the next one; real estate runs on reputation.", "cs": "Spokojený prodávající doporučí dalšího; reality táhne pověst."}$j$,
  null,
  $j$[
    {"en": "Ask 5 past clients for a referral or a review", "cs": "Požádej 5 bývalých klientů o doporučení nebo recenzi"},
    {"en": "Send past clients a market update once a quarter", "cs": "Jednou za čtvrt roku pošli bývalým klientům přehled trhu"},
    {"en": "Agree mutual referrals with a notary or mortgage advisor", "cs": "Domluv se s notářem nebo hypotečním poradcem na vzájemném doporučování"},
    {"en": "Win a new listing from a referral", "cs": "Získej novou nabídku z doporučení"}
  ]$j$);

select pg_temp.seed_milestone('real_estate', 4, 2, 'first_helper', 350, null,
  $j${"en": "Delegate viewings and paperwork", "cs": "Deleguj prohlídky a papírování"}$j$,
  $j${"en": "Your time is worth most negotiating and closing deals, not showing every flat.", "cs": "Tvůj čas má největší hodnotu při jednání a uzavírání, ne při ukazování každého bytu."}$j$,
  null,
  $j$[
    {"en": "Measure for one month how many hours viewings and paperwork take", "cs": "Změř měsíc, kolik hodin zaberou prohlídky a papírování"},
    {"en": "Find a junior agent or an assistant for viewings", "cs": "Najdi juniorního makléře nebo asistentku na prohlídky"},
    {"en": "Hand over the first viewing with written instructions", "cs": "Předej první prohlídku s písemnými instrukcemi"},
    {"en": "Agree the commission split for handled deals", "cs": "Domluv rozdělení provize za zpracované obchody"}
  ]$j$);

select pg_temp.seed_milestone('real_estate', 4, 3, 'business_system', 400, null,
  $j${"en": "Run your agency with a system", "cs": "Řiď svou kancelář podle systému"}$j$,
  $j${"en": "Templates, a CRM routine and a pipeline that keeps moving when you are away.", "cs": "Šablony, rutina v CRM a pipeline, která běží i v tvé nepřítomnosti."}$j$,
  $j${"en": "A proper holiday, phone on silent", "cs": "Pořádná dovolená, telefon na tichý režim"}$j$,
  $j$[
    {"en": "Prepare templates for the brokerage agreement, listing text and the closing checklist", "cs": "Připrav šablony zprostředkovatelské smlouvy, textu inzerátu a checklistu uzavření"},
    {"en": "Set up a weekly CRM review of all active listings and leads", "cs": "Nastav týdenní kontrolu CRM pro všechny aktivní nabídky a poptávky"},
    {"en": "Automate new-listing alerts for your buyer leads", "cs": "Zautomatizuj upozornění na nové nabídky pro zájemce o koupi"},
    {"en": "Raise your commission for new sellers once your pipeline is full", "cs": "Zvyš provizi pro nové prodávající, jakmile je pipeline plná"},
    {"en": "Take a week off with a junior agent covering viewings", "cs": "Vezmi si týden volna, prohlídky zastoupí juniorní makléř"}
  ]$j$);

-- =============================================================================
-- Fitness and personal trainer
-- =============================================================================

select pg_temp.seed_path('fitness', 8, 'dumbbell', array['fitness'],
  $j${"en": "Fitness and personal trainer", "cs": "Fitness a osobní trenér"}$j$,
  $j${"en": "From a trainer certificate to a fully booked weekly schedule. For personal trainers and coaches.", "cs": "Od trenérského certifikátu po plný týdenní rozvrh. Pro osobní trenéry a koučky."}$j$);

select pg_temp.seed_milestone('fitness', 1, 1, 'trade_license', 100, null,
  $j${"en": "Register your trainer trade", "cs": "Založ živnost osobního trenéra"}$j$,
  $j${"en": "Personal training is a free trade; a recognised certificate still makes clients trust you faster.", "cs": "Osobní trénink je volná živnost; uznaný certifikát ti ale rychleji získá důvěru klientů."}$j$,
  null,
  $j$[
    {"en": "Register the free trade field \"Provision of sport and physical training services\"", "cs": "Ohlas obor volné živnosti „Poskytování tělovýchovných a sportovních služeb“"},
    {"en": "Get or renew a recognised trainer certificate", "cs": "Získej nebo obnov uznaný trenérský certifikát"},
    {"en": "Register as self-employed with social security and your health insurer", "cs": "Přihlas se jako OSVČ na OSSZ a u zdravotní pojišťovny"},
    {"en": "Take out liability insurance for injuries during training", "cs": "Sjednej pojištění odpovědnosti za úraz během tréninku"}
  ]$j$);

select pg_temp.seed_milestone('fitness', 1, 2, 'business_account', 100, null,
  $j${"en": "Account, space and booking tools", "cs": "Účet, prostor a nástroje na rezervace"}$j$,
  $j${"en": "Decide where you will train, how clients book you and keep money apart from private.", "cs": "Rozhodni, kde budeš trénovat, jak se k tobě klienti budou objednávat, a odděl peníze od soukromých."}$j$,
  null,
  $j$[
    {"en": "Open a business bank account", "cs": "Otevři si podnikatelský účet"},
    {"en": "Agree access to a gym, studio or outdoor space to train clients", "cs": "Domluv si přístup do posilovny, studia nebo venkovního prostoru pro trénink klientů"},
    {"en": "Set up an online booking calendar", "cs": "Nastav si online rezervační kalendář"},
    {"en": "Prepare a health questionnaire and informed-consent form for new clients", "cs": "Připrav zdravotní dotazník a informovaný souhlas pro nové klienty"}
  ]$j$);

select pg_temp.seed_milestone('fitness', 1, 3, 'offer_pricing', 150, 'section_contacts',
  $j${"en": "Packages, prices and your specialisation", "cs": "Balíčky, ceny a specializace"}$j$,
  $j${"en": "A clear focus (weight loss, strength, rehab movement) and packages that beat single sessions.", "cs": "Jasné zaměření (hubnutí, síla, pohyb po zranění) a balíčky, které se vyplatí víc než jednotlivé lekce."}$j$,
  $j${"en": "A new piece of gear you have wanted for a while", "cs": "Nové vybavení, po kterém dlouho pokukuješ"}$j$,
  $j$[
    {"en": "Pick one specialisation and one ideal client", "cs": "Vyber jednu specializaci a jednoho ideálního klienta"},
    {"en": "Design 3 packages: single session, 10-session pack, monthly program", "cs": "Navrhni 3 balíčky: jednotlivá lekce, balíček 10 lekcí, měsíční program"},
    {"en": "Check prices of 3 trainers or studios nearby", "cs": "Zjisti ceny 3 trenérů nebo studií v okolí"},
    {"en": "Work out your minimum rate per hour covering space rental and insurance", "cs": "Spočítej minimální sazbu za hodinu pokrývající nájem prostoru a pojištění"},
    {"en": "Write 2 short success stories or before/after examples", "cs": "Sepiš 2 krátké příběhy úspěchu nebo příklady před/po"}
  ]$j$);

select pg_temp.seed_milestone('fitness', 2, 1, 'contact_list', 150, 'section_cold_calling',
  $j${"en": "Build a list of potential clients", "cs": "Sestav seznam potenciálních klientů"}$j$,
  $j${"en": "People you know who want to get fit, plus gyms and offices open to a partnership.", "cs": "Lidé, které znáš a chtějí se dostat do formy, plus posilovny a firmy otevřené spolupráci."}$j$,
  null,
  $j$[
    {"en": "Write down 15 people you know who mentioned wanting to train or lose weight", "cs": "Zapiš 15 známých, kteří zmínili, že chtějí cvičit nebo zhubnout"},
    {"en": "Find 10 local gyms or studios open to a trainer partnership", "cs": "Najdi 10 místních posiloven nebo studií otevřených spolupráci s trenérem"},
    {"en": "Add 5 offices that might want a wellness or fitness benefit for staff", "cs": "Přidej 5 firem, které by mohly chtít wellness nebo fitness benefit pro zaměstnance"},
    {"en": "Create an Instagram or Facebook profile with photos and your offer", "cs": "Založ profil na Instagramu nebo Facebooku s fotkami a nabídkou"}
  ]$j$);

select pg_temp.seed_milestone('fitness', 2, 2, 'first_outreach', 200, 'section_pipeline',
  $j${"en": "Offer your first free sessions", "cs": "Nabídni první lekce zdarma"}$j$,
  $j${"en": "A free trial session converts far better than a cold sales pitch.", "cs": "Zkušební lekce zdarma přesvědčí mnohem lépe než chladná nabídka."}$j$,
  null,
  $j$[
    {"en": "Message 15 contacts offering a free trial session", "cs": "Napiš 15 kontaktům nabídku zkušební lekce zdarma"},
    {"en": "Post your offer and a short training video on social media", "cs": "Zveřejni svou nabídku a krátké video z tréninku na sociálních sítích"},
    {"en": "Pitch a wellness partnership to 5 offices", "cs": "Nabídni wellness spolupráci 5 firmám"},
    {"en": "Record every outcome by moving the contact to the right table", "cs": "Každý výsledek zapiš přesunem kontaktu do správné tabulky"}
  ]$j$);

select pg_temp.seed_milestone('fitness', 2, 3, 'first_meeting', 200, 'section_calendar',
  $j${"en": "First trial session with a client", "cs": "První zkušební lekce s klientem"}$j$,
  $j${"en": "A booked slot, the health questionnaire filled in and a clear next step.", "cs": "Domluvený termín, vyplněný zdravotní dotazník a jasný další krok."}$j$,
  $j${"en": "A good post-workout meal out", "cs": "Dobré jídlo po tréninku v restauraci"}$j$,
  $j$[
    {"en": "Book the trial session with a specific day and time", "cs": "Domluv zkušební lekci na konkrétní den a hodinu"},
    {"en": "Fill in the health questionnaire and informed consent before starting", "cs": "Před zahájením vyplň zdravotní dotazník a informovaný souhlas"},
    {"en": "Assess the client's starting fitness and goals", "cs": "Zhodnoť výchozí formu a cíle klienta"},
    {"en": "Propose a package and the next session at the end", "cs": "Na konci navrhni balíček a další lekci"}
  ]$j$);

select pg_temp.seed_milestone('fitness', 3, 1, 'first_job', 250, 'section_finance',
  $j${"en": "Sell your first training package", "cs": "Prodej první tréninkový balíček"}$j$,
  $j${"en": "A signed package, a deposit and a training plan the client can follow.", "cs": "Podepsaný balíček, záloha a tréninkový plán, který klient dokáže dodržet."}$j$,
  null,
  $j$[
    {"en": "Agree and confirm a package of at least 10 sessions", "cs": "Domluv a potvrď balíček alespoň 10 lekcí"},
    {"en": "Collect a deposit or payment for the first package", "cs": "Vyber zálohu nebo platbu za první balíček"},
    {"en": "Write a simple training plan for the first 4 weeks", "cs": "Sepiš jednoduchý tréninkový plán na první 4 týdny"},
    {"en": "Check in with the client after the first week", "cs": "Po prvním týdnu se klientovi ozvi, jak to jde"}
  ]$j$);

select pg_temp.seed_milestone('fitness', 3, 2, 'first_invoice', 250, null,
  $j${"en": "Invoice and track your real hourly rate", "cs": "Faktura a skutečná hodinová sazba"}$j$,
  $j${"en": "Get paid on time and know what you really earn after space rental and travel.", "cs": "Dostat zaplaceno včas a vědět, kolik si doopravdy vyděláš po odečtení nájmu prostoru a dopravy."}$j$,
  null,
  $j$[
    {"en": "Issue an invoice or receipt for the package", "cs": "Vystav fakturu nebo doklad za balíček"},
    {"en": "Record income and costs (space rental, equipment) in Finance", "cs": "Zapiš příjmy a náklady (nájem prostoru, vybavení) do Financí"},
    {"en": "Calculate your real hourly rate after costs and travel time", "cs": "Spočítej skutečnou hodinovou sazbu po odečtení nákladů a času na cestu"},
    {"en": "Send a reminder if a payment is late", "cs": "Pošli upomínku, pokud platba nedorazí včas"}
  ]$j$);

select pg_temp.seed_milestone('fitness', 3, 3, 'recurring_income', 300, null,
  $j${"en": "A full weekly training schedule", "cs": "Plný týdenní tréninkový rozvrh"}$j$,
  $j${"en": "Enough recurring clients to fill your available hours every week.", "cs": "Dost pravidelných klientů, aby zaplnili tvé dostupné hodiny každý týden."}$j$,
  $j${"en": "New workout gear for yourself", "cs": "Nové sportovní vybavení pro sebe"}$j$,
  $j$[
    {"en": "Set a weekly income target based on your costs", "cs": "Stanov si týdenní cíl příjmu podle svých nákladů"},
    {"en": "Offer existing clients a renewed package before the current one ends", "cs": "Nabídni stávajícím klientům prodloužení balíčku ještě před koncem toho současného"},
    {"en": "Fill at least 80% of your available training hours", "cs": "Naplň alespoň 80 % svých dostupných tréninkových hodin"},
    {"en": "Hit your weekly income target two weeks in a row", "cs": "Splň týdenní cíl příjmu dva týdny po sobě"}
  ]$j$);

select pg_temp.seed_milestone('fitness', 4, 1, 'repeat_clients', 300, null,
  $j${"en": "Turn clients into long-term regulars", "cs": "Udělej z klientů dlouhodobé stálice"}$j$,
  $j${"en": "A client who stays for a year is worth far more than one who buys a single package.", "cs": "Klient, který zůstane rok, má mnohem větší hodnotu než ten, kdo koupí jediný balíček."}$j$,
  null,
  $j$[
    {"en": "Track progress and show it to the client monthly", "cs": "Sleduj pokrok a jednou měsíčně ho klientovi ukaž"},
    {"en": "Ask 5 happy clients for a review or a referral", "cs": "Požádej 5 spokojených klientů o recenzi nebo doporučení"},
    {"en": "Offer a discount for referring a friend", "cs": "Nabídni slevu za doporučení kamaráda"},
    {"en": "Renew a package with a client for the third time", "cs": "Prodluž balíček s klientem potřetí"}
  ]$j$);

select pg_temp.seed_milestone('fitness', 4, 2, 'first_helper', 350, null,
  $j${"en": "Bring in a second trainer", "cs": "Přiber druhého trenéra"}$j$,
  $j${"en": "When your calendar is full, hand off clients whose goals fit a colleague better.", "cs": "Když je kalendář plný, předej klienty, jejichž cíle sedí lépe kolegovi."}$j$,
  null,
  $j$[
    {"en": "Count how many client requests you turned down last month", "cs": "Spočítej, kolik poptávek klientů jsi minulý měsíc odmítl"},
    {"en": "Find a colleague trainer open to taking on clients", "cs": "Najdi kolegu trenéra otevřeného přebírání klientů"},
    {"en": "Hand over one client with a written training history", "cs": "Předej jednoho klienta s písemnou historií tréninku"},
    {"en": "Agree how referred clients and payments are split", "cs": "Domluv, jak se dělí předaní klienti a platby"}
  ]$j$);

select pg_temp.seed_milestone('fitness', 4, 3, 'business_system', 400, null,
  $j${"en": "Run your training business with a system", "cs": "Řiď svůj trenérský byznys podle systému"}$j$,
  $j${"en": "Templates, a progress-tracking routine and online sessions for the weeks you travel.", "cs": "Šablony, rutina na sledování pokroku a online lekce pro týdny, kdy jsi na cestách."}$j$,
  $j${"en": "A proper holiday", "cs": "Pořádná dovolená"}$j$,
  $j$[
    {"en": "Prepare training plan and progress-tracking templates", "cs": "Připrav šablony tréninkového plánu a sledování pokroku"},
    {"en": "Set up online sessions or video check-ins for travel weeks", "cs": "Zaveď online lekce nebo videohovory pro týdny na cestách"},
    {"en": "Block one hour a week for finances and client follow-ups", "cs": "Vyhraď si hodinu týdně na finance a kontakt s klienty"},
    {"en": "Raise prices for new clients by 10%", "cs": "Zvyš ceny pro nové klienty o 10 %"},
    {"en": "Take a week off with sessions covered online or by a colleague", "cs": "Vezmi si týden volna, lekce zajistí online nebo kolega"}
  ]$j$);
