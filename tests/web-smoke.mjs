// Run after `npx expo export --platform web`. Requires an installed Chrome/Chromium.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve('dist');
const contentTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const server = createServer(async (request, response) => {
  try {
    let path = resolve(
      root,
      `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`,
    );
    if (path !== root && !path.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    response.setHeader('Content-Type', contentTypes[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch {
    response.writeHead(404).end();
  }
});
let browser;
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    geolocation: { latitude: 37.7749, longitude: -122.4194 },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  const errors = [];
  async function scrollToTop() {
    await page.evaluate(() => {
      for (const element of document.querySelectorAll('*'))
        if (element instanceof HTMLElement) element.scrollTop = 0;
    });
  }
  page.on('pageerror', (error) => errors.push(error.message));
  // Network-independent test: sample-photo requests use the project's local icon.
  await page.route('https://images.unsplash.com/**', (route) =>
    route.fulfill({ path: 'assets/icon.png', contentType: 'image/png' }),
  );
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByText('A better neighborhood.', { exact: true }).waitFor();
  await mkdir('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/explore.png', fullPage: true });
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('button', { name: 'Garbage', exact: true }).click();
  await page.getByRole('textbox', { name: 'Find an issue', exact: true }).fill('park');
  await page.getByRole('button', { name: /Garbage, In progress/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Pothole, Submitted/ }).count(), 0);
  await page.getByRole('textbox', { name: 'Find an issue', exact: true }).fill('');
  await page.getByRole('button', { name: 'All', exact: true }).first().click();
  await page.getByRole('button', { name: 'Hide filters', exact: true }).click();
  await page.getByRole('button', { name: /Pothole, Submitted/ }).click();
  await page.getByRole('button', { name: '↑ Support this report (3)', exact: true }).click();
  await page.getByRole('button', { name: '✓ Supported · tap to undo (4)', exact: true }).waitFor();
  await page
    .getByRole('textbox', { name: 'Add a comment', exact: true })
    .fill('Smoke test: the issue is still visible.');
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await page.getByText('Smoke test: the issue is still visible.', { exact: true }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'In progress', exact: true }).click();
  await scrollToTop();
  await page.screenshot({ path: 'docs/screenshots/details.png', fullPage: true });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('tab', { name: 'Report', exact: true }).click();
  await page.getByRole('button', { name: 'Submit report', exact: true }).click();
  await page
    .getByText('Use GPS or enter valid latitude and longitude for this issue.', { exact: true })
    .waitFor();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose photo', exact: true }).click();
  await (await chooser).setFiles('assets/icon.png');
  await page.getByText('✓ Location is ready', { exact: true }).waitFor();
  await page
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('A dangerous pothole beside the neighborhood crossing.');
  await page.getByText('This may already be reported', { exact: true }).waitFor();
  await page
    .getByRole('switch', { name: 'Consent to share this photo and exact issue location' })
    .click();
  await scrollToTop();
  await page.screenshot({ path: 'docs/screenshots/report.png', fullPage: true });
  await page.getByRole('button', { name: 'Submit report', exact: true }).click();
  await page.getByText('Report details', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('tab', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: /Pothole, Submitted.*A dangerous pothole/ }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: /Pothole, Submitted.*A dangerous pothole/ }).waitFor();
  await page.getByRole('button', { name: /Pothole, In progress.*A deep pothole/ }).click();
  await page.getByRole('button', { name: '✓ Supported · tap to undo (4)', exact: true }).waitFor();
  await page.getByText('Smoke test: the issue is still visible.', { exact: true }).waitFor();
  assert.deepEqual(errors, [], `Unexpected browser errors: ${errors.join('; ')}`);
  console.log(
    'PASS: browser boot, search/filter, vote, comment, status, validation, photo/GPS report, duplicate warning, My reports, and reload persistence.',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
