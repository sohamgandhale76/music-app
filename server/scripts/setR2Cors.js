const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { S3Client, PutBucketCorsCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME || 'noirsync-library';

async function setCors() {
  console.log(`Setting CORS policy for bucket: ${BUCKET}...`);
  const corsPolicy = {
    Bucket: BUCKET,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: ['*'],
          AllowedMethods: ['GET', 'HEAD'],
          AllowedHeaders: ['*'],
          ExposeHeaders: ['Content-Length', 'Content-Type'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  };

  try {
    const command = new PutBucketCorsCommand(corsPolicy);
    await s3.send(command);
    console.log('✓ CORS policy successfully applied to R2 bucket.');
  } catch (err) {
    console.error('❌ Failed to set CORS policy:', err.message);
    process.exit(1);
  }
}

setCors();
