import AsyncStorage from '@react-native-async-storage/async-storage';
import { encode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { CATEGORIES, SEVERITIES, STATUSES, type Comment, type Report, type User } from '../types';
import { uniqueId } from './live';

export const MODE_KEY = '@issue-reporter/mode/v1';
export const DEMO_USER: User = {
  id: 'local-demo-user',
  email: 'demo@local.example',
  is_admin: true,
};

export interface DemoData {
  version: 1;
  reports: Report[];
  comments: Comment[];
  votes: Record<string, string[]>;
}

function storageKey(userId: string): string {
  return `@issue-reporter/demo/v1/${userId}`;
}

function seed(): DemoData {
  const createdAt = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();
  return {
    version: 1,
    reports: [
      {
        id: 'demo-pothole',
        user_id: 'demo-neighbor-1',
        image_url:
          'https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=1000&auto=format&fit=crop',
        category: 'Pothole',
        description:
          'A deep pothole near the crosswalk on Market Street. Cyclists are swerving into traffic to avoid it.',
        severity: 'High',
        latitude: 37.7749,
        longitude: -122.4194,
        status: 'Submitted',
        created_at: createdAt(3),
        upvotes: 0,
        has_upvoted: false,
      },
      {
        id: 'demo-garbage',
        user_id: 'demo-neighbor-2',
        image_url:
          'https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?w=1000&auto=format&fit=crop',
        category: 'Garbage',
        description:
          'Overflowing bins beside the neighborhood park entrance. Please arrange an extra collection.',
        severity: 'Medium',
        latitude: 37.7694,
        longitude: -122.4862,
        status: 'In progress',
        created_at: createdAt(18),
        upvotes: 0,
        has_upvoted: false,
      },
      {
        id: 'demo-streetlight',
        user_id: DEMO_USER.id,
        image_url:
          'https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=1000&auto=format&fit=crop',
        category: 'Streetlight',
        description:
          'The streetlight by the bus stop was flickering at night. The maintenance team has replaced the lamp.',
        severity: 'Low',
        latitude: 37.784,
        longitude: -122.409,
        status: 'Resolved',
        created_at: createdAt(46),
        upvotes: 0,
        has_upvoted: false,
      },
    ],
    votes: {
      'demo-pothole': ['demo-neighbor-2', 'demo-neighbor-3', 'demo-neighbor-4'],
      'demo-garbage': ['demo-neighbor-1', 'demo-neighbor-3'],
      'demo-streetlight': ['demo-neighbor-2'],
    },
    comments: [
      {
        id: 'demo-comment-1',
        report_id: 'demo-pothole',
        user_id: 'demo-neighbor-2',
        body: 'This is especially hard to see after dark.',
        created_at: createdAt(2),
      },
      {
        id: 'demo-comment-2',
        report_id: 'demo-streetlight',
        user_id: DEMO_USER.id,
        body: 'Confirmed: the light is working again. Thank you!',
        created_at: createdAt(5),
      },
    ],
  };
}

export function demoReports(data: DemoData, userId: string): Report[] {
  return data.reports
    .map((report) => {
      const votes = data.votes[report.id] ?? [];
      return { ...report, upvotes: votes.length, has_upvoted: votes.includes(userId) };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function readDemo(userId: string): Promise<DemoData> {
  const saved = await AsyncStorage.getItem(storageKey(userId));
  if (saved === null) {
    const data = seed();
    await writeDemo(userId, data);
    return data;
  }
  try {
    const data = JSON.parse(saved) as DemoData;
    if (
      data.version !== 1 ||
      !Array.isArray(data.reports) ||
      !Array.isArray(data.comments) ||
      !data.votes ||
      typeof data.votes !== 'object' ||
      Array.isArray(data.votes)
    )
      throw new Error('Invalid shape');
    if (
      !data.reports.every(
        (report) =>
          typeof report.id === 'string' &&
          typeof report.user_id === 'string' &&
          typeof report.image_url === 'string' &&
          typeof report.description === 'string' &&
          typeof report.created_at === 'string' &&
          Number.isFinite(report.latitude) &&
          Number.isFinite(report.longitude) &&
          CATEGORIES.includes(report.category) &&
          SEVERITIES.includes(report.severity) &&
          STATUSES.includes(report.status),
      ) ||
      !data.comments.every(
        (comment) =>
          typeof comment.id === 'string' &&
          typeof comment.report_id === 'string' &&
          typeof comment.user_id === 'string' &&
          typeof comment.body === 'string' &&
          typeof comment.created_at === 'string',
      ) ||
      !Object.values(data.votes).every(
        (votes) => Array.isArray(votes) && votes.every((id) => typeof id === 'string'),
      )
    )
      throw new Error('Invalid records');
    return data;
  } catch {
    throw new Error(
      'Saved demo data is invalid. It has not been overwritten. Clear this app’s local storage to reset the demo.',
    );
  }
}

export async function writeDemo(userId: string, data: DemoData): Promise<void> {
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(data));
}

// Picker cache files can disappear between launches; keep demo photos in durable storage.
export async function keepDemoImage(
  uri: string,
): Promise<{ uri: string; remove: () => Promise<void> }> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error(`Could not read the image (HTTP ${response.status}).`);
    const blob = await response.blob();
    const type = blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
    return {
      uri: `data:${type};base64,${encode(await blob.arrayBuffer())}`,
      remove: async () => {},
    };
  }
  if (!FileSystem.documentDirectory)
    throw new Error('Persistent local image storage is unavailable on this device.');
  const directory = `${FileSystem.documentDirectory}demo-report-images/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const extension = uri.split('?')[0].match(/\.(jpe?g|png|webp|heic)$/i)?.[1] ?? 'jpg';
  const destination = `${directory}${uniqueId()}.${extension}`;
  await FileSystem.copyAsync({ from: uri, to: destination });
  return {
    uri: destination,
    remove: () => FileSystem.deleteAsync(destination, { idempotent: true }),
  };
}
