# Task Tracker deployment guide

This repository is prepared for GitHub-backed automatic deployments through Firebase App Hosting.

## 1. Publish the source to GitHub

Create a private, empty GitHub repository named `task-tracker`. Do not initialize it with a README or `.gitignore`, because both already exist locally.

```bash
cd /Users/chetankrishna/Documents/Codex/2026-07-20/i
git remote add origin https://github.com/YOUR_USERNAME/task-tracker.git
git push -u origin main
```

Confirm that the **Task Tracker CI** workflow passes in GitHub Actions.

## 2. Create the Firebase project

1. Create a Firebase project, for example `task-tracker-production`.
2. Register a Web app named **Task Tracker Web**.
3. Copy its public Firebase web configuration.
4. Upgrade to the Blaze plan if Firebase requests it for App Hosting.
5. Set a Google Cloud billing budget alert.

## 3. Enable authentication

In **Firebase → Authentication → Sign-in method**:

1. Enable Google sign-in and choose a support email.
2. Enable Email/Password sign-in.
3. Under **Settings → Authorized domains**, retain `localhost` and later add the generated App Hosting domain and any custom domain.

## 4. Create Firestore

Create the default Cloud Firestore database in **Production mode**. Choose a permanent region near the majority of users and, where possible, near the App Hosting backend.

## 5. Deploy Firestore rules and indexes

```bash
npm install --global firebase-tools
cd /Users/chetankrishna/Documents/Codex/2026-07-20/i
firebase login
firebase use --add
firebase deploy --only firestore
```

When `firebase use --add` asks for an alias, use `production`. The checked-in rules isolate groups and tasks under each authenticated user's UID.

## 6. Create the App Hosting backend

In **Firebase → Hosting & Serverless → App Hosting**:

1. Create a backend named `task-tracker`.
2. Connect the private GitHub repository.
3. Set the repository root directory to `/`.
4. Set the live branch to `main`.
5. Leave automatic rollouts enabled.
6. Select the latest recommended runtime compatible with Node.js 22.
7. Choose a region close to Firestore and the users.
8. Select the **Task Tracker Web** Firebase app.
9. Finish setup and allow the initial rollout to complete.

## 7. Add App Hosting environment variables

Open **App Hosting → View backend → Settings → Environment** and add:

```dotenv
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id
NEXT_PUBLIC_APP_URL=https://your-generated-hosted-app-url
NEXT_PUBLIC_USE_FIREBASE_EMULATORS=false
```

Leave `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY` unset until App Check has been registered. Save the variables and create another rollout.

## 8. Production verification

Verify all of the following:

- Email/password signup, login, password reset, and sign-out
- Google login
- Individual and bulk task creation
- Groups, group colors, priorities, and due dates
- Completion dates
- Confirmation before individual and multi-task deletion
- Reload persistence and cross-device synchronization
- Offline task creation followed by reconnection
- iPhone and iPad portrait, landscape, split-screen, and Home Screen installation
- Firestore documents appearing only below `users/{uid}`

## 9. Add App Check after the application works

Register the web app in **Firebase → App Check** with reCAPTCHA Enterprise, add the resulting site key as `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY`, and create another rollout. Monitor verified requests before enabling Firestore enforcement.

## 10. Future releases

Every push to `main` triggers an automatic App Hosting rollout:

```bash
git add -A
git commit -m "Describe the change"
git push origin main
```

For significant changes, use a branch and pull request so Task Tracker CI runs before merging to `main`.
