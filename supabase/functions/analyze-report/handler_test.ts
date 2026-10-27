// Runs without dependencies: node --experimental-strip-types --test <this file>
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createHandler,
  imageType,
  readLimited,
  validateAnalysis,
  validatePath,
  type Backend,
} from './handler.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const PATH = `${USER}/temporary-photo.jpg`;
const ANALYSIS = {
  category: 'Pothole',
  description: 'A visible pothole in the road.',
  severity: 'Medium',
};
const JPEG = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });

function fixture(
  options: {
    user?: { id: string } | null;
    quota?: boolean;
    blob?: Blob | null;
    provider?: Response;
    origins?: string[];
    key?: string;
    failClaim?: boolean;
  } = {},
) {
  const calls: { claims: string[]; downloads: string[]; providers: unknown[]; tokens: string[] } = {
    claims: [],
    downloads: [],
    providers: [],
    tokens: [],
  };
  const backend: Backend = {
    async getUser(token) {
      calls.tokens.push(token);
      return options.user === undefined ? { id: USER } : options.user;
    },
    async claim(id) {
      calls.claims.push(id);
      if (options.failClaim) throw new Error('Database down: do not expose this');
      return options.quota ?? true;
    },
    async download(token, path) {
      assert.equal(token, 'verified-token');
      calls.downloads.push(path);
      return options.blob === undefined ? JPEG : options.blob;
    },
  };
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, 'https://api.openai.com/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer server-secret');
    calls.providers.push(JSON.parse(String(init?.body)));
    return options.provider ?? providerResponse(ANALYSIS);
  };
  const handler = createHandler(
    backend,
    {
      apiKey: options.key ?? 'server-secret',
      model: 'gpt-4o-mini',
      allowedOrigins: options.origins ?? [],
    },
    fetcher,
  );
  return { handler, calls };
}

function providerResponse(value: unknown, finish = 'stop', refusal: string | null = null) {
  return Response.json({
    choices: [{ finish_reason: finish, message: { content: JSON.stringify(value), refusal } }],
  });
}

