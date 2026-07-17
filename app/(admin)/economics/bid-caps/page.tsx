import { getListedPrintPieces, getPrintSizePricing } from '@/lib/pricing';
import {
  getCatalogBidCaps,
  getSizeCapReference,
  buildMarketPerformance,
  bidCapsGeneratedAt,
  type PricedSize,
} from '@/lib/costs/bid-caps';
import { getMarketActuals } from '@/lib/costs/market-performance';
import { getFinanceSettings } from '@/lib/costs/economics';
import { BidCapsSection } from './bid-caps-section';

// Reads live prices, the listed catalog, and live Meta/Shopify actuals.
export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 28;

export default async function BidCapsPage() {
  const [pieces, pricing, actuals, finance] = await Promise.all([
    getListedPrintPieces(),
    getPrintSizePricing(),
    getMarketActuals(WINDOW_DAYS),
    getFinanceSettings(),
  ]);

  // Output VAT nets down the price before contribution, matching the P&L.
  // EU sales carry the Greek home rate (24) under the <€10k regime; exports
  // are zero-rated. See lib/costs/bid-caps.ts::outputVatPercent.
  const homeVatPercent = finance.default_vat_percent;

  // Sales-weighted average contribution across the listed pieces.
  const caps = getCatalogBidCaps(pieces, { weighted: true, homeVatPercent });
  const perfRows = buildMarketPerformance(caps, actuals.byCountry);

  const pricedSizes: PricedSize[] = pricing.rows.map((r) => ({
    sizeKey: r.size_key,
    label: r.display_name,
    price: Number(r.price_eur),
  }));
  const sizeRows = getSizeCapReference(pricedSizes, undefined, homeVatPercent);

  const sizesUsed = Array.from(new Set(pieces.map((p) => p.sizeKey)));

  return (
    <BidCapsSection
      perfRows={perfRows}
      sizeRows={sizeRows}
      generatedAt={bidCapsGeneratedAt().slice(0, 10)}
      pieceCount={pieces.length}
      sizesUsed={sizesUsed}
      metaConfigured={actuals.metaConfigured}
      metaError={actuals.error}
      windowDays={actuals.days}
      currency={actuals.currency}
    />
  );
}
