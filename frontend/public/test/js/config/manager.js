// Configuration Management Module

// Generate random MAC address
function generateRandomMac() {
    const hexDigits = '0123456789ABCDEF';
    let mac = '';
    for (let i = 0; i < 6; i++) {
        if (i > 0) mac += ':';
        for (let j = 0; j < 2; j++) {
            mac += hexDigits.charAt(Math.floor(Math.random() * 16));
        }
    }
    return mac;
}

// Load configuration
export function loadConfig() {
    const deviceMacInput = document.getElementById('deviceMac');
    const deviceNameInput = document.getElementById('deviceName');
    const clientIdInput = document.getElementById('clientId');
    const tokenInput = document.getElementById('token');
    const otaUrlInput = document.getElementById('otaUrl');

    // Load MAC address from localStorage, generate new if not present
    let savedMac = localStorage.getItem('xz_tester_deviceMac');
    if (!savedMac) {
        savedMac = generateRandomMac();
        localStorage.setItem('xz_tester_deviceMac', savedMac);
    }
    deviceMacInput.value = savedMac;

    // Load other configuration from localStorage
    const savedDeviceName = localStorage.getItem('xz_tester_deviceName');
    if (savedDeviceName) {
        deviceNameInput.value = savedDeviceName;
    }

    const savedClientId = localStorage.getItem('xz_tester_clientId');
    if (savedClientId) {
        clientIdInput.value = savedClientId;
    }

    const savedToken = localStorage.getItem('xz_tester_token');
    if (savedToken) {
        tokenInput.value = savedToken;
    }

    const savedOtaUrl = localStorage.getItem('xz_tester_otaUrl');
    if (savedOtaUrl) {
        otaUrlInput.value = savedOtaUrl;
    }
}

// Save configuration
export function saveConfig() {
    const deviceMacInput = document.getElementById('deviceMac');
    const deviceNameInput = document.getElementById('deviceName');
    const clientIdInput = document.getElementById('clientId');
    const tokenInput = document.getElementById('token');

    localStorage.setItem('xz_tester_deviceMac', deviceMacInput.value);
    localStorage.setItem('xz_tester_deviceName', deviceNameInput.value);
    localStorage.setItem('xz_tester_clientId', clientIdInput.value);
    localStorage.setItem('xz_tester_token', tokenInput.value);
}

// Get configuration values
export function getConfig() {
    const deviceMac = document.getElementById('deviceMac').value.trim();
    return {
        deviceId: deviceMac,  // Use MAC address as deviceId
        deviceName: document.getElementById('deviceName').value.trim(),
        deviceMac: deviceMac,
        clientId: document.getElementById('clientId').value.trim(),
        token: document.getElementById('token').value.trim()
    };
}

// Save connection URL
export function saveConnectionUrls() {
    const otaUrl = document.getElementById('otaUrl').value.trim();
    const wsUrl = document.getElementById('serverUrl').value.trim();
    localStorage.setItem('xz_tester_otaUrl', otaUrl);
    localStorage.setItem('xz_tester_wsUrl', wsUrl);
}
