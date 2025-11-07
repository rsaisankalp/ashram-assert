import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from '../utils/password.js';
import {
  assertArray,
  assertDate,
  assertEmail,
  assertEnum,
  assertPositiveInteger,
  assertString,
} from '../utils/validators.js';

const USER_ROLES = ['ADMIN', 'ASHRAM_USER', 'HEAD_OFFICE'];
const ASSET_STATUSES = ['ACTIVE', 'ARCHIVED', 'SOLD'];
const REMINDER_TYPES = ['INSURANCE', 'TAX', 'MAINTENANCE', 'WARRANTY', 'CUSTOM'];
const DOCUMENT_CATEGORIES = ['INVOICE', 'WARRANTY', 'RC', 'INSURANCE', 'PHOTO', 'OTHER'];

export class AssetManagementService {
  constructor({ ashrams, users, assignments, assets }) {
    this.ashrams = ashrams;
    this.users = users;
    this.assignments = assignments;
    this.assets = assets;
    this.sessions = new Map();
    this.assetCounters = new Map();
  }

  async registerUser({ email, password, displayName, roles }) {
    const normalizedEmail = assertEmail(email);
    const uniqueRoles = [...new Set(assertArray(roles ?? [], 'Roles'))];
    if (uniqueRoles.length === 0) {
      throw new Error('At least one role must be provided');
    }
    for (const role of uniqueRoles) {
      assertEnum(role, USER_ROLES, 'Role');
    }
    const existing = await this.users.findByEmail(normalizedEmail);
    if (existing) {
      throw new Error('User with this email already exists');
    }
    const user = await this.users.create({
      id: randomUUID(),
      email: normalizedEmail,
      displayName: assertString(displayName, 'Display name'),
      passwordHash: hashPassword(password),
      roles: uniqueRoles,
      ashramIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: null,
    });
    return user;
  }

  async login({ email, password }) {
    const normalizedEmail = assertEmail(email);
    const user = await this.users.findByEmail(normalizedEmail);
    if (!user) {
      throw new Error('Invalid credentials');
    }
    const isValid = verifyPassword(password, user.passwordHash);
    if (!isValid) {
      throw new Error('Invalid credentials');
    }
    await this.users.update(user.id, { lastLoginAt: new Date() });
    const token = randomUUID();
    const session = { token, userId: user.id, issuedAt: new Date(), roles: [...user.roles] };
    this.sessions.set(token, session);
    return session;
  }

  async getUserSession(token) {
    return this.sessions.get(token) ?? null;
  }

