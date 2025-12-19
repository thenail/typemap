/**
 * Crypto Utilities
 * Hashing and security helpers
 */

import * as crypto from 'crypto';

/**
 * Generate a random nonce for CSP
 */
export function generateNonce(length: number = 32): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * Compute SHA-256 hash of content (truncated for efficiency)
 */
export function computeHash(content: string, length: number = 16): string {
  return crypto
    .createHash('sha256')
    .update(content)
    .digest('hex')
    .substring(0, length);
}

/**
 * Compute hash of a file path for cache keys
 */
export function hashFilePath(filePath: string): string {
  return computeHash(filePath, 12);
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}
