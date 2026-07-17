import { getListedPrintPieces, getPrintSizePricing } from '@/lib/pricing';
import {
  getCatalogBidCaps,
  getSizeCapReference,
  bidCapsGeneratedAt,
  type PricedSize,
} from '@/lib/costs/bid-caps';
import { BidCapsSection } from './bid-caps-section';

// Reads live prices + the listed catalog, so keep it dynamic.
export const dynamic = 'force-dynamic';

export default async function BidCapsPage() {
  const [pieces, pricing] = await Promise.all([
    getListedPrintPieces(),
    getPrintSizePricing(),
  ]);

  const catalogRows = getCatalogBidCaps(pieces);

  const pricedSizes: PricedSize[] = pricing.rows.map((r) => ({
    sizeKey: r.size_key,
    label: r.display_name,
    price: Number(r.price_eur),
  }));
  const sizeRows = getSizeCapReference(pricedSizes);

  const sizesUsed = Array.from(new Set(pieces.map((p) => p.sizeKey)));

  return (
    <BidCapsSection
      catalogRows={catalogRows}
      sizeRows={sizeRows}
      generatedAt={bidCapsGeneratedAt().slice(0, 10)}
      pieceCount={pieces.length}
      sizesUsed={sizesUsed}
    />
  );
}
