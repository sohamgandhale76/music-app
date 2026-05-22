const { Telegram, Telegraf } = require('telegraf');
const logger = require('./logger');

const fs = require('fs');
const path = require('path');

const token = process.env.TELEGRAM_BOT_TOKEN;
let chatId = process.env.TELEGRAM_CHAT_ID;
const envPath = path.join(__dirname, '../.env');

let bot = null;
let telegram = null;
let isEnabled = false;

if (token) {
  try {
    telegram = new Telegram(token);
    bot = new Telegraf(token);
    
    if (chatId) {
      isEnabled = true;
      logger.info('Telegram Bot integration configured', { chatId });
    } else {
      logger.warn('Telegram Bot active in DISCOVERY mode. Send /start to your bot in Telegram to link it!');
    }

    // Simple bot command listeners for user-friendliness
    bot.start((ctx) => {
      const incomingId = String(ctx.chat.id);
      
      if (!chatId) {
        chatId = incomingId;
        isEnabled = true;
        logger.info(`Dynamically discovered Telegram Chat ID: ${chatId}`);
        
        // Write the discovered chat ID back to the server's .env file
        try {
          let envContent = '';
          if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
          }
          if (envContent.includes('TELEGRAM_CHAT_ID=')) {
            envContent = envContent.replace(/TELEGRAM_CHAT_ID=.*/, `TELEGRAM_CHAT_ID=${chatId}`);
          } else {
            envContent += `\nTELEGRAM_CHAT_ID=${chatId}`;
          }
          fs.writeFileSync(envPath, envContent, 'utf8');
          logger.info('Updated server/.env with discovered TELEGRAM_CHAT_ID');
        } catch (envErr) {
          logger.error('Failed to write TELEGRAM_CHAT_ID to .env, using in-memory fallback', { error: envErr.message });
        }
        
        ctx.reply(
          `🎙 *NoirSync Linked Successfully!*\n\n` +
          `I have dynamically set your Storage Chat ID to: \`${chatId}\`.\n\n` +
          `You can now upload songs directly in the Web UI. They will be sliced and hosted in this chat!`,
          { parse_mode: 'Markdown' }
        );
      } else {
        ctx.reply(
          `🎙 *NoirSync Cloud Bot Active!*\n\n` +
          `• Storage Chat ID: \`${chatId}\`\n\n` +
          `Upload music in the web player and see them index here!`,
          { parse_mode: 'Markdown' }
        );
      }
    });

    bot.on('audio', (ctx) => {
      const audio = ctx.message.audio;
      ctx.reply(
        `🎵 *Audio details for manual registration:*\n` +
        `• Title: \`${audio.title || 'Unknown'}\`\n` +
        `• Artist: \`${audio.performer || 'Unknown'}\`\n` +
        `• Duration: \`${audio.duration}s\`\n` +
        `• File size: \`${(audio.file_size / 1024 / 1024).toFixed(2)} MB\`\n` +
        `• File ID: \`${audio.file_id}\`\n\n` +
        `You can use this File ID or upload directly via the web player.`,
        { parse_mode: 'Markdown' }
      );
    });

    // Launch polling in the background without blocking server boot
    bot.launch().catch((err) => {
      logger.error('Failed to launch Telegram bot polling', { error: err.message });
    });

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));

  } catch (err) {
    logger.error('Error initialising Telegram Bot', { error: err.message });
    isEnabled = false;
  }
} else {
  logger.warn('Telegram Bot integration disabled: TELEGRAM_BOT_TOKEN missing in env.');
}

/**
 * Upload a raw chunk buffer to the configured Telegram chat
 * @param {Buffer} buffer 
 * @param {string} filename 
 * @returns {Promise<string>} fileId
 */
