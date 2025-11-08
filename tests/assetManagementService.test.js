import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryAshramRepository,
  InMemoryAssignmentRepository,
  InMemoryAssetRepository,
  InMemoryUserRepository,
  AssetManagementService,
} from '../src/index.js';

function createService() {
  const ashrams = new InMemoryAshramRepository();
  const users = new InMemoryUserRepository();
  const assignments = new InMemoryAssignmentRepository();
  const assets = new InMemoryAssetRepository();
  const service = new AssetManagementService({ ashrams, users, assignments, assets });
  return { service, ashrams, users, assignments, assets };
}

test('user registration, login, and ashram assignment workflow', async () => {
  const { service, users, ashrams } = createService();

  const admin = await service.registerUser({
    email: 'admin@example.com',
    password: 'supersecure',
    displayName: 'System Admin',
    roles: ['ADMIN'],
  });

  const session = await service.login({ email: 'admin@example.com', password: 'supersecure' });
  assert.equal(session.userId, admin.id);
  assert.deepEqual(session.roles, ['ADMIN']);

  const ashram = await service.createAshram({
    name: 'Ganga Ashram',
    location: 'Rishikesh',
    createdBy: admin.id,
  });

  const manager = await service.registerUser({
    email: 'manager@ganga.org',
    password: 'managerpass',
    displayName: 'Ganga Manager',
    roles: ['ASHRAM_USER'],
  });

  await service.assignUserToAshram({
    userId: manager.id,
    ashramId: ashram.id,
    roles: ['ASHRAM_USER'],
    requestedBy: admin.id,
  });

  const updatedManager = await users.findById(manager.id);
  assert.ok(updatedManager.ashramIds.includes(ashram.id), 'manager assigned to ashram');

  const updatedAshram = await ashrams.findById(ashram.id);
  assert.ok(updatedAshram.userIds.includes(manager.id), 'ashram lists assigned user');

  const managerSession = await service.login({ email: 'manager@ganga.org', password: 'managerpass' });
  assert.equal(managerSession.userId, manager.id);
  assert.deepEqual(managerSession.roles, ['ASHRAM_USER']);
});

function createAsset(service, admin, user, ashram) {
  return service.addAsset({
    ashramId: ashram.id,
    name: 'Toyota Innova',
    category: 'CAR',
    purchaseDate: new Date('2023-04-18T00:00:00.000Z'),
    status: 'ACTIVE',
    owner: 'Ganga Ashram',
    metadata: { registration: 'UK07AB1234' },
    reminders: [
      {
        type: 'INSURANCE',
        dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        notes: 'Renew before expiry',
      },
      {
        type: 'MAINTENANCE',
        dueDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
      },
    ],
    documents: [
      {
        name: 'Insurance Policy',
        url: 'https://example.com/docs/innova-insurance.pdf',
        category: 'INSURANCE',
      },
      {
        name: 'RC Copy',
        url: 'https://example.com/docs/innova-rc.pdf',
        category: 'RC',
      },
    ],
    addedBy: user.id,
  });
}

test('asset lifecycle with reminders, QR codes, and retention deletion rules', async () => {
  const { service, assets } = createService();
  const admin = await service.registerUser({
    email: 'admin@example.com',
    password: 'supersecure',
    displayName: 'System Admin',
    roles: ['ADMIN'],
  });
  const ashram = await service.createAshram({
    name: 'Yamuna Ashram',
    location: 'Haridwar',
    createdBy: admin.id,
  });
  const caretaker = await service.registerUser({
    email: 'caretaker@yamuna.org',
    password: 'caretaker1',
    displayName: 'Yamuna Caretaker',
    roles: ['ASHRAM_USER'],
  });
  await service.assignUserToAshram({
    userId: caretaker.id,
    ashramId: ashram.id,
    roles: ['ASHRAM_USER'],
    requestedBy: admin.id,
  });

  const asset = await createAsset(service, admin, caretaker, ashram);
  assert.match(asset.assetTag, /^YAMU-CAR-0001$/);
  assert.ok(typeof asset.qrCode === 'string' && asset.qrCode.length > 0, 'qr code generated');

  const decoded = JSON.parse(Buffer.from(asset.qrCode, 'base64url').toString('utf8'));
  assert.equal(decoded.assetTag, asset.assetTag);
  assert.equal(decoded.category, 'CAR');

  const reminders = await service.getUpcomingReminders({
    ashramId: ashram.id,
    dueBefore: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  });
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].reminder.type, 'INSURANCE');

  const reminderToComplete = asset.reminders[0];
  const updatedAsset = await service.markReminderComplete({
    assetId: asset.id,
    reminderId: reminderToComplete.id,
    completedBy: caretaker.id,
  });
  const completedReminder = updatedAsset.reminders.find((item) => item.id === reminderToComplete.id);
  assert.ok(completedReminder.completed);
  assert.ok(completedReminder.completedAt instanceof Date);

  await service.archiveAsset({ assetId: asset.id, archivedBy: admin.id });
  const refreshed = await assets.findById(asset.id);
  assert.equal(refreshed.status, 'ARCHIVED');

  await assert.rejects(
    () => service.deleteAssetPermanently({ assetId: asset.id, requestedBy: admin.id, retentionDays: 30 }),
    /retention period has not elapsed/,
  );

  const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  await assets.update(asset.id, { archivedAt: fortyDaysAgo });
  const deleted = await service.deleteAssetPermanently({
    assetId: asset.id,
    requestedBy: admin.id,
    retentionDays: 30,
  });
  assert.equal(deleted, true);

  const remainingAssets = await service.listAssetsByAshram(ashram.id);
  assert.equal(remainingAssets.length, 0);
});

