// User types
export type UserRole = 'CONTRIBUTOR' | 'ARTIST' | 'ADMIN';

export type User = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  bio: string | null;
  portfolio: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
};

// Topic types
export type TopicStatus = 'active' | 'completed' | 'upcoming';

export interface ContributionTypeConfig {
  type: string;
  title: string;
  description: string;
  examples: string[];
}

export interface TopicRow {
  id: string;
  title: string;
  description: string;
  long_description: string | null;
  status: TopicStatus;
  target_contributors: number;
  deadline: string | null;
  estimated_completion: string | null;
  completed_date: string | null;
  artist_id: string | null;
  contribution_types: ContributionTypeConfig[];
  prompts: string[];
  created_at: string;
  updated_at: string;
  users?: {
    id: string;
    name: string | null;
    bio: string | null;
    portfolio: string | null;
  } | null;
}

export interface TopicStats {
  contributors: number;
  contributions: number;
  privateContributions: number;
  pendingContributions: number;
}

// Contribution types
export type ContributionType = 'story' | 'photo' | 'sound' | 'link';
export type ContributionStatus = 'pending' | 'approved' | 'rejected';

export interface Contribution {
  id: string;
  topic_id: string;
  type: ContributionType;
  contributor_name: string;
  contributor_email: string;
  contributor_location: string | null;
  content: string;
  caption: string | null;
  consent_given: boolean;
  status: ContributionStatus;
  admin_notes: string | null;
  show_publicly: boolean;
  created_at: string;
  updated_at: string;
}

// Artwork types
export type Artwork = {
  id: string;
  title: string;
  description: string | null;
  shopify_product_id: string | null;
  shopify_handle: string | null;
  artist_id: string | null;
  topic_id: string | null;
  status: 'created' | 'listed' | 'sold';
  edition_size: number | null;
  edition_sold: number;
  creation_date: string | null;
  inspiration_summary: string | null;
  contributor_count: number;
  created_at: string;
  updated_at: string;
};
