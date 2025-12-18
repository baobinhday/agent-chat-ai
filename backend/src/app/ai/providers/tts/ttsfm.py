"""
TTSFM TTS Provider

Uses the TTSFM Python package for text-to-speech generation.
"""

from typing import Optional
from ttsfm import AsyncTTSClient, Voice, AudioFormat
from app.ai.providers.tts.base import TTSProviderBase
from app.core.logger import setup_logging

TAG = __name__
logger = setup_logging()

# Voice mapping from string to Voice enum
VOICE_MAP = {
    "alloy": Voice.ALLOY,
    "ash": Voice.ASH,
    "ballad": Voice.BALLAD,
    "coral": Voice.CORAL,   
    "echo": Voice.ECHO,
    "fable": Voice.FABLE,
    "nova": Voice.NOVA,
    "onyx": Voice.ONYX,
    "sage": Voice.SAGE,
    "shimmer": Voice.SHIMMER,
    "verse": Voice.VERSE,
}

# Audio format mapping from string to AudioFormat enum
FORMAT_MAP = {
    "mp3": AudioFormat.MP3,
    "opus": AudioFormat.OPUS,
    "aac": AudioFormat.AAC,
    "flac": AudioFormat.FLAC,
    "wav": AudioFormat.WAV,
    "pcm": AudioFormat.PCM,
}


class TTSProvider(TTSProviderBase):
    def __init__(self, config, delete_audio_file):
        super().__init__(config, delete_audio_file)
        
        # TTS parameters
        voice_name = config.get("private_voice") or config.get("voice", "alloy")
        self.voice = VOICE_MAP.get(voice_name.lower(), Voice.ALLOY)
        self.voice_name = voice_name
        
        format_name = config.get("format", "mp3")
        self.response_format = FORMAT_MAP.get(format_name.lower(), AudioFormat.MP3)
        self.audio_file_type = format_name
        
        # Speed parameter
        speed = config.get("speed", "1.0")
        self.speed = float(speed) if speed else 1.0
        
        # Initialize the async client (uses default ttsapi.site)
        self.client = AsyncTTSClient()
        
        logger.bind(tag=TAG).info(
            f"Initialized TTSFM TTS provider: "
            f"voice={self.voice_name}, format={format_name}, speed={self.speed}"
        )

    async def text_to_speak(self, text: str, output_file: Optional[str]) -> Optional[bytes]:
        """
        Convert text to speech using TTSFM Python package.
        
        Args:
            text: Text to convert
            output_file: Path to save audio file (if None, returns bytes)
            
        Returns:
            Audio bytes if output_file is None, otherwise None
        """
        try:
            text_length = len(text)
            logger.bind(tag=TAG).debug(
                f"Generating speech: text='{text[:50]}...', length={text_length}, voice={self.voice_name}"
            )
            
            # Check if text is long (>1000 chars) and use auto_combine mode
            if text_length > 1000:
                logger.bind(tag=TAG).debug(
                    f"Long text detected ({text_length} chars), using auto_combine mode"
                )
                response = await self.client.generate_speech(
                    text=text,
                    voice=self.voice,
                    response_format=self.response_format,
                    speed=self.speed,
                    auto_combine=True,
                )
            else:
                # Short text, use regular generate_speech
                response = await self.client.generate_speech(
                    text=text,
                    voice=self.voice,
                    response_format=self.response_format,
                    speed=self.speed,
                )
            
            # Save to file or return bytes
            if output_file:
                response.save_to_file(output_file)
                logger.bind(tag=TAG).debug(f"Saved audio to {output_file}")
                return None
            else:
                # Get audio bytes from response
                audio_bytes = response.content
                logger.bind(tag=TAG).debug(
                    f"Generated audio size: {len(audio_bytes)} bytes"
                )
                return audio_bytes
                
        except Exception as e:
            error_msg = f"TTSFM TTS request failed: {e}"
            logger.bind(tag=TAG).error(error_msg)
            raise Exception(error_msg)
