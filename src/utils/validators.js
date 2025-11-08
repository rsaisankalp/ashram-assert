export function assertString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

export function assertEmail(value) {
  const email = assertString(value, 'Email');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Email must be valid');
  }
  return email.toLowerCase();
}

export function assertDate(value, fieldName) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid date`);
  }
  return date;
}

export function assertEnum(value, options, fieldName) {
  if (!options.includes(value)) {
    throw new Error(`${fieldName} must be one of ${options.join(', ')}`);
  }
  return value;
}

export function assertArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  return value;
}

export function assertPositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return value;
}

export function assertPlainObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be a plain object`);
  }
  return value;
}
