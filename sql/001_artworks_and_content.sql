-- ============================================
-- ArtInScale Admin — Database Migrations
-- Run in order in Supabase SQL Editor
-- ============================================

-- 1. Artworks table (must be created first — other tables reference it)
create table if not exists public.artworks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  image_url text,
  shopify_product_id text,
  shopify_handle text,
  gelato_product_id text,
  gelato_store_id text,
  artist_id uuid references public.users(id) on delete set null,
  topic_id uuid references public.topics(id) on delete set null,
  status text not null default 'created',
  edition_size integer,
  edition_sold integer not null default 0,
  price numeric(10,2),
  currency text not null default 'EUR',
  product_type text,
  creation_date date,
  inspiration_summary text,
  contributor_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_artworks_artist on public.artworks(artist_id);
create index if not exists idx_artworks_topic on public.artworks(topic_id);
create index if not exists idx_artworks_status on public.artworks(status);
create index if not exists idx_artworks_shopify on public.artworks(shopify_handle) where shopify_handle is not null;
create index if not exists idx_artworks_gelato on public.artworks(gelato_product_id) where gelato_product_id is not null;

-- Auto-update updated_at
create or replace function update_artworks_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists artworks_updated_at on public.artworks;
create trigger artworks_updated_at
  before update on public.artworks
  for each row execute function update_artworks_updated_at();


-- 2. Social Posts table (Content Studio)
create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  title text,
  platform text not null default 'instagram',
  post_type text not null default 'single',
  visual_config jsonb not null,
  caption text,
  status text not null default 'draft',
  scheduled_for timestamptz,
  tags text[] default '{}',
  artwork_id uuid references public.artworks(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_social_posts_status on public.social_posts(status) where deleted_at is null;
create index if not exists idx_social_posts_artwork on public.social_posts(artwork_id) where artwork_id is not null;
create index if not exists idx_social_posts_scheduled on public.social_posts(scheduled_for) where status = 'scheduled' and deleted_at is null;


-- 3. Generated Images table (AI Art Generator)
create table if not exists public.generated_images (
  id uuid primary key default gen_random_uuid(),
  prompt text not null,
  edit_history jsonb default '[]',
  model text not null,
  aspect_ratio text not null default '1:1',
  style_preset text,
  image_url text not null,
  storage_path text not null,
  topic_id uuid references public.topics(id) on delete set null,
  artwork_id uuid references public.artworks(id) on delete set null,
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_generated_images_topic on public.generated_images(topic_id) where topic_id is not null;
create index if not exists idx_generated_images_artwork on public.generated_images(artwork_id) where artwork_id is not null;
