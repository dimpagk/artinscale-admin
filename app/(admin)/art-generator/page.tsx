import { supabaseAdmin } from '@/lib/supabase/admin'
import { ArtGeneratorClient } from './art-generator-client'
import type { GeneratedImage } from '@/lib/constants/art-generator'
import type { TopicRow } from '@/lib/types'

async function getGeneratedImages(): Promise<GeneratedImage[]> {
  const { data, error } = await supabaseAdmin
    .from('generated_images')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return []
  return (data || []) as GeneratedImage[]
}

async function getTopics(): Promise<TopicRow[]> {
  const { data, error } = await supabaseAdmin
    .from('topics')
    .select('id, title, status')
    .order('title')

  if (error) return []
  return (data || []) as TopicRow[]
}

export default async function ArtGeneratorPage() {
  const [images, topics] = await Promise.all([
    getGeneratedImages(),
    getTopics(),
  ])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">AI Art Generator</h1>
        <p className="text-sm text-gray-500">Generate and manage AI-powered artwork</p>
      </div>

      <ArtGeneratorClient initialImages={images} topics={topics} />
    </div>
  )
}
