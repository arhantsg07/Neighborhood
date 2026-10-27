import type { Session } from '@supabase/supabase-js';
import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import {
  CATEGORIES,
  SEVERITIES,
  type Analysis,
  type Comment,
  type Report,
  type ReportDraft,
  type ReportStatus,
  type User,
} from '../types';

const BUCKET = 'report-images';

export function client() {
  if (!supabase) throw new Error('Supabase is not configured. Enter demo mode to explore the app.');
  return supabase;
}

export function uniqueId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export async function loadUser(session: Session): Promise<User> {
  const { data, error } = await client()
    .from('profiles')
    .select('is_admin')
    .eq('id', session.user.id)
    .maybeSingle();
  if (error) throw error;
  return {
    id: session.user.id,
    email: session.user.email ?? '',
    is_admin: data?.is_admin === true,
  };
}

export async function loadReports(userId: string): Promise<Report[]> {
  const { data, error } = await client()
    .from('reports')
    .select('*, upvotes(user_id)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return Promise.all(
    (data ?? []).map(async (row) => {
      const { data: image, error: imageError } = await client()
        .storage.from(BUCKET)
        .createSignedUrl(row.image_url, 3600);
      // One missing/inaccessible photo must not hide the entire community feed.
      const votes = (row.upvotes ?? []) as { user_id: string }[];
      return {
        id: row.id,
        user_id: row.user_id,
        image_url: imageError ? '' : (image?.signedUrl ?? ''),
        category: row.category,
        description: row.description,
        severity: row.severity,
        latitude: row.latitude,
        longitude: row.longitude,
        status: row.status,
        created_at: row.created_at,
        upvotes: votes.length,
        has_upvoted: votes.some((vote) => vote.user_id === userId),
      } satisfies Report;
    }),
  );
}

async function uploadImage(userId: string, uri: string): Promise<string> {
  let bytes: ArrayBuffer;
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error(`Could not read the image (HTTP ${response.status}).`);
    const blob = await response.blob();
    bytes = await blob.arrayBuffer();
  } else {
    bytes = decode(
      await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }),
    );
  }
  const header = new Uint8Array(bytes);
  if (!header.length) throw new Error('The selected image is empty. Choose another photo.');
  const png = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
  const jpeg = header[0] === 0xff && header[1] === 0xd8;
  const webp =
    String.fromCharCode(...header.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...header.slice(8, 12)) === 'WEBP';
  if (!png && !jpeg && !webp)
    throw new Error('Choose a JPEG, PNG, or WebP photo. Convert HEIC images before uploading.');
  const extension = png ? 'png' : webp ? 'webp' : 'jpg';
  const path = `${userId}/${uniqueId()}.${extension}`;
  const { error } = await client()
    .storage.from(BUCKET)
    .upload(path, bytes, {
      contentType: `image/${jpeg ? 'jpeg' : extension}`,
      upsert: false,
    });
  if (error) throw error;
  return path;
}

async function removeImage(path: string): Promise<void> {
  const { error } = await client().storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

export function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === 'object' && 'message' in error)
    return new Error(String(error.message));
  return new Error(
    typeof error === 'string' ? error : 'An unexpected error occurred. Please try again.',
  );
}

function withCleanupError(original: unknown, cleanup: unknown): Error {
  return new Error(
    `${asError(original).message} Also failed to remove the uploaded image: ${asError(cleanup).message}`,
  );
}

export async function insertReport(
  user: User,
  draft: ReportDraft,
  assertCurrent: () => void,
): Promise<Report> {
  const path = await uploadImage(user.id, draft.image_uri);
  let row: Omit<Report, 'upvotes' | 'has_upvoted'>;
  try {
    assertCurrent();
    const { data, error } = await client()
      .from('reports')
      .insert({
        user_id: user.id,
        image_url: path,
        category: draft.category,
        description: draft.description.trim(),
        severity: draft.severity,
        latitude: draft.latitude,
        longitude: draft.longitude,
        status: 'Submitted',
      })
      .select('*')
      .single();
    if (error) throw error;
    row = data;
  } catch (error) {
    try {
      await removeImage(path);
    } catch (cleanup) {
      throw withCleanupError(error, cleanup);
    }
    throw error;
  }
  // The insert has committed. Never delete its image if signing or a later refresh fails.
  const { data, error } = await client().storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error)
    throw new Error(
      `Report ${row.id} was saved, but its image could not be loaded: ${error.message}. Refresh instead of submitting again.`,
    );
  return { ...row, image_url: data.signedUrl, upvotes: 0, has_upvoted: false };
}

export async function loadComments(reportId: string): Promise<Comment[]> {
  const { data, error } = await client()
    .from('comments')
    .select('*')
    .eq('report_id', reportId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function insertComment(
  userId: string,
  reportId: string,
  body: string,
): Promise<Comment> {
  const { data, error } = await client()
    .from('comments')
    .insert({ user_id: userId, report_id: reportId, body })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function setStatus(reportId: string, status: ReportStatus): Promise<void> {
  const { error } = await client().rpc('set_report_status', {
    p_report_id: reportId,
    p_status: status,
  });
  if (error) throw error;
}

export async function toggleVote(reportId: string): Promise<void> {
  const { error } = await client().rpc('toggle_upvote', { p_report_id: reportId });
  if (error) throw error;
}

export async function analyze(
  userId: string,
  uri: string,
  assertCurrent: () => void,
): Promise<Analysis> {
  const path = await uploadImage(userId, uri);
  let analysis: Analysis | undefined;
  let failure: unknown;
  try {
    assertCurrent();
    const { data, error } = await client().functions.invoke('analyze-report', {
      body: { image_path: path },
    });
    if (error) {
      // FunctionsHttpError's generic message omits the actionable backend response.
      if (error.context instanceof Response) {
        const detail = await error.context.clone().text();
        throw new Error(`${error.message}${detail ? `: ${detail}` : ''}`);
      }
      throw error;
    }
    if (
      !data ||
      !CATEGORIES.includes(data.category) ||
      !SEVERITIES.includes(data.severity) ||
      typeof data.description !== 'string' ||
      !data.description.trim()
    ) {
      throw new Error(
        'The analysis service returned an invalid response. Please enter report details manually.',
      );
    }
    analysis = {
      category: data.category,
      description: data.description.trim(),
      severity: data.severity,
    };
    assertCurrent();
  } catch (error) {
    failure = error;
  }
  try {
    await removeImage(path);
  } catch (cleanup) {
    if (failure) throw withCleanupError(failure, cleanup);
    throw new Error(
      `Analysis completed, but its temporary image could not be removed: ${asError(cleanup).message}`,
    );
  }
  if (failure) throw failure;
  return analysis!;
}
