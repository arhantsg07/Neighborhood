import { createClient } from '@supabase/supabase-js';
import { createHandler, HttpError, type Backend } from './handler.ts';

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing backend configuration: ${name}`);
  return value;
}

function client(key: string, signal: AbortSignal, token?: string) {
  return createClient(required('SUPABASE_URL'), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      fetch: (input, init) => fetch(input, { ...init, signal, redirect: 'error' }),
    },
  });
}

const backend: Backend = {
  async getUser(token, signal) {
    const supabase = client(required('SUPABASE_ANON_KEY'), signal);
    // Explicit server-side verification works even when gateway verify_jwt=false.
    // Never use getSession(), raw JWT decoding, or user metadata for authorization.
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id };
  },
  async claim(userId, signal) {
    // Service role stays on the server and is used ONLY for the private quota RPC.
    const supabase = client(required('SUPABASE_SERVICE_ROLE_KEY'), signal);
    const { data, error } = await supabase.rpc('claim_ai_request', { p_user_id: userId });
    if (error || typeof data !== 'boolean') throw new Error('Quota store unavailable');
    return data;
  },
  async download(token, path, signal) {
    // Keep the caller's RLS context as defense in depth; do not download as service role.
    const supabase = client(required('SUPABASE_ANON_KEY'), signal, token);
    const { data, error } = await supabase.storage.from('report-images').download(path);
    if (error) {
      const status = Number(
        (error as { status?: number; statusCode?: string }).status ??
          (error as { statusCode?: string }).statusCode,
      );
      if (status === 400 || status === 403 || status === 404) return null;
      throw new HttpError(503, 'Image storage is unavailable. Please try again later.');
    }
    return data;
  },
};

Deno.serve(
  createHandler(backend, {
    apiKey: Deno.env.get('OPENAI_API_KEY') ?? '',
    model: Deno.env.get('OPENAI_MODEL')?.trim() || 'gpt-4o-mini',
    allowedOrigins: (Deno.env.get('ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  }),
);
