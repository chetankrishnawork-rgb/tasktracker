# Task Tracker

Task Tracker is a private, offline-ready daily task tracker built with Next.js, Firebase Authentication, Cloud Firestore, and Progressive Web App capabilities.

## Product capabilities

- Individual and multiline bulk task creation
- Color-coded groups and priority levels
- Due dates and server-recorded completion dates
- Search and task views for today, upcoming, and completed work
- Confirmed individual and bulk deletion
- Per-user data isolation
- Realtime synchronization across devices
- Offline reads and queued writes through Firestore persistence
- One-time import of data from the original browser-only tracker release
- Installable phone and iPad PWA with safe-area and standalone-mode support

## Architecture

- **Source:** GitHub
- **Frontend:** Next.js 16 and React 19
- **Hosting:** Firebase App Hosting
- **Authentication:** Firebase Authentication with Google and email/password
- **Database:** Cloud Firestore
- **Offline:** Firestore IndexedDB persistence plus a service-worker app shell
- **Authorization:** Firestore Security Rules scoped to `users/{uid}`

## Local setup

1. Install Node.js 22 or later and pnpm.
2. Copy `.env.example` to `.env.local`.
3. Create a Firebase web app and paste its public configuration into `.env.local`.
4. Install dependencies and start the application:

   ```bash
   pnpm install
   pnpm dev
   ```

The application displays a configuration checklist instead of failing when Firebase values are absent.

## Firebase configuration

In the Firebase console:

1. Create a Firebase project and register a Web app.
2. Enable **Authentication → Sign-in method → Google**.
3. Enable **Authentication → Sign-in method → Email/Password**.
4. Create a Cloud Firestore database and choose the production region deliberately; it cannot be casually changed later.
5. Add local, App Hosting, and custom domains to Authentication authorized domains.
6. Recommended for production: register the web app with **App Check**, select reCAPTCHA Enterprise, and put its site key in `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY`. Start enforcement only after the App Check metrics show legitimate traffic is verified.
7. Install the Firebase CLI, associate the repository with the project, and deploy the checked-in rules:

   ```bash
   firebase login
   firebase use --add
   firebase deploy --only firestore
   ```

Security rules are defined in `firestore.rules`. Do not replace them with an allow-all development rule.

## GitHub and Firebase App Hosting deployment

The complete guided checklist is in `DEPLOYMENT.md`.

1. Create a private GitHub repository named `task-tracker`.
2. Push this directory to the repository's `main` branch.
3. In Firebase, open **App Hosting** and create a backend.
4. Connect the GitHub repository and select `main` as the live branch.
5. Add every variable from `.env.example` to the App Hosting environment, replacing blank values with the Firebase web-app configuration.
6. Set `NEXT_PUBLIC_APP_URL` to the assigned App Hosting URL or custom production domain.
7. Review the checked-in `apphosting.yaml` capacity limits, then trigger the first rollout.
8. Verify Authentication, Firestore writes, offline mode, and PWA installation.

Firebase web-app configuration is intentionally public; authorization is enforced by Authentication and Firestore Security Rules. Never commit a Firebase Admin service-account key.

## Suggested GitHub protections

- Require pull requests before merging to `main`.
- Require the included CI workflow to pass.
- Enable dependency alerts and two-factor authentication.
- Store administrative credentials in Firebase/Google Secret Manager, never in GitHub source.
- Use separate Firebase projects for development and production.

## Testing

```bash
pnpm test
pnpm lint
pnpm build
```

For rule integration testing, run the Firebase Emulator Suite using the ports configured in `firebase.json`. Production acceptance should include Safari on iPhone and iPad, an installed Home Screen launch, offline task creation, reconnection, and cross-device synchronization.

## Data model

```text
users/{uid}
users/{uid}/groups/{groupId}
users/{uid}/tasks/{taskId}
users/{uid}/meta/local-storage-v1
```

Task due dates are stored as `YYYY-MM-DD` calendar dates so they do not shift across time zones. Creation, update, and completion timestamps use Firestore server timestamps.
