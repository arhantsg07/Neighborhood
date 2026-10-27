/// <reference types="node" />
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { build, type Plugin } from 'esbuild';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Session } from '@supabase/supabase-js';
import type { AppContextValue } from '../../src/data/AppProvider';
import type { Analysis, Comment, Report, ReportStatus } from '../../src/types';

export const LIVE_USER_ID = '11111111-1111-4111-8111-111111111111';
export const REPORT_ID = '22222222-2222-4222-8222-222222222222';
export const MODE_KEY = '@issue-reporter/mode/v1';
export const DEMO_KEY = '@issue-reporter/demo/v1/local-demo-user';

export const LIVE_SESSION: Session = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  user: {
    id: LIVE_USER_ID,
    email: 'neighbor@example.com',
    aud: 'authenticated',
    created_at: '2026-10-27T10:00:00.000Z',
    app_metadata: {},
    user_metadata: {},
  },
};

type Failure = { message: string; context?: Response } | null;
type ReportRow = Omit<Report, 'upvotes' | 'has_upvoted'> & { upvotes: { user_id: string }[] };
type ReportInsert = Omit<ReportRow, 'id' | 'created_at' | 'upvotes'>;
type CommentInsert = Pick<Comment, 'user_id' | 'report_id' | 'body'>;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function reportRow(): ReportRow {
  return {
    id: REPORT_ID,
    user_id: LIVE_USER_ID,
    image_url: `${LIVE_USER_ID}/photo.jpg`,
    category: 'Pothole',
    description: 'A deep pothole beside the crosswalk.',
    severity: 'High',
    latitude: 37.7749,
    longitude: -122.4194,
    status: 'Submitted',
    created_at: '2026-10-27T10:00:00.000Z',
    upvotes: [{ user_id: '33333333-3333-4333-8333-333333333333' }],
  };
}

