-- Per-card details migration (T16)
-- Run in Supabase Dashboard > SQL Editor
--
-- Adds optional per-card detail columns to the existing cards table:
--   condition       - raw card condition: NM / LP / MP / HP / DMG
--   image_url       - uploaded card image (Supabase Storage public URL)
--   card_grade      - graded slab grade, e.g. "PSA 8"
--   cert_number     - grading certification / slab cert number
--   purchased_date  - date the card was purchased

alter table public.cards
  add column if not exists condition      text,
  add column if not exists image_url      text,
  add column if not exists card_grade     text,
  add column if not exists cert_number    text,
  add column if not exists purchased_date date;

-- ── Storage bucket for card images ─────────────────────────────
-- The Add/Edit forms upload card photos to this public bucket and
-- store the resulting public URL in cards.image_url.
insert into storage.buckets (id, name, public)
values ('card-images', 'card-images', true)
on conflict (id) do nothing;

-- Allow anon (the app's anon key) to upload and read card images.
create policy if not exists "card_images_public_insert"
  on storage.objects for insert
  with check (bucket_id = 'card-images');

create policy if not exists "card_images_public_select"
  on storage.objects for select
  using (bucket_id = 'card-images');

-- Allow both users to delete an image when they edit/clear one.
create policy if not exists "card_images_public_delete"
  on storage.objects for delete
  using (bucket_id = 'card-images');
