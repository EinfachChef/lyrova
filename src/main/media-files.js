// Copies a user-chosen background image/video into the app's data folder, so it keeps working
// even if the original file is moved or deleted.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'];
const VIDEO_EXT = ['mp4', 'webm', 'm4v', 'mov'];
const MAX_IMAGE = 60 * 1024 * 1024;
const MAX_VIDEO = 1024 * 1024 * 1024;

/**
 * @param {'image'|'video'} kind
 * @returns {string} path of the copy
 */
async function importMedia(source, kind, dir) {
  const ext = path.extname(source).slice(1).toLowerCase();
  const allowed = kind === 'image' ? IMAGE_EXT : VIDEO_EXT;
  if (!allowed.includes(ext)) throw new Error(`unsupported file type .${ext}`);
  const stat = await fs.promises.stat(source);
  if (!stat.isFile()) throw new Error('not a file');
  if (stat.size > (kind === 'image' ? MAX_IMAGE : MAX_VIDEO)) throw new Error('file too large');
  await fs.promises.mkdir(dir, { recursive: true });
  const target = path.join(dir, `${kind}-${crypto.randomBytes(6).toString('hex')}.${ext}`);
  await fs.promises.copyFile(source, target);
  return target;
}

/** Removes an old copy – only files inside our own folder are ever deleted. */
async function removeMedia(file, dir) {
  if (!file) return;
  const resolved = path.resolve(file);
  if (path.dirname(resolved) !== path.resolve(dir)) return;
  await fs.promises.unlink(resolved).catch(() => {});
}

module.exports = { importMedia, removeMedia, IMAGE_EXT, VIDEO_EXT };
