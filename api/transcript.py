from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled
import json
import re

def handler(request, response):
    # Set CORS headers
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET'
    response.headers['Content-Type'] = 'application/json'

    video_id = request.args.get('videoId', '')

    if not video_id or not re.match(r'^[a-zA-Z0-9_-]{11}$', video_id):
        response.status_code = 400
        return response.send(json.dumps({'error': 'Invalid video ID'}))

    try:
        # Get list of available transcripts
        transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)

        # Try to get English transcript (manual first, then auto-generated)
        transcript = None
        try:
            transcript = transcript_list.find_manually_created_transcript(['en', 'en-US', 'en-GB'])
        except NoTranscriptFound:
            try:
                transcript = transcript_list.find_generated_transcript(['en', 'en-US'])
            except NoTranscriptFound:
                # Get whatever is available
                for t in transcript_list:
                    transcript = t
                    break

        if not transcript:
            response.status_code = 404
            return response.send(json.dumps({'error': 'No captions found for this video.'}))

        # Fetch the actual transcript data
        data = transcript.fetch()

        lines = []
        for item in data:
            text = item.get('text', '').strip()
            start = item.get('start', 0)
            if text and text != '[Music]' and text != '[Applause]':
                lines.append({'start': round(start, 2), 'text': text})

        if not lines:
            response.status_code = 404
            return response.send(json.dumps({'error': 'Transcript is empty for this video.'}))

        # Get video title via noembed
        import urllib.request
        title = 'YouTube Video'
        try:
            url = f'https://noembed.com/embed?url=https://www.youtube.com/watch?v={video_id}'
            with urllib.request.urlopen(url, timeout=5) as r:
                oembed = json.loads(r.read().decode())
                title = oembed.get('title', title)
        except:
            pass

        response.status_code = 200
        return response.send(json.dumps({
            'title': title,
            'transcript': lines,
            'language': transcript.language_code,
            'trackName': transcript.language,
            'count': len(lines)
        }))

    except TranscriptsDisabled:
        response.status_code = 404
        return response.send(json.dumps({'error': 'Transcripts are disabled for this video by the creator.'}))
    except Exception as e:
        response.status_code = 500
        return response.send(json.dumps({'error': f'Could not fetch transcript: {str(e)}'}))