  async createAshram({ name, location, createdBy }) {
    const actor = await this.requireUser(createdBy);
    this.requireAnyRole(actor, ['ADMIN', 'HEAD_OFFICE']);
    const record = await this.ashrams.create({
      id: randomUUID(),
      name: assertString(name, 'Ashram name'),
      location: location ? assertString(location, 'Location') : undefined,
      userIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return record;
  }

  async assignUserToAshram({ userId, ashramId, roles, requestedBy }) {
    const actor = await this.requireUser(requestedBy);
    this.requireAnyRole(actor, ['ADMIN', 'HEAD_OFFICE']);

    const ashram = await this.requireAshram(ashramId);
    const user = await this.requireUser(userId);
    const uniqueRoles = [...new Set(assertArray(roles, 'Roles for assignment'))];
    for (const role of uniqueRoles) {
      assertEnum(role, USER_ROLES, 'Assignment role');
    }

    if (!user.ashramIds.includes(ashramId)) {
      user.ashramIds.push(ashramId);
      await this.users.update(user.id, { ashramIds: user.ashramIds });
    }
    if (!ashram.userIds.includes(userId)) {
      ashram.userIds.push(userId);
      await this.ashrams.update(ashram.id, { userIds: ashram.userIds });
    }

    return this.assignments.create({
      id: randomUUID(),
      userId: user.id,
      ashramId: ashram.id,
      roles: uniqueRoles,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async addAsset({
    ashramId,
    name,
    category,
    purchaseDate,
    status = 'ACTIVE',
    owner,
    metadata = {},
    reminders = [],
    documents = [],
    addedBy,
  }) {
    const actor = await this.requireUser(addedBy);
    this.requireAssignment(actor.id, ashramId);

    const ashram = await this.requireAshram(ashramId);
    const normalizedCategory = assertEnum(category, ['CAR', 'ELECTRICAL', 'LAPTOP', 'FURNITURE', 'OTHER'], 'Asset category');
    const normalizedStatus = assertEnum(status, ASSET_STATUSES, 'Asset status');
    const validatedName = assertString(name, 'Asset name');
    const assetPurchaseDate = assertDate(purchaseDate, 'Purchase date');
    const ownerName = owner ? assertString(owner, 'Owner') : undefined;

    const preparedReminders = reminders.map((reminder) => ({
      id: randomUUID(),
      type: assertEnum(reminder.type, REMINDER_TYPES, 'Reminder type'),
      dueDate: assertDate(reminder.dueDate, 'Reminder due date'),
      notes: reminder.notes ? assertString(reminder.notes, 'Reminder notes') : undefined,
      completed: Boolean(reminder.completed ?? false),
      completedAt: reminder.completed ? new Date() : null,
    }));

    const preparedDocuments = documents.map((doc) => ({
      id: randomUUID(),
      name: assertString(doc.name, 'Document name'),
      url: assertString(doc.url, 'Document URL'),
      category: assertEnum(doc.category, DOCUMENT_CATEGORIES, 'Document category'),
      uploadedAt: new Date(),
    }));

    const assetTag = this.generateAssetTag(ashram, normalizedCategory);
    const qrPayload = this.generateQrPayload({
      ashramId: ashram.id,
      assetName: validatedName,
      assetTag,
      category: normalizedCategory,
    });

    const asset = await this.assets.create({
      id: randomUUID(),
      ashramId: ashram.id,
      name: validatedName,
      category: normalizedCategory,
      assetTag,
      purchaseDate: assetPurchaseDate,
      status: normalizedStatus,
      owner: ownerName,
      metadata,
      reminders: preparedReminders,
      documents: preparedDocuments,
      qrCode: qrPayload,
      createdBy: actor.id,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
      deletedAt: null,
    });
    return asset;
  }

  generateAssetTag(ashram, category) {
    const countersForAshram = this.assetCounters.get(ashram.id) ?? new Map();
    const currentCount = countersForAshram.get(category) ?? 0;
    const nextCount = currentCount + 1;
    countersForAshram.set(category, nextCount);
    this.assetCounters.set(ashram.id, countersForAshram);
    const suffix = String(nextCount).padStart(4, '0');
    const normalizedAshram = ashram.name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'ASHR';
    const normalizedCategory = category.toUpperCase().slice(0, 3);
    return `${normalizedAshram}-${normalizedCategory}-${suffix}`;
  }

  generateQrPayload(data) {
    const payload = {
      ...data,
      generatedAt: new Date().toISOString(),
    };
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  }

  async listAssetsByAshram(ashramId) {
    return this.assets.listByAshramId(assertString(ashramId, 'Ashram ID'));
  }

  async queryAssets({ category, status, ashramId, reminderDueBefore, search }) {
    const allAssets = await this.assets.list();
    return allAssets.filter((asset) => {
      if (category && asset.category !== category) return false;
      if (status && asset.status !== status) return false;
      if (ashramId && asset.ashramId !== ashramId) return false;
      if (search) {
        const term = search.toLowerCase();
        const matches =
          asset.name.toLowerCase().includes(term) ||
          asset.assetTag.toLowerCase().includes(term) ||
          (asset.owner ?? '').toLowerCase().includes(term);
        if (!matches) return false;
      }
      if (reminderDueBefore) {
        const dueDate = assertDate(reminderDueBefore, 'Reminder due before');
        const hasDueReminder = asset.reminders.some(
          (reminder) => !reminder.completed && reminder.dueDate <= dueDate,
        );
        if (!hasDueReminder) return false;
      }
      return true;
    });
  }

  async getUpcomingReminders({ ashramId, dueBefore }) {
    const assets = ashramId
      ? await this.assets.listByAshramId(ashramId)
      : await this.assets.list();
    const cutoff = assertDate(dueBefore, 'Reminder cutoff');
    const reminders = [];
    for (const asset of assets) {
      for (const reminder of asset.reminders) {
        if (!reminder.completed && reminder.dueDate <= cutoff) {
          reminders.push({
            assetId: asset.id,
            assetName: asset.name,
            assetTag: asset.assetTag,
            ashramId: asset.ashramId,
            reminder,
          });
        }
      }
    }
    reminders.sort((a, b) => a.reminder.dueDate - b.reminder.dueDate);
    return reminders;
  }

  async markReminderComplete({ assetId, reminderId, completedBy }) {
    await this.requireUser(completedBy);
    const asset = await this.assets.findById(assertString(assetId, 'Asset ID'));
    if (!asset) {
      throw new Error('Asset not found');
    }
    const reminder = asset.reminders.find((item) => item.id === reminderId);
    if (!reminder) {
      throw new Error('Reminder not found');
    }
    if (reminder.completed) {
      return asset;
    }
    reminder.completed = true;
    reminder.completedAt = new Date();
    const updatedReminders = asset.reminders.map((item) =>
      item.id === reminder.id ? reminder : item,
    );
    return this.assets.update(asset.id, { reminders: updatedReminders });
  }

  async archiveAsset({ assetId, archivedBy }) {
    const actor = await this.requireUser(archivedBy);
    this.requireAnyRole(actor, ['ADMIN', 'HEAD_OFFICE']);
    const asset = await this.assets.findById(assertString(assetId, 'Asset ID'));
    if (!asset) {
      throw new Error('Asset not found');
    }
    if (asset.status === 'ARCHIVED') {
      return asset;
    }
    return this.assets.update(asset.id, {
      status: 'ARCHIVED',
      archivedAt: new Date(),
    });
  }

  async deleteAssetPermanently({ assetId, requestedBy, retentionDays = 30 }) {
    const actor = await this.requireUser(requestedBy);
    this.requireAnyRole(actor, ['ADMIN', 'HEAD_OFFICE']);
    const asset = await this.assets.findById(assertString(assetId, 'Asset ID'));
    if (!asset) {
      throw new Error('Asset not found');
    }
    if (asset.status !== 'ARCHIVED' || !asset.archivedAt) {
      throw new Error('Asset must be archived before deletion');
    }
    const days = assertPositiveInteger(retentionDays, 'Retention days');
    const retentionCutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    if (asset.archivedAt > retentionCutoff) {
      throw new Error('Asset retention period has not elapsed');
    }
    await this.assets.delete(asset.id);
    return true;
  }

  async requireUser(id) {
    const user = await this.users.findById(assertString(id, 'User ID'));
    if (!user) {
      throw new Error('User not found');
    }
    return user;
  }

  async requireAshram(id) {
    const ashram = await this.ashrams.findById(assertString(id, 'Ashram ID'));
    if (!ashram) {
      throw new Error('Ashram not found');
    }
    return ashram;
  }

  async requireAssignment(userId, ashramId) {
    const assignments = await this.assignments.listByUserId(userId);
    const found = assignments.some((assignment) => assignment.ashramId === ashramId);
    if (!found) {
      throw new Error('User is not assigned to this ashram');
    }
    return true;
  }

  requireAnyRole(user, allowedRoles) {
    const hasRole = user.roles.some((role) => allowedRoles.includes(role));
    if (!hasRole) {
      throw new Error('User does not have permission for this operation');
    }
  }
}
