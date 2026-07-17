import { redirect } from 'next/navigation';

// The "Ad Copy" page was dissolved (2026-07): the copy-review tool moved
// into Content, and the per-market bid caps moved into Economics. Keep the
// old URL working by sending it to the copy tool's new home.
export default function MarketingRedirect() {
  redirect('/content?tab=ad-copy');
}
