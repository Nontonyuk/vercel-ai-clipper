const { GoogleGenerativeAI } = require('@google/generative-ai');

function extractVideoId(inputUrl) {
  try {
    const parsed = new URL(inputUrl.trim());

    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.split('/').filter(Boolean)[0] || '';
    }

    if (parsed.hostname.includes('youtube.com')) {
      if (parsed.pathname === '/watch') return parsed.searchParams.get('v') || '';
      if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.split('/')[2] || '';
      if (parsed.pathname.startsWith('/embed/')) return parsed.pathname.split('/')[2] || '';
    }

    return '';
  } catch (_) {
    return '';
  }
}

function stripVtt(vttText) {
  return String(vttText || '')
    .replace(/^WEBVTT.*$/gm, '')
    .replace(/^Kind:.*$/gm, '')
    .replace(/^Language:.*$/gm, '')
    .replace(/^\d+$/gm, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function secondsFromVttTime(value) {
  const parts = String(value).trim().split(':');
  const sec = Number(parts.pop().replace(',', '.'));
  const min = Number(parts.pop() || 0);
  const hour = Number(parts.pop() || 0);

  if ([sec, min, hour].some(Number.isNaN)) return 0;
  return Math.round(hour * 3600 + min * 60 + sec);
}

function parseVttCues(vttText) {
  const cues = [];
  const regex = /((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/g;
  let match;

  while ((match = regex.exec(vttText)) !== null) {
    const text = stripVtt(match[3]).replace(/\s+/g, ' ').trim();
    if (!text) continue;

    cues.push({
      start: secondsFromVttTime(match[1]),
      end: secondsFromVttTime(match[2]),
      text,
    });
  }

  return cues;
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findKeywordLocally(cues, keyword) {
  const needle = normalizeText(keyword);
  if (!needle) return null;

  for (const cue of cues) {
    if (normalizeText(cue.text).includes(needle)) {
      return { start: cue.start, end: cue.end };
    }
  }

  // Gabungkan beberapa cue agar kalimat yang terpotong tetap bisa ketemu.
  for (let i = 0; i < cues.length; i++) {
    const group = cues.slice(i, i + 5);
    const combined = normalizeText(group.map((cue) => cue.text).join(' '));

    if (combined.includes(needle)) {
      return {
        start: group[0].start,
        end: group[group.length - 1].end,
      };
    }
  }

  return null;
}

function getBestSubtitle(subtitles) {
  if (!Array.isArray(subtitles) || subtitles.length === 0) return null;

  return (
    subtitles.find((sub) => /indonesia|bahasa|\bid\b/i.test(`${sub.name || ''} ${sub.code || ''}`)) ||
    subtitles.find((sub) => /english|\ben\b/i.test(`${sub.name || ''} ${sub.code || ''}`)) ||
    subtitles[0]
  );
}

function extractJsonObject(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`AI tidak mengembalikan JSON: ${text}`);
  return JSON.parse(match[0]);
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url, keyword } = req.body || {};

  if (!url || !keyword) {
    return res.status(400).json({ error: 'Harap isi URL YouTube dan kalimat yang dicari.' });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return res.status(400).json({ error: 'Format URL YouTube tidak valid.' });
  }

  try {
    const pipedRes = await fetch(`https://pipedapi.kavin.rocks/streams/${videoId}`);

    if (!pipedRes.ok) {
      return res.status(502).json({
        error: `Gagal mengambil data video dari server subtitle. Status: ${pipedRes.status}`,
      });
    }

    const pipedData = await pipedRes.json();
    const subtitle = getBestSubtitle(pipedData.subtitles);

    if (!subtitle?.url) {
      return res.status(404).json({ error: 'Video ini tidak memiliki Subtitle/CC yang bisa dibaca.' });
    }

    const vttRes = await fetch(subtitle.url);
    if (!vttRes.ok) {
      return res.status(502).json({ error: 'Gagal mengambil file subtitle dari video.' });
    }

    const vttText = await vttRes.text();
    const cues = parseVttCues(vttText);

    if (cues.length === 0) {
      return res.status(404).json({ error: 'Subtitle ditemukan, tetapi formatnya tidak bisa dibaca.' });
    }

    const localMatch = findKeywordLocally(cues, keyword);
    if (localMatch) {
      return res.status(200).json(localMatch);
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(404).json({
        error: `Kalimat "${keyword}" tidak ditemukan secara langsung, dan GEMINI_API_KEY belum disetel untuk pencarian AI.`,
      });
    }

    const transcriptForAi = cues
      .map((cue) => `[${cue.start}-${cue.end}] ${cue.text}`)
      .join('\n')
      .slice(0, 45000);

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `Cari timestamp yang paling cocok dengan keyword berikut pada transkrip subtitle.\n\nKeyword: "${keyword}"\n\nTranskrip:\n${transcriptForAi}\n\nJawab hanya JSON valid. Jika ditemukan: {"start": angka_detik, "end": angka_detik}. Jika tidak ditemukan: {"start": 0, "end": 0}.`;

    const result = await model.generateContent(prompt);
    const aiText = result.response.text();
    const timeline = extractJsonObject(aiText);

    const start = Number(timeline.start);
    const end = Number(timeline.end);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return res.status(500).json({ error: `Format waktu dari AI tidak valid: ${aiText}` });
    }

    if (start === 0 && end === 0) {
      return res.status(404).json({ error: `Kata/kalimat "${keyword}" tidak diucapkan di dalam video ini.` });
    }

    return res.status(200).json({ start: Math.round(start), end: Math.round(end) });
  } catch (error) {
    return res.status(500).json({ error: `Sistem gagal: ${error.message}` });
  }
}

module.exports = handler;
