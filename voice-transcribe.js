// Voice transcription via ffmpeg conversion + Gemini audio API
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const AI_GATEWAY_BASE = 'https://ai-gateway.trickle-lab.tech/api/v1';
const FFMPEG = process.env.FFMPEG_PATH || `${process.env.HOME}/bin/ffmpeg`;

// Detect audio mime type from content-type or URL extension
function detectFormat(contentType, url) {
  if (contentType) {
    if (contentType.includes('amr')) return 'amr';
    if (contentType.includes('silk')) return 'silk';
    if (contentType.includes('ogg')) return 'ogg';
    if (contentType.includes('mp4') || contentType.includes('m4a')) return 'm4a';
    if (contentType.includes('mp3') || contentType.includes('mpeg')) return 'mp3';
    if (contentType.includes('wav')) return 'wav';
    if (contentType.includes('opus')) return 'opus';
  }
  if (url) {
    const ext = url.split('?')[0].split('.').pop()?.toLowerCase();
    if (['amr', 'silk', 'ogg', 'mp3', 'wav', 'm4a', 'mp4', 'opus'].includes(ext)) return ext;
  }
  return 'unknown';
}

// Download audio file to tmp
async function downloadAudio(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || '';
  return { buf, contentType };
}

// Convert audio buffer to WAV using ffmpeg
// Returns wav buffer or null if conversion failed
function convertToWav(inputBuf, inputFormat) {
  const tmpIn = join(tmpdir(), `qq-voice-${Date.now()}.${inputFormat === 'unknown' ? 'bin' : inputFormat}`);
  const tmpOut = join(tmpdir(), `qq-voice-${Date.now()}.wav`);
  try {
    writeFileSync(tmpIn, inputBuf);
    // Try conversion; -y overwrites, -loglevel error suppresses spam
    execSync(
      `${FFMPEG} -y -loglevel error -i "${tmpIn}" -ar 16000 -ac 1 -f wav "${tmpOut}"`,
      { timeout: 15000 }
    );
    const wavBuf = readFileSync(tmpOut);
    return wavBuf;
  } catch {
    return null;
  } finally {
    try { unlinkSync(tmpIn); } catch {}
    try { unlinkSync(tmpOut); } catch {}
  }
}

// Send audio to Gemini Flash for transcription via AI Gateway
async function transcribeWithGemini(audioBuf, mimeType = 'audio/wav') {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY not set');

  const base64 = audioBuf.toString('base64');

  const res = await fetch(`${AI_GATEWAY_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Origin': 'https://trickle.so',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-preview',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: '请识别这段语音的文字内容。只输出识别到的文字，不要加任何说明、标点以外的格式、或引号。如果听不清或无法识别，输出：[语音无法识别]',
          },
          {
            type: 'input_audio',
            input_audio: { data: base64, format: mimeType.replace('audio/', '') },
          },
        ],
      }],
      max_tokens: 500,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '[语音无法识别]';
}

// Main: given QQ voice attachment, return transcript or null
export async function transcribeVoice(attachment) {
  const url = attachment.url;
  if (!url) return null;

  try {
    const { buf, contentType } = await downloadAudio(url);
    const fmt = detectFormat(contentType, url);

    // If already a format Gemini supports, try directly first
    const directFormats = ['mp3', 'wav', 'm4a', 'mp4', 'ogg', 'opus', 'flac'];
    if (directFormats.includes(fmt)) {
      try {
        const mime = fmt === 'ogg' ? 'audio/ogg' : fmt === 'opus' ? 'audio/opus' : `audio/${fmt}`;
        return await transcribeWithGemini(buf, mime);
      } catch {
        // fall through to ffmpeg conversion
      }
    }

    // Convert to WAV via ffmpeg (works for AMR, OGG, M4A, etc.)
    const wavBuf = convertToWav(buf, fmt);
    if (!wavBuf) return null;

    return await transcribeWithGemini(wavBuf, 'audio/wav');
  } catch (e) {
    process.stdout.write(`[voice-transcribe] error: ${e.message}\n`);
    return null;
  }
}
