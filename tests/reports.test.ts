import assert from 'node:assert/strict';
import test from 'node:test';
import {
  distanceMeters,
  filterReports,
  nearbyDuplicates,
  validateReport,
} from '../src/lib/reports';
import type { Report, ReportDraft } from '../src/types';
const report: Report = {
  id: 'one',
  user_id: 'user',
  image_url: 'file:///photo.jpg',
  category: 'Pothole',
  description: 'A deep pothole near the bus stop.',
  severity: 'High',
  latitude: 12,
  longitude: 77,
  status: 'Submitted',
  created_at: '2026-10-20T10:00:00Z',
  upvotes: 3,
  has_upvoted: false,
};
const draft: ReportDraft = {
  image_uri: report.image_url,
  category: report.category,
  description: report.description,
  severity: report.severity,
  latitude: report.latitude,
  longitude: report.longitude,
};
test('distance is zero at the same position and symmetric', () => {
  assert.equal(distanceMeters(report, report), 0);
  const other = { latitude: 12.001, longitude: 77 };
  assert.ok(distanceMeters(report, other) > 110 && distanceMeters(report, other) < 112);
  assert.equal(distanceMeters(report, other), distanceMeters(other, report));
});
test('distance handles opposite sides of the globe without NaN', () => {
  assert.ok(
    Number.isFinite(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 })),
  );
});
test('duplicate suggestions only include nearby open reports of the same category', () => {
  const data: Report[] = [
    report,
    { ...report, id: 'resolved', status: 'Resolved' },
    { ...report, id: 'far', latitude: 12.01 },
    { ...report, id: 'garbage', category: 'Garbage' },
  ];
  assert.deepEqual(
    nearbyDuplicates(data, 'Pothole', { latitude: 12.0001, longitude: 77 }).map((r) => r.id),
    ['one'],
  );
});
test('search, category and status filters work together', () => {
  assert.equal(
    filterReports([report], { query: ' BUS ', category: 'Pothole', status: 'Submitted' }).length,
    1,
  );
  assert.equal(filterReports([report], { status: 'Resolved' }).length, 0);
  assert.equal(filterReports([report], { query: 'leak' }).length, 0);
});
test('sorts newest, support and distance without mutating reports', () => {
  const data = [
    report,
    { ...report, id: 'two', upvotes: 9, latitude: 12.1, created_at: '2026-10-21T10:00:00Z' },
  ];
  assert.equal(filterReports(data, { sort: 'Newest' })[0].id, 'two');
  assert.equal(filterReports(data, { sort: 'Most supported' })[0].id, 'two');
  assert.equal(filterReports(data, { sort: 'Nearest', location: report })[0].id, 'one');
  assert.equal(data[0].id, 'one');
});
test('validates required photo, description and coordinates', () => {
  assert.equal(validateReport(draft), null);
  assert.ok(validateReport({ ...draft, image_uri: '' }));
  assert.ok(validateReport({ ...draft, description: '   short   ' }));
  assert.ok(validateReport({ ...draft, description: 'x'.repeat(2001) }));
  assert.ok(validateReport({ ...draft, latitude: NaN }));
  assert.ok(validateReport({ ...draft, longitude: 181 }));
  assert.equal(validateReport({ ...draft, latitude: 0, longitude: 0 }), null);
});
