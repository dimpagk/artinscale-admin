/**
 * Image thumbnail with a graceful "no image" fallback.
 *
 * Used in artwork lists, content posts grid, etc. Centralizes the
 * `image-or-placeholder` pattern so callers don't reinvent the
 * fallback box each time.
 */
interface ImageThumbProps {
  src: string | null | undefined
  alt: string
  /** Tailwind size class — e.g. 'h-10 w-10' (default), 'h-16 w-16'. */
  size?: string
  /** Placeholder text when src is missing. Defaults to "No img". */
  placeholder?: string
  /** Apply rounded class. Defaults to 'rounded' (small radius). */
  rounded?: 'none' | 'rounded' | 'rounded-md' | 'rounded-lg' | 'rounded-full'
  className?: string
}

export function ImageThumb({
  src,
  alt,
  size = 'h-10 w-10',
  placeholder = 'No img',
  rounded = 'rounded',
  className = '',
}: ImageThumbProps) {
  const base = `${size} ${rounded === 'none' ? '' : rounded} ${className}`.trim()

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt} className={`${base} object-cover`} />
    )
  }

  return (
    <div
      className={`flex items-center justify-center bg-gray-100 text-xs text-gray-400 ${base}`}
    >
      {placeholder}
    </div>
  )
}
