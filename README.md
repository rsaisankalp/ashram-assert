# Ashram Asset Management System

This repository implements an in-memory service layer for managing ashrams, users, and assets as described in the product requirements document. The codebase now uses plain ECMAScript modules so that it can run without external dependencies or a build step, making it easier to execute the full login and asset lifecycle tests in constrained environments.

## Features

- Secure user registration and login with salted password hashing.
- Role-aware creation of ashrams and assignment of caretakers and head-office staff.
- Asset onboarding with QR payload generation, category-specific metadata, and document tracking.
- Reminder scheduling and completion for insurance, maintenance, and other lifecycle events.
- Archiving and retention-aware deletion flows for sold or disposed assets.
- Query helpers to surface assets by category, ashram, status, search terms, or upcoming reminders.

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