/** Only external boundaries are mocked; the provider, demo store, live helpers and client configuration are real. */
export async function createDataHarness(
  options: {
    configured?: boolean;
    session?: Session | null;
    storage?: Map<string, string>;
    platform?: 'ios' | 'web';
  } = {},
) {
  const memory = options.storage ?? new Map<string, string>();
  const authListeners = new Set<(event: string, session: Session | null) => void>();
  const appStateListeners = new Set<(state: string) => void>();
  const reads: { started: ReturnType<typeof deferred>; released: ReturnType<typeof deferred> }[] =
    [];
  const pendingReads = new Set<ReturnType<typeof deferred>>();
  let sequence = 0;
  const backend = {
    session: options.session ?? null,
    isAdmin: true,
    confirmationRequired: true,
    rows: [reportRow()],
    comments: [] as Comment[],
    failures: {
      auth: null as Failure,
      signOut: null as Failure,
      reports: null as Failure,
      profile: null as Failure,
      insert: null as Failure,
      signing: null as Failure,
      upload: null as Failure,
      remove: null as Failure,
      analysis: null as Failure,
      rpc: null as Failure,
    },
    analysis: {
      category: 'Pothole',
      severity: 'High',
      description: 'A damaged road surface needs repair.',
    } as Analysis | unknown,
    credentials: [] as { email: string; password: string }[],
    reportInserts: [] as ReportInsert[],
    commentInserts: [] as CommentInsert[],
    uploads: [] as { path: string; bytes: ArrayBuffer; contentType: string; upsert: boolean }[],
    removed: [] as string[],
    signed: [] as { path: string; expires: number }[],
    invocations: [] as { image_path: string }[],
    rpcs: [] as { name: string; args: { p_report_id: string; p_status?: ReportStatus } }[],
    refreshStarts: 0,
    refreshStops: 0,
    clientOptions: undefined as
      | undefined
      | {
          auth: {
            storage: unknown;
            lock: unknown;
            autoRefreshToken: boolean;
            persistSession: boolean;
            detectSessionInUrl: boolean;
          };
        },
    emit(event: string, session: Session | null) {
      backend.session = session;
      for (const listener of authListeners) listener(event, session);
    },
    holdNextReports() {
      const read = { started: deferred(), released: deferred() };
      reads.push(read);
      pendingReads.add(read.released);
      return {
        started: read.started.promise,
        release() {
          read.released.resolve();
          pendingReads.delete(read.released);
        },
      };
    },
    changeAppState(state: string) {
      for (const listener of appStateListeners) listener(state);
    },
    get subscriberCount() {
      return authListeners.size;
    },
  };
  const disk = {
    failNextDemoWrite: false,
    copies: [] as { from: string; to: string }[],
    deleted: [] as string[],
    base64Reads: [] as { uri: string; encoding: string }[],
    base64: '/9j/2Q==',
  };
  const storage = {
    async getItem(key: string) {
      return memory.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      if (disk.failNextDemoWrite && key.startsWith('@issue-reporter/demo/')) {
        disk.failNextDemoWrite = false;
        throw new Error('Local storage is full');
      }
      memory.set(key, value);
    },
    async removeItem(key: string) {
      memory.delete(key);
    },
  };
  const client = {
    auth: {
      async getSession() {
        return { data: { session: backend.session }, error: null };
      },
      onAuthStateChange(listener: (event: string, session: Session | null) => void) {
        authListeners.add(listener);
        return { data: { subscription: { unsubscribe: () => authListeners.delete(listener) } } };
      },
      async signInWithPassword(credentials: { email: string; password: string }) {
        backend.credentials.push(credentials);
        if (!backend.failures.auth) backend.emit('SIGNED_IN', LIVE_SESSION);
        return {
          data: { session: backend.failures.auth ? null : LIVE_SESSION },
          error: backend.failures.auth,
        };
      },
      async signUp(credentials: { email: string; password: string }) {
        backend.credentials.push(credentials);
        const session = backend.confirmationRequired || backend.failures.auth ? null : LIVE_SESSION;
        if (session) backend.emit('SIGNED_IN', session);
        return { data: { session }, error: backend.failures.auth };
      },
      async signOut(options: { scope: string }) {
        assert.equal(options.scope, 'local');
        if (!backend.failures.signOut) backend.emit('SIGNED_OUT', null);
        return { error: backend.failures.signOut };
      },
      async startAutoRefresh() {
        backend.refreshStarts += 1;
      },
      async stopAutoRefresh() {
        backend.refreshStops += 1;
      },
    },
    from(table: string) {
      switch (table) {
        case 'profiles':
          return {
            select(columns: string) {
              assert.equal(columns, 'is_admin');
              return {
                eq(column: string, id: string) {
                  assert.equal(column, 'id');
                  assert.equal(id, backend.session?.user.id);
                  return {
                    async maybeSingle() {
                      return {
                        data: { is_admin: backend.isAdmin },
                        error: backend.failures.profile,
                      };
                    },
                  };
                },
              };
            },
          };
        case 'reports':
          return {
            select(columns: string) {
              assert.equal(columns, '*, upvotes(user_id)');
              return {
                async order(column: string, options: { ascending: boolean }) {
                  assert.equal(column, 'created_at');
                  assert.equal(options.ascending, false);
                  // Capture the response BEFORE waiting, reproducing an old response arriving late.
                  const data = structuredClone(backend.rows);
                  const error = backend.failures.reports;
                  const read = reads.shift();
                  if (read) {
                    read.started.resolve();
                    await read.released.promise;
                  }
                  return { data, error };
                },
              };
            },
            insert(values: ReportInsert) {
              backend.reportInserts.push(structuredClone(values));
              assert.equal(values.user_id, backend.session?.user.id);
              assert.equal(values.status, 'Submitted');
              assert.match(
                values.image_url,
                new RegExp(`^${LIVE_USER_ID}/[A-Za-z0-9_.-]+\\.(jpg|jpeg|png|webp)$`),
              );
              assert.ok(backend.uploads.some((upload) => upload.path === values.image_url));
              return {
                select(columns: string) {
                  assert.equal(columns, '*');
                  return {
                    async single() {
                      // Mirror the shared SQL text constraints instead of silently accepting invalid fixtures.
                      const length = Array.from(values.description).length;
                      const error =
                        backend.failures.insert ??
                        (length < 10 || length > 2000
                          ? { message: 'reports_description_check violated (10..2000 characters)' }
                          : null);
                      if (error) return { data: null, error };
                      const row: ReportRow = {
                        ...values,
                        id: `inserted-report-${++sequence}`,
                        created_at: new Date().toISOString(),
                        upvotes: [],
                      };
                      backend.rows.unshift(row);
                      const { upvotes: _, ...data } = row;
                      return { data, error: null };
                    },
                  };
                },
              };
            },
          };
        case 'comments':
          return {
            select(columns: string) {
              assert.equal(columns, '*');
              return {
                eq(column: string, id: string) {
                  assert.equal(column, 'report_id');
                  return {
                    async order(column: string, options: { ascending: boolean }) {
                      assert.equal(column, 'created_at');
                      assert.equal(options.ascending, true);
                      return {
                        data: structuredClone(
                          backend.comments.filter((comment) => comment.report_id === id),
                        ),
                        error: null,
                      };
                    },
                  };
                },
              };
            },
            insert(values: CommentInsert) {
              backend.commentInserts.push(structuredClone(values));
              assert.equal(values.user_id, backend.session?.user.id);
              return {
                select(columns: string) {
                  assert.equal(columns, '*');
                  return {
                    async single() {
                      const length = Array.from(values.body).length;
                      if (length < 1 || length > 1000)
                        return {
                          data: null,
                          error: { message: 'comments_body_check violated (1..1000 characters)' },
                        };
                      const data: Comment = {
                        ...values,
                        id: `comment-${++sequence}`,
                        created_at: new Date().toISOString(),
                      };
                      backend.comments.push(data);
                      return { data, error: null };
                    },
                  };
                },
              };
            },
          };
        default:
          throw new Error(`Unexpected table: ${table}`);
      }
    },
    storage: {
      from(bucket: string) {
        assert.equal(bucket, 'report-images');
        return {
          async createSignedUrl(path: string, expires: number) {
            assert.ok(
              !path.startsWith('http'),
              'Signing must receive the stored object path, not a URL',
            );
            backend.signed.push({ path, expires });
            return {
              data: { signedUrl: `https://signed.example/${path}` },
              error: backend.failures.signing,
            };
          },
          async upload(
            path: string,
            bytes: ArrayBuffer,
            options: { contentType: string; upsert: boolean },
          ) {
            assert.ok(bytes instanceof ArrayBuffer);
            backend.uploads.push({ path, bytes, ...options });
            return { error: backend.failures.upload };
          },
          async remove(paths: string[]) {
            backend.removed.push(...paths);
            return { error: backend.failures.remove };
          },
        };
      },
    },
    async rpc(name: string, args: { p_report_id: string; p_status?: ReportStatus }) {
      backend.rpcs.push({ name, args });
      if (backend.failures.rpc) return { error: backend.failures.rpc };
      const row = backend.rows.find((item) => item.id === args.p_report_id);
      if (!row) return { error: { message: 'Report not found' } };
      const userId = backend.session?.user.id;
      if (!userId) return { error: { message: 'Authentication required' } };
      if (name === 'toggle_upvote') {
        row.upvotes = row.upvotes.some((vote) => vote.user_id === userId)
          ? row.upvotes.filter((vote) => vote.user_id !== userId)
          : [...row.upvotes, { user_id: userId }];
      } else if (name === 'set_report_status') {
        if (!backend.isAdmin) return { error: { message: 'Administrator access required' } };
        row.status = args.p_status!;
      } else throw new Error(`Unexpected RPC: ${name}`);
      return { error: null };
    },
    functions: {
      async invoke(name: string, options: { body: { image_path: string } }) {
        assert.equal(name, 'analyze-report');
        backend.invocations.push(options.body);
        return { data: backend.analysis, error: backend.failures.analysis };
      },
    },
  };
  const processLock = () => {};
  const mocks = {
    storage,
    supabase: {
      processLock,
      createClient(url: string, key: string, options: NonNullable<typeof backend.clientOptions>) {
        assert.equal(url, 'https://test.supabase.co');
        assert.equal(key, 'test-anon-key');
        backend.clientOptions = options;
        return client;
      },
    },
    native: {
      Platform: { OS: options.platform ?? 'ios' },
      AppState: {
        currentState: 'active',
        addEventListener(event: string, listener: (state: string) => void) {
          assert.equal(event, 'change');
          appStateListeners.add(listener);
          return { remove: () => appStateListeners.delete(listener) };
        },
      },
    },
    files: {
      documentDirectory: 'file:///documents/',
      EncodingType: { Base64: 'base64' },
      async readAsStringAsync(uri: string, options: { encoding: string }) {
        disk.base64Reads.push({ uri, ...options });
        return disk.base64;
      },
      async makeDirectoryAsync() {},
      async copyAsync(options: { from: string; to: string }) {
        disk.copies.push(options);
      },
      async deleteAsync(uri: string) {
        disk.deleted.push(uri);
      },
    },
  };
  const externalMocks: Record<string, string> = {
    '@react-native-async-storage/async-storage': 'storage',
    '@supabase/supabase-js': 'supabase',
    'react-native': 'native',
    'expo-file-system/legacy': 'files',
  };
  const plugin: Plugin = {
    name: 'data-test-boundaries',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (args.path in externalMocks || args.path === 'react-native-url-polyfill/auto')
          return { path: args.path, namespace: 'data-mocks' };
        return undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: 'data-mocks' }, (args) => ({
        contents:
          args.path === 'react-native-url-polyfill/auto'
            ? ''
            : `module.exports = __mocks.${externalMocks[args.path]};`,
        loader: 'js',
      }));
    },
  };
  const bundle = await build({
    entryPoints: [resolve('src/data/AppProvider.tsx')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', 'base64-arraybuffer'],
    plugins: [plugin],
    define: {
      'process.env.EXPO_PUBLIC_SUPABASE_URL': JSON.stringify(
        options.configured ? 'https://test.supabase.co' : '',
      ),
      'process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY': JSON.stringify(
        options.configured ? 'test-anon-key' : '',
      ),
    },
  });
  const module = { exports: {} };
  // An isolated bundle avoids both Node's module cache and global Module._load/env patches.
  new Function('require', 'module', 'exports', '__mocks', bundle.outputFiles[0].text)(
    createRequire(resolve('package.json')),
    module,
    module.exports,
    mocks,
  );
  const appModule = module.exports as typeof import('../../src/data/AppProvider');
  let current: AppContextValue | undefined;
  let renderer: ReactTestRenderer | undefined;
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

  function Probe() {
    current = appModule.useApp();
    return null;
  }
  async function run<T>(action: () => T | Promise<T>): Promise<T> {
    let result!: T;
    let failed = false;
    let failure: unknown;
    // Let act flush error-state updates before propagating an expected rejection to assert.rejects.
    await act(async () => {
      try {
        result = await action();
      } catch (error) {
        failed = true;
        failure = error;
      }
    });
    if (failed) throw failure;
    return result;
  }
  async function flushAuth() {
    // The provider deliberately schedules auth work outside Supabase's lock using setTimeout(0).
    await run(() => new Promise<void>((done) => setTimeout(done, 0)));
  }
  async function unmount() {
    if (renderer) {
      await run(() => renderer!.unmount());
      renderer = undefined;
      current = undefined;
    }
  }
  return {
    backend,
    disk,
    memory,
    storage,
    processLock,
    get app(): AppContextValue {
      assert.ok(current, 'Mount the provider before using its context');
      return current;
    },
    async mount() {
      assert.equal(renderer, undefined, 'Unmount before remounting');
      await run(() => {
        renderer = create(
          React.createElement(appModule.AppProvider, null, React.createElement(Probe)),
        );
      });
      await flushAuth();
      assert.equal(current?.ready, true, 'Initialization must finish');
    },
    unmount,
    run,
    flushAuth,
    async begin<T>(action: () => Promise<T>, started: Promise<void>) {
      let completion!: Promise<T>;
      await run(async () => {
        completion = action();
        void completion.catch(() => {}); // Rejections are asserted by the caller after releasing its gate.
        await started;
      });
      return { completion };
    },
    async dispose() {
      await run(() => {
        for (const read of pendingReads) read.resolve();
        pendingReads.clear();
      });
      await unmount();
      if (previousActEnvironment === undefined) delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
      else actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    },
  };
}
