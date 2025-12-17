import BlockingQueue from '../../utils/blocking-queue.js';
import { log } from '../../utils/logger.js';

// Streaming audio playback context class
export class StreamingContext {
    constructor(opusDecoder, audioContext, sampleRate, channels, minAudioDuration) {
        this.opusDecoder = opusDecoder;
        this.audioContext = audioContext;

        // Audio parameters
        this.sampleRate = sampleRate;
        this.channels = channels;
        this.minAudioDuration = minAudioDuration;

        // Initialize queues and state
        this.queue = [];          // Decoded PCM queue. Currently playing.
        this.activeQueue = new BlockingQueue(); // Decoded PCM queue. Ready to play.
        this.pendingAudioBufferQueue = [];  // Pending buffer queue
        this.audioBufferQueue = new BlockingQueue();  // Buffer queue
        this.playing = false;     // Is playing?
        this.endOfStream = false; // Received end signal?
        this.source = null;       // Current audio source
        this.totalSamples = 0;    // Total accumulated samples
        this.lastPlayTime = 0;    // Last play timestamp
        this.scheduledEndTime = 0; // Scheduled end time of audio
    }

    // Buffer audio array
    pushAudioBuffer(item) {
        this.audioBufferQueue.enqueue(...item);
    }

    // Get pending audio buffer queue, single thread: safe as long as audioBufferQueue is constantly updated
    async getPendingAudioBufferQueue() {
        // Wait for data and retrieve
        const data = await this.audioBufferQueue.dequeue();
        // Assign to pending queue
        this.pendingAudioBufferQueue = data;
    }

    // Get active decoded PCM queue, single thread: safe as long as activeQueue is constantly updated
    async getQueue(minSamples) {
        const num = minSamples - this.queue.length > 0 ? minSamples - this.queue.length : 1;

        // Wait for data and retrieve
        const tempArray = await this.activeQueue.dequeue(num);
        this.queue.push(...tempArray);
    }

    // Convert Int16 audio data to Float32 audio data
    convertInt16ToFloat32(int16Data) {
        const float32Data = new Float32Array(int16Data.length);
        for (let i = 0; i < int16Data.length; i++) {
            // Convert [-32768, 32767] range to [-1, 1], using 32768.0 to avoid asymmetric distortion
            float32Data[i] = int16Data[i] / 32768.0;
        }
        return float32Data;
    }

    // Get pending decode packet count
    getPendingDecodeCount() {
        return this.audioBufferQueue.length + this.pendingAudioBufferQueue.length;
    }

    // Get pending play sample count (converted to packets, 960 samples per packet)
    getPendingPlayCount() {
        // Calculate samples currently in queue
        const queuedSamples = this.activeQueue.length + this.queue.length;

        // Calculate scheduled but not yet played samples (in Web Audio buffer)
        let scheduledSamples = 0;
        if (this.playing && this.scheduledEndTime) {
            const currentTime = this.audioContext.currentTime;
            const remainingTime = Math.max(0, this.scheduledEndTime - currentTime);
            scheduledSamples = Math.floor(remainingTime * this.sampleRate);
        }

        const totalSamples = queuedSamples + scheduledSamples;
        return Math.ceil(totalSamples / 960);
    }

    // Clear all audio buffers
    clearAllBuffers() {
        log('Clear all audio buffers', 'info');

        // Clear all queues (use clear method to preserve object reference)
        this.audioBufferQueue.clear();
        this.pendingAudioBufferQueue = [];
        this.activeQueue.clear();
        this.queue = [];

        // Stop current audio source
        if (this.source) {
            try {
                this.source.stop();
                this.source.disconnect();
            } catch (e) {
                // Ignore already stopped error
            }
            this.source = null;
        }

        // Reset state
        this.playing = false;
        this.scheduledEndTime = this.audioContext.currentTime;
        this.totalSamples = 0;

        log('Audio buffers cleared', 'success');
    }

    // Decode Opus data to PCM
    async decodeOpusFrames() {
        if (!this.opusDecoder) {
            log('Opus decoder not initialized, cannot decode', 'error');
            return;
        } else {
            log('Opus decoder started', 'info');
        }

        while (true) {
            let decodedSamples = [];
            for (const frame of this.pendingAudioBufferQueue) {
                try {
                    // Decode using Opus decoder
                    const frameData = this.opusDecoder.decode(frame);
                    if (frameData && frameData.length > 0) {
                        // Convert to Float32
                        const floatData = this.convertInt16ToFloat32(frameData);
                        // Use loop instead of spread operator
                        for (let i = 0; i < floatData.length; i++) {
                            decodedSamples.push(floatData[i]);
                        }
                    }
                } catch (error) {
                    log("Opus decode failed: " + error.message, 'error');
                }
            }

            if (decodedSamples.length > 0) {
                // Use loop instead of spread operator
                for (let i = 0; i < decodedSamples.length; i++) {
                    this.activeQueue.enqueue(decodedSamples[i]);
                }
                this.totalSamples += decodedSamples.length;
            } else {
                log('No samples successfully decoded', 'warning');
            }
            await this.getPendingAudioBufferQueue();
        }
    }

    // Start playing audio
    async startPlaying() {
        this.scheduledEndTime = this.audioContext.currentTime; // Track scheduled audio end time

        while (true) {
            // Initial buffer: wait for enough samples to start playing
            const minSamples = this.sampleRate * this.minAudioDuration * 2;
            if (!this.playing && this.queue.length < minSamples) {
                await this.getQueue(minSamples);
            }
            this.playing = true;

            // Continuously play audio from queue, play a small chunk each time
            while (this.playing && this.queue.length > 0) {
                // Play 120ms of audio each time (2 Opus packets)
                const playDuration = 0.12;
                const targetSamples = Math.floor(this.sampleRate * playDuration);
                const actualSamples = Math.min(this.queue.length, targetSamples);

                if (actualSamples === 0) break;

                const currentSamples = this.queue.splice(0, actualSamples);
                const audioBuffer = this.audioContext.createBuffer(this.channels, currentSamples.length, this.sampleRate);
                audioBuffer.copyToChannel(new Float32Array(currentSamples), 0);

                // Create audio source
                this.source = this.audioContext.createBufferSource();
                this.source.buffer = audioBuffer;

                // Precisely schedule playback time
                const currentTime = this.audioContext.currentTime;
                const startTime = Math.max(this.scheduledEndTime, currentTime);

                // Connect directly to destination
                this.source.connect(this.audioContext.destination);

                log(`Scheduled play: ${currentSamples.length} samples, approx ${(currentSamples.length / this.sampleRate).toFixed(2)}s`, 'debug');
                this.source.start(startTime);

                // Update scheduled end time for next audio chunk
                const duration = audioBuffer.duration;
                this.scheduledEndTime = startTime + duration;
                this.lastPlayTime = startTime;

                // If not enough data in queue, wait for new data
                if (this.queue.length < targetSamples) {
                    break;
                }
            }

            // Wait for new data
            await this.getQueue(minSamples);
        }
    }
}

// Factory function to create StreamingContext instance
export function createStreamingContext(opusDecoder, audioContext, sampleRate, channels, minAudioDuration) {
    return new StreamingContext(opusDecoder, audioContext, sampleRate, channels, minAudioDuration);
}