// api/transcript.js - DEBUG V2
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { videoId } = req.query;
  if (!videoId) return res.status(400).json({ error: 'No videoId' });

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

    if (!playerData) return res.status(500).json({ error: 'Could not parse playerData' });

    const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captionTracks?.length) return res.status(404).json({ error: 'No caption tracks found in playerData', captionsObject: JSON.stringify(playerData?.captions)?.substring(0, 500) });

    const track = captionTracks.find(t => t.languageCode === 'en') || captionTracks[0];

    // Fetch raw XML (no fmt param)
    const xmlRes = await fetch(track.baseUrl);
    const xmlText = await xmlRes.text();

    // Fetch JSON3
    const jsonRes = await fetch(track.baseUrl + '&fmt=json3');
    const jsonText = await jsonRes.text();

    return res.status(200).json({
      trackLanguage: track.languageCode,
      trackKind: track.kind,
      trackName: track.name?.simpleText,
      baseUrlStart: track.baseUrl?.substring(0, 100),
      xmlLength: xmlText.length,
      xmlFirst300: xmlText.substring(0, 300),
      json3Length: jsonText.length,
      json3First300: jsonText.substring(0, 300),
      totalTracks: captionTracks.length,
      allTracks: captionTracks.map(t => ({ lang: t.languageCode, kind: t.kind, name: t.name?.simpleText }))
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
