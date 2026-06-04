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

    // Extract ytInitialPlayerResponse using brace matching
    let playerData = null;
    const splitToken = 'ytInitialPlayerResponse = ';
    const splitIdx = html.indexOf(splitToken);

    if (splitIdx !== -1) {
      const jsonStart = splitIdx + splitToken.length;
      let depth = 0, inString = false, escape = false, end = jsonStart;
      for (let i = jsonStart; i < html.length; i++) {
        const ch = html[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
      }
      try { playerData = JSON.parse(html.slice(jsonStart, end)); } catch(e) {}
    }

    if (!playerData) {
      return res.status(500).json({ error: 'Could not parse YouTube page data. Please try again.' });
    }

    const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!captionTracks?.length) {
      return res.status(404).json({ error: 'No captions found for this video. The creator may not have captions enabled.' });
    }

    // Pick best track
    const track =
      captionTracks.find(t => t.languageCode === 'en' && t.kind !== 'asr') ||
      captionTracks.find(t => t.languageCode === 'en-US' && t.kind !== 'asr') ||
      captionTracks.find(t => t.languageCode === 'en') ||
      captionTracks.find(t => t.languageCode === 'en-US') ||
      captionTracks[0];

    // The baseUrl from YouTube is often missing the tlang and other params
    // Build the URL fresh using the timedtext API directly
    // Extract the key params from the baseUrl
    const baseUrl = track.baseUrl;
    const urlObj = new URL(baseUrl);

    // Add fmt=json3 for JSON format and lang param
    urlObj.searchParams.set('fmt', 'json3');
    urlObj.searchParams.set('lang', track.languageCode);

    // Also try with xorb, xobt, xovt params that YouTube sometimes needs
    const captionUrl = urlObj.toString();

    let lines = [];

    // Fetch with proper headers mimicking a browser request
    const captionRes = await fetch(captionUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': `https://www.youtube.com/watch?v=${videoId}`,
        'Origin': 'https://www.youtube.com',
      }
    });

    const captionText = await captionRes.text();

    // Try JSON3 parse
    if (captionText && captionText.length > 10) {
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
          if (text && text.trim()) {
            lines.push({ start: event.tStartMs / 1000, text: text.trim() });
          }
        }
      } catch(e) {}
    }

    // If still empty, try XML format
    if (!lines.length) {
      const xmlUrl = new URL(baseUrl);
      xmlUrl.searchParams.set('lang', track.languageCode);
      // Remove fmt to get XML
      xmlUrl.searchParams.delete('fmt');

      const xmlRes = await fetch(xmlUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': `https://www.youtube.com/watch?v=${videoId}`,
          'Origin': 'https://www.youtube.com',
        }
      });
      const xml = await xmlRes.text();

      if (xml && xml.includes('<text')) {
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
    }

    // Last resort — use YouTube's timedtext API directly with just videoId and lang
    if (!lines.length) {
      const fallbackUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${track.languageCode}&fmt=json3&xorb=2&xobt=3&xovt=3`;
      const fallbackRes = await fetch(fallbackUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': `https://www.youtube.com/watch?v=${videoId}`,
        }
      });
      const fallbackText = await fallbackRes.text();
      if (fallbackText && fallbackText.length > 10) {
        try {
          const fallbackJson = JSON.parse(fallbackText);
          const events = fallbackJson?.events || [];
          for (const event of events) {
            if (!event.segs || !event.tStartMs) continue;
            const text = event.segs.map(s => s.utf8 || '').join('').replace(/\n/g, ' ').trim();
            if (text) lines.push({ start: event.tStartMs / 1000, text });
          }
        } catch(e) {}
      }
    }

    if (!lines.length) {
      return res.status(404).json({
        error: 'Could not load transcript for this video. Try a different video.'
      });
    }

    const title = playerData?.videoDetails?.title || 'YouTube Video';

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
