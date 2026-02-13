import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, existsSync, statSync } from 'fs';
import { basename } from 'path';

// MinIO/S3 configuration
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost';
const MINIO_PORT = parseInt(process.env.MINIO_PORT || '9000', 10);
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin123';
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'artifacts';
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true';

/**
 * Storage service for managing test artifacts in MinIO/S3
 */
class StorageService {
  private client: S3Client | null = null;
  private isAvailable = false;
  private connectionChecked = false;

  /**
   * Initialize S3 client connection
   */
  private async initialize(): Promise<boolean> {
    if (this.connectionChecked) {
      return this.isAvailable;
    }

    this.connectionChecked = true;

    try {
      this.client = new S3Client({
        endpoint: `${MINIO_USE_SSL ? 'https' : 'http'}://${MINIO_ENDPOINT}:${MINIO_PORT}`,
        region: 'us-east-1', // MinIO requires a region but doesn't use it
        credentials: {
          accessKeyId: MINIO_ACCESS_KEY,
          secretAccessKey: MINIO_SECRET_KEY,
        },
        forcePathStyle: true, // Required for MinIO
      });

      // Test connection by listing objects (bucket should exist from docker-compose init)
      await this.client.send(new ListObjectsV2Command({
        Bucket: MINIO_BUCKET,
        MaxKeys: 1,
      }));

      this.isAvailable = true;
      console.log('[StorageService] Connected to MinIO/S3');
      return true;
    } catch (error) {
      console.warn('[StorageService] MinIO/S3 not available:', error instanceof Error ? error.message : error);
      this.isAvailable = false;
      return false;
    }
  }

  /**
   * Upload a file to storage
   */
  async uploadFile(
    localPath: string,
    runId: string,
    artifactType: string
  ): Promise<{ success: boolean; storagePath?: string; error?: string }> {
    await this.initialize();

    if (!this.isAvailable || !this.client) {
      return { success: false, error: 'Storage not available' };
    }

    if (!existsSync(localPath)) {
      return { success: false, error: `File not found: ${localPath}` };
    }

    try {
      const fileName = basename(localPath);
      const key = `runs/${runId}/${artifactType}/${fileName}`;
      const fileSize = statSync(localPath).size;

      await this.client.send(new PutObjectCommand({
        Bucket: MINIO_BUCKET,
        Key: key,
        Body: createReadStream(localPath),
        ContentLength: fileSize,
        ContentType: this.getMimeType(fileName),
      }));

      console.log(`[StorageService] Uploaded ${localPath} to ${key}`);

      return {
        success: true,
        storagePath: `${MINIO_BUCKET}/${key}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      console.error('[StorageService] Upload error:', message);
      return { success: false, error: message };
    }
  }

  /**
   * Upload content directly (without local file)
   */
  async uploadContent(
    content: string | Buffer,
    runId: string,
    artifactType: string,
    fileName: string
  ): Promise<{ success: boolean; storagePath?: string; error?: string }> {
    await this.initialize();

    if (!this.isAvailable || !this.client) {
      return { success: false, error: 'Storage not available' };
    }

    try {
      const key = `runs/${runId}/${artifactType}/${fileName}`;
      const body = typeof content === 'string' ? Buffer.from(content) : content;

      await this.client.send(new PutObjectCommand({
        Bucket: MINIO_BUCKET,
        Key: key,
        Body: body,
        ContentType: this.getMimeType(fileName),
      }));

      return {
        success: true,
        storagePath: `${MINIO_BUCKET}/${key}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      return { success: false, error: message };
    }
  }

  /**
   * Get a pre-signed URL for downloading an artifact
   */
  async getDownloadUrl(
    storagePath: string,
    expiresIn = 3600
  ): Promise<string | null> {
    await this.initialize();

    if (!this.isAvailable || !this.client) {
      return null;
    }

    try {
      // Extract key from storage path (remove bucket prefix if present)
      const key = storagePath.startsWith(`${MINIO_BUCKET}/`)
        ? storagePath.slice(MINIO_BUCKET.length + 1)
        : storagePath;

      const command = new GetObjectCommand({
        Bucket: MINIO_BUCKET,
        Key: key,
      });

      return await getSignedUrl(this.client, command, { expiresIn });
    } catch (error) {
      console.error('[StorageService] Error generating download URL:', error);
      return null;
    }
  }

  /**
   * Delete artifacts for a run
   */
  async deleteRunArtifacts(runId: string): Promise<boolean> {
    await this.initialize();

    if (!this.isAvailable || !this.client) {
      return false;
    }

    try {
      const prefix = `runs/${runId}/`;

      // List all objects with this prefix
      const listResponse = await this.client.send(new ListObjectsV2Command({
        Bucket: MINIO_BUCKET,
        Prefix: prefix,
      }));

      if (!listResponse.Contents || listResponse.Contents.length === 0) {
        return true; // Nothing to delete
      }

      // Delete each object
      for (const obj of listResponse.Contents) {
        if (obj.Key) {
          await this.client.send(new DeleteObjectCommand({
            Bucket: MINIO_BUCKET,
            Key: obj.Key,
          }));
        }
      }

      console.log(`[StorageService] Deleted ${listResponse.Contents.length} artifacts for run ${runId}`);
      return true;
    } catch (error) {
      console.error('[StorageService] Error deleting artifacts:', error);
      return false;
    }
  }

  /**
   * Check if storage is available
   */
  async isStorageAvailable(): Promise<boolean> {
    await this.initialize();
    return this.isAvailable;
  }

  /**
   * Get MIME type from file extension
   */
  private getMimeType(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webm: 'video/webm',
      mp4: 'video/mp4',
      json: 'application/json',
      txt: 'text/plain',
      log: 'text/plain',
      zip: 'application/zip',
      html: 'text/html',
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }
}

export const storageService = new StorageService();
