#!/usr/bin/env python3
"""
Simple script to get YouTube transcripts using youtube-transcript-api
This library accesses YouTube's transcript API directly without downloading video
"""
import sys
import json
from youtube_transcript_api import YouTubeTranscriptApi
from urllib.parse import urlparse, parse_qs

def extract_video_id(url):
    """Extract video ID from YouTube URL"""
    parsed = urlparse(url)

    if parsed.hostname in ('youtu.be', 'www.youtu.be'):
        return parsed.path[1:]

    if parsed.hostname in ('youtube.com', 'www.youtube.com'):
        if parsed.path == '/watch':
            return parse_qs(parsed.query)['v'][0]
        elif parsed.path.startswith('/embed/'):
            return parsed.path.split('/')[2]
        elif parsed.path.startswith('/v/'):
            return parsed.path.split('/')[2]

    return None

def get_transcript(video_url):
    """Get transcript from YouTube video"""
    try:
        video_id = extract_video_id(video_url)
        if not video_id:
            return {"error": "Invalid YouTube URL"}

        # Get transcript
        transcript = YouTubeTranscriptApi.get_transcript(video_id)

        # Format response
        return {
            "success": True,
            "transcript": transcript,
            "video_id": video_id
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: get_transcript.py <youtube_url>"}))
        sys.exit(1)

    result = get_transcript(sys.argv[1])
    print(json.dumps(result))
