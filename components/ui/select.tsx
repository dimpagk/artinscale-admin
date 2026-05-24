'use client'

import { forwardRef } from 'react'
import { Select as DSSelect, type SelectProps } from '@dimpagk/artinscale-ui/forms'

export type { SelectProps }

/**
 * Admin-side Select — defaults to `size="sm"` matching Input + Textarea.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  props,
  ref
) {
  return <DSSelect ref={ref} size={props.size ?? 'sm'} {...props} />
})
