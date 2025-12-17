// Main App Entry
import { log } from './utils/logger.js';
import { checkOpusLoaded, initOpusEncoder } from './core/audio/opus-codec.js';
import { getUIController } from './ui/controller.js';
import { getAudioPlayer } from './core/audio/player.js';
import { initMcpTools } from './core/mcp/tools.js';

// App Class
class App {
    constructor() {
        this.uiController = null;
        this.audioPlayer = null;
    }

    // Initialize App
    async init() {
        log('Initializing application...', 'info');

        // Initialize UI Controller
        this.uiController = getUIController();
        this.uiController.init();

        // Check Opus Library
        checkOpusLoaded();

        // Initialize Opus Encoder
        initOpusEncoder();

        // Initialize Audio Player
        this.audioPlayer = getAudioPlayer();
        await this.audioPlayer.start();

        // Initialize MCP Tools
        initMcpTools();

        log('Application initialized', 'success');
    }
}

// Create and start application
const app = new App();

// Initialize after DOM loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init());
} else {
    app.init();
}

export default app;
