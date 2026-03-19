'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import type { TopicRow, User } from '@/lib/types';
import { createTopicAction, updateTopicAction, deleteTopicAction } from '@/app/(admin)/topics/actions';

interface TopicFormProps {
  topic?: TopicRow;
  artists: User[];
}

export function TopicForm({ topic, artists }: TopicFormProps) {
  const router = useRouter();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const isEditing = !!topic;

  const artistOptions = [
    { value: '', label: 'No artist assigned' },
    ...artists.map((a) => ({ value: a.id, label: a.name || a.email })),
  ];

  const handleSubmit = async (formData: FormData) => {
    if (isEditing) {
      await updateTopicAction(topic.id, formData);
    } else {
      await createTopicAction(formData);
    }
  };

  const handleDelete = async () => {
    if (topic) {
      await deleteTopicAction(topic.id);
    }
  };

  return (
    <>
      <form action={handleSubmit} className="max-w-2xl space-y-6">
        {!isEditing && (
          <Input
            name="id"
            label="Topic ID (URL slug)"
            placeholder="e.g., breath, genesis, survive"
            required
            helperText="Lowercase, no spaces. This becomes the URL path."
          />
        )}

        <Input
          name="title"
          label="Title"
          defaultValue={topic?.title}
          required
        />

        <Textarea
          name="description"
          label="Short Description"
          defaultValue={topic?.description}
          rows={3}
          required
        />

        <Textarea
          name="long_description"
          label="Long Description"
          defaultValue={topic?.long_description || ''}
          rows={6}
        />

        <div className="grid grid-cols-2 gap-4">
          <Select
            name="status"
            label="Status"
            options={[
              { value: 'upcoming', label: 'Upcoming' },
              { value: 'active', label: 'Active' },
              { value: 'completed', label: 'Completed' },
            ]}
            defaultValue={topic?.status || 'upcoming'}
          />

          <Input
            name="target_contributors"
            label="Target Contributors"
            type="number"
            defaultValue={topic?.target_contributors || 50}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input
            name="deadline"
            label="Deadline"
            type="date"
            defaultValue={topic?.deadline || ''}
          />
          <Input
            name="estimated_completion"
            label="Estimated Completion"
            type="date"
            defaultValue={topic?.estimated_completion || ''}
          />
        </div>

        {isEditing && (
          <Input
            name="completed_date"
            label="Completed Date"
            type="date"
            defaultValue={topic?.completed_date || ''}
          />
        )}

        <Select
          name="artist_id"
          label="Assigned Artist"
          options={artistOptions}
          defaultValue={topic?.artist_id || ''}
        />

        <Textarea
          name="prompts"
          label="Prompts (one per line or JSON array)"
          defaultValue={
            topic?.prompts
              ? JSON.stringify(topic.prompts, null, 2)
              : ''
          }
          rows={4}
          helperText="Enter as JSON array or one prompt per line"
        />

        <Textarea
          name="contribution_types"
          label="Contribution Types (JSON)"
          defaultValue={
            topic?.contribution_types
              ? JSON.stringify(topic.contribution_types, null, 2)
              : '[]'
          }
          rows={8}
          helperText='JSON array of {type, title, description, examples[]}'
        />

        <div className="flex items-center gap-3 pt-4">
          <Button type="submit">{isEditing ? 'Save Changes' : 'Create Topic'}</Button>
          <Button type="button" variant="ghost" onClick={() => router.push('/topics')}>
            Cancel
          </Button>
          {isEditing && (
            <Button
              type="button"
              variant="danger"
              onClick={() => setShowDeleteModal(true)}
              className="ml-auto"
            >
              Delete
            </Button>
          )}
        </div>
      </form>

      {isEditing && (
        <Modal
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          title="Delete Topic"
          actions={
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setShowDeleteModal(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleDelete}>
                Delete Topic
              </Button>
            </div>
          }
        >
          <p className="text-sm text-gray-600">
            Are you sure you want to delete <strong>{topic.title}</strong>? This will also delete all
            contributions associated with this topic. This action cannot be undone.
          </p>
        </Modal>
      )}
    </>
  );
}
