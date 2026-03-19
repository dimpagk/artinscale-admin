/**
 * Gelato API client
 *
 * Wraps the Gelato Print-on-Demand API for creating and managing products.
 * Docs: https://docs.gelato.com/reference/products
 */

const GELATO_API_KEY = process.env.GELATO_API_KEY;
const GELATO_STORE_ID = process.env.GELATO_STORE_ID;

export const GELATO_PRODUCT_TYPES = [
  { value: 'poster', label: 'Poster', productUidPrefix: 'poster_' },
  { value: 'canvas', label: 'Canvas', productUidPrefix: 'canvas_' },
  { value: 'framed-poster', label: 'Framed Poster', productUidPrefix: 'framed-poster_' },
  { value: 'acrylic-print', label: 'Acrylic Print', productUidPrefix: 'acrylic-print_' },
  { value: 'metal-print', label: 'Metal Print', productUidPrefix: 'metal-print_' },
] as const;

export type GelatoProductType = (typeof GELATO_PRODUCT_TYPES)[number]['value'];

interface CreateGelatoProductParams {
  title: string;
  description: string;
  imageUrl: string;
  productType: string;
}

interface GelatoProductResponse {
  id: string;
  storeId: string;
  title: string;
  status: string;
}

/**
 * Creates a product in Gelato.
 *
 * NOTE: This is currently a placeholder that returns a mock response.
 * The real implementation requires account-specific configuration:
 *   - A valid GELATO_STORE_ID from your Gelato dashboard
 *   - Product template UIDs specific to your store and product catalog
 *
 * Real API call structure:
 * ```
 * const response = await fetch('https://product.gelatoapis.com/v3/stores/{storeId}/products', {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'X-API-KEY': GELATO_API_KEY,
 *   },
 *   body: JSON.stringify({
 *     title: params.title,
 *     description: params.description,
 *     storeId: GELATO_STORE_ID,
 *     productType: params.productType,
 *     variants: [
 *       {
 *         templateUid: `${productUidPrefix}..._template_uid`,
 *         imagePlaceholders: [
 *           { name: 'default', fileUrl: params.imageUrl },
 *         ],
 *       },
 *     ],
 *   }),
 * });
 * ```
 */
export async function createGelatoProduct(
  params: CreateGelatoProductParams
): Promise<GelatoProductResponse> {
  if (!GELATO_API_KEY || !GELATO_STORE_ID) {
    throw new Error(
      'Gelato API key and Store ID are required. Set GELATO_API_KEY and GELATO_STORE_ID in your environment.'
    );
  }

  // Placeholder: return a mock response
  // Replace this with the real API call above once you have your store configured
  const mockId = `gpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  console.log('[Gelato] Mock product created:', {
    id: mockId,
    title: params.title,
    productType: params.productType,
    imageUrl: params.imageUrl,
  });

  return {
    id: mockId,
    storeId: GELATO_STORE_ID,
    title: params.title,
    status: 'created',
  };
}
