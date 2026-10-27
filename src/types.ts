export const CATEGORIES = ['Pothole', 'Garbage', 'Streetlight', 'Water leak', 'Other'] as const;
export const STATUSES = ['Submitted', 'In progress', 'Resolved'] as const;
export const SEVERITIES = ['Low', 'Medium', 'High'] as const;
export type Category = (typeof CATEGORIES)[number];
export type ReportStatus = (typeof STATUSES)[number];
export type Severity = (typeof SEVERITIES)[number];

export interface Report {
  id: string;
  user_id: string;
  image_url: string;
  category: Category;
  description: string;
  severity: Severity;
  latitude: number;
  longitude: number;
  status: ReportStatus;
  created_at: string;
  upvotes: number;
  has_upvoted: boolean;
}
export interface Comment {
  id: string;
  report_id: string;
  user_id: string;
  body: string;
  created_at: string;
}
export interface User {
  id: string;
  email: string;
  is_admin: boolean;
}
export interface ReportDraft {
  image_uri: string;
  category: Category;
  description: string;
  severity: Severity;
  latitude: number;
  longitude: number;
}
export interface Analysis {
  category: Category;
  description: string;
  severity: Severity;
}
