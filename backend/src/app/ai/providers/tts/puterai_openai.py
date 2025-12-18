"""
PuterAI OpenAI TTS Provider

Uses the PuterClient from putergenai for text-to-speech generation with OpenAI backend.
This is a convenience wrapper that sets provider="openai" automatically.
"""

from app.ai.providers.tts.puterai import TTSProvider as PuterAITTSProvider


class TTSProvider(PuterAITTSProvider):
    """
    PuterAI TTS Provider with OpenAI backend.
    
    Config options:
        - username: Puter account username (or from PUTER_USERNAME env)
        - password: Puter account password (or from PUTER_PASSWORD env)
        - voice: Voice name (alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse)
        - model: Model name (gpt-4o-mini-tts)
        - instructions: Instructions for voice style
        - format: Audio format (default: "mp3")
    """
    
    def __init__(self, config, delete_audio_file):
        # Force provider to OpenAI
        config = dict(config) if config else {}
        config["provider"] = "openai"
        
        # Map 'voice' to 'voice_id' for consistency with base class
        if "voice" in config and "voice_id" not in config:
            config["voice_id"] = config["voice"]
        
        super().__init__(config, delete_audio_file)
