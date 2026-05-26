'use server';

import { revalidatePath } from 'next/cache';
import { retireExternalPrintById } from '@/lib/external-prints';

export async function retireExternalPrintAction(id: string): Promise<void> {
  await retireExternalPrintById(id);
  revalidatePath('/external-prints');
}
