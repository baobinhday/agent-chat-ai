"""
PuterAI ElevenLabs TTS Provider

Uses the PuterClient from putergenai for text-to-speech generation with ElevenLabs backend.
This is a convenience wrapper that sets provider="elevenlabs" automatically.
"""

from app.ai.providers.tts.puterai import TTSProvider as PuterAITTSProvider


class TTSProvider(PuterAITTSProvider):
    """
    PuterAI TTS Provider with ElevenLabs backend.
    
    Config options:
        - username: Puter account username (or from PUTER_USERNAME env)
        - password: Puter account password (or from PUTER_PASSWORD env)
        - voice_id: ElevenLabs Voice ID
        - model: Model name (eleven_multilingual_v2, eleven_flash_v2_5, eleven_turbo_v2_5, eleven_v3)
        - format: Audio format (default: "mp3")
    """
    
    def __init__(self, config, delete_audio_file):
        # Force provider to ElevenLabs
        config = dict(config) if config else {}
        config["provider"] = "elevenlabs"
        
        super().__init__(config, delete_audio_file)
