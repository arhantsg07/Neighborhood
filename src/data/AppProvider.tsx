import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { validateReport } from '../lib/reports';
import {
  CATEGORIES,
  SEVERITIES,
  STATUSES,
  type Analysis,
  type Comment,
  type Report,
  type ReportDraft,
  type ReportStatus,
  type User,
} from '../types';
import {
  DEMO_USER,
  MODE_KEY,
  demoReports,
  keepDemoImage,
  readDemo,
  writeDemo,
  type DemoData,
} from './demo';
import * as live from './live';

export interface AppContextValue {
  user: User | null;
  mode: 'demo' | 'live';
  ready: boolean;
  loading: boolean;
  error: string | null;
  reports: Report[];
  refresh(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<string | void>;
  signOut(): Promise<void>;
  enterDemo(): Promise<void>;
  createReport(draft: ReportDraft): Promise<Report>;
  toggleUpvote(id: string): Promise<void>;
  getComments(reportId: string): Promise<Comment[]>;
  addComment(reportId: string, body: string): Promise<Comment>;
  updateStatus(id: string, status: ReportStatus): Promise<void>;
  analyzeImage(uri: string): Promise<Analysis>;
  clearError(): void;
}

export const AppContext = createContext<AppContextValue | undefined>(undefined);

type AppState = Pick<AppContextValue, 'user' | 'mode' | 'reports'>;
type Scope = { version: number; mode: AppState['mode']; user: User };

function validateCredentials(email: string, password: string): string {
  const normalized = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
    throw new Error('Enter a valid email address.');
  if (!password || !password.trim()) throw new Error('Enter your password.');
  return normalized;
}

function validateDraft(draft: ReportDraft): void {
  if (!draft.image_uri?.trim()) throw new Error('Select a photo for the report.');
  if (!CATEGORIES.includes(draft.category)) throw new Error('Select a valid category.');
  if (!SEVERITIES.includes(draft.severity)) throw new Error('Select a valid severity.');
  if (!draft.description?.trim()) throw new Error('Add a description of the issue.');
  const validationError = validateReport(draft);
  if (validationError) throw new Error(validationError);
}

function validateId(id: string): void {
  if (typeof id !== 'string' || !id.trim()) throw new Error('A report ID is required.');
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>({
    mode: isSupabaseConfigured ? 'live' : 'demo',
    user: null,
    reports: [],
  });
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const version = useRef(0);
  const mounted = useRef(true);
  const refreshes = useRef(0);
  const reportRequest = useRef(0);
  const authEvent = useRef(0);
  const demoQueue = useRef<Promise<void>>(Promise.resolve());
  const sessionSync = useRef<{ key: string; version: number; promise: Promise<void> } | null>(null);

  const commit = useCallback((next: AppState) => {
    stateRef.current = next;
    if (mounted.current) setState(next);
  }, []);

  const changeContext = useCallback(
    (mode: AppState['mode'], user: User | null) => {
      version.current += 1;
      const previous = stateRef.current;
      commit({
        mode,
        user,
        reports: previous.mode === mode && previous.user?.id === user?.id ? previous.reports : [],
      });
      return version.current;
    },
    [commit],
  );

  const syncSession = useCallback(
    (session: Session | null): Promise<void> => {
      if (!mounted.current || stateRef.current.mode !== 'live') return Promise.resolve();
      const key = session?.access_token ?? 'signed-out';
      const existing = sessionSync.current;
      if (existing?.key === key && existing.version === version.current) return existing.promise;
      const oldUser = stateRef.current.user;
      const initialUser = session
        ? oldUser?.id === session.user.id
          ? oldUser
          : { id: session.user.id, email: session.user.email ?? '', is_admin: false }
        : null;
      const current = changeContext('live', initialUser);
      const request = ++reportRequest.current;
      const promise = (async () => {
        if (!session) return;
        try {
          const [user, reports] = await Promise.all([
            live.loadUser(session),
            live.loadReports(session.user.id),
          ]);
          if (mounted.current && current === version.current) {
            commit({
              mode: 'live',
              user,
              reports: request === reportRequest.current ? reports : stateRef.current.reports,
            });
          }
        } catch (reason) {
          if (mounted.current && current === version.current)
            setError(live.asError(reason).message);
          // A subsequent refresh/sign-in should be able to retry this session.
          if (sessionSync.current?.version === current) sessionSync.current = null;
          throw live.asError(reason);
        }
      })();
      sessionSync.current = { key, version: current, promise };
      return promise;
    },
    [changeContext, commit],
  );

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    mounted.current = true;
    const initialize = async () => {
      try {
        const preference = await AsyncStorage.getItem(MODE_KEY);
        if (!active) return;
        if (preference === 'demo' || (!isSupabaseConfigured && preference !== 'demo-signed-out')) {
          const current = changeContext('demo', null);
          const data = await readDemo(DEMO_USER.id);
          if (active && current === version.current) {
            await AsyncStorage.setItem(MODE_KEY, 'demo');
            if (active && current === version.current)
              commit({ mode: 'demo', user: DEMO_USER, reports: demoReports(data, DEMO_USER.id) });
          }
        } else if (supabase) {
          changeContext('live', null);
        }
        if (!active) return;
        if (supabase) {
          const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'INITIAL_SESSION') return; // getSession below owns initialization.
            // Supabase invokes listeners under its auth lock. Never await backend work in that callback.
            const eventNumber = ++authEvent.current;
            setTimeout(() => {
              if (active && eventNumber === authEvent.current && stateRef.current.mode === 'live') {
                void syncSession(session).catch(() => {
                  /* syncSession exposes the error through context. */
                });
              }
            }, 0);
          });
          unsubscribe = () => subscription.subscription.unsubscribe();
          if (stateRef.current.mode === 'live') {
            const observedVersion = version.current;
            const observedEvent = authEvent.current;
            const { data, error: sessionError } = await supabase.auth.getSession();
            if (sessionError) throw sessionError;
            if (
              active &&
              observedVersion === version.current &&
              observedEvent === authEvent.current
            )
              await syncSession(data.session);
          }
        }
      } catch (reason) {
        if (active) setError(live.asError(reason).message);
      } finally {
        if (active) setReady(true);
      }
    };
    void initialize();
    return () => {
      active = false;
      mounted.current = false;
      version.current += 1;
      unsubscribe?.();
    };
  }, [changeContext, commit, syncSession]);

  async function perform<T>(action: () => Promise<T>): Promise<T> {
    setError(null);
    try {
      return await action();
    } catch (reason) {
      const failure = live.asError(reason);
      if (mounted.current) setError(failure.message);
      throw failure;
    }
  }

  function scope(): Scope {
    if (!ready) throw new Error('The app is still initializing. Please try again in a moment.');
    const { mode, user } = stateRef.current;
    if (!user) throw new Error('Sign in or enter demo mode to continue.');
    return { mode, user, version: version.current };
  }

  function assertCurrent(context: Scope): void {
    if (!mounted.current || context.version !== version.current)
      throw new Error('Your session changed. Please try again.');
  }

  function enqueueDemo<T>(action: () => Promise<T>): Promise<T> {
    const next = demoQueue.current.then(action);
    // Keep later operations runnable after a failed write; the caller still receives the rejection.
    demoQueue.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  function mutateDemo<T>(
    context: Scope,
    mutate: (data: DemoData) => T | Promise<T>,
    onPersist?: () => void,
  ): Promise<T> {
    return enqueueDemo(async () => {
      assertCurrent(context);
      const data = await readDemo(context.user.id);
      assertCurrent(context);
      const result = await mutate(data);
      assertCurrent(context);
      await writeDemo(context.user.id, data);
      onPersist?.();
      assertCurrent(context);
      commit({ ...stateRef.current, reports: demoReports(data, context.user.id) });
      return result;
    });
  }

  async function reloadLive(context: Scope): Promise<void> {
    assertCurrent(context);
    const request = ++reportRequest.current;
    const reports = await live.loadReports(context.user.id);
    assertCurrent(context);
    if (request === reportRequest.current) commit({ ...stateRef.current, reports });
  }

  const refresh = () =>
    perform(async () => {
      const context = scope();
      refreshes.current += 1;
      setLoading(true);
      try {
        if (context.mode === 'demo') {
          await enqueueDemo(async () => {
            assertCurrent(context);
            const data = await readDemo(context.user.id);
            assertCurrent(context);
            commit({ ...stateRef.current, reports: demoReports(data, context.user.id) });
          });
        } else {
          // Retry profile reads too, so a transient initialization failure does not hide admin controls forever.
          const { data, error: sessionError } = await live.client().auth.getSession();
          if (sessionError) throw sessionError;
          if (!data.session || data.session.user.id !== context.user.id)
            throw new Error('Your session expired. Please sign in again.');
          const user = await live.loadUser(data.session);
          assertCurrent(context);
          commit({ ...stateRef.current, user });
          await reloadLive(context);
        }
      } finally {
        refreshes.current -= 1;
        if (mounted.current && refreshes.current === 0) setLoading(false);
      }
    });

  async function activateLive(session: Session): Promise<void> {
    await AsyncStorage.setItem(MODE_KEY, 'live');
    if (stateRef.current.mode !== 'live') changeContext('live', null);
    await syncSession(session);
  }

  const signIn = (email: string, password: string) =>
    perform(async () => {
      const normalized = validateCredentials(email, password);
      const { data, error: authError } = await live
        .client()
        .auth.signInWithPassword({ email: normalized, password });
      if (authError) throw authError;
      await activateLive(data.session);
    });

  const signUp = (email: string, password: string) =>
    perform(async (): Promise<string | void> => {
      const normalized = validateCredentials(email, password);
      if (password.length < 6) throw new Error('Use a password with at least 6 characters.');
      const { data, error: authError } = await live
        .client()
        .auth.signUp({ email: normalized, password });
      if (authError) throw authError;
      if (!data.session) return 'Check your email to confirm your account, then sign in.';
      await activateLive(data.session);
    });

  const signOut = () =>
    perform(async () => {
      if (supabase) {
        const { error: authError } = await supabase.auth.signOut({ scope: 'local' });
        if (authError) throw authError;
      }
      // Keep demo records, but let the auth screen appear until enterDemo is explicitly chosen.
      await AsyncStorage.setItem(MODE_KEY, isSupabaseConfigured ? 'live' : 'demo-signed-out');
      changeContext(isSupabaseConfigured ? 'live' : 'demo', null);
    });

  const enterDemo = () =>
    perform(async () => {
      const current = changeContext('demo', null);
      await enqueueDemo(async () => {
        const data = await readDemo(DEMO_USER.id);
        if (current !== version.current) throw new Error('Your session changed. Please try again.');
        await AsyncStorage.setItem(MODE_KEY, 'demo');
        if (current !== version.current || !mounted.current)
          throw new Error('Your session changed. Please try again.');
        commit({ mode: 'demo', user: DEMO_USER, reports: demoReports(data, DEMO_USER.id) });
      });
    });

  const createReport = (draft: ReportDraft) =>
    perform(async () => {
      const context = scope();
      validateDraft(draft);
      if (context.mode === 'live') {
        const report = await live.insertReport(context.user, draft, () => assertCurrent(context));
        assertCurrent(context);
        // No second fetch: a refresh failure must not make a successful insert look like a failed submission.
        reportRequest.current += 1;
        commit({
          ...stateRef.current,
          reports: [report, ...stateRef.current.reports.filter((item) => item.id !== report.id)],
        });
        return report;
      }
      const image = await keepDemoImage(draft.image_uri);
      let persisted = false;
      try {
        return await mutateDemo(
          context,
          (data) => {
            const report: Report = {
              id: live.uniqueId(),
              user_id: context.user.id,
              image_url: image.uri,
              category: draft.category,
              description: draft.description.trim(),
              severity: draft.severity,
              latitude: draft.latitude,
              longitude: draft.longitude,
              status: 'Submitted',
              created_at: new Date().toISOString(),
              upvotes: 0,
              has_upvoted: false,
            };
            data.reports.unshift(report);
            data.votes[report.id] = [];
            return report;
          },
          () => {
            persisted = true;
          },
        );
      } catch (reason) {
        if (persisted) throw reason;
        try {
          await image.remove();
        } catch (cleanup) {
          throw new Error(
            `${live.asError(reason).message} Failed to clean up the local photo: ${live.asError(cleanup).message}`,
          );
        }
        throw reason;
      }
    });

  const toggleUpvote = (id: string) =>
    perform(async () => {
      const context = scope();
      validateId(id);
      if (context.mode === 'demo') {
        await mutateDemo(context, (data) => {
          if (!data.reports.some((report) => report.id === id))
            throw new Error('This report no longer exists.');
          const votes = data.votes[id] ?? [];
          data.votes[id] = votes.includes(context.user.id)
            ? votes.filter((userId) => userId !== context.user.id)
            : [...votes, context.user.id];
        });
      } else {
        await live.toggleVote(id);
        try {
          await reloadLive(context);
        } catch (reason) {
          throw new Error(
            `Your vote was updated, but reports could not be reloaded: ${live.asError(reason).message} Refresh instead of voting again.`,
          );
        }
      }
    });

  const getComments = (reportId: string) =>
    perform(async () => {
      const context = scope();
      validateId(reportId);
      if (context.mode === 'live') {
        const comments = await live.loadComments(reportId);
        assertCurrent(context);
        return comments;
      }
      return enqueueDemo(async () => {
        assertCurrent(context);
        const data = await readDemo(context.user.id);
        assertCurrent(context);
        if (!data.reports.some((report) => report.id === reportId))
          throw new Error('This report no longer exists.');
        return data.comments
          .filter((comment) => comment.report_id === reportId)
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
      });
    });

  const addComment = (reportId: string, body: string) =>
    perform(async () => {
      const context = scope();
      validateId(reportId);
      const text = body.trim();
      if (!text) throw new Error('Write a comment before posting.');
      if (text.length > 1000) throw new Error('Keep comments to 1,000 characters or fewer.');
      if (context.mode === 'live') {
        const comment = await live.insertComment(context.user.id, reportId, text);
        assertCurrent(context);
        return comment;
      }
      return mutateDemo(context, (data) => {
        if (!data.reports.some((report) => report.id === reportId))
          throw new Error('This report no longer exists.');
        const comment: Comment = {
          id: live.uniqueId(),
          report_id: reportId,
          user_id: context.user.id,
          body: text,
          created_at: new Date().toISOString(),
        };
        data.comments.push(comment);
        return comment;
      });
    });

  const updateStatus = (id: string, status: ReportStatus) =>
    perform(async () => {
      const context = scope();
      validateId(id);
      if (!STATUSES.includes(status)) throw new Error('Select a valid report status.');
      if (!context.user.is_admin) throw new Error('Only administrators can change report status.');
      if (context.mode === 'demo') {
        await mutateDemo(context, (data) => {
          const report = data.reports.find((item) => item.id === id);
          if (!report) throw new Error('This report no longer exists.');
          report.status = status;
        });
      } else {
        await live.setStatus(id, status);
        assertCurrent(context);
        reportRequest.current += 1;
        commit({
          ...stateRef.current,
          reports: stateRef.current.reports.map((report) =>
            report.id === id ? { ...report, status } : report,
          ),
        });
      }
    });

  const analyzeImage = (uri: string) =>
    perform(async () => {
      const context = scope();
      if (context.mode === 'demo')
        throw new Error(
          'AI image analysis is unavailable in demo mode. Configure Supabase and sign in to use it, or enter the report details manually.',
        );
      if (!uri?.trim()) throw new Error('Select a photo to analyze.');
      return live.analyze(context.user.id, uri, () => assertCurrent(context));
    });

  return (
    <AppContext.Provider
      value={{
        ...state,
        ready,
        loading,
        error,
        refresh,
        signIn,
        signUp,
        signOut,
        enterDemo,
        createReport,
        toggleUpvote,
        getComments,
        addComment,
        updateStatus,
        analyzeImage,
        clearError: () => setError(null),
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider.');
  return context;
}
