'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createArtwork, updateArtwork, deleteArtwork, getArtworkById } from '@/lib/artworks';
import { createGelatoProduct } from '@/lib/gelato';

export async function createArtworkAction(formData: FormData) {
  const title = formData.get('title') as string;
  const description = formData.get('description') as string;
  const imageUrl = formData.get('image_url') as string;
  const artistId = formData.get('artist_id') as string;
  const topicId = formData.get('topic_id') as string;
  const status = formData.get('status') as string;
  const editionSize = formData.get('edition_size') as string;
  const editionSold = formData.get('edition_sold') as string;
  const price = formData.get('price') as string;
  const currency = formData.get('currency') as string;
  const productType = formData.get('product_type') as string;
  const inspirationSummary = formData.get('inspiration_summary') as string;

  await createArtwork({
    title,
    description: description || null,
    image_url: imageUrl || null,
    artist_id: artistId || null,
    topic_id: topicId || null,
    status: status || 'created',
    edition_size: editionSize ? parseInt(editionSize) : null,
    edition_sold: editionSold ? parseInt(editionSold) : 0,
    price: price ? parseFloat(price) : null,
    currency: currency || 'EUR',
    product_type: productType || null,
    inspiration_summary: inspirationSummary || null,
  });

  revalidatePath('/artworks');
  redirect('/artworks');
}

export async function updateArtworkAction(id: string, formData: FormData) {
  const title = formData.get('title') as string;
  const description = formData.get('description') as string;
  const imageUrl = formData.get('image_url') as string;
  const artistId = formData.get('artist_id') as string;
  const topicId = formData.get('topic_id') as string;
  const status = formData.get('status') as string;
  const editionSize = formData.get('edition_size') as string;
  const editionSold = formData.get('edition_sold') as string;
  const price = formData.get('price') as string;
  const currency = formData.get('currency') as string;
  const productType = formData.get('product_type') as string;
  const inspirationSummary = formData.get('inspiration_summary') as string;

  await updateArtwork(id, {
    title,
    description: description || null,
    image_url: imageUrl || null,
    artist_id: artistId || null,
    topic_id: topicId || null,
    status,
    edition_size: editionSize ? parseInt(editionSize) : null,
    edition_sold: editionSold ? parseInt(editionSold) : 0,
    price: price ? parseFloat(price) : null,
    currency: currency || 'EUR',
    product_type: productType || null,
    inspiration_summary: inspirationSummary || null,
  });

  revalidatePath('/artworks');
  redirect('/artworks');
}

export async function deleteArtworkAction(id: string) {
  await deleteArtwork(id);
  revalidatePath('/artworks');
  redirect('/artworks');
}

export async function pushToGelatoAction(id: string) {
  const artwork = await getArtworkById(id);
  if (!artwork) throw new Error('Artwork not found');
  if (!artwork.image_url) throw new Error('Artwork must have an image URL to push to Gelato');

  const result = await createGelatoProduct({
    title: artwork.title,
    description: artwork.description || '',
    imageUrl: artwork.image_url,
    productType: artwork.product_type || 'poster',
  });

  await updateArtwork(id, {
    gelato_product_id: result.id,
    gelato_store_id: result.storeId,
  });

  revalidatePath(`/artworks/${id}`);
  revalidatePath('/artworks');
}
