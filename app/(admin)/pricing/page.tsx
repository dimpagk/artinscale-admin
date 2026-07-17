import { redirect } from 'next/navigation';

// Pricing moved under Economics (2026-07). Keep the old URL working.
export default function PricingRedirect() {
  redirect('/economics/pricing');
}
