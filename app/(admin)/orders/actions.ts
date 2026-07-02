'use server';

import { revalidatePath } from 'next/cache';
import { getOrderById, refreshOrderGelatoStatus, runOrderSync } from '@/lib/orders';
import { approveGelatoOrder } from '@/lib/gelato-order';

/**
 * Approve a pending Gelato order from the admin, sending it to
 * production. This charges the print cost and ships a physical item, so
 * it only ever runs from an explicit button press on the order.
 */
export async function approveOrderAction(orderId: string): Promise<void> {
  const order = await getOrderById(orderId);
  if (!order?.gelato_order_id) {
    console.error(`approveOrderAction(${orderId}): no Gelato order to approve`);
    return;
  }

  const result = await approveGelatoOrder(order.gelato_order_id);
  if (!result.ok) {
    console.error(`approveOrderAction(${orderId}) Gelato approve failed: ${result.error}`);
    return;
  }

  // Pull the fresh Gelato status back onto the row so the UI reflects
  // production immediately (a dry-run leaves status untouched).
  if (!result.isDryRun) await refreshOrderGelatoStatus(orderId);

  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);
}

/** Manual "Sync now" button: reconcile Shopify + refresh Gelato statuses. */
export async function syncOrdersAction(): Promise<void> {
  await runOrderSync();
  revalidatePath('/orders');
}
