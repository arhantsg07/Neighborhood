# Neighborhood · Local Issue Reporter

A minimal React Native app for reporting everyday neighborhood problems. Built from the included project-plan PDF with **Expo, TypeScript, and Supabase**. Three tabs, no extra navigation library, and no simulated AI responses.

**First-time setup:** follow the [Supabase and Expo Go step-by-step guide](docs/SETUP_SUPABASE_AND_EXPO_GO.md) to open the app on your phone and connect real accounts and shared reports.

## What is implemented

| Area | Functionality |
| --- | --- |
| Explore | Community feed, search, category/status filters, newest/most-supported/nearest sorting, pull-to-refresh, Android/iOS map pins |
| Report | Camera or photo library, resized JPEGs, automatic foreground GPS, editable coordinates, category/severity/description, optional editable AI suggestions, similar open reports within 100 m |
| Details sheet | Photo, status, directions link, one support vote per account with undo, comments, admin-only status changes |
| Account | Email/password sign-up and sign-in, persisted sessions, My reports with status filters, sign-out |
| Safety | Client/database validation, row-level security, private storage with expiring image links, server-only AI key, authenticated and rate-limited AI endpoint, loading/error/empty states |
| Local demo | Persisted reports, photos, votes, comments, and testable administrator controls without credentials |

Status flow: **Submitted → In progress → Resolved**. Administrators can also correct/reopen a status. This is a community tracker, **not an official municipal integration or emergency service**.

## 1. Run it now — no backend required

Prerequisite: a current Node.js LTS release supported by Expo SDK 58 (Node 24 was used here), plus npm.

```sh
npm ci
npm start
```

- Install **Expo Go** on your phone and scan the QR code (iOS: Camera; Android: Expo Go). The phone and computer usually need to be on the same network. Use an Expo Go version supporting SDK 58; otherwise use an Expo development build.
- Press `a` for an already-configured Android emulator, or `i` for an iOS simulator on macOS.
- `npm run web` opens the browser version. Web uses the list instead of the embedded native map. Camera/GPS depend on browser support and require localhost or HTTPS.

With no Supabase variables, the app enters the local demo automatically. Demo data stays on the device, including your own photos; signing out does not erase it. The three initial reports are fictional and their remote Unsplash images are illustrative. Those images need an internet connection; failures show a placeholder. Clearing app storage resets the demo. AI is disabled in demo mode rather than returning made-up analysis.

### A useful five-minute demo

1. Open a community report. Support it and post a comment.
2. Try **Demo status controls** to move it to In progress.
3. Open **Report**, choose/take a photo, grant foreground location access (or enter coordinates), and describe the issue.
4. Review any nearby-duplicate suggestion, confirm sharing, and submit.
5. See your report on Explore and Account → My reports. Restart the app to check persistence.

## 2. Enable real accounts and shared reports

1. Create a Supabase project.
2. Apply `supabase/migrations/20261027000000_issue_reporter.sql` **once**, in the project's SQL editor. It creates the tables, permissions, functions, and private photo bucket. The CLI migration alternative is in [the backend guide](docs/BACKEND.md).
3. Copy `.env.example` to `.env`, then fill in:

   ```dotenv
   EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-project-anon-key
   ```

   Use the project's public **anon** key, never its service-role key. Public configuration is intentionally bundled; database policies protect the data.
4. Restart Expo with `npx expo start --clear`. If you were in the demo, choose Account → **Leave demo** to get to sign-in.
5. Create an account. With Supabase email confirmation enabled, confirm the email, then return and sign in. No in-app callback is required; configure a valid confirmation Site URL in Supabase. Production SMTP setup is explained in the backend guide.
6. To test status updates, make one account an administrator using the SQL in `docs/BACKEND.md`, then refresh/re-login. Ordinary members cannot change statuses, even through direct API requests.

**The live workflow has not been run against your Supabase project.** Follow the manual checklist below before sharing a build.

## 3. Enable optional real AI

Reporting works without AI. To enable photo categorization and description drafting:

