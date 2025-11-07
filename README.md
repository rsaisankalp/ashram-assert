# Ashram Asset Management System

This repository implements an in-memory service layer for managing ashrams, users, and assets as described in the product requirements document. The codebase now uses plain ECMAScript modules so that it can run without external dependencies or a build step, making it easier to execute the full login and asset lifecycle tests in constrained environments.

## Features

- Secure user registration and login with salted password hashing.
- Role-aware creation of ashrams and assignment of caretakers and head-office staff.
- Asset onboarding with QR payload generation, category-specific metadata, and document tracking.
- Reminder scheduling and completion for insurance, maintenance, and other lifecycle events.
- Archiving and retention-aware deletion flows for sold or disposed assets.
- Query helpers to surface assets by category, ashram, status, search terms, or upcoming reminders.

## Running the Test Suite

The project relies solely on Node.js built-ins. To execute the scenario coverage (login, assignment, asset lifecycle, reminders, and queries), run:

```bash
npm test
```

To gather experimental coverage information:

```bash
npm run coverage
```

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
