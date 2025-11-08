# Ashram Asset Management System

This repository implements an in-memory service layer for managing ashrams, users, and assets as described in the product requirements document. The codebase now uses plain ECMAScript modules so that it can run without external dependencies or a build step, making it easier to execute the full login and asset lifecycle tests in constrained environments.

## Features

- Secure user registration and login with salted password hashing.
- Role-aware creation of ashrams and assignment of caretakers and head-office staff.
- Asset onboarding with QR payload generation, category-specific metadata, and document tracking.
- Post-onboarding asset management so caretakers can edit asset details, attach additional documents, and schedule new reminders without re-creating records.
- Reminder scheduling and completion for insurance, maintenance, and other lifecycle events.
- Archiving and retention-aware deletion flows for sold or disposed assets.
- Query helpers plus dashboard summaries to surface assets by category, ashram, status, search terms, or upcoming reminders for both local and head-office views.
- Browser console that uses Firebase Authentication (Google sign-in) plus Firestore to exercise the PRD flows end-to-end.
- Optional Backblaze B2 integration for uploading asset documents directly from the browser (10 GB always-free tier).
- QR codes now deep-link back into the console (e.g., `/?assetId=...`). Scanning a code prompts the user to sign in and opens a detailed asset view if they have access.

## Setup and Execution

### 1. Prerequisites

