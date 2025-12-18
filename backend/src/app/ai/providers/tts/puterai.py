"""
PuterAI TTS Provider

Uses the PuterClient from putergenai for text-to-speech generation.
Handles token-based authentication with 6-hour refresh cycles.
Supports multiple tokens with automatic rotation on insufficient funds.
"""

import os
import asyncio
import time
import threading
import json
from typing import Optional, List, Set
from app.ai.custom_lib.putergenai import PuterClient
from app.ai.providers.tts.base import TTSProviderBase
from app.core.logger import setup_logging

TAG = __name__
logger = setup_logging()

# Token refresh interval: 1 hour in seconds
TOKEN_REFRESH_INTERVAL = 1 * 60 * 60


class TTSProvider(TTSProviderBase):
    """
    PuterAI TTS Provider
    
    Uses PuterClient from putergenai library for TTS generation.
    Automatically handles token authentication with refresh cycles.
    Supports multiple tokens (comma-separated) with automatic rotation on insufficient funds.
    
    Config options:
        - token: Puter API tokens (comma-separated for rotation)
        - username: Puter account username (or from PUTER_USERNAME env)
        - password: Puter account password (or from PUTER_PASSWORD env)
        - provider: TTS provider to use ("elevenlabs", "openai", etc.) default: "openai"
        - voice_id: Voice ID for ElevenLabs or voice name for OpenAI (optional)
        - model: Model name for ElevenLabs/OpenAI (optional)
        - instructions: Instructions for OpenAI TTS (optional)
        - format: Audio format (default: "mp3")
    """
    
    # Class-level token management for shared state across instances
    _token: Optional[str] = None
    _token_timestamp: float = 0
    _token_lock = threading.Lock()
    _exhausted_tokens: Set[str] = set()  # Track tokens with insufficient funds
    _current_token_index: int = 0
    
    def __init__(self, config, delete_audio_file):
        super().__init__(config, delete_audio_file)
        
        # Parse tokens (comma-separated) from config or environment
        token_str = config.get("token") or os.environ.get("PUTER_TOKEN", "")
        self.tokens: List[str] = [t.strip() for t in token_str.split(",") if t.strip()]
        
        # Authentication credentials from config or environment (used if no direct token)
        self.username = config.get("username") or os.environ.get("PUTER_USERNAME", "")
        self.password = config.get("password") or os.environ.get("PUTER_PASSWORD", "")
        
        if not self.tokens and (not self.username or not self.password):
            logger.bind(tag=TAG).warning(
                "PuterAI TTS: Missing credentials. Please set PUTER_TOKEN or PUTER_USERNAME/PUTER_PASSWORD."
            )
        
        # TTS configuration
        self.tts_provider = config.get("provider", "openai")
        
        # Voice and model options (customizable)
        self.voice_id = config.get("voice_id") or config.get("voice")
        self.model = config.get("model")
        self.instructions = config.get("instructions")
        
        # Audio format
        format_name = config.get("format", "mp3")
        self.audio_file_type = format_name
        
        # Output directory
        self.output_file = config.get("output_dir", "tmp/")
        
        # PuterClient instance (will be created per request)
        self._client: Optional[PuterClient] = None
        
        auth_mode = f"tokens({len(self.tokens)})" if self.tokens else "login"
        logger.bind(tag=TAG).info(
            f"Initialized PuterAI TTS provider: "
            f"auth={auth_mode}, provider={self.tts_provider}, voice={self.voice_id or 'default'}, "
            f"model={self.model or 'default'}, format={format_name}"
        )
    
    @classmethod
    def _is_token_valid(cls) -> bool:
        """Check if the current token is still valid (within refresh window)."""
        if not cls._token:
            return False
        
        elapsed = time.time() - cls._token_timestamp
        return elapsed < TOKEN_REFRESH_INTERVAL
    
    def _get_next_available_token(self) -> Optional[str]:
        """Get the next available token that hasn't been exhausted."""
        if not self.tokens:
            return None
        
        # Try to find a token that isn't exhausted
        for i in range(len(self.tokens)):
            idx = (self.__class__._current_token_index + i) % len(self.tokens)
            token = self.tokens[idx]
            if token not in self.__class__._exhausted_tokens:
                self.__class__._current_token_index = idx
                return token
        
        # All tokens exhausted, reset and try first one
        logger.bind(tag=TAG).warning("All tokens exhausted, resetting token pool")
        self.__class__._exhausted_tokens.clear()
        self.__class__._current_token_index = 0
        return self.tokens[0] if self.tokens else None
    
    def _mark_token_exhausted(self, token: str):
        """Mark a token as exhausted (insufficient funds)."""
        self.__class__._exhausted_tokens.add(token)
        logger.bind(tag=TAG).warning(f"Token exhausted (insufficient funds): {token[:20]}...")
    
    async def _ensure_token(self) -> str:
        """
        Ensure we have a valid token, refreshing if necessary.
        
        Returns:
            str: Valid authentication token
        """
        # If direct tokens are provided, use rotation
        if self.tokens:
            token = self._get_next_available_token()
            if token:
                logger.bind(tag=TAG).debug(f"Using token index {self.__class__._current_token_index}")
                return token
        
        # Fall back to login-based token
        with self.__class__._token_lock:
            if self.__class__._is_token_valid():
                return self.__class__._token
        
        # Token needs refresh via login
        logger.bind(tag=TAG).info("Refreshing PuterAI authentication token...")
        
        try:
            async with PuterClient() as client:
                token = await client.login(self.username, self.password)
                
                with self.__class__._token_lock:
                    self.__class__._token = token
                    self.__class__._token_timestamp = time.time()
                
                logger.bind(tag=TAG).info("PuterAI token refreshed successfully")
                return token
                
        except Exception as e:
            logger.bind(tag=TAG).error(f"Failed to refresh PuterAI token: {e}")
            raise ValueError(f"PuterAI authentication failed: {e}")
    
    async def _get_client(self) -> PuterClient:
        """Get a PuterClient instance with a valid token."""
        token = await self._ensure_token()
        return PuterClient(token=token)
    
    async def _try_tts_with_token(self, text: str, token: str) -> bytes:
        """
        Try TTS with a specific token.
        
        Returns:
            Audio bytes on success
            
        Raises:
            Exception with error code if insufficient_funds or other error
        """
        async with PuterClient(token=token) as client:
            audio_bytes = await client.ai_txt2speech(
                text=text,
                provider=self.tts_provider,
                voice=self.voice_id,
                model=self.model,
                instructions=self.instructions,
            )
        
        if not audio_bytes:
            raise Exception("PuterAI TTS returned empty response")
        
        # Check if response is a JSON error
        if audio_bytes[:1] == b'{':
            try:
                error_response = json.loads(audio_bytes.decode('utf-8'))
                if error_response.get("success") is False:
                    error_info = error_response.get("error", {})
                    error_code = error_info.get("code", "unknown")
                    error_message = error_info.get("message", "Unknown error")
                    
                    # Create exception with error code for handling
                    exc = Exception(f"PuterAI API error: {error_message} (code: {error_code})")
                    exc.error_code = error_code  # Attach error code
                    raise exc
            except json.JSONDecodeError:
                pass  # Not JSON, treat as audio bytes
        
        return audio_bytes
    
    async def text_to_speak(self, text: str, output_file: Optional[str]) -> Optional[bytes]:
        """
        Convert text to speech using PuterAI TTS.
        Automatically rotates to next token if current one has insufficient funds.
        """
        if not text or not text.strip():
            logger.bind(tag=TAG).warning("Empty text provided for TTS")
            return None
        
        try:
            text_length = len(text)
            logger.bind(tag=TAG).debug(
                f"Generating speech: text='{text[:50]}...', length={text_length}, "
                f"provider={self.tts_provider}, voice={self.voice_id or 'default'}"
            )
            
            # Try with token rotation
            max_attempts = len(self.tokens) + 1 if self.tokens else 1
            last_error = None
            
            for attempt in range(max_attempts):
                token = await self._ensure_token()
                
                try:
                    audio_bytes = await self._try_tts_with_token(text, token)
                    
                    logger.bind(tag=TAG).debug(f"Generated audio size: {len(audio_bytes)} bytes")
                    
                    # Save to file or return bytes
                    if output_file:
                        with open(output_file, "wb") as f:
                            f.write(audio_bytes)
                        logger.bind(tag=TAG).debug(f"Saved audio to {output_file}")
                        return None
                    else:
                        return audio_bytes
                        
                except Exception as e:
                    last_error = e
                    error_code = getattr(e, 'error_code', None)
                    
                    # If insufficient funds, mark token and try next
                    if error_code == "insufficient_funds" and self.tokens:
                        self._mark_token_exhausted(token)
                        logger.bind(tag=TAG).info(f"Trying next token (attempt {attempt + 2}/{max_attempts})")
                        continue
                    else:
                        # Other errors, don't retry
                        raise
            
            # All attempts exhausted
            if last_error:
                raise last_error
            raise Exception("No available tokens for PuterAI TTS")
                
        except ValueError as e:
            error_msg = f"PuterAI TTS authentication error: {e}"
            logger.bind(tag=TAG).error(error_msg)
            raise Exception(error_msg)
        except Exception as e:
            error_msg = f"PuterAI TTS request failed: {e}"
            logger.bind(tag=TAG).error(error_msg)
            raise Exception(error_msg)
    
    async def close(self):
        """Clean up resources."""
        await super().close()
        if self._client:
            await self._client.close()
            self._client = None
