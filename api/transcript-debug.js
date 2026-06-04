// api/transcript.js - DEBUG VERSION
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
    const htmlLen = html.length;

    // Check what's in the page
    const hasCaptionTracks = html.includes('"captionTracks"');
    const hasPlayerResponse = html.includes('ytInitialPlayerResponse');
    const hasInitialData = html.includes('ytInitialData');
    const hasBotCheck = html.includes('consent') || html.includes('captcha');
    const first500 = html.substring(0, 500);

    return res.status(200).json({
      debug: true,
      htmlLength: htmlLen,
      hasCaptionTracks,
      hasPlayerResponse,
      hasInitialData,
      hasBotCheck,
      first500chars: first500,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries())
    });

  } catch(e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
}
