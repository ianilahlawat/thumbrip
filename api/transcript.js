// api/transcript.js
// Vercel serverless function - fetches YouTube transcripts server-side

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { videoId } = req.query;

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

  try {
    // Fetch YouTube page server-side
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    });

    const html = await response.text();

    // Extract caption tracks from YouTube's page data
    // YouTube embeds this as JSON inside a script tag
    let captions = [];

    // Method 1: try ytInitialPlayerResponse
    const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?})\s*;/s);
    if (playerMatch) {
      try {
        const playerData = JSON.parse(playerMatch[1]);
        const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (captionTracks?.length) captions = captionTracks;
      } catch(e) {}
    }

    // Method 2: fallback - extract captionTracks directly
    if (!captions.length) {
      const captionMatch = html.match(/"captionTracks"\s*:\s*(\[[\s\S]*?\])\s*,\s*"audioTracks"/);
      if (captionMatch) {
        try { captions = JSON.parse(captionMatch[1]); } catch(e) {}
      }
    }

    // Method 3: broader fallback
    if (!captions.length) {
      const broadMatch = html.match(/"captionTracks"\s*:\s*(\[[\s\S]*?\])/);
      if (broadMatch) {
        try { captions = JSON.parse(broadMatch[1]); } catch(e) {}
      }
    }

    if (!captions.length) {
      return res.status(404).json({
        error: 'No captions found for this video. The video may not have subtitles enabled.'
      });
    }

    // Prefer English, then English auto-generated, then first available
    const track =
      captions.find(t => t.languageCode === 'en' && !t.kind) ||
      captions.find(t => t.languageCode === 'en-US' && !t.kind) ||
      captions.find(t => t.languageCode === 'en') ||
      captions.find(t => t.languageCode === 'en-US') ||
      captions[0];

    if (!track?.baseUrl) {
      return res.status(404).json({ error: 'Could not find caption track URL.' });
    }

    // Fetch the caption XML
    const captionRes = await fetch(track.baseUrl + '&fmt=json3');
    const captionText = await captionRes.text();

    let lines = [];

    // Try JSON3 format first (newer YouTube format)
    try {
      const captionJson = JSON.parse(captionText);
      const events = captionJson?.events || [];
      events.forEach(event => {
        if (!event.segs) return;
        const text = event.segs
          .map(s => s.utf8 || '')
          .join('')
          .replace(/\n/g, ' ')
          .trim();
        if (text && text !== '\n') {
          lines.push({
            start: (event.tStartMs || 0) / 1000,
            text: text
          });
        }
      });
    } catch(e) {
      // JSON3 parse failed, try XML format
      lines = [];
    }

    // If JSON3 failed or returned nothing, fetch as XML
    if (!lines.length) {
      const xmlRes = await fetch(track.baseUrl);
      const xmlText = await xmlRes.text();

      // Parse XML manually — handle both formats YouTube uses
      // Format 1: <text start="1.234" dur="2.345">content</text>
      // Format 2: <text start="1.234" dur="2.345" xml:space="preserve">content</text>
      const xmlRegex = /<text[^>]+start="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g;
      let m;
      while ((m = xmlRegex.exec(xmlText)) !== null) {
        const start = parseFloat(m[1]);
        const raw = m[2];
        const text = raw
          .replace(/<[^>]+>/g, '')   // strip inner tags
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&nbsp;/g, ' ')
          .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
          .trim();
        if (text) lines.push({ start, text });
      }
    }

    if (!lines.length) {
      return res.status(404).json({
        error: 'Transcript is empty. This video may have auto-captions disabled or an unsupported caption format.'
      });
    }

    // Get video title
    let title = 'YouTube Video';
    try {
      const oembedRes = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
      const oembed = await oembedRes.json();
      if (oembed.title) title = oembed.title;
    } catch(e) {}

    return res.status(200).json({
      title,
      transcript: lines,
      language: track.languageCode,
      trackName: track.name?.simpleText || track.languageCode
    });

  } catch (error) {
    console.error('Transcript error:', error);
    return res.status(500).json({
      error: 'Failed to fetch transcript. Please try again in a moment.'
    });
  }
}