async function uploadChunk(buffer, filename) {
  if (!isEnabled) {
    throw new Error('Telegram Bot storage is not enabled.');
  }
  const res = await telegram.sendDocument(chatId, { source: buffer, filename });
  if (!res.document || !res.document.file_id) {
    throw new Error('Telegram response did not return a valid document fileId');
  }
  return res.document.file_id;
}

/**
 * Get a temporary direct download link for a given file_id
 * @param {string} fileId 
 * @returns {Promise<string>} downloadUrl
 */
async function getChunkUrl(fileId) {
  if (!isEnabled) {
    throw new Error('Telegram Bot storage is not enabled.');
  }
  const fileInfo = await telegram.getFile(fileId);
  if (!fileInfo || !fileInfo.file_path) {
    throw new Error('Could not retrieve file path from Telegram');
  }
  return `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
}

// Simple in-memory chunk cache using Promises to avoid concurrent redundant requests
const chunkCache = new Map(); // fileId -> { promise: Promise<Buffer>, timestamp: number }
const MAX_CACHE_SIZE = 100;

function setCachedChunk(fileId, promise) {
  if (chunkCache.size >= MAX_CACHE_SIZE) {
    let oldestFileId = null;
    let oldestTime = Infinity;
    for (const [id, val] of chunkCache.entries()) {
      if (val.timestamp < oldestTime) {
        oldestTime = val.timestamp;
        oldestFileId = id;
      }
    }
    if (oldestFileId) {
      chunkCache.delete(oldestFileId);
      logger.info(`Evicted oldest Telegram chunk from cache: ${oldestFileId}`);
    }
  }
  chunkCache.set(fileId, { promise, timestamp: Date.now() });
}

/**
 * Get a chunk buffer, using cache if available.
 * @param {string} fileId
 * @returns {Promise<Buffer>}
 */
function getChunkBuffer(fileId) {
  const cached = chunkCache.get(fileId);
  if (cached) {
    cached.timestamp = Date.now(); // update LRU order
    logger.debug(`Telegram Cache HIT for chunk: ${fileId}`);
    return cached.promise;
  }

  logger.info(`Telegram Cache MISS. Fetching chunk: ${fileId}`);
  const promise = (async () => {
    try {
      const url = await getChunkUrl(fileId);
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Telegram CDN returned status ${res.status}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      // Evict failed requests so they can be retried later
      chunkCache.delete(fileId);
      throw err;
    }
  })();

  setCachedChunk(fileId, promise);
  return promise;
}

/**
 * Fetches the pinned catalog content from the Telegram chat
 * @returns {Promise<Buffer|null>} catalogBuffer
 */
async function getPinnedCatalog() {
  if (!isEnabled) return null;
  try {
    const chat = await telegram.getChat(chatId);
    if (chat.pinned_message && chat.pinned_message.document && chat.pinned_message.document.file_name === 'library.json') {
      const fileId = chat.pinned_message.document.file_id;
      return await getChunkBuffer(fileId);
    }
  } catch (err) {
    logger.error('Failed to fetch pinned catalog from Telegram', { error: err.message });
  }
  return null;
}

/**
 * Uploads the catalog to Telegram and pins it
 * @param {Buffer} buffer 
 * @returns {Promise<boolean>} success
 */
async function pinCatalog(buffer) {
  if (!isEnabled) return false;
  try {
    const res = await telegram.sendDocument(chatId, { source: buffer, filename: 'library.json' });
    if (!res.document || !res.document.file_id) {
      throw new Error('Telegram response did not return a valid document');
    }
    const messageId = res.message_id;
    await telegram.pinChatMessage(chatId, messageId, { disable_notification: true });
    logger.info('Pinned new catalog on Telegram', { messageId });
    return true;
  } catch (err) {
    logger.error('Failed to pin catalog on Telegram', { error: err.message });
    return false;
  }
}

module.exports = {
  isEnabled: () => isEnabled,
  uploadChunk,
  getChunkUrl,
  getChunkBuffer,
  getPinnedCatalog,
  pinCatalog,
};
