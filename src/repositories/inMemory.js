import { randomUUID } from 'node:crypto';

const clone = (value) => structuredClone(value);

export class InMemoryAshramRepository {
  constructor() {
    this.items = new Map();
  }

  async create(data) {
    const record = { ...data, id: data.id ?? randomUUID() };
    record.createdAt ??= new Date();
    record.updatedAt ??= new Date();
    this.items.set(record.id, clone(record));
    return clone(record);
  }

  async update(id, patch) {
    const existing = this.items.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...clone(patch), updatedAt: new Date() };
    this.items.set(id, clone(updated));
    return clone(updated);
  }

  async findById(id) {
    const record = this.items.get(id);
    return record ? clone(record) : null;
  }

  async list() {
    return Array.from(this.items.values(), clone);
  }
}

export class InMemoryUserRepository {
  constructor() {
    this.items = new Map();
  }

  async create(data) {
    const record = { ...data, id: data.id ?? randomUUID() };
    record.createdAt ??= new Date();
    record.updatedAt ??= new Date();
    this.items.set(record.id, clone(record));
    return clone(record);
  }

  async update(id, patch) {
    const existing = this.items.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...clone(patch), updatedAt: new Date() };
    this.items.set(id, clone(updated));
    return clone(updated);
  }

  async findById(id) {
    const record = this.items.get(id);
    return record ? clone(record) : null;
  }

  async findByEmail(email) {
    for (const record of this.items.values()) {
      if (record.email === email) {
        return clone(record);
      }
    }
    return null;
  }

  async list() {
    return Array.from(this.items.values(), clone);
  }
}

export class InMemoryAssignmentRepository {
  constructor() {
    this.items = new Map();
  }

  async create(data) {
    const record = { ...data, id: data.id ?? randomUUID() };
    record.createdAt ??= new Date();
    record.updatedAt ??= new Date();
    this.items.set(record.id, clone(record));
    return clone(record);
  }

  async listByUserId(userId) {
    return Array.from(this.items.values())
      .filter((item) => item.userId === userId)
      .map(clone);
  }

  async listByAshramId(ashramId) {
    return Array.from(this.items.values())
      .filter((item) => item.ashramId === ashramId)
      .map(clone);
  }

  async delete(id) {
    this.items.delete(id);
  }
}

export class InMemoryAssetRepository {
  constructor() {
    this.items = new Map();
  }

  async create(data) {
    const record = { ...data, id: data.id ?? randomUUID() };
    record.createdAt ??= new Date();
    record.updatedAt ??= new Date();
    this.items.set(record.id, clone(record));
    return clone(record);
  }

  async update(id, patch) {
    const existing = this.items.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...clone(patch), updatedAt: new Date() };
    this.items.set(id, clone(updated));
    return clone(updated);
  }

  async findById(id) {
    const record = this.items.get(id);
    return record ? clone(record) : null;
  }

  async listByAshramId(ashramId) {
    return Array.from(this.items.values())
      .filter((asset) => asset.ashramId === ashramId && !asset.deletedAt)
      .map(clone);
  }

  async list() {
    return Array.from(this.items.values())
      .filter((asset) => !asset.deletedAt)
      .map(clone);
  }

  async delete(id) {
    const existing = this.items.get(id);
    if (!existing) return null;
    const updated = { ...existing, deletedAt: new Date() };
    this.items.set(id, clone(updated));
    return clone(updated);
  }
}
