// api/transcript.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { videoId } = req.query;
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cookie': 'CONSENT=YES+; SOCS=CAI;',
      }
    });

    const html = await response.text();

    // Extract ytInitialPlayerResponse — it's a JS variable assignment in a script tag
    // We split on the variable name, then find the matching closing brace
    let playerData = null;

    const splitToken = 'ytInitialPlayerResponse = ';
    const splitIdx = html.indexOf(splitToken);

    if (splitIdx !== -1) {
      const jsonStart = splitIdx + splitToken.length;
      // Walk forward to find matching closing brace
      let depth = 0;
      let inString = false;
      let escape = false;
      let end = jsonStart;

      for (let i = jsonStart; i < html.length; i++) {
        const ch = html[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        if (ch === '}') {
          depth--;
          if (depth === 0) { end = i + 1; break; }
        }
      }

      try {
        playerData = JSON.parse(html.slice(jsonStart, end));
      } catch(e) {
        playerData = null;
      }
    }

    if (!playerData) {
      return res.status(500).json({ error: 'Could not parse YouTube page data. Please try again.' });
    }

    // Get caption tracks
    const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!captionTracks || !captionTracks.length) {
      return res.status(404).json({ error: 'No captions found for this video. The creator may not have captions enabled.' });
    }

    // Pick best track: manual English > auto English > any English > first track
    const track =
      captionTracks.find(t => (t.languageCode === 'en' || t.languageCode === 'en-US') && t.kind !== 'asr') ||
      captionTracks.find(t => t.languageCode === 'en' || t.languageCode === 'en-US') ||
      captionTracks.find(t => t.languageCode?.startsWith('en')) ||
      captionTracks[0];

    if (!track?.baseUrl) {
      return res.status(404).json({ error: 'Caption track URL not found.' });
    }

    // Fetch captions in JSON3 format (easiest to parse)
    const captionUrl = track.baseUrl + '&fmt=json3';
    const captionRes = await fetch(captionUrl);
    const captionText = await captionRes.text();

    let lines = [];

    // Parse JSON3 format
    try {
      const captionJson = JSON.parse(captionText);
      const events = captionJson?.events || [];

      for (const event of events) {
        if (!event.segs || !event.tStartMs) continue;
        const text = event.segs
          .map(s => s.utf8 || '')
          .join('')
          .replace(/\n/g, ' ')
          .trim();
        if (text && text !== '\n' && text !== ' ') {
          lines.push({
            start: event.tStartMs / 1000,
            text
          });
        }
      }
    } catch(e) {
      // JSON3 failed — try XML
      lines = [];
    }

    // Fallback: parse as XML
    if (!lines.length) {
      const xmlRes = await fetch(track.baseUrl);
      const xml = await xmlRes.text();

      const parts = xml.split('<text ');
      for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        const startMatch = part.match(/start="([^"]+)"/);
        const closeTag = part.indexOf('>');
        const endTag = part.indexOf('</text>');
        if (!startMatch || closeTag === -1 || endTag === -1) continue;

        const start = parseFloat(startMatch[1]);
        const raw = part.slice(closeTag + 1, endTag);
        const text = raw
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&nbsp;/g, ' ')
          .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c)))
          .trim();

        if (text) lines.push({ start, text });
      }
    }

    if (!lines.length) {
      return res.status(404).json({ error: 'Transcript is empty or could not be parsed for this video.' });
    }

    // Get video title
    let title = playerData?.videoDetails?.title || 'YouTube Video';

    return res.status(200).json({
      title,
      transcript: lines,
      language: track.languageCode,
      trackName: track.name?.simpleText || track.languageCode,
      count: lines.length
    });

  } catch (error) {
    return res.status(500).json({ error: 'Server error: ' + error.message });
  }
}