- **Node.js 20 or later.** The project uses the built-in [`node --test`](https://nodejs.org/api/test.html) runner and native ESM modules, both of which are fully supported in Node 20+.
- **Git** for cloning the repository.

Check your installed Node.js version with:

```bash
node --version
```

If you need to install Node.js, download it from [nodejs.org](https://nodejs.org/en/download) or use a version manager such as [fnm](https://github.com/Schniz/fnm), [nvm](https://github.com/nvm-sh/nvm), or [asdf](https://asdf-vm.com/).

### 2. Clone the Repository

```bash
git clone https://github.com/<your-org>/ashram-assert.git
cd ashram-assert
```

### 3. Install Dependencies (optional)

The service layer intentionally avoids external packages, so `npm install` is not required. Running it will simply ensure a lockfile exists:

```bash
npm install
```

### 4. Run the Test Suite

Execute the end-to-end workflow tests that cover login, role assignments, asset lifecycle, reminders, and query scenarios:

```bash
npm test
```

### 5. Collect Coverage (optional)

Node's experimental coverage flag can provide rough insight into exercised lines:

```bash
npm run coverage
```

### 6. Try the Service Interactively

You can run a quick smoke test by executing the included example script with Node.js:

```bash
node ./tests/assetManagementService.test.js
```

The script prints assertion details; successful execution without thrown errors mirrors the automated tests.

## Browser UI (Firebase-backed Prototype)

The `web/` directory hosts a lightweight console that exercises the PRD inside a browser using Firebase Authentication and Firestore. The flow mirrors how admins and caretakers would manage real assets.

1. **Create / configure a Firebase project.**
   - Enable **Google** under *Authentication → Sign-in method*.
   - Create a Firestore database in *production* or *test* mode.
2. **Copy the sample configuration.**
   ```bash
   cp web/firebase-config.sample.js web/firebase-config.js
   ```
   - Update the exported `firebaseConfig` object with your project's values from *Project settings → General*.
   - Populate `defaultSuperAdmins` with the email addresses that should automatically receive `ADMIN` + `HEAD_OFFICE` roles the first time they sign in (the sample includes `rsaisankalp@gmail.com`).
3. **Bootstrap your first admin.**
   - Any email listed in `defaultSuperAdmins` is auto-promoted on first login, so you can skip manual role edits. Otherwise, sign in once and then set the `roles` field on `users/{uid}` via the Firestore console.
   - Subsequent role changes can be done through the in-app *Admin Workspace*.
4. **Run the local static server.**
   ```bash
   npm run web
   ```
5. **Open the console** at [http://localhost:4173](http://localhost:4173) and use Google sign-in.
   - Admins can create ashrams, assign caretakers/head-office viewers, and monitor cross-ashram dashboards.
   - Assigned caretakers can add assets (with QR payloads, reminders, and documents) constrained to their ashrams.

> **Heads-up:** The prototype writes directly to Firestore from the browser. For production deployments you should lock down security rules and migrate the in-memory service to Firebase Functions/Firestore to enforce RBAC on the server.

### Document Uploads via Backblaze B2 (optional)

1. Create a Backblaze account, enable **B2 Cloud Storage**, and create a bucket (10 GB always-free).
2. Generate an *Application Key* that has read/write access to that bucket.
3. Set the following environment variables before running `npm run web` (export in your shell or add to a `.env` file loaded by your shell). For `B2_DOWNLOAD_URL`, use the **Friendly URL** shown in Backblaze (looks like `https://f005.backblazeb2.com`), not the S3 endpoint:
   ```
   export B2_KEY_ID=yourKeyId
   export B2_APPLICATION_KEY=yourAppKey
   export B2_BUCKET_ID=yourBucketId
   export B2_BUCKET_NAME=yourBucketName
   export B2_DOWNLOAD_URL=https://f005.backblazeb2.com
   ```
4. Start the local server: `npm run web`. The `/api/upload` endpoint now proxies uploads to B2 (files are streamed through Node, no secrets in the browser).
5. In the asset form, use the **Upload File** control—documents are stored in B2 and the resulting URL is automatically attached to the asset record.

#### Keeping the bucket private with signed downloads

The UI now proxies document downloads through `/api/download`, which generates short-lived B2 download authorizations (5‑minute validity) so you can keep your bucket private:

1. Ensure your application key grants `readFiles` in addition to the upload capabilities.
2. No extra client configuration is needed—document links on the dashboard automatically hit `/api/download?path=...`, which issues a redirect to Backblaze with the authorization token appended.
3. Optionally, add CORS rules allowing your site to call the signed URLs:
   ```json
   [
     {
       "corsRuleName": "ashram-console",
       "allowedOrigins": ["http://127.0.0.1:4173", "http://localhost:4173"],
       "allowedHeaders": ["*"],
       "allowedOperations": ["b2_download_file_by_name"],
       "allowedResponseHeaders": ["*"],
       "maxAgeSeconds": 3600
     }
   ]
   ```
4. If you later host the UI on a public domain, add that origin to the CORS rule as well.

> Backblaze buckets are private by default. If you want caretakers to open files via the stored URL, set the bucket to “public” or issue signed URLs; for production, consider serving downloads through a backend that enforces RBAC.

## Usage Example

```js
import {
  AssetManagementService,
  InMemoryAshramRepository,
  InMemoryAssetRepository,
  InMemoryAssignmentRepository,
  InMemoryUserRepository,
} from 'ashram-assert';

const repositories = {
  ashrams: new InMemoryAshramRepository(),
  users: new InMemoryUserRepository(),
  assignments: new InMemoryAssignmentRepository(),
  assets: new InMemoryAssetRepository(),
};

const service = new AssetManagementService(repositories);

const admin = await service.registerUser({
  email: 'admin@example.com',
  password: 'supersecure',
  displayName: 'System Admin',
  roles: ['ADMIN'],
});

const ashram = await service.createAshram({
  name: 'Pune Ashram',
  location: 'Pune',
  createdBy: admin.id,
});

const caretaker = await service.registerUser({
  email: 'caretaker@pune.org',
  password: 'caretaker1',
  displayName: 'Caretaker',
  roles: ['ASHRAM_USER'],
});

await service.assignUserToAshram({
  userId: caretaker.id,
  ashramId: ashram.id,
  roles: ['ASHRAM_USER'],
  requestedBy: admin.id,
});

const asset = await service.addAsset({
  ashramId: ashram.id,
  name: 'Toyota Innova',
  category: 'CAR',
  purchaseDate: new Date('2024-01-10'),
  status: 'ACTIVE',
  reminders: [{ type: 'INSURANCE', dueDate: new Date('2025-01-09') }],
  documents: [{ name: 'Insurance', url: 'https://example.com/policy.pdf', category: 'INSURANCE' }],
  addedBy: caretaker.id,
});
```

## Documentation

- [Asset Management System PRD](docs/asset-management-system-prd.md)
