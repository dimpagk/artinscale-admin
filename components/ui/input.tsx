'use client'

import { forwardRef } from 'react'
import { Input as DSInput, type InputProps } from '@dimpagk/artinscale-ui/forms'

export type { InputProps }

/**
 * Admin-side Input — defaults to `size="sm"` so admin forms stay dense
 * by default. Pass an explicit `size` to override (e.g. for the login
 * page or any focal form). The design-system `Input` itself defaults
 * to `md` for the storefront's marketing-page usage.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  props,
  ref
) {
  return <DSInput ref={ref} size={props.size ?? 'sm'} {...props} />
})
