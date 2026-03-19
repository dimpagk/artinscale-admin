import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...classes: (string | undefined | null | false)[]): string {
  return twMerge(clsx(...classes));
}
