import { getListedPrintPieces, getPrintSizePricing } from '@/lib/pricing';
import {
  getCatalogBidCaps,
  getSizeCapReference,
  buildMarketPerformance,
  getPerEuroSummary,
  bidCapsGeneratedAt,
  type PricedSize,
} from '@/lib/costs/bid-caps';
import { getMarketActuals } from '@/lib/costs/market-performance';
import { getFinanceSettings } from '@/lib/costs/economics';
import { getPerOrderOverheads } from '@/lib/costs/overheads';
import { BidCapsSection } from './bid-caps-section';

// Reads live prices, the listed catalog, and live Meta/Shopify actuals.
export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 28;

export default async function BidCapsPage() {
  const [pieces, pricing, actuals, finance, overheads] = await Promise.all([
    getListedPrintPieces(),
    getPrintSizePricing(),
    getMarketActuals(WINDOW_DAYS),
    getFinanceSettings(),
    getPerOrderOverheads(),
  ]);

  // Output VAT nets down the price before contribution, matching the P&L.
  // EU sales carry the Greek home rate (24) under the <€10k regime; exports
  // are zero-rated. See lib/costs/bid-caps.ts::outputVatPercent.
  const homeVatPercent = finance.default_vat_percent;

  // Sales-weighted average contribution across the listed pieces.
  const caps = getCatalogBidCaps(pieces, { weighted: true, homeVatPercent });
  const perfRows = buildMarketPerformance(caps, actuals.byCountry);

  // Blended per-€1 economics at the caps. Amortisation lifetime and the
  // opex spread come from finance_settings + recurring_costs (migration 047),
  // so the operator tunes them without a deploy.
  const perEuro = getPerEuroSummary(pieces, {
    weighted: true,
    homeVatPercent,
    amortUnits: overheads.amortUnits,
    opexPerOrder: overheads.opexPerOrder,
  });

  const pricedSizes: PricedSize[] = pricing.rows.map((r) => ({
    sizeKey: r.size_key,
    label: r.display_name,
    price: Number(r.price_eur),
  }));
  const sizeRows = getSizeCapReference(pricedSizes, undefined, homeVatPercent);

  const sizesUsed = Array.from(new Set(pieces.map((p) => p.sizeKey)));

  return (
    <BidCapsSection
      perEuro={perEuro}
      opexNote={`monthly opex €${overheads.monthlyOpex.toFixed(2)} ${overheads.basis}`}
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
