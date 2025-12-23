import crypto from 'crypto';

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 16 bytes for AES
const AUTH_TAG_LENGTH = 16; // 16 bytes for GCM auth tag

/**
 * Get the encryption key from environment variable
 * Key must be 32 bytes (256 bits) in hex format (64 characters)
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  if (key.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes / 256 bits)');
  }
  return Buffer.from(key, 'hex');
}

/**
 * Check if encryption is enabled (key is set)
 */
export function isEncryptionEnabled(): boolean {
  return Boolean(process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length === 64);
}

/**
 * Encrypt a string value
 * Returns format: iv:authTag:encryptedData (all in hex)
 */
export function encrypt(text: string): string {
  if (!text) return text;
  
  // If encryption is not enabled, return original
  if (!isEncryptionEnabled()) {
    console.warn('Encryption key not set, storing data unencrypted');
    return text;
  }
  
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Format: ENC:iv:authTag:encryptedData
    // Prefix with ENC: to identify encrypted data
    return `ENC:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt an encrypted string
 * Handles both encrypted (ENC:... or DENC:...) and unencrypted (legacy) data
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) return encryptedText;
  
  // Check if data is encrypted (starts with ENC: or DENC:)
  const isStandardEncrypted = encryptedText.startsWith('ENC:');
  const isDeterministicEncrypted = encryptedText.startsWith('DENC:');
  
  if (!isStandardEncrypted && !isDeterministicEncrypted) {
    // Return original unencrypted data (legacy/migration support)
    return encryptedText;
  }
  
  // If encryption is not enabled, we can't decrypt
  if (!isEncryptionEnabled()) {
    console.warn('Cannot decrypt: encryption key not set');
    return encryptedText;
  }
  
  try {
    const key = getEncryptionKey();
    
    // Remove ENC: or DENC: prefix and split
    const prefixLength = isDeterministicEncrypted ? 5 : 4;
    const parts = encryptedText.substring(prefixLength).split(':');
    if (parts.length !== 3) {
      // Invalid format, return original
      return encryptedText;
    }
    
    const [ivHex, authTagHex, encrypted] = parts;
    
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    // Return original if decryption fails (might be corrupted or wrong key)
    return encryptedText;
  }
}

/**
 * Check if a string is encrypted (has ENC: or DENC: prefix)
 */
export function isEncrypted(text: string): boolean {
  return text?.startsWith('ENC:') || text?.startsWith('DENC:') || false;
}

/**
 * Deterministic encryption - same plaintext always produces same ciphertext
 * Uses HMAC of the plaintext as the IV for consistent output
 * Allows exact-match database lookups while keeping data encrypted
 */
export function encryptDeterministic(text: string): string {
  if (!text) return text;
  
  // If encryption is not enabled, return original
  if (!isEncryptionEnabled()) {
    console.warn('Encryption key not set, storing data unencrypted');
    return text;
  }
  
  try {
    const key = getEncryptionKey();
    
    // Derive IV from HMAC of the text (deterministic)
    const hmac = crypto.createHmac('sha256', key);
    hmac.update(text);
    const iv = hmac.digest().subarray(0, IV_LENGTH);
    
    // Encrypt with derived IV
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    
    // Format: DENC:iv:authTag:encryptedData
    // Prefix with DENC: to identify deterministically encrypted data
    return `DENC:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('Deterministic encryption error:', error);
    throw new Error('Failed to encrypt data deterministically');
  }
}

/**
 * Encrypt a JSON object by stringifying and encrypting
 */
export function encryptJson(obj: any): string {
  if (!obj) return obj;
  
  const jsonString = JSON.stringify(obj);
  return encrypt(jsonString);
}

/**
 * Decrypt an encrypted JSON string back to an object
 */
export function decryptJson<T = any>(encryptedText: string): T {
  if (!encryptedText) return encryptedText as any;
  
  const decrypted = decrypt(encryptedText);
  
  // If it's encrypted JSON, parse it
  if (encryptedText.startsWith('ENC:')) {
    try {
      return JSON.parse(decrypted);
    } catch {
      // If parsing fails, return as-is
      return decrypted as any;
    }
  }
  
  // If not encrypted, try to parse as JSON (legacy data might already be JSON string)
  try {
    return JSON.parse(decrypted);
  } catch {
    return decrypted as any;
  }
}

/**
 * Encrypt sensitive fields in a member object
 * - account_number uses deterministic encryption (allows lookups)
 * - title, state use standard encryption (random IV)
 * - other PII fields use standard encryption
 */
export function encryptMemberFields(member: {
  account_number?: string;
  title?: string;
  state?: string;
  email?: string;
  address?: string;
  suburb?: string;
  first_name?: string;
  last_name?: string;
  post_code?: string;
  [key: string]: any;
}): typeof member {
  return {
    ...member,
    account_number: member.account_number ? encryptDeterministic(member.account_number) : member.account_number,
    title: member.title ? encrypt(member.title) : member.title,
    state: member.state ? encrypt(member.state) : member.state,
    email: member.email ? encrypt(member.email) : member.email,
    address: member.address ? encrypt(member.address) : member.address,
    suburb: member.suburb ? encrypt(member.suburb) : member.suburb,
    first_name: member.first_name ? encrypt(member.first_name) : member.first_name,
    last_name: member.last_name ? encrypt(member.last_name) : member.last_name,
    post_code: member.post_code ? encrypt(member.post_code) : member.post_code,
  };
}

/**
 * Decrypt sensitive fields in a member object
 */
export function decryptMemberFields(member: {
  account_number?: string;
  title?: string;
  state?: string;
  email?: string;
  address?: string;
  suburb?: string;
  first_name?: string;
  last_name?: string;
  post_code?: string;
  [key: string]: any;
}): typeof member {
  return {
    ...member,
    account_number: member.account_number ? decrypt(member.account_number) : member.account_number,
    title: member.title ? decrypt(member.title) : member.title,
    state: member.state ? decrypt(member.state) : member.state,
    email: member.email ? decrypt(member.email) : member.email,
    address: member.address ? decrypt(member.address) : member.address,
    suburb: member.suburb ? decrypt(member.suburb) : member.suburb,
    first_name: member.first_name ? decrypt(member.first_name) : member.first_name,
    last_name: member.last_name ? decrypt(member.last_name) : member.last_name,
    post_code: member.post_code ? decrypt(member.post_code) : member.post_code,
  };
}

/**
 * Generate a new encryption key (for setup)
 * Returns a 64-character hex string (32 bytes / 256 bits)
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}




