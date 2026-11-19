const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
function ffmpegPath(root, platform = process.platform, arch = process.arch) {
  if (!['darwin-arm64', 'win32-x64'].includes(`${platform}-${arch}`)) throw new Error('Unsupported desktop platform');
  return path.join(root, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}
async function probeFFmpeg(root) {
  const binary = ffmpegPath(root);
  try {
    await fs.access(binary);
    const { stdout } = await run(binary, ['-version'], { timeout: 5000, maxBuffer: 128 * 1024, windowsHide: true, shell: false });
    return { available: true, version: stdout.split(/\r?\n/)[0] };
  } catch (error) {
    return { available: false, reason: error.code === 'ENOENT' ? 'Approved FFmpeg binary is not installed' : 'FFmpeg probe failed' };
  }
}
module.exports = { ffmpegPath, probeFFmpeg };
