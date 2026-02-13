import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

// Initialize S3 client (MinIO is S3-compatible)
const s3Client = new S3Client({
  endpoint: `http://${process.env.MINIO_ENDPOINT || 'localhost'}:${process.env.MINIO_PORT || '9000'}`,
  region: 'us-east-1', // MinIO doesn't care about region
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
  },
  forcePathStyle: true, // Required for MinIO
});

const BUCKET_NAME = process.env.MINIO_BUCKET || 'artifacts';

// MIME type mapping
const mimeTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.zip': 'application/zip',
  '.html': 'text/html',
};

function getMimeType(filename: string): string {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  return mimeTypes[ext] || 'application/octet-stream';
}

interface ArtifactParams {
  '*': string;
}

export async function artifactsRoutes(fastify: FastifyInstance) {
  // Serve artifact files from MinIO/S3
  fastify.get<{ Params: ArtifactParams }>('/*', {
    schema: {
      tags: ['artifacts'],
      summary: 'Download an artifact file from storage',
      params: {
        type: 'object',
        properties: {
          '*': { type: 'string', description: 'Path to artifact in storage' },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: ArtifactParams }>, reply: FastifyReply) => {
    let storagePath = request.params['*'];

    if (!storagePath) {
      return reply.status(400).send({ error: 'No artifact path provided' });
    }

    // Strip bucket name prefix if present (e.g., "artifacts/runs/..." -> "runs/...")
    if (storagePath.startsWith(`${BUCKET_NAME}/`)) {
      storagePath = storagePath.substring(BUCKET_NAME.length + 1);
    }

    try {
      // Check if object exists and get metadata
      await s3Client.send(new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: storagePath,
      }));

      // Get the object
      const response = await s3Client.send(new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: storagePath,
      }));

      // Extract filename and set headers
      const filename = storagePath.split('/').pop() || 'artifact';
      const mimeType = response.ContentType || getMimeType(filename);

      reply.header('Content-Type', mimeType);
      reply.header('Content-Disposition', `inline; filename="${filename}"`);

      if (response.ContentLength) {
        reply.header('Content-Length', response.ContentLength);
      }

      // Enable range requests for video seeking
      if (mimeType.startsWith('video/')) {
        reply.header('Accept-Ranges', 'bytes');
      }

      // Stream the response body
      if (response.Body instanceof Readable) {
        return reply.send(response.Body);
      }

      // For web streams, convert to Node stream
      const webStream = response.Body as ReadableStream;
      const nodeStream = Readable.fromWeb(webStream as Parameters<typeof Readable.fromWeb>[0]);
      return reply.send(nodeStream);
    } catch (error) {
      const s3Error = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (s3Error.name === 'NotFound' || s3Error.$metadata?.httpStatusCode === 404) {
        return reply.status(404).send({ error: 'Artifact not found' });
      }
      fastify.log.error({ err: error }, 'Artifact fetch error');
      return reply.status(500).send({ error: 'Failed to fetch artifact' });
    }
  });
}
