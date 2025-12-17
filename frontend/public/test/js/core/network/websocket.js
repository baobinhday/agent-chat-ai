// WebSocket Message Handler Module
import { log } from '../../utils/logger.js';
import { addMessage } from '../../ui/dom-helper.js';
import { webSocketConnect } from './ota-connector.js';
import { getConfig, saveConnectionUrls } from '../../config/manager.js';
import { getAudioPlayer } from '../audio/player.js';
import { getAudioRecorder } from '../audio/recorder.js';
import { getMcpTools, executeMcpTool, setWebSocket as setMcpWebSocket } from '../mcp/tools.js';

// WebSocket Handler Class
export class WebSocketHandler {
    constructor() {
        this.websocket = null;
        this.onConnectionStateChange = null;
        this.onRecordButtonStateChange = null;
        this.onSessionStateChange = null;
        this.onSessionEmotionChange = null;
        this.currentSessionId = null;
        this.isRemoteSpeaking = false;
    }

    // Send hello handshake message
    async sendHelloMessage() {
        if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) return false;

        try {
            const config = getConfig();

            const helloMessage = {
                type: 'hello',
                device_id: config.deviceId,
                device_name: config.deviceName,
                device_mac: config.deviceMac,
                token: config.token,
                features: {
                    mcp: true
                }
            };

            log('Sending hello handshake message', 'info');
            this.websocket.send(JSON.stringify(helloMessage));

            return new Promise(resolve => {
                const timeout = setTimeout(() => {
                    log('Timeout waiting for hello response', 'error');
                    log('Tip: Please try clicking the "Test Auth" button to troubleshoot connection', 'info');
                    resolve(false);
                }, 5000);

                const onMessageHandler = (event) => {
                    try {
                        const response = JSON.parse(event.data);
                        if (response.type === 'hello' && response.session_id) {
                            log(`Server handshake successful, session ID: ${response.session_id}`, 'success');
                            clearTimeout(timeout);
                            this.websocket.removeEventListener('message', onMessageHandler);
                            resolve(true);
                        }
                    } catch (e) {
                        // Ignore non-JSON messages
                    }
                };

                this.websocket.addEventListener('message', onMessageHandler);
            });
        } catch (error) {
            log(`Error sending hello message: ${error.message}`, 'error');
            return false;
        }
    }

    // Handle text messages
    handleTextMessage(message) {
        if (message.type === 'hello') {
            log(`Server response: ${JSON.stringify(message, null, 2)}`, 'success');
        } else if (message.type === 'tts') {
            this.handleTTSMessage(message);
        } else if (message.type === 'audio') {
            log(`Received audio control message: ${JSON.stringify(message)}`, 'info');
        } else if (message.type === 'stt') {
            log(`Recognition result: ${message.text}`, 'info');
            addMessage(`${message.text}`, true);
        } else if (message.type === 'llm') {
            log(`LLM reply: ${message.text}`, 'info');

            // If it contains an emoji, update sessionStatus emoji
            if (message.text && /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(message.text)) {
                // Extract emoji
                const emojiMatch = message.text.match(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u);
                if (emojiMatch && this.onSessionEmotionChange) {
                    this.onSessionEmotionChange(emojiMatch[0]);
                }
            }

            // Add to conversation only if text is not just an emoji
            // Check if there is content after removing emojis
            const textWithoutEmoji = message.text ? message.text.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim() : '';
            if (textWithoutEmoji) {
                addMessage(message.text);
            }
        } else if (message.type === 'mcp') {
            this.handleMCPMessage(message);
        } else {
            log(`Unknown message type: ${message.type}`, 'info');
            addMessage(JSON.stringify(message, null, 2));
        }
    }

    // Handle TTS messages
    handleTTSMessage(message) {
        if (message.state === 'start') {
            log('Server started sending audio', 'info');
            this.currentSessionId = message.session_id;
            this.isRemoteSpeaking = true;
            if (this.onSessionStateChange) {
                this.onSessionStateChange(true);
            }
        } else if (message.state === 'sentence_start') {
            log(`Server sending audio segment: ${message.text}`, 'info');
            if (message.text) {
                addMessage(message.text);
            }
        } else if (message.state === 'sentence_end') {
            log(`Audio segment ended: ${message.text}`, 'info');
        } else if (message.state === 'stop') {
            log('Server audio transmission ended, clearing all audio buffers', 'info');

            // Clear all audio buffers and stop playback
            const audioPlayer = getAudioPlayer();
            audioPlayer.clearAllAudio();

            this.isRemoteSpeaking = false;
            if (this.onRecordButtonStateChange) {
                this.onRecordButtonStateChange(false);
            }
            if (this.onSessionStateChange) {
                this.onSessionStateChange(false);
            }
        }
    }

    // Handle MCP messages
    handleMCPMessage(message) {
        const payload = message.payload || {};
        log(`Server sent: ${JSON.stringify(message)}`, 'info');

        if (payload.method === 'tools/list') {
            const tools = getMcpTools();

            const replyMessage = JSON.stringify({
                "session_id": message.session_id || "",
                "type": "mcp",
                "payload": {
                    "jsonrpc": "2.0",
                    "id": payload.id,
                    "result": {
                        "tools": tools
                    }
                }
            });
            log(`Client report: ${replyMessage}`, 'info');
            this.websocket.send(replyMessage);
            log(`Replying with MCP tool list: ${tools.length} tools`, 'info');

        } else if (payload.method === 'tools/call') {
            const toolName = payload.params?.name;
            const toolArgs = payload.params?.arguments;

            log(`Calling tool: ${toolName} Args: ${JSON.stringify(toolArgs)}`, 'info');

            const result = executeMcpTool(toolName, toolArgs);

            const replyMessage = JSON.stringify({
                "session_id": message.session_id || "",
                "type": "mcp",
                "payload": {
                    "jsonrpc": "2.0",
                    "id": payload.id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": JSON.stringify(result)
                            }
                        ],
                        "isError": false
                    }
                }
            });

            log(`Client report: ${replyMessage}`, 'info');
            this.websocket.send(replyMessage);
        } else if (payload.method === 'initialize') {
            log(`Received tool init request: ${JSON.stringify(payload.params)}`, 'info');
        } else {
            log(`Unknown MCP method: ${payload.method}`, 'warning');
        }
    }

    // Handle binary messages
    async handleBinaryMessage(data) {
        try {
            let arrayBuffer;
            if (data instanceof ArrayBuffer) {
                arrayBuffer = data;
                log(`Received ArrayBuffer audio data, size: ${data.byteLength} bytes`, 'debug');
            } else if (data instanceof Blob) {
                arrayBuffer = await data.arrayBuffer();
                log(`Received Blob audio data, size: ${arrayBuffer.byteLength} bytes`, 'debug');
            } else {
                log(`Received unknown binary data type: ${typeof data}`, 'warning');
                return;
            }

            const opusData = new Uint8Array(arrayBuffer);
            const audioPlayer = getAudioPlayer();
            audioPlayer.enqueueAudioData(opusData);
        } catch (error) {
            log(`Error handling binary message: ${error.message}`, 'error');
        }
    }

    // Connect to WebSocket server
    async connect() {
        const config = getConfig();
        log('Checking OTA status...', 'info');
        saveConnectionUrls();

        try {
            const otaUrl = document.getElementById('otaUrl').value.trim();
            const ws = await webSocketConnect(otaUrl, config);
            if (ws === undefined) {
                return false;
            }
            this.websocket = ws;

            // Set binary type to ArrayBuffer
            this.websocket.binaryType = 'arraybuffer';

            // Set WebSocket instance for MCP module
            setMcpWebSocket(this.websocket);

            // Set WebSocket for audio recorder
            const audioRecorder = getAudioRecorder();
            audioRecorder.setWebSocket(this.websocket);

            this.setupEventHandlers();

            return true;
        } catch (error) {
            log(`Connection error: ${error.message}`, 'error');
            if (this.onConnectionStateChange) {
                this.onConnectionStateChange(false);
            }
            return false;
        }
    }

    // Set event handlers
    setupEventHandlers() {
        this.websocket.onopen = async () => {
            const url = document.getElementById('serverUrl').value;
            log(`Connected to server: ${url}`, 'success');

            if (this.onConnectionStateChange) {
                this.onConnectionStateChange(true);
            }

            // After successful connection, default state is listening
            this.isRemoteSpeaking = false;
            if (this.onSessionStateChange) {
                this.onSessionStateChange(false);
            }

            await this.sendHelloMessage();
        };

        this.websocket.onclose = () => {
            log('Disconnected', 'info');

            if (this.onConnectionStateChange) {
                this.onConnectionStateChange(false);
            }

            const audioRecorder = getAudioRecorder();
            audioRecorder.stop();
        };

        this.websocket.onerror = (error) => {
            log(`WebSocket Error: ${error.message || 'Unknown error'}`, 'error');

            if (this.onConnectionStateChange) {
                this.onConnectionStateChange(false);
            }
        };

        this.websocket.onmessage = (event) => {
            try {
                if (typeof event.data === 'string') {
                    const message = JSON.parse(event.data);
                    this.handleTextMessage(message);
                } else {
                    this.handleBinaryMessage(event.data);
                }
            } catch (error) {
                log(`WebSocket message handling error: ${error.message}`, 'error');
                if (typeof event.data === 'string') {
                    addMessage(event.data);
                }
            }
        };
    }

    // Disconnect
    disconnect() {
        if (!this.websocket) return;

        this.websocket.close();
        const audioRecorder = getAudioRecorder();
        audioRecorder.stop();
    }

    // Send text message
    sendTextMessage(text) {
        if (text === '' || !this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
            return false;
        }

        try {
            // If remote is speaking, send abort message first
            if (this.isRemoteSpeaking && this.currentSessionId) {
                const abortMessage = {
                    session_id: this.currentSessionId,
                    type: 'abort',
                    reason: 'wake_word_detected'
                };
                this.websocket.send(JSON.stringify(abortMessage));
                log('Sent abort message', 'info');
            }

            const listenMessage = {
                type: 'listen',
                mode: 'manual',
                state: 'detect',
                text: text
            };

            this.websocket.send(JSON.stringify(listenMessage));
            log(`Sent text message: ${text}`, 'info');

            return true;
        } catch (error) {
            log(`Error sending message: ${error.message}`, 'error');
            return false;
        }
    }

    // Get WebSocket instance
    getWebSocket() {
        return this.websocket;
    }

    // Check if connected
    isConnected() {
        return this.websocket && this.websocket.readyState === WebSocket.OPEN;
    }
}

// Create singleton
let wsHandlerInstance = null;

export function getWebSocketHandler() {
    if (!wsHandlerInstance) {
        wsHandlerInstance = new WebSocketHandler();
    }
    return wsHandlerInstance;
}
