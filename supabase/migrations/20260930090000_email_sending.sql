-- =============================================================================
-- E-mail sending (prompt 5.3)
--   * a sent e-mail is logged as a contact_activities row of the new
--     'email_sent' type; the row is written by the sender's own client like
--     every other activity, RLS already covers it
--   * the "Odeslán e-mail" / "Email sent" contact table already exists from
--     initialize_user() with system_key 'email_sent'; nothing else to add
-- =============================================================================

alter type public.contact_activity_type add value if not exists 'email_sent';