test('query interface filters across ashrams and categories', async () => {
  const { service } = createService();

  const admin = await service.registerUser({
    email: 'admin@example.com',
    password: 'supersecure',
    displayName: 'System Admin',
    roles: ['ADMIN', 'HEAD_OFFICE'],
  });

  const headOfficeSession = await service.login({ email: 'admin@example.com', password: 'supersecure' });
  assert.ok(headOfficeSession.token);

  const ganga = await service.createAshram({
    name: 'Ganga Ashram',
    location: 'Rishikesh',
    createdBy: admin.id,
  });
  const yamuna = await service.createAshram({
    name: 'Yamuna Ashram',
    location: 'Haridwar',
    createdBy: admin.id,
  });

  const gangaUser = await service.registerUser({
    email: 'ganga.user@example.com',
    password: 'gangapass',
    displayName: 'Ganga User',
    roles: ['ASHRAM_USER'],
  });
  await service.assignUserToAshram({
    userId: gangaUser.id,
    ashramId: ganga.id,
    roles: ['ASHRAM_USER'],
    requestedBy: admin.id,
  });

  const yamunaUser = await service.registerUser({
    email: 'yamuna.user@example.com',
    password: 'yamunapass',
    displayName: 'Yamuna User',
    roles: ['ASHRAM_USER'],
  });
  await service.assignUserToAshram({
    userId: yamunaUser.id,
    ashramId: yamuna.id,
    roles: ['ASHRAM_USER'],
    requestedBy: admin.id,
  });

  await service.addAsset({
    ashramId: ganga.id,
    name: 'Mahindra Bolero',
    category: 'CAR',
    purchaseDate: new Date('2022-11-10T00:00:00.000Z'),
    status: 'ACTIVE',
    owner: 'Ganga Ashram',
    reminders: [
      { type: 'INSURANCE', dueDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000) },
    ],
    documents: [],
    addedBy: gangaUser.id,
  });

  await service.addAsset({
    ashramId: ganga.id,
    name: 'HP Elitebook',
    category: 'LAPTOP',
    purchaseDate: new Date('2024-01-15T00:00:00.000Z'),
    status: 'ACTIVE',
    owner: 'Ganga Ashram',
    reminders: [
      { type: 'WARRANTY', dueDate: new Date('2026-01-14T00:00:00.000Z') },
    ],
    documents: [],
    addedBy: gangaUser.id,
  });

  await service.addAsset({
    ashramId: yamuna.id,
    name: 'LG Refrigerator',
    category: 'ELECTRICAL',
    purchaseDate: new Date('2021-06-01T00:00:00.000Z'),
    status: 'ACTIVE',
    owner: 'Yamuna Ashram',
    reminders: [
      { type: 'MAINTENANCE', dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) },
    ],
    documents: [],
    addedBy: yamunaUser.id,
  });

  const cars = await service.queryAssets({ category: 'CAR' });
  assert.equal(cars.length, 1);
  assert.equal(cars[0].name, 'Mahindra Bolero');

  const upcoming = await service.queryAssets({
    reminderDueBefore: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].name, 'LG Refrigerator');

  const searchLaptop = await service.queryAssets({ search: 'Elite' });
  assert.equal(searchLaptop.length, 1);
  assert.equal(searchLaptop[0].category, 'LAPTOP');

  const yamunaReminders = await service.getUpcomingReminders({
    ashramId: yamuna.id,
    dueBefore: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
  });
  assert.equal(yamunaReminders.length, 1);
  assert.equal(yamunaReminders[0].assetName, 'LG Refrigerator');
});

