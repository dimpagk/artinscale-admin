# ArtInScale Admin

Admin dashboard for ArtInScale — managing artworks, artists, topics, contributions, social media content, and AI art generation. Integrates with Shopify (storefront) and Gelato (print-on-demand).

## Tech Stack

- **Framework**: Next.js 15.5.7 (App Router, Turbopack)
- **Language**: TypeScript 5.8, React 19
- **Database**: Supabase (PostgreSQL + Auth + Storage)
- **Styling**: Tailwind CSS 4
- **AI**: Anthropic SDK (Content Copilot), Google Generative AI / Gemini (AI Art Generator)
- **Print-on-Demand**: Gelato API
- **E-commerce**: Shopify (via Gelato sync)
- **Video**: Remotion (video preview + export)
- **Icons**: Phosphor Icons
- **Toasts**: Sonner

## Prerequisites

- Node.js 18+
- pnpm 9+
- A Supabase project
- Anthropic API key (for Content Copilot)
- Google Gemini API key (for AI Art Generator)
- Gelato API key + Store ID (for print-on-demand sync)

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

# Gelato (Print-on-Demand)
GELATO_API_KEY=your-gelato-api-key
GELATO_STORE_ID=your-gelato-store-id
```

Get your keys from:
- **Supabase**: Project Settings > API in your [Supabase dashboard](https://supabase.com/dashboard)
- **Anthropic**: [Anthropic Console](https://console.anthropic.com/)
- **Google Gemini**: [Google AI Studio](https://aistudio.google.com/apikey)
- **Gelato**: Developer > API Key in your [Gelato dashboard](https://dashboard.gelato.com/)

### 3. Database migrations

All SQL migrations live in the **shared** `../sql/` folder (one level up
from this app — same set powers both the storefront and admin panel).

Run every file in numeric order in your Supabase SQL Editor (Dashboard
> SQL Editor > New Query). The admin-specific tables (`artworks`,
`social_posts`, `generated_images`) are created by `012_create_admin_tables.sql`,
the agent infrastructure (`agent_tasks`, `approval_queue`, etc.) by
`011_agent_infrastructure.sql`, and the seed-contribution helpers by
`015_seed_contribution_enhancements.sql`.

See `../sql/README.md` for the full migration catalogue.

> **Note**: The migration assumes the `users` and `topics` tables already exist (from the main artinscale-nextjs app). If they don't, create them first.

### 4. Create your admin account

The admin panel requires a Supabase auth user with `ADMIN` role. To set this up:

**Step 1**: Create an auth user in Supabase Dashboard > Authentication > Users > Add User:
- Enter your email and a password
- Click "Create User"

**Step 2**: Insert the user into the `users` table with ADMIN role. Run this in the SQL Editor:

```sql
INSERT INTO public.users (id, email, name, role)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'YOUR_EMAIL'),
  'YOUR_EMAIL',
  'Your Name',
  'ADMIN'
);
```

Replace `YOUR_EMAIL` with the email you used in Step 1.

You can now sign in at [http://localhost:3001/login](http://localhost:3001/login).

### 5. Supabase Storage buckets

Create these storage buckets in Supabase Dashboard > Storage:

| Bucket | Public | Purpose |
|---|---|---|
| `contributions` | No | Community contribution uploads |
| `artworks` | Yes | Artwork images |
| `profiles` | Yes | Artist profile images |
| `ai-generated` | Yes | AI-generated artwork images |

For each: click "New bucket", enter the name, toggle public access as noted, click "Create bucket".

### 6. Run the dev server

```bash
pnpm dev
```

The admin panel runs at [http://localhost:3001](http://localhost:3001).

### 7. Build for production

```bash
pnpm build
pnpm start
```

## Features

### Dashboard (`/`)
- Pending contributions count, active topics, contributor stats
- Quick links to recent items

### Topics (`/topics`)
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

### Artworks (`/artworks`)
- Full CRUD for artwork records
- Link to artists and topics
- Edition tracking (size, sold count)
- Pricing and product type configuration
- Gelato sync status (push artwork to Gelato for print-on-demand)
- Shopify sync status (product ID and handle tracking)
- Image URL management

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
│   ├── (admin)/                      # Protected admin routes
│   │   ├── page.tsx                  # Dashboard
│   │   ├── topics/                   # Topic CRUD
│   │   ├── contributions/            # Contribution moderation
│   │   ├── artists/                  # Artist management
│   │   ├── artworks/                 # Artwork management + Gelato sync
│   │   ├── content/                  # Content Studio
│   │   └── art-generator/            # AI Art Generator
│   ├── api/
│   │   ├── content/                  # Content CRUD + copilot
│   │   └── art-generator/            # Generation + editing + gallery
│   ├── login/                        # Auth
│   └── auth/callback/                # Supabase auth callback
├── components/
│   ├── ui/                           # Shared UI primitives
│   ├── artworks/                     # Artwork form components
│   ├── content/                      # Content Studio components
│   ├── art-generator/                # AI Art Generator components
│   └── layout/                       # Sidebar, etc.
├── lib/
│   ├── constants/                    # Type definitions + presets
│   ├── supabase/                     # Supabase clients
│   ├── gelato.ts                     # Gelato API client
│   └── *.ts                          # Data query modules
└── middleware.ts                      # Auth guard (admin-only)
```

## Auth

Only users with `role = 'ADMIN'` in the `users` table can access the admin panel. The middleware checks both:
1. Valid Supabase auth session
2. `role = 'ADMIN'` in the `users` table

Non-admin users are redirected to `/login?error=unauthorized`.

## Artwork Pipeline

The artwork lifecycle flows through:

1. **Create** in admin (`/artworks/new`) — set title, artist, topic, edition details, upload image
2. **Push to Gelato** — creates a print-on-demand product (poster, canvas, framed print, etc.)
3. **Gelato publishes to Shopify** — product goes live in the storefront automatically
4. **Track** — Gelato product ID and Shopify handle/product ID stored on the artwork record

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start dev server on port 3001 (Turbopack) |
| `pnpm build` | Production build |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |
