const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { uploadToR2, getStreamUrl, deleteFromR2 } = require('../src/r2');

async function runTest() {
  const testKey = 'test/connection-test.txt';
  const testData = Buffer.from('NoirSync R2 Connection Test');

  console.log('Testing R2 upload...');
  try {
    await uploadToR2(testKey, testData, 'text/plain');
    console.log('✓ Upload successful.');

    console.log('Testing R2 signed URL generation...');
    const url = await getStreamUrl(testKey);
    console.log('✓ Signed URL generated:', url);

    console.log('Testing R2 delete...');
    await deleteFromR2(testKey);
    console.log('✓ Delete successful.');
    console.log('⭐ R2 credentials are valid for data operations!');
  } catch (err) {
    console.error('❌ R2 connection test failed:', err);
  }
}

runTest();
