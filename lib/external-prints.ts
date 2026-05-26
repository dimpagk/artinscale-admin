import { supabaseAdmin } from '@/lib/supabase/admin';

export type ExternalPrintStatus =
  | 'discovered'
  | 'in_progress'
  | 'fetching'
  | 'upscaling'
  | 'rendering'
  | 'creating_gelato'
  | 'creating_shopify'
  | 'shopify_created'
  | 'retired'
  | 'error';

export interface ExternalPrintRow {
  id: string;
  source: string;
  source_id: string;
  canonical_key: string;
  title: string;
  artist: string | null;
  year_created: string | null;
  medium: string | null;
  license: 'CC0' | 'PDM';
  attribution_text: string;
  source_image_url: string;
  source_image_width: number | null;
  source_image_height: number | null;
  print_ready_url: string | null;
  max_print_size: string | null;
  gelato_product_id: string | null;
  shopify_product_id: string | null;
  shopify_handle: string | null;
  status: ExternalPrintStatus;
  error_message: string | null;
  order_count: number;
  last_ordered_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function getExternalPrints(): Promise<ExternalPrintRow[]> {
  const { data, error } = await supabaseAdmin
    .from('external_prints')
    .select(
      'id, source, source_id, canonical_key, title, artist, year_created, medium, license, attribution_text, source_image_url, source_image_width, source_image_height, print_ready_url, max_print_size, gelato_product_id, shopify_product_id, shopify_handle, status, error_message, order_count, last_ordered_at, created_at, updated_at'
    )
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Error fetching external_prints:', error);
    return [];
  }
  return (data ?? []) as ExternalPrintRow[];
}

export async function getExternalPrintsCountsByStatus(): Promise<
  Record<ExternalPrintStatus, number>
> {
  const { data, error } = await supabaseAdmin
    .from('external_prints')
    .select('status');

  if (error) {
    console.error('Error counting external_prints by status:', error);
    return {} as Record<ExternalPrintStatus, number>;
  }

  const counts = {} as Record<ExternalPrintStatus, number>;
  for (const row of data ?? []) {
    const s = (row as { status: ExternalPrintStatus }).status;
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return counts;
}

export async function retireExternalPrintById(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin
    .from('external_prints')
    .update({ status: 'retired' })
    .eq('id', id);
  if (error) {
    console.error(`retireExternalPrintById(${id}) failed:`, error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
