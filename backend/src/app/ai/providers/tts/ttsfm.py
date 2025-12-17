"""
TTSFM WebSocket TTS Provider

Uses WebSocket connection to ws://ttsapi.site/ws/generate for real-time TTS streaming.
"""

import json
import base64
import asyncio
import websockets
from typing import Optional
from app.ai.providers.tts.base import TTSProviderBase
from app.core.logger import setup_logging

TAG = __name__
logger = setup_logging()


class TTSProvider(TTSProviderBase):
    def __init__(self, config, delete_audio_file):
        super().__init__(config, delete_audio_file)
        
        # WebSocket endpoint - try ws_url first, then api_url as fallback
        ws_url = config.get("ws_url") or config.get("api_url") or "ws://ttsapi.site/ws/generate"
        
        # Validate and fix URL scheme
        self.ws_url = self._normalize_ws_url(ws_url)
        
        # TTS parameters
        if config.get("private_voice"):
            self.voice = config.get("private_voice")
        else:
            self.voice = config.get("voice", "alloy")
        
        self.format = config.get("format", "mp3")
        self.audio_file_type = self.format
        
        # Speed parameter
        speed = config.get("speed", "1.0")
        self.speed = float(speed) if speed else 1.0
        
        # Connection timeout
        self.timeout = config.get("timeout", 30)
        
        logger.bind(tag=TAG).info(
            f"Initialized TTSFM WebSocket TTS provider: ws_url={self.ws_url}, "
            f"voice={self.voice}, format={self.format}, speed={self.speed}"
        )

    def _normalize_ws_url(self, url: str) -> str:
        """
        Normalize URL to use WebSocket scheme (ws:// or wss://).
        Converts http:// to ws:// and https:// to wss://.
        """
        if not url:
            return "ws://ttsapi.site/ws/generate"
        
        original_url = url
        
        # Convert HTTP schemes to WebSocket schemes
        if url.startswith("https://"):
            url = "wss://" + url[8:]
            logger.bind(tag=TAG).warning(
                f"URL scheme converted: {original_url} -> {url}"
            )
        elif url.startswith("http://"):
            url = "ws://" + url[7:]
            logger.bind(tag=TAG).warning(
                f"URL scheme converted: {original_url} -> {url}"
            )
        elif not url.startswith("ws://") and not url.startswith("wss://"):
            # Add ws:// if no scheme provided
            url = "ws://" + url
            logger.bind(tag=TAG).warning(
                f"Added ws:// scheme: {original_url} -> {url}"
            )
        
        return url


    async def text_to_speak(self, text: str, output_file: Optional[str]) -> Optional[bytes]:
        """
        Convert text to speech using TTSFM WebSocket API.
        
        Args:
            text: Text to convert
            output_file: Path to save audio file (if None, returns bytes)
            
        Returns:
            Audio bytes if output_file is None, otherwise None
        """
        try:
            # Connect to WebSocket
            async with websockets.connect(
                self.ws_url,
                ping_interval=20,
                ping_timeout=10,
                close_timeout=10,
            ) as websocket:
                # Send TTS request
                request = {
                    "text": text,
                    "voice": self.voice,
                    "format": self.format,
                    "speed": self.speed,
                }
                
                logger.bind(tag=TAG).debug(
                    f"Sending TTS request: text='{text[:50]}...', voice={self.voice}"
                )
                
                await websocket.send(json.dumps(request))
                
                # Collect audio chunks
                audio_chunks = []
                generation_started = False
                
                # Wait for response with timeout
                try:
                    async with asyncio.timeout(self.timeout):
                        async for message in websocket:
                            try:
                                event = json.loads(message)
                                event_type = event.get("type") or event.get("event")
                                
                                if event_type == "start":
                                    generation_started = True
                                    logger.bind(tag=TAG).debug("TTS generation started")
                                    
                                elif event_type == "chunk":
                                    # Decode base64 audio chunk
                                    chunk_data = event.get("data") or event.get("chunk")
                                    if chunk_data:
                                        audio_data = base64.b64decode(chunk_data)
                                        audio_chunks.append(audio_data)
                                        logger.bind(tag=TAG).debug(
                                            f"Received audio chunk: {len(audio_data)} bytes"
                                        )
                                    
                                elif event_type == "complete":
                                    logger.bind(tag=TAG).debug(
                                        f"TTS generation complete: {len(audio_chunks)} chunks received"
                                    )
                                    break
                                    
                                elif event_type == "error":
                                    error_msg = event.get("error", {}).get("message", "Unknown error")
                                    error_code = event.get("error", {}).get("code", "unknown")
                                    hint = event.get("error", {}).get("hint", "")
                                    
                                    raise Exception(
                                        f"TTSFM API error [{error_code}]: {error_msg}. {hint}"
                                    )
                                    
                            except json.JSONDecodeError as e:
                                logger.bind(tag=TAG).warning(
                                    f"Failed to parse WebSocket message: {e}"
                                )
                                continue
                                
                except asyncio.TimeoutError:
                    raise Exception(
                        f"TTS generation timeout after {self.timeout}s. "
                        f"Received {len(audio_chunks)} chunks."
                    )
                
                # Combine all chunks
                if not audio_chunks:
                    raise Exception("No audio data received from TTSFM API")
                
                audio_bytes = b"".join(audio_chunks)
                logger.bind(tag=TAG).debug(
                    f"Total audio size: {len(audio_bytes)} bytes"
                )
                
                # Save to file or return bytes
                if output_file:
                    with open(output_file, "wb") as f:
                        f.write(audio_bytes)
                    logger.bind(tag=TAG).debug(f"Saved audio to {output_file}")
                    return None
                else:
                    return audio_bytes
                    
        except websockets.exceptions.WebSocketException as e:
            error_msg = f"TTSFM WebSocket connection failed: {e}"
            logger.bind(tag=TAG).error(error_msg)
            raise Exception(error_msg)
            
        except Exception as e:
            error_msg = f"TTSFM TTS request failed: {e}"
            logger.bind(tag=TAG).error(error_msg)
            raise Exception(error_msg)