function request(body: unknown = { image_path: PATH }, headers: Record<string, string> = {}) {
  return new Request('https://example.test/functions/v1/analyze-report', {
    method: 'POST',
    headers: {
      authorization: 'Bearer verified-token',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test('success verifies token, claims verified ID, downloads own path, and returns only validated analysis', async () => {
  const { handler, calls } = fixture();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), ANALYSIS);
  assert.deepEqual(calls.tokens, ['verified-token']);
  assert.deepEqual(calls.claims, [USER]);
  assert.deepEqual(calls.downloads, [PATH]);
  const sent = calls.providers[0] as {
    model: string;
    response_format: { json_schema: { strict: boolean } };
    messages: { content: unknown }[];
  };
  assert.equal(sent.model, 'gpt-4o-mini');
  assert.equal(sent.response_format.json_schema.strict, true);
  assert.match(JSON.stringify(sent.messages[1]), /data:image\/jpeg;base64,/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('CORS preflight needs no JWT; disallowed browser origin is rejected', async () => {
  const { handler, calls } = fixture({ origins: ['https://app.example'] });
  const response = await handler(
    new Request('https://example.test', {
      method: 'OPTIONS',
      headers: { origin: 'https://app.example' },
    }),
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://app.example');
  assert.deepEqual(calls.tokens, []);
  const denied = await handler(request(undefined, { origin: 'https://evil.example' }));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
});

test('only POST is accepted', async () => {
  assert.equal((await fixture().handler(new Request('https://example.test'))).status, 405);
});

test('missing and unverifiable tokens cannot spend quota', async () => {
  for (const authorization of ['', 'Basic token', 'Bearer ', `Bearer ${'a'.repeat(8193)}`]) {
    const { handler, calls } = fixture();
    assert.equal((await handler(request(undefined, { authorization }))).status, 401);
    assert.deepEqual(calls.tokens, []);
    assert.deepEqual(calls.claims, []);
  }
  const { handler, calls } = fixture({ user: null });
  assert.equal((await handler(request())).status, 401);
  assert.deepEqual(calls.claims, []);
});

test('untrusted paths, URLs, unexpected fields and non-object bodies are rejected before quota', async () => {
  for (const body of [
    { image_path: 'https://evil.example/a.jpg' },
    { image_path: `22222222-2222-4222-8222-222222222222/photo.jpg` },
    { image_path: `${USER}/../photo.jpg` },
    { image_path: `${USER}/nested/photo.jpg` },
    { image_path: `${USER}/photo.jpg?secret=x` },
    { image_path: `${USER}/photo.svg` },
    { image_path: PATH, user_id: USER },
    {},
    [],
    null,
    { image_path: 123 },
  ]) {
    const { handler, calls } = fixture();
    assert.equal((await handler(request(body))).status, 400, JSON.stringify(body));
    assert.deepEqual(calls.claims, []);
  }
});

test('body size is bounded even without Content-Length', async () => {
  const { handler, calls } = fixture();
  assert.equal((await handler(request({ image_path: 'x'.repeat(2000) }))).status, 413);
  assert.deepEqual(calls.claims, []);
  assert.equal((await handler(request(undefined, { 'content-length': '999999' }))).status, 413);
});

test('malformed JSON and incorrect content type have actionable errors', async () => {
  const { handler } = fixture();
  assert.equal(
    (
      await handler(
        new Request('https://example.test', {
          method: 'POST',
          headers: { authorization: 'Bearer verified-token', 'content-type': 'application/json' },
          body: '{',
        }),
      )
    ).status,
    400,
  );
  assert.equal((await handler(request(undefined, { 'content-type': 'text/plain' }))).status, 415);
});

test('quota denial fails closed and makes no storage or provider request', async () => {
  const { handler, calls } = fixture({ quota: false });
  const response = await handler(request());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '3600');
  assert.deepEqual(calls.downloads, []);
  assert.deepEqual(calls.providers, []);
});

test('quota infrastructure failure fails closed without exposing details', async () => {
  const { handler, calls } = fixture({ failClaim: true });
  const response = await handler(request());
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /Database down/);
  assert.deepEqual(calls.downloads, []);
});

test('missing AI key gives no fake analysis and does not charge quota', async () => {
  const { handler, calls } = fixture({ key: '' });
  assert.equal((await handler(request())).status, 503);
  assert.deepEqual(calls.claims, []);
});

test('missing, empty, oversized, spoofed, and unsupported images never reach OpenAI', async () => {
  const cases: [Blob | null, number][] = [
    [null, 404],
    [new Blob(), 413],
    [new Blob([new Uint8Array(6 * 1024 * 1024 + 1)], { type: 'image/jpeg' }), 413],
    [new Blob(['not an image'], { type: 'image/jpeg' }), 415],
    [new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/png' }), 415],
  ];
  for (const [blob, expected] of cases) {
    const { handler, calls } = fixture({ blob });
    assert.equal((await handler(request())).status, expected);
    assert.equal(calls.claims.length, 1);
    assert.deepEqual(calls.providers, []);
  }
});

test('provider failures, refusals, truncation and invalid output produce errors, never fallback data', async () => {
  for (const provider of [
    new Response('sensitive upstream error', { status: 429 }),
    new Response('not JSON'),
    new Response('x'.repeat(33 * 1024)),
    providerResponse(ANALYSIS, 'length'),
    providerResponse(ANALYSIS, 'stop', 'Refused'),
    providerResponse({ ...ANALYSIS, category: 'Unknown' }),
    providerResponse({ ...ANALYSIS, severity: 'Critical' }),
    providerResponse({ ...ANALYSIS, description: 'short' }),
    providerResponse({ ...ANALYSIS, description: 'x'.repeat(2001) }),
    providerResponse({ ...ANALYSIS, extra: true }),
  ]) {
    const { handler } = fixture({ provider });
    const response = await handler(request());
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /sensitive upstream error|server-secret/);
  }
});

test('description bounds count Unicode code points as PostgreSQL does', () => {
  assert.equal(
    validateAnalysis({ ...ANALYSIS, description: `  ${'😀'.repeat(2000)}  ` }).description,
    '😀'.repeat(2000),
  );
  assert.throws(() => validateAnalysis({ ...ANALYSIS, description: '😀'.repeat(2001) }));
  assert.throws(() => validateAnalysis({ ...ANALYSIS, description: ' '.repeat(10) }));
});

test('image signature detection and path validation', () => {
  assert.equal(imageType(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])), 'image/png');
  assert.equal(imageType(new TextEncoder().encode('RIFF1234WEBP')), 'image/webp');
  assert.equal(imageType(new Uint8Array()), null);
  assert.equal(validatePath(PATH, USER), PATH);
});

test('bounded stream reading honors abort and rejects oversize content', async () => {
  const controller = new AbortController();
  const pending = readLimited(new ReadableStream({ start() {} }), 10, controller.signal, 413);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(
    readLimited(new Blob(['too long']).stream(), 1, new AbortController().signal, 413),
  );
});
