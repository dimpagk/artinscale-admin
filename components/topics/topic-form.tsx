'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import {
  FormActions,
  FormCard,
  FormGrid,
  DeleteConfirmModal,
} from '@/components/admin-ui';
import type { TopicRow, User } from '@/lib/types';
import {
  createTopicAction,
  updateTopicAction,
  deleteTopicAction,
} from '@/app/(admin)/topics/actions';

interface TopicFormProps {
  topic?: TopicRow;
  artists: User[];
}

export function TopicForm({ topic, artists }: TopicFormProps) {
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
      <form action={handleSubmit} className="space-y-6">
        <FormCard
          title="Basics"
          description="Title and description shown to community contributors."
        >
          {!isEditing && (
            <Input
              name="id"
              label="Topic ID (URL slug)"
              placeholder="e.g., breath, genesis, survive"
              required
              helperText="Lowercase, no spaces. This becomes the URL path."
            />
          )}

          <Input name="title" label="Title" defaultValue={topic?.title} required />

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
        </FormCard>

        <FormCard title="Lifecycle" description="Status, target, and key dates.">
          <FormGrid columns={2}>
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
          </FormGrid>

          <FormGrid columns={2}>
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
          </FormGrid>

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
        </FormCard>

        <FormCard
          title="Contribution Schema"
          description="Prompts shown to contributors and the contribution-type config consumed by the public storefront."
        >
          <Textarea
            name="prompts"
            label="Prompts (one per line or JSON array)"
            defaultValue={
              topic?.prompts ? JSON.stringify(topic.prompts, null, 2) : ''
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
        </FormCard>

        <FormActions
          submitLabel={isEditing ? 'Save Changes' : 'Create Topic'}
          cancelHref="/topics"
          onDelete={isEditing ? () => setShowDeleteModal(true) : undefined}
          deleteLabel="Delete Topic"
        />
      </form>

      {isEditing && (
        <DeleteConfirmModal
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          entity="Topic"
          itemName={topic.title}
          cascade="Deleting this topic also removes all contributions linked to it."
          onConfirm={handleDelete}
        />
      )}
    </>
  );
}
