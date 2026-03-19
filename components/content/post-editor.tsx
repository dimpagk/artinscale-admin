'use client'

import { BACKGROUND_PRESETS, ACCENT_PRESETS, POST_FORMATS, type SlideConfig, type PostFormatKey } from '@/lib/constants/content'
import { Switch } from '@/components/ui/switch'
import { BlockEditor } from './block-editor'
import { cn } from '@/lib/utils'

interface PostEditorProps {
  config: SlideConfig
  onChange: (config: SlideConfig) => void
}

export function PostEditor({ config, onChange }: PostEditorProps) {
  const update = (partial: Partial<SlideConfig>) => onChange({ ...config, ...partial })

  return (
    <div className="space-y-6">
      {/* Canvas Settings */}
      <div className="space-y-4">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
          Canvas Settings
        </p>

        {/* Format */}
        <div className="space-y-2">
          <label className="text-xs text-gray-500">Format</label>
          <div className="grid grid-cols-3 gap-1.5">
            {Object.values(POST_FORMATS).map(fmt => (
              <button
                key={fmt.key}
                onClick={() => update({ format: fmt.key as PostFormatKey })}
                className={cn(
                  'px-2 py-2 text-[10px] font-medium rounded-lg border transition-all flex flex-col items-center gap-1',
                  (config.format || 'portrait') === fmt.key
                    ? 'border-[#F72D5E] bg-[#F72D5E]/10 text-[#F72D5E]'
                    : 'border-gray-200 text-gray-400 hover:text-gray-700 hover:bg-gray-50'
                )}
              >
                <div
                  className="border border-current rounded-sm"
                  style={{
                    width: 24,
                    height: Math.max(6, Math.min(32, 24 * (fmt.height / fmt.width))),
                  }}
                />
                <span>{fmt.label}</span>
                <span className="text-[8px] opacity-60">{fmt.width}&times;{fmt.height}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Background */}
        <div className="space-y-2">
          <label className="text-xs text-gray-500">Background</label>
          <div className="grid grid-cols-5 gap-2">
            {BACKGROUND_PRESETS.map(preset => (
              <button
                key={preset.key}
                onClick={() => update({ bg: preset.key, dark: preset.dark })}
                className={cn(
                  'h-10 rounded-lg border-2 transition-all',
                  config.bg === preset.key
                    ? 'border-[#F72D5E] shadow-[0_0_8px_rgba(247,45,94,0.2)]'
                    : 'border-gray-200 hover:border-gray-300'
                )}
                style={{ background: preset.css }}
                title={preset.label}
              />
            ))}
          </div>
        </div>

        {/* Accent */}
        <div className="space-y-2">
          <label className="text-xs text-gray-500">Accent</label>
          <div className="flex flex-wrap gap-1.5">
            {ACCENT_PRESETS.map(preset => (
              <button
                key={preset.key}
                onClick={() => update({ accent: preset.key })}
                className={cn(
                  'px-2.5 py-1.5 text-[10px] font-medium rounded-lg border transition-all',
                  config.accent === preset.key
                    ? 'border-[#F72D5E] bg-[#F72D5E]/10 text-[#F72D5E]'
                    : 'border-gray-200 text-gray-400 hover:text-gray-700 hover:bg-gray-50'
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Dark mode */}
        <div className="flex items-center justify-between">
          <label className="text-xs text-gray-500">Dark text mode</label>
          <Switch
            checked={config.dark}
            onCheckedChange={checked => update({ dark: checked })}
          />
        </div>

        {/* Footer */}
        <div className="space-y-2">
          <label className="text-xs text-gray-500">Footer text</label>
          <input
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#F72D5E]/30"
            value={config.footer}
            onChange={e => update({ footer: e.target.value })}
            placeholder="artinscale.com"
          />
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-200" />

      {/* Block Editor */}
      <BlockEditor
        blocks={config.blocks}
        onChange={blocks => update({ blocks })}
      />
    </div>
  )
}
