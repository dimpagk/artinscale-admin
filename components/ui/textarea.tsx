'use client'

import { forwardRef } from 'react'
import { Textarea as DSTextarea, type TextareaProps } from '@dimpagk/artinscale-ui/forms'

export type { TextareaProps }

/**
 * Admin-side Textarea — same density rule as Input: default `sm` here,
 * `md` in the storefront.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  props,
  ref
) {
  return <DSTextarea ref={ref} size={props.size ?? 'sm'} {...props} />
})
