// File: api/transcript.js
// This is a Vercel serverless function that fetches YouTube transcripts server-side
// (bypassing CORS restrictions that block browser requests to YouTube)
// Deploy this file to your GitHub repo in an /api/ folder

export default async function handler(req, res) {
  // Allow CORS from your domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { videoId } = req.query;

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

  try {
    // Fetch YouTube video page server-side (no CORS issues here)
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    const html = await response.text();

    // Extract caption tracks
    const captionMatch = html.match(/"captionTracks":\s*(\[.*?\])/s);
    if (!captionMatch) {
      return res.status(404).json({ error: 'No captions found for this video. The video may not have subtitles enabled.' });
    }

    const captions = JSON.parse(captionMatch[1]);
    const track = captions.find(t => t.languageCode === 'en' || t.languageCode === 'en-US') || captions[0];

    if (!track) {
      return res.status(404).json({ error: 'No English captions found.' });
    }

    // Fetch the actual caption file
    const captionResponse = await fetch(track.baseUrl);
    const captionXml = await captionResponse.text();

    // Parse XML and extract text + timestamps
    const lines = [];
    const regex = /<text start="([^"]+)"[^>]*>([^<]*)<\/text>/g;
    let match;
    while ((match = regex.exec(captionXml)) !== null) {
      const start = parseFloat(match[1]);
      const text = match[2]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (text) lines.push({ start, text });
    }

    // Also get video title from oEmbed
    let title = 'YouTube Video';
    try {
      const oembedRes = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
      const oembed = await oembedRes.json();
      title = oembed.title || title;
    } catch(e) {}

    return res.status(200).json({ title, transcript: lines, language: track.languageCode });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch transcript. Please try again.' });
  }
}
