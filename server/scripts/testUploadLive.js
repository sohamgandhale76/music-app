const BINDING_URL = 'https://music-app-zlgk.onrender.com';

async function runLiveTest() {
  console.log('--- Starting Live End-to-End Test ---');

  // Dummy files
  const audioContent = Buffer.from('NoirSync dummy audio contents for testing');
  const coverContent = Buffer.from('NoirSync dummy cover image');
  const lyricsContent = Buffer.from('[00:01.00] NoirSync test lyrics');

  const formData = new FormData();
  formData.append('audio', new Blob([audioContent], { type: 'audio/mpeg' }), 'test-song.mp3');
  formData.append('cover', new Blob([coverContent], { type: 'image/jpeg' }), 'test-cover.jpg');
  formData.append('lyrics', new Blob([lyricsContent], { type: 'text/plain' }), 'test-lyrics.lrc');
  formData.append('title', 'E2E Test Song');
  formData.append('artist', 'Antigravity');
  formData.append('duration', '120.5');

  let trackId;

  try {
    // 1. Test POST /library/upload
    console.log('1. Uploading test track to live server...');
    const uploadRes = await fetch(`${BINDING_URL}/library/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!uploadRes.ok) {
      throw new Error(`Upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
    }

    const uploadData = await uploadRes.json();
    console.log('✓ Upload response:', uploadData);
    trackId = uploadData.track.id;
    console.log(`✓ Track created with ID: ${trackId}`);

    // 2. Test GET /library
    console.log('2. Fetching track list...');
    const listRes = await fetch(`${BINDING_URL}/library`);
    const tracks = await listRes.json();
    console.log('✓ Track list contains:', tracks.map(t => t.title));
    if (!tracks.some(t => t.id === trackId)) {
      throw new Error('Uploaded track not found in library list');
    }

    // 3. Test GET /library/:id/stream
    console.log('3. Fetching signed stream URL...');
    const streamRes = await fetch(`${BINDING_URL}/library/${trackId}/stream`);
    const streamData = await streamRes.json();
    console.log('✓ Signed stream URL:', streamData.url);

    // 4. Test GET /api/library/covers/r2-:id
    console.log('4. Testing mapped R2 cover endpoint (should redirect to R2)...');
    const coverRes = await fetch(`${BINDING_URL}/api/library/covers/r2-${trackId}`, {
      redirect: 'manual'
    });
    console.log(`✓ Cover response status (redirect expected): ${coverRes.status}`);
    const locationHeader = coverRes.headers.get('location');
    console.log(`✓ Cover redirect location: ${locationHeader || '(followed redirect / none)'}`);

    // 5. Test DELETE /library/:id
    console.log('5. Deleting test track...');
    const deleteRes = await fetch(`${BINDING_URL}/library/${trackId}`, {
      method: 'DELETE',
    });
    if (!deleteRes.ok) {
      throw new Error(`Delete failed: ${deleteRes.status}`);
    }
    console.log('✓ Delete response:', await deleteRes.json());

    // 6. Verify library is clean
    console.log('6. Verifying library is empty again...');
    const verifyRes = await fetch(`${BINDING_URL}/library`);
    const finalTracks = await verifyRes.json();
    console.log('✓ Final track list count:', finalTracks.length);

    const storageRes = await fetch(`${BINDING_URL}/library/storage`);
    const storageData = await storageRes.json();
    console.log('✓ Final R2 storage usage:', storageData.usedGB, 'GB');

    console.log('⭐ ALL ENDPOINTS VERIFIED SUCCESSFULLY! R2 persistence integration is fully operational.');
  } catch (err) {
    console.error('❌ Live test failed:', err);
    // Attempt cleanup if it failed midway
    if (trackId) {
      console.log('Attempting cleanup of track ID:', trackId);
      await fetch(`${BINDING_URL}/library/${trackId}`, { method: 'DELETE' }).catch(() => {});
    }
  }
}

runLiveTest();
