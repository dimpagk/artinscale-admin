import { BidCapsSection } from './bid-caps-section';

// Per-market Meta cost caps, derived from the committed Gelato landed-cost
// snapshot. Static (no DB), so no dynamic route config needed.
export default function BidCapsPage() {
  return <BidCapsSection />;
}