test('asset editing, documents, and reminders can be managed after creation', async () => {
  const { service } = createService();
  const admin = await service.registerUser({
    email: 'admin@example.com',
    password: 'supersecure',
    displayName: 'System Admin',
    roles: ['ADMIN', 'HEAD_OFFICE'],
  });
  const ashram = await service.createAshram({
    name: 'Yamuna Ashram',
    location: 'Haridwar',
    createdBy: admin.id,
  });
  const caretaker = await service.registerUser({
    email: 'caretaker@yamuna.org',
    password: 'caretaker1',
    displayName: 'Yamuna Caretaker',
    roles: ['ASHRAM_USER'],
  });
  await service.assignUserToAshram({
    userId: caretaker.id,
    ashramId: ashram.id,
    roles: ['ASHRAM_USER'],
    requestedBy: admin.id,
  });

  const asset = await createAsset(service, admin, caretaker, ashram);
  const updated = await service.updateAssetDetails({
    assetId: asset.id,
    updatedBy: caretaker.id,
    name: 'Toyota Innova Crysta',
    owner: 'Fleet Team',
    metadata: { registration: 'UK07AB1234', kms: 54000 },
  });
  assert.equal(updated.name, 'Toyota Innova Crysta');
  assert.equal(updated.owner, 'Fleet Team');
  assert.equal(updated.metadata.kms, 54000);

  const recategorized = await service.updateAssetDetails({
    assetId: asset.id,
    updatedBy: admin.id,
    category: 'ELECTRICAL',
    status: 'ARCHIVED',
  });
  assert.equal(recategorized.category, 'ELECTRICAL');
  assert.equal(recategorized.status, 'ARCHIVED');
  assert.ok(recategorized.archivedAt);
  assert.match(recategorized.assetTag, /^YAMU-ELE-0001$/);

  const reactivated = await service.updateAssetDetails({
    assetId: asset.id,
    updatedBy: admin.id,
    status: 'ACTIVE',
  });
  assert.equal(reactivated.status, 'ACTIVE');
  assert.equal(reactivated.archivedAt, null);

  const withDocs = await service.addDocumentToAsset({
    assetId: asset.id,
    addedBy: caretaker.id,
    documents: [
      {
        name: 'Road Tax Certificate',
        url: 'https://example.com/docs/innova-tax.pdf',
        category: 'OTHER',
      },
    ],
  });
  assert.equal(withDocs.documents.length, 3);

  const reminderAdded = await service.scheduleAssetReminder({
    assetId: asset.id,
    addedBy: caretaker.id,
    reminder: {
      type: 'MAINTENANCE',
      dueDate: new Date('2030-03-01T00:00:00.000Z'),
      notes: 'Quarterly service',
    },
  });
  assert.equal(reminderAdded.reminders.length, 3);

  const newReminder = reminderAdded.reminders.at(-1);
  const reminderUpdated = await service.updateAssetReminder({
    assetId: asset.id,
    reminderId: newReminder.id,
    updatedBy: caretaker.id,
    dueDate: new Date('2030-04-15T00:00:00.000Z'),
    notes: 'Rescheduled service',
  });
  const persistedReminder = reminderUpdated.reminders.find((item) => item.id === newReminder.id);
  assert.equal(persistedReminder.notes, 'Rescheduled service');
  assert.equal(
    persistedReminder.dueDate.toISOString(),
    new Date('2030-04-15T00:00:00.000Z').toISOString(),
  );
});

