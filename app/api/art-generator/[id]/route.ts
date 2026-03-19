import { NextResponse } from 'next/server'
import { getGeneratedImageById, deleteGeneratedImage } from '@/lib/generated-images'
import { deleteFile } from '@/lib/storage'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const image = await getGeneratedImageById(id)
    if (!image) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 })
    }

    // Delete from storage
    try {
      await deleteFile('ai-generated', image.storage_path)
    } catch (storageError) {
      console.error('Error deleting file from storage:', storageError)
      // Continue with DB deletion even if storage deletion fails
    }

    const deleted = await deleteGeneratedImage(id)
    if (!deleted) {
      return NextResponse.json(
        { error: 'Failed to delete image record' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting generated image:', error)
    return NextResponse.json(
      { error: 'Failed to delete image' },
      { status: 500 }
    )
  }
}
