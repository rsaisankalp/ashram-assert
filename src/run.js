import {
  AssetManagementService,
  InMemoryAshramRepository,
  InMemoryAssetRepository,
  InMemoryAssignmentRepository,
  InMemoryUserRepository,
} from './index.js';
import repl from 'repl';

async function main() {
  const repositories = {
    ashrams: new InMemoryAshramRepository(),
    users: new InMemoryUserRepository(),
    assignments: new InMemoryAssignmentRepository(),
    assets: new InMemoryAssetRepository(),
  };

  const service = new AssetManagementService(repositories);

  console.log('Service instantiated.');
  console.log('Registering admin user...');
  const admin = await service.registerUser({
    email: 'admin@example.com',
    password: 'supersecure',
    displayName: 'System Admin',
    roles: ['ADMIN'],
  });
  console.log('Admin user registered:', admin);

  console.log('Creating ashram...');
  const ashram = await service.createAshram({
    name: 'Pune Ashram',
    location: 'Pune',
    createdBy: admin.id,
  });
  console.log('Ashram created:', ashram);

  console.log('Registering caretaker user...');
  const caretaker = await service.registerUser({
    email: 'caretaker@pune.org',
    password: 'caretaker1',
    displayName: 'Caretaker',
    roles: ['ASHRAM_USER'],
  });
  console.log('Caretaker user registered:', caretaker);

  console.log('Assigning caretaker to ashram...');
  await service.assignUserToAshram({
    userId: caretaker.id,
    ashramId: ashram.id,
    roles: ['ASHRAM_USER'],
    requestedBy: admin.id,
  });
  console.log('Caretaker assigned to ashram.');

  console.log('Adding asset...');
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
  console.log('Asset added:', asset);

  console.log('\nStarting interactive REPL...');
  console.log('You can interact with the `service` object.');
  console.log('For example, try: await service.findAssetById(asset.id)');
  console.log('Or: await service.queryAssets({ ashramId: ashram.id })');
  
  const replServer = repl.start({ prompt: '> ' });
  replServer.context.service = service;
  replServer.context.admin = admin;
  replServer.context.ashram = ashram;
  replServer.context.caretaker = caretaker;
  replServer.context.asset = asset;
}

main().catch(console.error);