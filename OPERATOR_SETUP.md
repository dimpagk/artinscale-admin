# Operator setup

One-time configuration the admin codebase can't do for you. Each task
below is a manual step in a third-party dashboard (Shopify) — bookmark
this page and revisit when you onboard a new store or rotate
credentials.

## 1. Shopify Custom App scopes

The Admin API token at `SHOPIFY_ADMIN_ACCESS_TOKEN` needs these scopes:

| Scope | Required for |
|---|---|
| `write_products` | Setting price, vendor, tags, body_html, status, metafields, images |
| `read_products` | All read operations (looking up product by handle) |
| `write_inventory` | Setting `variant.inventory_quantity` (legacy fallback path) |
| `read_locations` | Setting inventory via the modern `/inventory_levels/set.json` path |
| `read_publications` | Listing the store's sales channels (Online Store, Google & YouTube, etc.) |
| `write_publications` | Auto-publishing each artwork to every sales channel by default |

### Why `read_locations` matters

Without it, the listing-sync writes inventory via the legacy
`variant.inventory_quantity` field. That works for single-location
stores but is deprecated by Shopify and ignored when
`inventory_management='shopify'` doesn't get applied. Symptom: variant
shows `inventory_quantity=0` after sync even though edition is open.

### Why `read_publications` + `write_publications` matter

Without them, products are published to the Online Store channel only
(Shopify's default for products created via REST/Gelato). Symptom: a
sync finishes with a warning `shopify_channels: Access denied for
publications field. Required access: read_publications`. After
granting both scopes, every newly listed artwork is automatically
visible on Google & YouTube, Facebook & Instagram, the Artinscale
Platform / Headless channels, and any future channels you enable —
no per-product clicking through Shopify's UI.

### How to grant it

1. Shopify admin → **Settings** → **Apps and sales channels** → **Develop apps**
2. Pick the custom app whose token you're using
3. **Configuration** → **Admin API access scopes** → check `read_locations`
4. **Save**
5. **API credentials** → **Reveal token once** → copy
6. Paste into `.env`:
   ```
   SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_<new-token>
   ```
7. Restart the admin dev server

After this, the listing-sync's `shopify_inventory` step picks the
canonical `/inventory_levels/set.json` path, the legacy fallback
warning disappears, and `inventory_management='shopify'` actually
sticks on the variant.

## 2. Shopify metafield definitions for SEO + OG

The listing-sync writes four product metafields. The first two are
picked up by every Shopify theme out of the box; the OG ones need
metafield definitions to render in `<meta property="og:title">` etc.
on the storefront.

### Auto-rendered (no setup needed)

| Namespace | Key | Type | Purpose |
|---|---|---|---|
| `global` | `title_tag` | single_line_text_field | `<title>` override per product |
| `global` | `description_tag` | multi_line_text_field | `<meta name="description">` per product |

These are the standard Shopify SEO slots. Every theme reads them.

### Need a definition (one-time)

| Namespace | Key | Type | Renders as |
|---|---|---|---|
| `seo` | `og_title` | single_line_text_field | `<meta property="og:title">` |
| `seo` | `og_description` | multi_line_text_field | `<meta property="og:description">` |

If your theme already has these defined and reads them, skip the next
step. Otherwise:

### How to add the definitions

1. Shopify admin → **Settings** → **Custom data** → **Products**
2. **Add definition** for each row above:
   - **Name**: `OG Title` (or `OG Description`)
   - **Namespace and key**: `seo.og_title` (or `seo.og_description`)
   - **Type**: pick from the table above
   - **Validation**: leave defaults
3. Save

Then in your storefront theme's `theme.liquid` (or product template),
add:

```liquid
{% if product.metafields.seo.og_title %}
  <meta property="og:title" content="{{ product.metafields.seo.og_title }}">
{% endif %}
{% if product.metafields.seo.og_description %}
  <meta property="og:description" content="{{ product.metafields.seo.og_description }}">
{% endif %}
```

(Any future-proof Online Store 2.0 theme should already have an
SEO/sharing block where you can drag the metafield as a dynamic source
without code edits.)

After this, the listing-generator's poetic OG copy lands on every
LinkedIn / Twitter / Facebook share.

## 3. Sanity-check checklist after onboarding

Push one artwork through the pipeline end-to-end and verify in Shopify:

- [ ] Product exists with `vendor` = artist name (not "Artinscale")
- [ ] `product_type` = "Art Print"
- [ ] Variant `price` matches admin DB price (not Gelato template default)
- [ ] Tags include `illustration, museum-matte, archival-print, limited-edition, <topic>, size-<wxh>`
- [ ] Description renders three paragraphs, last one has the `Artwork details:` block
- [ ] Inventory: `inventory_management='shopify'` and `inventory_quantity = edition_size - edition_sold`
- [ ] Metafields: 4 entries (`global.title_tag`, `global.description_tag`, `seo.og_title`, `seo.og_description`)
- [ ] Collections: product is in 3 collections (Topic, Artist, "Limited Edition")
- [ ] Images: 6 images in this order — original, framed, in-room, detail (center), detail (upper), detail (lower)
- [ ] Sales channels: enabled on every channel (Online Store + Google & YouTube + Facebook & Instagram + Artinscale Platform + Artinscale Headless)

If any of these come up empty after a sync, check the agent_tasks feed
in the admin for warnings — the sync logs each step's outcome.

## 4. Rotating tokens

Every quarter is sensible. The keys to rotate:

| Env var | Where it lives |
|---|---|
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Shopify admin → Apps → custom app → API credentials |
| `GELATO_API_KEY` | dashboard.gelato.com → Developer → API Key |
| `ANTHROPIC_API_KEY` | console.anthropic.com → Settings → API Keys |
| `GOOGLE_GEMINI_API_KEY` | aistudio.google.com → API Keys |
| `REPLICATE_API_TOKEN` | replicate.com → Account → API Tokens |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `AGENT_TRIGGER_TOKEN` | self-issued; rotate by editing `.env` and restarting |

For rotation: paste the new value into `.env`, restart the dev server
(or redeploy production), revoke the old token in the source dashboard.
