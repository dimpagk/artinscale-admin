# ArtInScale Admin

Admin dashboard for ArtInScale — managing artists, topics, contributions, social media content, and AI art generation.

## Tech Stack

- **Framework**: Next.js 15.5.7 (App Router, Turbopack)
- **Language**: TypeScript 5.8, React 19
- **Database**: Supabase (PostgreSQL + Auth + Storage)
- **Styling**: Tailwind CSS 4
- **AI**: Anthropic SDK (Content Copilot), Google Generative AI / Gemini (AI Art Generator)
- **Video**: Remotion (video preview + export)
- **Icons**: Phosphor Icons
- **Toasts**: Sonner

## Prerequisites

- Node.js 18+
- pnpm 9+
- A Supabase project with the ArtInScale schema
- Anthropic API key (for Content Copilot)
- Google Gemini API key (for AI Art Generator)

## Installation

### 1. Clone and install dependencies

```bash
cd artinscale-admin
pnpm install
```

### 2. Environment variables

Create a `.env.local` file in the project root:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Anthropic (Content Copilot)
ANTHROPIC_API_KEY=sk-ant-...

# Google Gemini (AI Art Generator)
GOOGLE_GEMINI_API_KEY=your-gemini-api-key
```

Get your keys from:
- **Supabase**: Project Settings > API in your [Supabase dashboard](https://supabase.com/dashboard)
- **Anthropic**: [Anthropic Console](https://console.anthropic.com/)
- **Google Gemini**: [Google AI Studio](https://aistudio.google.com/apikey)

### 3. Database migrations

Run these SQL migrations in your Supabase SQL Editor (Dashboard > SQL Editor > New Query):

#### Social Posts table (Content Studio)

```sql
create table public.social_posts (
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

create index idx_social_posts_status on public.social_posts(status) where deleted_at is null;
create index idx_social_posts_artwork on public.social_posts(artwork_id) where artwork_id is not null;
create index idx_social_posts_scheduled on public.social_posts(scheduled_for) where status = 'scheduled' and deleted_at is null;
```

#### Generated Images table (AI Art Generator)

```sql
create table public.generated_images (
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

create index idx_generated_images_topic on public.generated_images(topic_id) where topic_id is not null;
create index idx_generated_images_artwork on public.generated_images(artwork_id) where artwork_id is not null;
```

### 4. Supabase Storage bucket

Create a storage bucket for AI-generated images:

1. Go to your Supabase Dashboard > Storage
2. Click "New bucket"
3. Name: `ai-generated`
4. Toggle **Public bucket** to ON
5. Click "Create bucket"

### 5. Run the dev server

```bash
pnpm dev
```

The admin panel runs at [http://localhost:3001](http://localhost:3001).

### 6. Build for production

```bash
pnpm build
pnpm start
```

## Features

### Dashboard
- Pending contributions count, active topics, contributor stats
- Quick links to recent items

### Topics Management (`/topics`)
- Create, edit, delete topics
- Set deadlines, contribution types, and prompts
- Assign artists

### Contributions (`/contributions`)
- Review pending submissions (stories, photos, sounds, links)
- Approve/reject with admin notes
- Filter by status, topic, and type

### Artists (`/artists`)
- Manage artist profiles
- View portfolios and bios

### Content Studio (`/content`)
- Create social media posts (single + carousel) with a visual block editor
- 16+ block types including artwork-specific blocks (Artwork Showcase, Artist Credit, Edition Info, Price & CTA)
- 5 branded background presets, 5 accent styles, 6 post formats
- Schedule posts with a content calendar
- Art-focused templates (New Artwork Drop, Artist Spotlight, Exhibition, Collection Showcase, etc.)
- Export as PNG or animated video (WebM via Remotion)
- AI Content Copilot (Anthropic Claude) for caption writing and post creation
- Link posts to artworks from the database

### AI Art Generator (`/art-generator`)
- Generate artwork using Google Gemini (Nano Banana 2)
- Structured prompt builder with style, medium, mood, and aspect ratio selectors
- Topic-aware generation using community contribution context
- Multi-turn image editing (inpainting, style changes, variations)
- Image gallery with search and filters
- Link generated images to artworks
- Integrated into Content Studio via "Art AI" button

## Project Structure

```
artinscale-admin/
├── app/
│   ├── (admin)/                    # Protected admin routes
│   │   ├── page.tsx                # Dashboard
│   │   ├── topics/                 # Topic CRUD
│   │   ├── contributions/          # Contribution moderation
│   │   ├── artists/                # Artist management
│   │   ├── content/                # Content Studio
│   │   └── art-generator/          # AI Art Generator
│   ├── api/
│   │   ├── content/                # Content CRUD + copilot
│   │   └── art-generator/          # Generation + editing + gallery
│   ├── login/                      # Auth
│   └── auth/callback/              # Supabase auth callback
├── components/
│   ├── ui/                         # Shared UI primitives
│   ├── content/                    # Content Studio components
│   ├── art-generator/              # AI Art Generator components
│   └── layout/                     # Sidebar, etc.
├── lib/
│   ├── constants/                  # Type definitions + presets
│   ├── supabase/                   # Supabase clients
│   └── *.ts                        # Data query modules
└── middleware.ts                    # Auth guard (admin-only)
```

## Auth

Only users with `role = 'ADMIN'` in the `users` table can access the admin panel. The middleware checks the Supabase session and verifies the admin role on every request.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start dev server on port 3001 (Turbopack) |
| `pnpm build` | Production build |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |
