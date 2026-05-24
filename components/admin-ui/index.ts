/**
 * Admin-side UI compositions.
 *
 * Thin layer above @dimpagk/artinscale-ui that codifies admin-specific
 * page conventions — page headers, form layouts, status badges, etc.
 * Pages should reach for these first; only drop down to the design
 * system primitives when none of these fit.
 */
export { PageHeader, type PageHeaderAction, type PageHeaderBadge } from './page-header'
export { PageMeta } from './page-meta'
export { BackLink } from './back-link'
export { EmptyState } from './empty-state'
export { DataTable, type DataTableColumn } from './data-table'
export { EditPageLayout } from './edit-page-layout'
export { SidebarCard } from './sidebar-card'
export { StatCard } from './stat-card'
export { AuthShell } from './auth-shell'
export { FormActions } from './form-actions'
export { FormGrid, FormSection, FormCard } from './form-grid'
export { DeleteConfirmModal } from './delete-confirm-modal'
export { StatusBadge, type StatusDomain } from './status-badge'
export { ImageThumb } from './image-thumb'
export { IntegrationStatusCard } from './integration-status-card'
export { SyncDot } from './sync-dot'
export { RelativeTime } from './relative-time'
export { FilterChip } from './filter-chip'
export { Field, FieldList } from './field'
export { SectionLabel } from './section-label'
export { QueuePreview } from './queue-previews'
export type { QueuePreviewProps, QueuePreviewComponent } from './queue-previews'
