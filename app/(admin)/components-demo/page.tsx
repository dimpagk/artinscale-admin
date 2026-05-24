import {
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Progress,
  Skeleton,
  Avatar,
} from '@dimpagk/artinscale-ui/display'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import {
  PageHeader,
  PageMeta,
  EmptyState,
  StatusBadge,
  StatCard,
  Field,
  FieldList,
  SectionLabel,
  SyncDot,
  RelativeTime,
  FilterChip,
  ImageThumb,
  IntegrationStatusCard,
  FormGrid,
  FormSection,
} from '@/components/admin-ui'

/**
 * Visual QA page for every design-system primitive + admin-ui composition.
 *
 * Hit `/components-demo` while logged in as an admin to scan all variants
 * in one view. Useful when changing brand tokens, refactoring the
 * design system, or onboarding someone new.
 */
export const dynamic = 'force-static'

export default function ComponentsDemo() {
  return (
    <div className="space-y-12">
      <PageHeader
        title="Components Demo"
        description="Every design-system primitive + admin-ui composition rendered with all variants. Visual QA target."
      />

      <DemoSection title="Buttons" description="Design system Button — variants × sizes × loading × disabled.">
        <FormGrid columns={3}>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="accent">Accent</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
        </FormGrid>
        <FormGrid columns={3}>
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </FormGrid>
        <FormGrid columns={3}>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button color="primary">Color: primary</Button>
        </FormGrid>
      </DemoSection>

      <DemoSection title="Badges" description="Statuses + domain-aware StatusBadge.">
        <div className="flex flex-wrap gap-2">
          <Badge variant="default">default</Badge>
          <Badge variant="success">success</Badge>
          <Badge variant="warning">warning</Badge>
          <Badge variant="error">error</Badge>
          <Badge variant="secondary">secondary</Badge>
          <Badge variant="outline">outline</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge domain="artwork" status="created" />
          <StatusBadge domain="artwork" status="listed" />
          <StatusBadge domain="artwork" status="sold" />
          <StatusBadge domain="topic" status="active" />
          <StatusBadge domain="topic" status="completed" />
          <StatusBadge domain="contribution" status="pending" />
          <StatusBadge domain="contribution" status="approved" />
          <StatusBadge domain="contribution" status="rejected" />
        </div>
      </DemoSection>

      <DemoSection title="Cards" description="Variants + tones + sub-components.">
        <FormGrid columns={3}>
          <Card variant="default">Default</Card>
          <Card variant="elevated">Elevated</Card>
          <Card variant="flat">Flat</Card>
        </FormGrid>
        <FormGrid columns={3}>
          <Card tone="default">Tone default</Card>
          <Card tone="muted">Tone muted</Card>
          <Card tone="accent">Tone accent</Card>
        </FormGrid>
        <Card>
          <CardHeader>
            <CardTitle>With sub-components</CardTitle>
            <CardDescription>Description prop renders here.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-700">Content goes inside CardContent.</p>
          </CardContent>
          <CardFooter>
            <Button size="sm">Footer action</Button>
          </CardFooter>
        </Card>
      </DemoSection>

      <DemoSection title="Skeleton + Avatar" description="Loading + identity primitives.">
        <FormGrid columns={2}>
          <div className="space-y-2">
            <Skeleton variant="rect" className="h-24" />
            <Skeleton variant="text" lines={3} />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Skeleton variant="circle" size="h-16 w-16" />
            <Avatar size="xs" name="Maya Riso" tone="coral" />
            <Avatar size="sm" name="Atlas Linework" tone="navy" />
            <Avatar size="md" name="Vera Prime" tone="gold" />
            <Avatar size="lg" name="Generic User" tone="blue" />
            <Avatar size="xl" name="Cyan One" tone="cyan" />
          </div>
        </FormGrid>
      </DemoSection>

      <DemoSection title="Inputs" description="Sizes including the new dense `xs`.">
        <FormGrid columns={2}>
          <Input label="xs (dense)" size="xs" placeholder="dense input" />
          <Input label="sm" size="sm" placeholder="small input" />
          <Input label="md (default)" placeholder="medium input" />
          <Input label="lg" size="lg" placeholder="large input" />
        </FormGrid>
        <FormGrid columns={2}>
          <Input label="With error" error="This field is invalid" />
          <Input label="With helper" helperText="Hint text appears below." />
        </FormGrid>
        <FormGrid columns={2}>
          <Textarea label="Textarea" rows={3} placeholder="multi-line content" />
          <Select
            label="Select"
            options={[
              { value: '', label: 'No selection' },
              { value: 'a', label: 'Option A' },
              { value: 'b', label: 'Option B' },
            ]}
          />
        </FormGrid>
      </DemoSection>

      <DemoSection title="Filter chips + sync dots" description="List affordances.">
        <div className="flex flex-wrap gap-2">
          <FilterChip label="All" href="#" active count={12} />
          <FilterChip label="Drafts" href="#" count={7} />
          <FilterChip label="Scheduled" href="#" count={3} />
          <FilterChip label="Empty" href="#" />
        </div>
        <div className="flex items-center gap-2">
          <SyncDot connected label="Synced" />
          <span className="text-sm text-gray-600">Synced</span>
          <SyncDot connected={false} label="Not synced" />
          <span className="text-sm text-gray-600">Not synced</span>
        </div>
      </DemoSection>

      <DemoSection title="Stat cards" description="Dashboard tiles.">
        <FormGrid columns={3}>
          <StatCard label="Pending" value={7} valueColorClass="text-brand-gold" />
          <StatCard label="Active topics" value={4} />
          <StatCard
            label="Total contributors"
            value={142}
            description="last 30 days"
          />
        </FormGrid>
      </DemoSection>

      <DemoSection title="Field lists + section labels" description="Description-list pattern.">
        <Card>
          <SectionLabel>Section label</SectionLabel>
          <FieldList>
            <Field label="Name" value="Maya Riso" />
            <Field label="Email" value="maya@artinscale.studio" />
            <Field label="Style" value="Risograph" />
            <Field label="Status" value="Active" />
          </FieldList>
        </Card>
      </DemoSection>

      <DemoSection title="Image + integration" description="Visual + status primitives.">
        <FormGrid columns={3}>
          <ImageThumb src={null} alt="placeholder" />
          <ImageThumb src={null} alt="placeholder" size="h-16 w-16" rounded="rounded-lg" />
          <ImageThumb src={null} alt="placeholder" size="h-24 w-24" rounded="rounded-full" />
        </FormGrid>
        <IntegrationStatusCard
          name="Gelato"
          synced={true}
          identifierLabel="Product ID"
          identifierValue="dry_demo_abc123"
        />
        <IntegrationStatusCard
          name="Shopify"
          synced={false}
          action={<Button size="sm">Push to Shopify</Button>}
        />
      </DemoSection>

      <DemoSection title="Empty + relative time" description="Microstates.">
        <Card>
          <EmptyState
            title="Nothing here yet"
            description="When agents drop drafts here, they'll appear in this view."
          />
        </Card>
        <p className="text-sm text-gray-600">
          Last updated <RelativeTime date={new Date(Date.now() - 1000 * 60 * 47)} />
          {' · '}
          <RelativeTime date={new Date(Date.now() - 1000 * 60 * 60 * 5)} />
          {' · '}
          <RelativeTime date={new Date(Date.now() - 1000 * 60 * 60 * 24 * 3)} />
        </p>
      </DemoSection>

      <DemoSection
        title="Form sections"
        description="FormSection groups + FormGrid alignment shown in artwork form."
      >
        <FormSection title="Inline example" description="Just a sub-section header.">
          <FormGrid columns={2}>
            <Input label="First name" placeholder="Maya" />
            <Input label="Last name" placeholder="Riso" />
          </FormGrid>
        </FormSection>
      </DemoSection>

      <DemoSection title="Page header — page meta" description="Used at the top of every page.">
        <div className="border border-gray-200 bg-white p-6">
          <PageHeader
            title="Edit: Sample artwork"
            badge={{ label: 'listed', variant: 'success' }}
          />
          <PageMeta items={['Maya Riso', 'Genesis', 'Edition 4 / 100']} />
          <p className="text-xs text-gray-500">
            (Above is what an edit page looks like.)
          </p>
        </div>
      </DemoSection>

      <DemoSection title="Progress" description="Linear progress bar.">
        <Progress value={35} max={100} />
        <Progress value={70} max={100} variant="success" />
        <Progress value={20} max={100} variant="warning" />
        <Progress value={90} max={100} variant="error" />
      </DemoSection>
    </div>
  )
}

function DemoSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <p className="text-sm text-gray-500">{description}</p>
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  )
}
