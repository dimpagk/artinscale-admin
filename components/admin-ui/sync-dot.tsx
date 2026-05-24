/**
 * Tiny sync-status dot. Used in dense list views (artwork rows) where a
 * full IntegrationStatusCard is overkill but you still want a visual
 * indicator that the artwork has been pushed to Gelato or Shopify.
 */
interface SyncDotProps {
  connected: boolean
  /** Plain-text title for the tooltip; e.g. "Gelato". */
  label: string
}

export function SyncDot({ connected, label }: SyncDotProps) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${
        connected ? 'bg-brand-success' : 'bg-gray-300'
      }`}
      title={`${label} ${connected ? 'synced' : 'not synced'}`}
      aria-label={`${label} ${connected ? 'synced' : 'not synced'}`}
    />
  )
}
