import { createHash, randomBytes } from 'crypto';
import { prisma } from '../db.js';

// Prefix for API keys
const API_KEY_PREFIX = 'w3t_';

/**
 * API Key service for managing extension authentication
 */
class ApiKeyService {
  /**
   * Generate a new API key
   */
  async createApiKey(name: string, expiresInDays?: number): Promise<{
    id: string;
    name: string;
    key: string; // Full key (only returned once)
    keyPrefix: string;
    expiresAt: Date | null;
    createdAt: Date;
  }> {
    // Generate random key
    const keyRaw = randomBytes(32).toString('hex');
    const fullKey = `${API_KEY_PREFIX}${keyRaw}`;

    // Hash the key for storage
    const keyHash = this.hashKey(fullKey);
    const keyPrefix = fullKey.slice(0, 12); // First 12 chars for identification

    // Calculate expiration
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    // Store in database
    const apiKey = await prisma.apiKey.create({
      data: {
        name,
        keyHash,
        keyPrefix,
        expiresAt,
      },
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      key: fullKey, // Only returned on creation
      keyPrefix: apiKey.keyPrefix,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
    };
  }

  /**
   * Validate an API key
   */
  async validateKey(key: string): Promise<{
    valid: boolean;
    keyId?: string;
    name?: string;
    error?: string;
  }> {
    // Check key format
    if (!key.startsWith(API_KEY_PREFIX)) {
      return { valid: false, error: 'Invalid key format' };
    }

    // Hash the provided key
    const keyHash = this.hashKey(key);

    // Look up in database
    const apiKey = await prisma.apiKey.findUnique({
      where: { keyHash },
    });

    if (!apiKey) {
      return { valid: false, error: 'Invalid API key' };
    }

    // Check expiration
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return { valid: false, error: 'API key has expired' };
    }

    // Update last used timestamp
    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      valid: true,
      keyId: apiKey.id,
      name: apiKey.name,
    };
  }

  /**
   * List all API keys (without exposing the actual keys)
   */
  async listApiKeys(): Promise<Array<{
    id: string;
    name: string;
    keyPrefix: string;
    lastUsedAt: Date | null;
    createdAt: Date;
    expiresAt: Date | null;
    isExpired: boolean;
  }>> {
    const keys = await prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
      expiresAt: k.expiresAt,
      isExpired: k.expiresAt ? k.expiresAt < new Date() : false,
    }));
  }

  /**
   * Delete an API key
   */
  async deleteApiKey(id: string): Promise<boolean> {
    try {
      await prisma.apiKey.delete({
        where: { id },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Hash an API key for secure storage
   */
  private hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }
}

export const apiKeyService = new ApiKeyService();
