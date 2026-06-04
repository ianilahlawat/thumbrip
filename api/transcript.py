from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import NoTranscriptFound, TranscriptsDisabled
from http.server import BaseHTTPRequestHandler
import json
import re
import urllib.request
import urllib.parse

class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        video_id = params.get('videoId', [''])[0]

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        if not video_id or not re.match(r'^[a-zA-Z0-9_-]{11}$', video_id):
            self.wfile.write(json.dumps({'error': 'Invalid video ID'}).encode())
            return

        try:
            # v1.x API — fetch directly, returns FetchedTranscript object
            ytt_api = YouTubeTranscriptApi()

            # Try English first, then auto-generated, then any language
            transcript_data = None
            try:
                transcript_data = ytt_api.fetch(video_id, languages=['en', 'en-US', 'en-GB'])
            except NoTranscriptFound:
                try:
                    # Try to get whatever language is available
                    transcript_list = ytt_api.list(video_id)
                    for t in transcript_list:
                        transcript_data = t.fetch()
                        break
                except Exception:
                    pass

            if not transcript_data:
                self.wfile.write(json.dumps({'error': 'No captions found for this video.'}).encode())
                return

            lines = []
            for snippet in transcript_data:
                text = snippet.text.strip() if hasattr(snippet, 'text') else str(snippet.get('text', '')).strip()
                start = snippet.start if hasattr(snippet, 'start') else float(snippet.get('start', 0))
                if text:
                    lines.append({'start': round(float(start), 2), 'text': text})

            if not lines:
                self.wfile.write(json.dumps({'error': 'Transcript is empty for this video.'}).encode())
                return

            # Get video title
            title = 'YouTube Video'
            try:
                url = f'https://noembed.com/embed?url=https://www.youtube.com/watch?v={video_id}'
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=5) as r:
                    oembed = json.loads(r.read().decode())
                    title = oembed.get('title', title)
            except Exception:
                pass

            result = {
                'title': title,
                'transcript': lines,
                'count': len(lines)
            }
            self.wfile.write(json.dumps(result).encode())

        except TranscriptsDisabled:
            self.wfile.write(json.dumps({'error': 'Transcripts are disabled for this video by the creator.'}).encode())
        except Exception as e:
            self.wfile.write(json.dumps({'error': f'Error: {str(e)}'}).encode())