test('dashboards summarize ashram and head office inventories', async () => {
  const { service } = createService();
  const admin = await service.registerUser({
    email: 'admin@example.com',
    password: 'supersecure',
    displayName: 'System Admin',
    roles: ['ADMIN', 'HEAD_OFFICE'],
  });
  const ganga = await service.createAshram({
    name: 'Ganga Ashram',
    location: 'Rishikesh',
    createdBy: admin.id,
  });
  const yamuna = await service.createAshram({
    name: 'Yamuna Ashram',
    location: 'Haridwar',
    createdBy: admin.id,
  });

  const gangaUser = await service.registerUser({
    email: 'ganga.caretaker@example.com',
    password: 'gangapass',
    displayName: 'Ganga Caretaker',
    roles: ['ASHRAM_USER'],
  });
  await service.assignUserToAshram({
    userId: gangaUser.id,
    ashramId: ganga.id,
    roles: ['ASHRAM_USER'],
    requestedBy: admin.id,
  });

  const yamunaUser = await service.registerUser({
    email: 'yamuna.caretaker@example.com',
    password: 'yamunapass',
    displayName: 'Yamuna Caretaker',
    roles: ['ASHRAM_USER'],
  });
  await service.assignUserToAshram({
    userId: yamunaUser.id,
    ashramId: yamuna.id,
    roles: ['ASHRAM_USER'],
    requestedBy: admin.id,
  });

  await service.addAsset({
    ashramId: ganga.id,
    name: 'Mahindra Scorpio',
    category: 'CAR',
    purchaseDate: new Date('2023-01-01T00:00:00.000Z'),
    status: 'ACTIVE',
    owner: 'Ganga Ashram',
    reminders: [{ type: 'INSURANCE', dueDate: new Date('2030-01-15T00:00:00.000Z') }],
    documents: [],
    addedBy: gangaUser.id,
  });

  await service.addAsset({
    ashramId: ganga.id,
    name: 'Dell Latitude',
    category: 'LAPTOP',
    purchaseDate: new Date('2024-02-01T00:00:00.000Z'),
    status: 'ACTIVE',
    owner: 'Ganga Ashram',
    reminders: [{ type: 'WARRANTY', dueDate: new Date('2031-02-01T00:00:00.000Z') }],
    documents: [],
    addedBy: gangaUser.id,
  });

  await service.addAsset({
    ashramId: yamuna.id,
    name: 'LG Refrigerator',
    category: 'ELECTRICAL',
    purchaseDate: new Date('2022-05-05T00:00:00.000Z'),
    status: 'ACTIVE',
    owner: 'Yamuna Ashram',
    reminders: [{ type: 'MAINTENANCE', dueDate: new Date('2030-01-20T00:00:00.000Z') }],
    documents: [],
    addedBy: yamunaUser.id,
  });

  const jeep = await service.addAsset({
    ashramId: yamuna.id,
    name: 'Old Jeep',
    category: 'CAR',
    purchaseDate: new Date('2018-03-03T00:00:00.000Z'),
    status: 'ACTIVE',
    owner: 'Yamuna Ashram',
    reminders: [],
    documents: [],
    addedBy: yamunaUser.id,
  });
  await service.archiveAsset({ assetId: jeep.id, archivedBy: admin.id });

  const cutoff = new Date('2030-02-01T00:00:00.000Z');
  const gangaDashboard = await service.getAshramDashboard({
    ashramId: ganga.id,
    requestedBy: gangaUser.id,
    dueBefore: cutoff,
  });
  assert.equal(gangaDashboard.totalAssets, 2);
  assert.equal(gangaDashboard.countsByCategory.CAR, 1);
  assert.equal(gangaDashboard.countsByCategory.LAPTOP, 1);
  assert.equal(gangaDashboard.upcomingReminders.length, 1);
  assert.ok(gangaDashboard.assets.every((record) => record.status !== 'ARCHIVED'));

  const headOfficeDashboard = await service.getHeadOfficeDashboard({
    requestedBy: admin.id,
    filters: { status: 'ACTIVE' },
    dueBefore: cutoff,
  });
  assert.equal(headOfficeDashboard.totals.assets, 3);
  assert.equal(headOfficeDashboard.totals.ashrams, 2);
  assert.equal(headOfficeDashboard.countsByCategory.CAR, 1);
  assert.equal(headOfficeDashboard.countsByCategory.LAPTOP, 1);
  assert.equal(headOfficeDashboard.countsByCategory.ELECTRICAL, 1);
  assert.equal(headOfficeDashboard.upcomingReminders.length, 2);
  assert.equal(
    headOfficeDashboard.totals.remindersDue,
    headOfficeDashboard.upcomingReminders.length,
  );
  const gangaBreakdown = headOfficeDashboard.ashramBreakdown.find(
    (entry) => entry.ashramId === ganga.id,
  );
  const yamunaBreakdown = headOfficeDashboard.ashramBreakdown.find(
    (entry) => entry.ashramId === yamuna.id,
  );
  assert.ok(gangaBreakdown);
  assert.ok(yamunaBreakdown);
  assert.equal(gangaBreakdown.assetCount, 2);
  assert.equal(yamunaBreakdown.assetCount, 1);
  assert.equal(headOfficeDashboard.filters.status, 'ACTIVE');
});
