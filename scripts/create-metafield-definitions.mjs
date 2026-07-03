#!/usr/bin/env node
// Create Shopify metafield definitions for the storefront-facing
// custom.* metafields written by lib/listing-sync.ts.
//
// Why: custom.* metafields WITHOUT a definition that grants storefront
// access return null from the Storefront API, so the headless Next.js
// storefront never sees them (learned the hard way with
// custom.dimensions). Values written by the sync are stored either way;
// the definition is what makes them readable.
//
// Covers: custom.medium, custom.orientation (added 2026-07).
//
// Idempotent: if a definition already exists (userError code TAKEN),
// the script updates it instead so storefront access is guaranteed to
// be PUBLIC_READ.
//
// Usage:
//   pnpm --dir artinscale-admin exec node scripts/create-metafield-definitions.mjs
//
// Reversal: Shopify Admin > Settings > Custom data > Products > delete
// the definition (values survive definition deletion).

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

const env = parseEnvFile(resolve(__dirname, '../.env'));
const SHOPIFY_DOMAIN = env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN = env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const API_VERSION = '2024-10';

if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
  console.error('SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN missing in .env');
  process.exit(1);
}

const DEFINITIONS = [
  {
    name: 'Medium',
    namespace: 'custom',
    key: 'medium',
    description:
      'Physical print description (paper, weight). Written by the admin listing-sync from the Gelato product family.',
    type: 'single_line_text_field',
    ownerType: 'PRODUCT',
  },
  {
    name: 'Orientation',
    namespace: 'custom',
    key: 'orientation',
    description:
      'portrait / landscape / square. Written by the admin listing-sync from the resolved print size.',
    type: 'single_line_text_field',
    ownerType: 'PRODUCT',
  },
];

async function graphql(query, variables) {
  const res = await fetch(
    `https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '));
  }
  return json.data;
}

async function createDefinition(def) {
  const data = await graphql(
    `mutation createDef($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition { id name }
        userErrors { field message code }
      }
    }`,
    { definition: { ...def, access: { storefront: 'PUBLIC_READ' } } }
  );
  const { createdDefinition, userErrors } = data.metafieldDefinitionCreate;
  if (createdDefinition) {
    console.log(`created  ${def.namespace}.${def.key} (${createdDefinition.id})`);
    return;
  }
  const taken = userErrors.some((e) => e.code === 'TAKEN');
  if (!taken) {
    throw new Error(
      `${def.namespace}.${def.key}: ${userErrors.map((e) => e.message).join('; ')}`
    );
  }
  // Definition exists; make sure storefront access is PUBLIC_READ.
  const upd = await graphql(
    `mutation updateDef($definition: MetafieldDefinitionUpdateInput!) {
      metafieldDefinitionUpdate(definition: $definition) {
        updatedDefinition { id name }
        userErrors { field message code }
      }
    }`,
    {
      definition: {
        namespace: def.namespace,
        key: def.key,
        ownerType: def.ownerType,
        access: { storefront: 'PUBLIC_READ' },
      },
    }
  );
  const updErrors = upd.metafieldDefinitionUpdate.userErrors;
  if (updErrors.length) {
    throw new Error(
      `${def.namespace}.${def.key} (update): ${updErrors.map((e) => e.message).join('; ')}`
    );
  }
  console.log(`exists   ${def.namespace}.${def.key} (storefront access ensured)`);
}

for (const def of DEFINITIONS) {
  await createDefinition(def);
}
console.log('done');
