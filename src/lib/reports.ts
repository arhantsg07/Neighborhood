import type { Category, Report, ReportDraft, ReportStatus } from '../types';

export type Coordinates = { latitude: number; longitude: number };
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function nearbyDuplicates(
  reports: Report[],
  category: Category,
  location: Coordinates,
): Report[] {
  return reports.filter(
    (report) =>
      report.category === category &&
      report.status !== 'Resolved' &&
      distanceMeters(report, location) <= 100,
  );
}
export function filterReports(
  reports: Report[],
  options: {
    query?: string;
    category?: Category | 'All';
    status?: ReportStatus | 'All';
    sort?: 'Newest' | 'Most supported' | 'Nearest';
    location?: Coordinates | null;
  },
): Report[] {
  const query = options.query?.trim().toLowerCase() ?? '';
  const result = reports.filter(
    (report) =>
      (!query || `${report.category} ${report.description}`.toLowerCase().includes(query)) &&
      (!options.category || options.category === 'All' || report.category === options.category) &&
      (!options.status || options.status === 'All' || report.status === options.status),
  );
  return result.sort((a, b) => {
    if (options.sort === 'Most supported')
      return b.upvotes - a.upvotes || Date.parse(b.created_at) - Date.parse(a.created_at);
    if (options.sort === 'Nearest' && options.location)
      return distanceMeters(a, options.location) - distanceMeters(b, options.location);
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });
}
export function validateReport(draft: ReportDraft): string | null {
  if (!draft.image_uri) return 'Add a photo of the issue.';
  if (
    !Number.isFinite(draft.latitude) ||
    Math.abs(draft.latitude) > 90 ||
    !Number.isFinite(draft.longitude) ||
    Math.abs(draft.longitude) > 180
  )
    return 'Add a valid location using GPS or coordinates.';
  if (draft.description.trim().length < 10) return 'Describe the issue in at least 10 characters.';
  if (draft.description.trim().length > 2000) return 'Keep the description under 2,000 characters.';
  return null;
}
export function distanceLabel(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m away` : `${(meters / 1000).toFixed(1)} km away`;
}
export function dateLabel(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