- Add `OPENAI_API_KEY` to **Supabase Edge Function secrets**, not `.env` or any `EXPO_PUBLIC_*` variable.
- Deploy `supabase/functions/analyze-report` using the authenticated setup in [docs/BACKEND.md](docs/BACKEND.md#5-configure-and-deploy-ai-analysis).
- The function defaults to `gpt-4o-mini`; set server secret `OPENAI_MODEL` if you want another model supporting vision and strict structured output.
- Sign in to the live app, choose a photo, and tap **Suggest details with AI**. Always review its output.

The photo is uploaded to Supabase and sent to OpenAI only when that button is pressed. AI calls may incur provider charges and share photo content with that provider. The backend permits up to 10 attempts per signed-in user per rolling hour; failed attempts after quota reservation also count. Set provider budgets as well. Manual entry remains available if the provider is unavailable or the key is missing.

## 4. Android APK / standalone builds

Expo Go is enough to start learning. For an installable Android preview:

1. Create an Expo account and install/use the EAS CLI (`npx eas-cli login`, then `npx eas-cli build:configure`). CLI setup may add your own EAS project ID to app config.
2. Create a Google Cloud key with **Maps SDK for Android** enabled. Set `GOOGLE_MAPS_ANDROID_API_KEY` in the build environment; restrict it by Android package, signing certificate, and API. `app.config.ts` passes it to the native maps plugin. Without it, standalone Android displays a helpful fallback instead of trying to mount an unconfigured map. Expo Go supplies its own map setup. iOS uses Apple Maps by default.
3. Configure the two public Supabase variables in that same EAS environment if using live mode; local `.env` files are ignored by Git and should not be relied on for remote builds.
4. Run `npx eas-cli build --platform android --profile preview`. `eas.json` requests an internal APK. EAS/Google/Supabase/OpenAI may have plan limits, billing requirements, or charges. Review them before use.

Change the example `com.neighborhood.issuereporter` identifiers to identifiers you own before publishing. Native permission or map-key changes require a rebuild. Building/signing an APK and publishing to stores were not performed here.

## Project structure

```text
App.tsx                         app shell, three tabs, details sheet
src/screens/                    Explore, Report, Account, sign-in
src/components/                 reusable controls, report card, native map, details
src/types.ts                    small shared domain model
src/lib/reports.ts              validation, search/sorting, distance and duplicates
src/lib/location.ts             foreground GPS with a timeout
src/lib/supabase.ts             configured client and session persistence
src/data/AppProvider.tsx        shared state and actions (React Context)
src/data/demo.ts                local persisted demo data
src/data/live.ts                Supabase database/storage/function calls
supabase/migrations/             database schema, RLS, voting/status RPCs
supabase/functions/analyze-report/  authenticated server-side AI endpoint
tests/                          domain and mocked data-layer regression tests
docs/EXPLAINING_THE_APP.md       beginner-friendly walkthrough and demo script
```

There is intentionally no Redux, Zustand, TanStack Query, or router here. For three tabs and one details sheet, React state and Context are enough. Photos, location, and maps still use real native capabilities.

## Validation

```sh
npm run typecheck
npm test
npm run test:backend
npm run test:sql
npx expo export --platform web
npx expo export --platform android --platform ios
```

There are **44 app/domain/data tests and 15 AI-handler tests**, plus an embedded PostgreSQL regression suite for the migration, RLS, status/vote permissions, storage visibility, and AI quota. The SQL test stubs Supabase-owned Auth/Storage schemas, not their HTTP services. Network services are mocked in automated tests; that is not a substitute for testing your real Supabase project. The native export checks JavaScript bundling, **not a compiled device build**.

Optional browser end-to-end test (Chrome/Chromium must already be installed):

```sh
npx expo export --platform web
node tests/web-smoke.mjs
```

Set `CHROME_PATH` if Chrome is not at `/usr/bin/google-chrome`. This bounded test starts/stops its own local server and browser. It checks boot, voting, comments, status updates, form validation, photo upload, mocked GPS, nearby duplicates, My reports, and reload persistence. It substitutes the app icon for remote demo photos so it needs no internet. Generated `docs/screenshots/` are **browser test captures**, not device screenshots or AI-produced photos.

### Manual live/device checklist

- [ ] Fresh sign-up, confirmation, sign-in, relaunch, and sign-out work with your Auth configuration.
- [ ] Camera/library access works on a real device; denied permissions have a usable fallback.
- [ ] GPS coordinates are sensible; denied/slow GPS permits manual entry.
- [ ] Submit a real photo; a second account can load it and see the correct map pin.
- [ ] Vote/undo from both accounts; each account only has one vote.
- [ ] Comments and status changes are visible after refresh; non-admin status RPC is denied.
- [ ] AI succeeds with your key, returns editable fields, and handles missing keys/quota/provider failures.
- [ ] Native Android map works with the build's restricted Maps key; iOS map works on a device.
- [ ] Network interruption during submission is handled carefully: if the outcome is uncertain, refresh before submitting again.

## Deliberate boundaries

This is a small working MVP, not a city-scale service. It deliberately leaves out push notifications, background GPS, offline live-sync queues, automatic city/ward routing, and complex dashboards. “Nearest” sorts loaded reports by distance; it is not a geographic-radius feed. Refresh fetches shared updates; there are no realtime subscriptions. The current feed loads the available reports in one query (Supabase defaults to a row limit, usually 1,000); add pagination/geospatial queries before a large deployment. Duplicate detection is category + 100 m proximity, not image similarity. There is no password-recovery UI, user deletion UI, or report/comment editing/deletion yet.

Before a public release, add moderation/abuse reporting, recovery/account deletion and retention policies, stronger non-AI spam controls, operational monitoring, published privacy/terms, storage cleanup, and pagination. See the backend guide for authorization and cleanup details. Local session storage uses AsyncStorage, not encrypted storage; consider your threat model before a wider rollout.

### Dependency audit note

At implementation time, `npm audit` reports three high-severity entries along the `expo → @expo/cli → zod` tooling chain (GHSA-mrhx-c7xc-m3w5). Expo SDK 58's CLI declares Zod 3; npm's proposed forced fix changes Expo to an incompatible SDK. No forced downgrade or incompatible major override was applied. Track the upstream fix and re-run `npm audit` before release. Do not expose development tooling as a public service.
