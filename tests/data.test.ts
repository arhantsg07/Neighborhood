import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import type { ReportDraft, ReportStatus } from '../src/types';
import {
  createDataHarness,
  DEMO_KEY,
  LIVE_SESSION,
  LIVE_USER_ID,
  MODE_KEY,
  REPORT_ID,
} from './helpers/dataHarness';

// Run with npm test. Additional devdeps: react-test-renderer matching React, its @types,
// and a direct esbuild dependency (already supplied transitively by tsx).
const draft: ReportDraft = {
  image_uri: 'file:///picker/photo.jpg',
  category: 'Pothole',
  severity: 'High',
  description: '  A large pothole beside the crosswalk.  ',
  latitude: 37.7749,
  longitude: -122.4194,
};
type Harness = Awaited<ReturnType<typeof createDataHarness>>;

async function mount(t: TestContext, options: Parameters<typeof createDataHarness>[0] = {}) {
  const harness = await createDataHarness(options);
  t.after(() => harness.dispose());
  await harness.mount();
  return harness;
}

async function signIn(h: Harness) {
  await h.run(() => h.app.signIn('neighbor@example.com', 'secret-password'));
  await h.flushAuth();
}

// The React act-environment flag is shared, so providers run sequentially within this file.
// esbuild's boundary mocks themselves are local to each harness, not global loader patches.
describe('AppProvider demo integration', { concurrency: false, timeout: 10_000 }, () => {
  it('automatically seeds and persists demo data when config is missing', async (t) => {
    const h = await mount(t);
    assert.equal(h.app.mode, 'demo');
    assert.equal(h.app.user?.id, 'local-demo-user');
    assert.equal(h.app.user!.is_admin, true);
    assert.equal(h.app.loading, false);
    assert.equal(h.app.error, null);
    assert.equal(
      h.backend.clientOptions,
      undefined,
      'Missing config must not create a placeholder client',
    );
    assert.equal(h.app.reports.length, 3);
    assert.equal(h.memory.get(MODE_KEY), 'demo');
    assert.ok(h.memory.has(DEMO_KEY));
    assert.equal(new Set(h.app.reports.map((report) => report.id)).size, 3);
    for (const report of h.app.reports) {
      assert.match(report.image_url, /^https:\/\//);
      assert.ok(report.description.trim().length >= 10 && report.description.length <= 2000);
      assert.ok(report.latitude >= -90 && report.latitude <= 90);
      assert.ok(report.longitude >= -180 && report.longitude <= 180);
      assert.equal(report.has_upvoted, false);
    }
    const timestamps = h.app.reports.map((report) => report.created_at);
    assert.deepEqual(timestamps, [...timestamps].sort().reverse());
  });

  it('toggles exactly one own vote and serializes concurrent writes without losing data', async (t) => {
    const h = await mount(t);
    const report = h.app.reports[0];
    await h.run(() => h.app.toggleUpvote(report.id));
    assert.equal(h.app.reports[0].upvotes, report.upvotes + 1);
    assert.equal(h.app.reports[0].has_upvoted, true);
    await h.run(() =>
      Promise.all([
        h.app.toggleUpvote(report.id),
        h.app.toggleUpvote(report.id),
        h.app.addComment(report.id, 'A neighbor also noticed this issue.'),
        h.app.updateStatus(report.id, 'In progress'),
      ]),
    );
    await h.unmount();
    await h.mount();
    const persisted = h.app.reports.find((item) => item.id === report.id)!;
    assert.equal(persisted.upvotes, report.upvotes + 1);
    assert.equal(persisted.has_upvoted, true);
    assert.equal(persisted.status, 'In progress');
    const comments = await h.run(() => h.app.getComments(report.id));
    assert.ok(comments.some((comment) => comment.body === 'A neighbor also noticed this issue.'));
    await h.run(() => h.app.toggleUpvote(report.id));
    assert.equal(h.app.reports.find((item) => item.id === report.id)!.upvotes, report.upvotes);
    assert.equal(h.app.reports.find((item) => item.id === report.id)!.has_upvoted, false);
  });

  it('trims, scopes, orders and persists comments; rejects blank comments and unknown reports', async (t) => {
    const h = await mount(t);
    const [first, second] = h.app.reports;
    const comment = await h.run(() =>
      h.app.addComment(first.id, '  Please watch your step here.  '),
    );
    assert.equal(comment.body, 'Please watch your step here.');
    assert.equal(comment.user_id, h.app.user!.id);
    assert.equal(comment.report_id, first.id);
    await h.unmount();
    await h.mount();
    const comments = await h.run(() => h.app.getComments(first.id));
    assert.ok(comments.some((item) => item.id === comment.id));
    const times = comments.map((item) => item.created_at);
    assert.deepEqual(times, [...times].sort());
    assert.ok(
      (await h.run(() => h.app.getComments(second.id))).every(
        (item) => item.report_id === second.id,
      ),
    );
    await assert.rejects(
      h.run(() => h.app.addComment(first.id, '   ')),
      /Write a comment/,
    );
    await assert.rejects(
      h.run(() => h.app.addComment('missing-report', 'Hello')),
      /no longer exists/,
    );
    await assert.rejects(
      h.run(() => h.app.getComments('missing-report')),
      /no longer exists/,
    );
  });

  it('persists demo status changes and rejects invalid statuses', async (t) => {
    const h = await mount(t);
    const id = h.app.reports[0].id;
    for (const status of ['In progress', 'Resolved', 'Submitted'] as const) {
      await h.run(() => h.app.updateStatus(id, status));
      assert.equal(h.app.reports.find((report) => report.id === id)!.status, status);
    }
    await assert.rejects(
      h.run(() => h.app.updateStatus(id, 'Closed' as ReportStatus)),
      /valid report status/,
    );
    await assert.rejects(
      h.run(() => h.app.updateStatus('missing-report', 'Resolved')),
      /no longer exists/,
    );
    await h.unmount();
    await h.mount();
    assert.equal(h.app.reports.find((report) => report.id === id)!.status, 'Submitted');
  });

  it('creates a trimmed report with a durable photo instead of persisting a picker cache URI', async (t) => {
    const h = await mount(t);
    const report = await h.run(() => h.app.createReport(draft));
    assert.equal(report.description, draft.description.trim());
    assert.equal(report.user_id, h.app.user!.id);
    assert.equal(report.status, 'Submitted');
    assert.equal(report.upvotes, 0);
    assert.equal(report.has_upvoted, false);
    assert.match(report.image_url, /^file:\/\/\/documents\/demo-report-images\//);
    assert.deepEqual(h.disk.copies, [{ from: draft.image_uri, to: report.image_url }]);
    assert.deepEqual(h.backend.uploads, []);
    assert.equal(h.app.loading, false);
    await h.unmount();
    await h.mount();
    assert.deepEqual(
      h.app.reports.find((item) => item.id === report.id),
      report,
    );
  });

  it('keeps failed local writes out of state, cleans up photos and leaves the mutation queue usable', async (t) => {
    const h = await mount(t);
    const before = structuredClone(h.app.reports);
    h.disk.failNextDemoWrite = true;
    await assert.rejects(
      h.run(() => h.app.createReport(draft)),
      /Local storage is full/,
    );
    assert.deepEqual(h.app.reports, before);
    assert.deepEqual(h.disk.deleted, [h.disk.copies[0].to]);
    assert.match(h.app.error!, /Local storage is full/);
    await h.run(() => h.app.clearError());
    assert.equal(h.app.error, null);
    await h.run(() => h.app.toggleUpvote(before[0].id));
    assert.equal(h.app.reports[0].has_upvoted, true);
    await h.run(() => h.app.refresh());
    assert.equal(h.app.loading, false);
  });

  it('validates photos, coordinates and required text before writing demo records', async (t) => {
    const h = await mount(t);
    for (const invalid of [
      { ...draft, image_uri: '' },
      { ...draft, image_uri: '  ' },
      { ...draft, description: '  ' },
      { ...draft, category: 'Unknown' as ReportDraft['category'] },
      { ...draft, severity: 'Critical' as ReportDraft['severity'] },
      { ...draft, latitude: 91 },
      { ...draft, longitude: -181 },
      { ...draft, latitude: Number.NaN },
      { ...draft, longitude: Number.POSITIVE_INFINITY },
    ])
      await assert.rejects(h.run(() => h.app.createReport(invalid)));
    assert.equal(h.disk.copies.length, 0);
    assert.equal(h.app.reports.length, 3);
    await assert.rejects(
      h.run(() => h.app.toggleUpvote(' ')),
      /report ID/,
    );
  });

  it('never fabricates AI analysis in demo or silently enables live auth without configuration', async (t) => {
    const h = await mount(t);
    await assert.rejects(
      h.run(() => h.app.analyzeImage(draft.image_uri)),
      /unavailable in demo.*manually/,
    );
    await assert.rejects(
      h.run(() => h.app.signIn('neighbor@example.com', 'secret-password')),
      /not configured/,
    );
    assert.equal(h.app.mode, 'demo');
    assert.equal(h.backend.invocations.length, 0);
    assert.equal(h.backend.uploads.length, 0);
  });

  it('persists logout without deleting demo records and supports explicit re-entry', async (t) => {
    const h = await mount(t);
    const before = structuredClone(h.app.reports);
    await h.run(() => h.app.signOut());
    assert.equal(h.app.user, null);
    assert.equal(h.app.mode, 'demo');
    assert.deepEqual(h.app.reports, []);
    await h.unmount();
    await h.mount();
    assert.equal(h.app.user, null);
    await assert.rejects(
      h.run(() => h.app.refresh()),
      /Sign in or enter demo/,
    );
    await h.run(() => h.app.enterDemo());
    assert.deepEqual(h.app.reports, before);
  });

  it('reports corrupt persisted data without overwriting it or claiming a ready demo user', async (t) => {
    const memory = new Map([[DEMO_KEY, '{broken-json']]);
    const h = await mount(t, { storage: memory });
    assert.match(h.app.error!, /Saved demo data is invalid/);
    assert.equal(h.app.user, null);
    assert.deepEqual(h.app.reports, []);
    assert.equal(memory.get(DEMO_KEY), '{broken-json');
  });
});

describe(
  'AppProvider live auth and backend integration',
  { concurrency: false, timeout: 10_000 },
  () => {
    it('defaults to live logged-out, requires auth and configures persistent, locked native refresh', async (t) => {
      const h = await mount(t, { configured: true });
      assert.equal(h.app.mode, 'live');
      assert.equal(h.app.user, null);
      assert.deepEqual(h.app.reports, []);
      assert.deepEqual(h.backend.clientOptions!.auth, {
        storage: h.storage,
        lock: h.processLock,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      });
      assert.equal(h.backend.refreshStarts, 1);
      h.backend.changeAppState('background');
      assert.equal(h.backend.refreshStops, 1);
      h.backend.changeAppState('active');
      assert.equal(h.backend.refreshStarts, 2);
      await assert.rejects(
        h.run(() => h.app.createReport(draft)),
        /Sign in or enter demo/,
      );
      await assert.rejects(
        h.run(() => h.app.addComment(REPORT_ID, 'Hello')),
        /Sign in or enter demo/,
      );
      assert.equal(h.backend.uploads.length, 0);
    });

    it('validates credentials, surfaces auth errors and trims emails without trimming passwords', async (t) => {
      const h = await mount(t, { configured: true });
      await assert.rejects(
        h.run(() => h.app.signIn('not-email', 'password')),
        /valid email/,
      );
      await assert.rejects(
        h.run(() => h.app.signIn('neighbor@example.com', '  ')),
        /password/,
      );
      await assert.rejects(
        h.run(() => h.app.signUp('neighbor@example.com', '12345')),
        /at least 6/,
      );
      assert.equal(h.backend.credentials.length, 0);
      h.backend.failures.auth = { message: 'Invalid login credentials' };
      await assert.rejects(
        h.run(() => h.app.signIn('neighbor@example.com', 'password')),
        /Invalid login credentials/,
      );
      assert.equal(h.app.mode, 'live');
      assert.equal(h.app.user, null);
      assert.match(h.app.error!, /Invalid login credentials/);
      h.backend.failures.auth = null;
      await h.run(() => h.app.signIn('  neighbor@example.com  ', ' password with spaces '));
      await h.flushAuth();
      assert.deepEqual(h.backend.credentials.at(-1), {
        email: 'neighbor@example.com',
        password: ' password with spaces ',
      });
      assert.equal(h.app.user!.id, LIVE_USER_ID);
      assert.equal(h.app.error, null);
    });

    it('returns an email-confirmation message or activates an immediate sign-up session', async (t) => {
      const h = await mount(t, { configured: true });
      const message = await h.run(() => h.app.signUp('neighbor@example.com', 'secret-password'));
      assert.match(message!, /email.*confirm/);
      assert.equal(h.app.user, null);
      h.backend.confirmationRequired = false;
      assert.equal(
        await h.run(() => h.app.signUp('neighbor@example.com', 'secret-password')),
        undefined,
      );
      await h.flushAuth();
      assert.equal(h.app.user!.id, LIVE_USER_ID);
      assert.equal(h.memory.get(MODE_KEY), 'live');
    });

    it('restores sessions, loads the admin profile, derives own votes and signs stored paths for one hour', async (t) => {
      const h = await mount(t, { configured: true, session: LIVE_SESSION });
      assert.deepEqual(h.app.user, {
        id: LIVE_USER_ID,
        email: 'neighbor@example.com',
        is_admin: true,
      });
      assert.equal(h.app.reports[0].upvotes, 1);
      assert.equal(h.app.reports[0].has_upvoted, false);
      assert.equal(h.app.reports[0].image_url, `https://signed.example/${LIVE_USER_ID}/photo.jpg`);
      assert.deepEqual(h.backend.signed, [{ path: `${LIVE_USER_ID}/photo.jpg`, expires: 3600 }]);
      assert.equal(h.backend.subscriberCount, 1);
      await h.unmount();
      assert.equal(h.backend.subscriberCount, 0);
      await h.mount();
      assert.equal(h.app.user!.id, LIVE_USER_ID);
      assert.equal(h.backend.subscriberCount, 1);
    });

    it('keeps reports visible when a photo cannot be signed and recovers on refresh', async (t) => {
      const h = await mount(t, { configured: true, session: LIVE_SESSION });
      h.backend.failures.signing = { message: 'Photo no longer exists' };
      await h.run(() => h.app.refresh());
      assert.equal(h.app.reports.length, 1);
      assert.equal(h.app.reports[0].image_url, '');
      assert.equal(h.app.mode, 'live');
      h.backend.failures.signing = null;
      await h.run(() => h.app.refresh());
      assert.match(h.app.reports[0].image_url, /^https:\/\/signed\.example\//);
    });

    it('does not fall back on profile/report errors and can recover through refresh', async (t) => {
      const h = await createDataHarness({ configured: true, session: LIVE_SESSION });
      t.after(() => h.dispose());
      h.backend.failures.profile = { message: 'Profile access denied' };
      await h.mount();
      assert.equal(h.app.mode, 'live');
      assert.equal(h.app.user!.id, LIVE_USER_ID);
      assert.equal(h.app.user!.is_admin, false);
      assert.match(h.app.error!, /Profile access denied/);
      h.backend.failures.profile = null;
      await h.run(() => h.app.refresh());
      assert.equal(h.app.user!.is_admin, true);
      const before = structuredClone(h.app.reports);
      h.backend.failures.reports = { message: 'Backend unavailable' };
      await assert.rejects(
        h.run(() => h.app.refresh()),
        /Backend unavailable/,
      );
      assert.equal(h.app.loading, false);
      assert.equal(h.app.mode, 'live');
      assert.deepEqual(h.app.reports, before);
      assert.equal(h.memory.has(DEMO_KEY), false);
      h.backend.failures.reports = null;
      await h.run(() => h.app.refresh());
      assert.equal(h.app.error, null);
    });

    it('persists explicit demo selection while configured, ignores live auth there and returns to live on logout', async (t) => {
      const h = await mount(t, { configured: true });
      await signIn(h);
      await h.run(() => h.app.enterDemo());
      const before = structuredClone(h.app.reports);
      await h.unmount();
      await h.mount();
      assert.equal(h.app.mode, 'demo');
      assert.equal(h.app.user!.id, 'local-demo-user');
      await h.run(() => h.backend.emit('TOKEN_REFRESHED', LIVE_SESSION));
      await h.flushAuth();
      assert.deepEqual(h.app.reports, before);
      h.backend.failures.signOut = { message: 'Sign-out request failed' };
      await assert.rejects(
        h.run(() => h.app.signOut()),
        /Sign-out request failed/,
      );
      assert.equal(h.app.mode, 'demo');
      assert.equal(h.app.user!.id, 'local-demo-user');
      h.backend.failures.signOut = null;
      await h.run(() => h.app.signOut());
      await h.flushAuth();
      assert.equal(h.app.mode, 'live');
      assert.equal(h.app.user, null);
      assert.deepEqual(h.app.reports, []);
      assert.ok(h.memory.has(DEMO_KEY));
      assert.equal(h.memory.get(MODE_KEY), 'live');
    });

    it('processes the latest auth event without resurrecting a just-signed-out user', async (t) => {
      const h = await mount(t, { configured: true });
      await h.run(() => {
        h.backend.emit('SIGNED_IN', LIVE_SESSION);
        h.backend.emit('SIGNED_OUT', null);
      });
      await h.flushAuth();
      assert.equal(h.app.user, null);
      assert.deepEqual(h.app.reports, []);
      await signIn(h);
      assert.equal(h.app.user!.id, LIVE_USER_ID);
      await h.run(() => h.app.signOut());
      await h.flushAuth();
      assert.equal(h.app.user, null);
    });

    it('uses the vote/status RPC contracts and trims/scopes live comments', async (t) => {
      const h = await mount(t, { configured: true, session: LIVE_SESSION });
      await h.run(() => h.app.toggleUpvote(REPORT_ID));
      assert.equal(h.app.reports[0].upvotes, 2);
      assert.equal(h.app.reports[0].has_upvoted, true);
      await h.run(() => h.app.toggleUpvote(REPORT_ID));
      assert.equal(h.app.reports[0].upvotes, 1);
      assert.equal(h.app.reports[0].has_upvoted, false);
      await h.run(() => h.app.updateStatus(REPORT_ID, 'Resolved'));
      assert.equal(h.app.reports[0].status, 'Resolved');
      assert.deepEqual(h.backend.rpcs, [
        { name: 'toggle_upvote', args: { p_report_id: REPORT_ID } },
        { name: 'toggle_upvote', args: { p_report_id: REPORT_ID } },
        { name: 'set_report_status', args: { p_report_id: REPORT_ID, p_status: 'Resolved' } },
      ]);
      const comment = await h.run(() =>
        h.app.addComment(REPORT_ID, '  Thank you for the update.  '),
      );
      assert.equal(comment.body, 'Thank you for the update.');
      assert.deepEqual(await h.run(() => h.app.getComments(REPORT_ID)), [comment]);
      assert.deepEqual(await h.run(() => h.app.getComments('another-report')), []);
      h.backend.failures.rpc = { message: 'RPC permission denied' };
      await assert.rejects(
        h.run(() => h.app.toggleUpvote(REPORT_ID)),
        /RPC permission denied/,
      );
      assert.equal(h.app.mode, 'live');
    });

    it('blocks non-admin status changes before issuing an RPC', async (t) => {
      const h = await createDataHarness({ configured: true, session: LIVE_SESSION });
      t.after(() => h.dispose());
      h.backend.isAdmin = false;
      await h.mount();
      await assert.rejects(
        h.run(() => h.app.updateStatus(REPORT_ID, 'Resolved')),
        /Only administrators/,
      );
      assert.equal(h.backend.rpcs.length, 0);
      assert.equal(h.app.reports[0].status, 'Submitted');
    });

    it('uploads native base64 bytes under the current user and inserts a storage path, never a signed URL', async (t) => {
      const h = await mount(t, { configured: true, session: LIVE_SESSION });
      const report = await h.run(() => h.app.createReport(draft));
      assert.equal(h.backend.uploads.length, 1);
      const upload = h.backend.uploads[0];
      assert.match(upload.path, new RegExp(`^${LIVE_USER_ID}/.+\\.jpg$`));
      assert.equal(upload.contentType, 'image/jpeg');
      assert.equal(upload.upsert, false);
      assert.deepEqual([...new Uint8Array(upload.bytes)], [0xff, 0xd8, 0xff, 0xd9]);
      assert.deepEqual(h.disk.base64Reads, [{ uri: draft.image_uri, encoding: 'base64' }]);
      assert.equal(h.backend.reportInserts[0].image_url, upload.path);
      assert.equal(h.backend.reportInserts[0].description, draft.description.trim());
      assert.equal(report.image_url, `https://signed.example/${upload.path}`);
      assert.equal(h.app.reports[0].id, report.id);
      assert.deepEqual(h.backend.removed, []);
      assert.equal(h.app.loading, false);
    });

    it('cleans up failed inserts but retains committed report images when signing fails', async (t) => {
      const h = await mount(t, { configured: true, session: LIVE_SESSION });
      const before = structuredClone(h.app.reports);
      h.backend.failures.insert = { message: 'Insert denied by policy' };
      await assert.rejects(
        h.run(() => h.app.createReport(draft)),
        /Insert denied by policy/,
      );
      assert.deepEqual(h.backend.removed, [h.backend.uploads[0].path]);
      assert.deepEqual(h.app.reports, before);
      h.backend.failures.insert = null;
      h.backend.failures.signing = { message: 'Signing unavailable' };
      await assert.rejects(
        h.run(() => h.app.createReport(draft)),
        /was saved.*Refresh instead of submitting again/,
      );
      assert.equal(h.backend.rows.length, 2, 'The insert has committed');
      assert.equal(
        h.backend.removed.length,
        1,
        'Do not delete a successfully committed report image',
      );
      h.backend.failures.signing = null;
      await h.run(() => h.app.refresh());
      assert.equal(h.app.reports.length, 2);
    });

    it('reports both the original failure and a cleanup failure', async (t) => {
      const h = await mount(t, { configured: true, session: LIVE_SESSION });
      h.backend.failures.insert = { message: 'Insert denied' };
      h.backend.failures.remove = { message: 'Storage deletion denied' };
      await assert.rejects(
        h.run(() => h.app.createReport(draft)),
        /Insert denied.*remove.*Storage deletion denied/,
      );
      assert.match(h.app.error!, /Storage deletion denied/);
    });

    it('removes temporary AI uploads after success, function errors and invalid output', async (t) => {
      const h = await mount(t, { configured: true, session: LIVE_SESSION });
      const result = await h.run(() => h.app.analyzeImage(draft.image_uri));
      assert.deepEqual(result, h.backend.analysis);
      assert.deepEqual(h.backend.invocations[0], { image_path: h.backend.uploads[0].path });
      assert.equal(h.backend.removed.at(-1), h.backend.uploads.at(-1)!.path);
      h.backend.failures.analysis = {
        message: 'Edge function returned an error',
        context: new Response(JSON.stringify({ error: 'AI quota exceeded' }), { status: 429 }),
      };
      await assert.rejects(
        h.run(() => h.app.analyzeImage(draft.image_uri)),
        /AI quota exceeded/,
      );
      assert.equal(h.backend.removed.at(-1), h.backend.uploads.at(-1)!.path);
      h.backend.failures.analysis = null;
      h.backend.analysis = {
        category: 'Invented category',
        description: 'Not a valid analysis.',
        severity: 'High',
      };
      await assert.rejects(
        h.run(() => h.app.analyzeImage(draft.image_uri)),
        /invalid response/,
      );
      assert.equal(h.backend.removed.at(-1), h.backend.uploads.at(-1)!.path);
      assert.equal(h.backend.removed.length, 3);
      assert.equal(h.app.loading, false);
      assert.equal(h.app.mode, 'live');
    });

    it('still surfaces backend constraint errors and cleans uploads after client validation succeeds', async (t) => {
      const h = await mount(t, { configured: true, session: LIVE_SESSION });
      h.backend.failures.insert = { message: 'reports_description_check violated' };
      await assert.rejects(
        h.run(() => h.app.createReport(draft)),
        /reports_description_check/,
      );
      assert.deepEqual(h.backend.removed, [h.backend.uploads[0].path]);
      assert.equal(h.backend.rows.length, 1);
      assert.equal(h.app.reports.length, 1);
      assert.equal(h.app.mode, 'live');
    });
  },
);

describe('AppProvider stale-refresh regressions', { concurrency: false, timeout: 10_000 }, () => {
  it('does not let an older report response remove a successfully created report', async (t) => {
    const h = await mount(t, { configured: true, session: LIVE_SESSION });
    const read = h.backend.holdNextReports();
    t.after(read.release);
    const pending = await h.begin(() => h.app.refresh(), read.started);
    assert.equal(h.app.loading, true);
    const report = await h.run(() => h.app.createReport(draft));
    await h.run(async () => {
      read.release();
      await pending.completion;
    });
    assert.ok(h.app.reports.some((item) => item.id === report.id));
    assert.equal(h.app.loading, false);
  });

  it('does not let an older report response undo a committed status change', async (t) => {
    const h = await mount(t, { configured: true, session: LIVE_SESSION });
    const read = h.backend.holdNextReports();
    t.after(read.release);
    const pending = await h.begin(() => h.app.refresh(), read.started);
    await h.run(() => h.app.updateStatus(REPORT_ID, 'Resolved'));
    await h.run(async () => {
      read.release();
      await pending.completion;
    });
    assert.equal(h.app.reports.find((report) => report.id === REPORT_ID)!.status, 'Resolved');
  });

  it('keeps the newest response and stays loading until all overlapping refreshes finish', async (t) => {
    const h = await mount(t, { configured: true, session: LIVE_SESSION });
    const first = h.backend.holdNextReports();
    t.after(first.release);
    const older = await h.begin(() => h.app.refresh(), first.started);
    h.backend.rows[0].description = 'The backend now has a newer description.';
    const second = h.backend.holdNextReports();
    t.after(second.release);
    const newer = await h.begin(() => h.app.refresh(), second.started);
    await h.run(async () => {
      second.release();
      await newer.completion;
    });
    assert.equal(h.app.loading, true, 'The first refresh is still outstanding');
    assert.equal(h.app.reports[0].description, h.backend.rows[0].description);
    await h.run(async () => {
      first.release();
      await older.completion;
    });
    assert.equal(h.app.loading, false);
    assert.equal(h.app.reports[0].description, h.backend.rows[0].description);
  });

  it('does not repopulate private reports when a pending refresh completes after logout', async (t) => {
    const h = await mount(t, { configured: true, session: LIVE_SESSION });
    const read = h.backend.holdNextReports();
    t.after(read.release);
    const pending = await h.begin(() => h.app.refresh(), read.started);
    await h.run(() => h.app.signOut());
    await h.flushAuth();
    read.release();
    await assert.rejects(
      h.run(() => pending.completion),
      /session changed/,
    );
    assert.equal(h.app.user, null);
    assert.deepEqual(h.app.reports, []);
    assert.equal(h.app.mode, 'live');
    assert.equal(h.app.loading, false);
  });
});

describe(
  'Client/demo text validation against shared SQL',
  { concurrency: false, timeout: 10_000 },
  () => {
    for (const [length, message] of [
      [9, /at least 10 characters/],
      [2001, /2,000 characters/],
    ] as const) {
      it(`rejects ${length}-character descriptions before demo persistence or live upload`, async (t) => {
        for (const configured of [false, true]) {
          await t.test(configured ? 'live' : 'demo', async (t) => {
            const h = await mount(t, { configured, session: configured ? LIVE_SESSION : null });
            const before = structuredClone(h.app.reports);
            const saved = h.memory.get(DEMO_KEY);
            await assert.rejects(
              h.run(() =>
                h.app.createReport({
                  ...draft,
                  description: `  \n${'x'.repeat(length)}\t  `,
                }),
              ),
              message,
            );
            assert.match(h.app.error!, message);
            assert.deepEqual(h.app.reports, before);
            assert.equal(h.memory.get(DEMO_KEY), saved);
            assert.equal(h.disk.copies.length, 0);
            assert.equal(h.disk.base64Reads.length, 0);
            assert.equal(h.backend.uploads.length, 0);
            assert.equal(h.backend.reportInserts.length, 0);
            assert.equal(h.app.mode, configured ? 'live' : 'demo');

            const boundary = length < 10 ? 10 : 2000;
            const report = await h.run(() =>
              h.app.createReport({
                ...draft,
                description: `  \n${'x'.repeat(boundary)}\t  `,
              }),
            );
            assert.equal(report.description, 'x'.repeat(boundary));
            assert.equal(h.app.error, null);
            if (configured) {
              assert.equal(h.backend.reportInserts[0].description, report.description);
            } else {
              await h.unmount();
              await h.mount();
              assert.equal(
                h.app.reports.find((item) => item.id === report.id)!.description,
                report.description,
              );
            }
          });
        }
      });
    }

    it('rejects oversized comments before demo persistence or live insertion and accepts trimmed boundaries', async (t) => {
      for (const configured of [false, true]) {
        await t.test(configured ? 'live' : 'demo', async (t) => {
          const h = await mount(t, { configured, session: configured ? LIVE_SESSION : null });
          const reportId = h.app.reports[0].id;
          const before = await h.run(() => h.app.getComments(reportId));
          const saved = h.memory.get(DEMO_KEY);
          await assert.rejects(
            h.run(() => h.app.addComment(reportId, `  \n${'x'.repeat(1001)}\t  `)),
            /1,000 characters/,
          );
          assert.match(h.app.error!, /1,000 characters/);
          assert.equal(h.backend.commentInserts.length, 0);
          assert.equal(h.memory.get(DEMO_KEY), saved);
          assert.deepEqual(await h.run(() => h.app.getComments(reportId)), before);
          await assert.rejects(
            h.run(() => h.app.addComment(reportId, '  \n\t  ')),
            /Write a comment/,
          );
          assert.equal(h.backend.commentInserts.length, 0);

          const comments = [];
          for (const length of [1, 1000]) {
            const comment = await h.run(() =>
              h.app.addComment(reportId, `  \n${'x'.repeat(length)}\t  `),
            );
            assert.equal(comment.body, 'x'.repeat(length));
            comments.push(comment);
          }
          assert.equal(h.app.error, null);
          if (!configured) {
            await h.unmount();
            await h.mount();
          }
          const persisted = await h.run(() => h.app.getComments(reportId));
          assert.equal(persisted.length, before.length + 2);
          for (const comment of comments)
            assert.ok(
              persisted.some((item) => item.id === comment.id && item.body === comment.body),
            );
          if (configured)
            assert.deepEqual(
              h.backend.commentInserts.map((comment) => comment.body.length),
              [1, 1000],
            );
        });
      }
    });
  },
);
