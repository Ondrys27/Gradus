-- =============================================================================
-- 20.3 A note can be a mind map instead of text
--   * notes.kind: 'text' (the Tiptap document, as before) or 'mindmap'
--   * a mind map's content is the tree of 20.2 with ids:
--       {"type": "mindmap", "version": 1,
--        "root": {"id": "...", "title": "<the note's title>", "children": [...]}}
--     a node may carry a small note, a branch colour, one link (a web address,
--     or a record as {"type": "mention", "attrs": {...}} like the text notes'
--     chips, so notes_sync_mentions lists it the same way) and the mark of a
--     branch Jarvis suggested and the user has not accepted yet
--   * content_text stays the plain text for search and Jarvis: for a map the
--     indented outline of the tree (the root first, so it is the title)
--   * additive only: every existing note is text and stays as it is
-- =============================================================================

alter table public.notes
  add column kind text not null default 'text'
    constraint notes_kind_check check (kind in ('text', 'mindmap'));

-- The kind and the shape of the content always agree, so a map can never be
-- opened as a text document or the other way round. NOT VALID: existing rows
-- are all text documents; every new or changed row is checked.
alter table public.notes
  add constraint notes_kind_content_check check (
    case kind
      when 'mindmap' then
        content ->> 'type' = 'mindmap' and jsonb_typeof(content -> 'root') = 'object'
      else coalesce(content ->> 'type', '') <> 'mindmap'
    end
  ) not valid;

-- Converting a note (text → map, map → text) changes its kind with its content.
grant insert (kind) on public.notes to authenticated;
grant update (kind) on public.notes to authenticated;

-- -----------------------------------------------------------------------------
-- Analytics: what happens to maps in notes, never their names or content
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('note_converted', 'notes', true),
  ('note_map_suggested', 'notes', true),
  ('note_map_suggestion_resolved', 'notes', true)
on conflict (event) do nothing;
