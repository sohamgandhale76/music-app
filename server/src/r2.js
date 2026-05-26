// ─── Cloudflare R2 Client ────────────────────────────────────────────────────
// Uses the S3-compatible API exposed by Cloudflare R2.
// All functions are async and throw on failure.

const { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const STORAGE_LIMIT_BYTES = 9.5 * 1024 * 1024 * 1024; // 9.5 GB

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME || 'noirsync-library';

/**
 * Upload a buffer to R2.
 * @param {string} key        - Object key (e.g. "audio/abc123.mp3")
 * @param {Buffer} buffer     - File content
 * @param {string} contentType - MIME type
 */
async function uploadToR2(key, buffer, contentType) {
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });
  await s3.send(cmd);
}

/**
 * Generate a pre-signed URL for streaming/downloading an object.
 * Valid for 1 hour (3600 seconds).
 * @param {string} key - Object key
 * @returns {Promise<string>} Signed URL
 */
async function getStreamUrl(key) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

/**
 * Delete an object from R2.
 * @param {string} key - Object key
 */
async function deleteFromR2(key) {
  const cmd = new DeleteObjectCommand({ Bucket: BUCKET, Key: key });
  await s3.send(cmd);
}

/**
 * Paginate through ALL objects in the bucket and sum their sizes.
 * @returns {Promise<number>} Total bytes used
 */
async function getTotalStorageUsed() {
  let totalBytes = 0;
  let continuationToken = undefined;

  do {
    const cmd = new ListObjectsV2Command({
      Bucket: BUCKET,
      ContinuationToken: continuationToken,
    });
    const response = await s3.send(cmd);

    if (response.Contents) {
      for (const obj of response.Contents) {
        totalBytes += obj.Size || 0;
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return totalBytes;
}

/**
 * Check if adding a new file would exceed the 9.5 GB storage limit.
 * Throws an error with message 'STORAGE_FULL' if limit would be exceeded.
 * @param {number} incomingFileSize - Size of the file about to be uploaded (bytes)
 */
async function checkStorageLimit(incomingFileSize) {
  const used = await getTotalStorageUsed();
  if (used + incomingFileSize > STORAGE_LIMIT_BYTES) {
    const err = new Error('STORAGE_FULL');
    err.code = 'STORAGE_FULL';
    err.usedBytes = used;
    throw err;
  }
}

/**
 * Generate a presigned PUT URL so the client can upload directly to R2,
 * bypassing the server entirely for the file bytes.
 * @param {string} key          - Object key (e.g. "audio/abc123.flac")
 * @param {string} contentType  - MIME type of the file
 * @param {number} [expiresIn]  - URL validity in seconds (default 3600)
 * @returns {Promise<string>} Presigned PUT URL
 */
async function getUploadUrl(key, contentType, expiresIn = 3600) {
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, cmd, { expiresIn });
}

module.exports = {
  uploadToR2,
  getStreamUrl,
  getUploadUrl,
  deleteFromR2,
  getTotalStorageUsed,
  checkStorageLimit,
};
