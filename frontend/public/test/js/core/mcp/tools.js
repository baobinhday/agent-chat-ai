import { log } from '../../utils/logger.js';

// ==========================================
// MCP Tool Management Logic
// ==========================================

// Global variables
let mcpTools = [];
let mcpEditingIndex = null;
let mcpProperties = [];
let websocket = null; // To be set from outside

/**
 * Set WebSocket instance
 * @param {WebSocket} ws - WebSocket connection instance
 */
export function setWebSocket(ws) {
    websocket = ws;
}

/**
 * Initialize MCP tools
 */
export async function initMcpTools() {
    // Load default tool data
    const defaultMcpTools = await fetch("js/config/default-mcp-tools.json").then(res => res.json());

    const savedTools = localStorage.getItem('mcpTools');
    if (savedTools) {
        try {
            mcpTools = JSON.parse(savedTools);
        } catch (e) {
            log('Failed to load MCP tools, using defaults', 'warning');
            mcpTools = [...defaultMcpTools];
        }
    } else {
        mcpTools = [...defaultMcpTools];
    }

    renderMcpTools();
    setupMcpEventListeners();
}

/**
 * Render tool list
 */
function renderMcpTools() {
    const container = document.getElementById('mcpToolsContainer');
    const countSpan = document.getElementById('mcpToolsCount');

    countSpan.textContent = `${mcpTools.length} Tools`;

    if (mcpTools.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 30px; color: #999;">No tools available, click below to add one</div>';
        return;
    }

    container.innerHTML = mcpTools.map((tool, index) => {
        const paramCount = tool.inputSchema.properties ? Object.keys(tool.inputSchema.properties).length : 0;
        const requiredCount = tool.inputSchema.required ? tool.inputSchema.required.length : 0;
        const hasMockResponse = tool.mockResponse && Object.keys(tool.mockResponse).length > 0;

        return `
            <div class="mcp-tool-card">
                <div class="mcp-tool-header">
                    <div class="mcp-tool-name">${tool.name}</div>
                    <div class="mcp-tool-actions">
                        <button onclick="window.mcpModule.editMcpTool(${index})"
                            style="padding: 4px 10px; border: none; border-radius: 4px; background-color: #2196f3; color: white; cursor: pointer; font-size: 12px;">
                            ✏️ Edit
                        </button>
                        <button onclick="window.mcpModule.deleteMcpTool(${index})"
                            style="padding: 4px 10px; border: none; border-radius: 4px; background-color: #f44336; color: white; cursor: pointer; font-size: 12px;">
                            🗑️ Delete
                        </button>
                    </div>
                </div>
                <div class="mcp-tool-description">${tool.description}</div>
                <div class="mcp-tool-info">
                    <div class="mcp-tool-info-row">
                        <span class="mcp-tool-info-label">Params:</span>
                        <span class="mcp-tool-info-value">${paramCount} (${requiredCount > 0 ? `${requiredCount} required` : ''})</span>
                    </div>
                    <div class="mcp-tool-info-row">
                        <span class="mcp-tool-info-label">Mock Resp:</span>
                        <span class="mcp-tool-info-value">${hasMockResponse ? '✅ Configured: ' + JSON.stringify(tool.mockResponse) : '⚪ Default'}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Render parameter list
 */
function renderMcpProperties() {
    const container = document.getElementById('mcpPropertiesContainer');

    if (mcpProperties.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: #999; font-size: 14px;">No parameters, click below to add one</div>';
        return;
    }

    container.innerHTML = mcpProperties.map((prop, index) => `
        <div class="mcp-property-item">
            <div class="mcp-property-header">
                <span class="mcp-property-name">${prop.name}</span>
                <button type="button" onclick="window.mcpModule.deleteMcpProperty(${index})"
                    style="padding: 3px 8px; border: none; border-radius: 3px; background-color: #f44336; color: white; cursor: pointer; font-size: 11px;">
                    Delete
                </button>
            </div>
            <div class="mcp-property-row">
                <div>
                    <label class="mcp-small-label">Param Name *</label>
                    <input type="text" class="mcp-small-input" value="${prop.name}"
                        onchange="window.mcpModule.updateMcpProperty(${index}, 'name', this.value)" required>
                </div>
                <div>
                    <label class="mcp-small-label">Data Type *</label>
                    <select class="mcp-small-input" onchange="window.mcpModule.updateMcpProperty(${index}, 'type', this.value)">
                        <option value="string" ${prop.type === 'string' ? 'selected' : ''}>String</option>
                        <option value="integer" ${prop.type === 'integer' ? 'selected' : ''}>Integer</option>
                        <option value="number" ${prop.type === 'number' ? 'selected' : ''}>Number</option>
                        <option value="boolean" ${prop.type === 'boolean' ? 'selected' : ''}>Boolean</option>
                        <option value="array" ${prop.type === 'array' ? 'selected' : ''}>Array</option>
                        <option value="object" ${prop.type === 'object' ? 'selected' : ''}>Object</option>
                    </select>
                </div>
            </div>
            ${(prop.type === 'integer' || prop.type === 'number') ? `
            <div class="mcp-property-row">
                <div>
                    <label class="mcp-small-label">Minimum</label>
                    <input type="number" class="mcp-small-input" value="${prop.minimum !== undefined ? prop.minimum : ''}"
                        placeholder="Optional" onchange="window.mcpModule.updateMcpProperty(${index}, 'minimum', this.value ? parseFloat(this.value) : undefined)">
                </div>
                <div>
                    <label class="mcp-small-label">Maximum</label>
                    <input type="number" class="mcp-small-input" value="${prop.maximum !== undefined ? prop.maximum : ''}"
                        placeholder="Optional" onchange="window.mcpModule.updateMcpProperty(${index}, 'maximum', this.value ? parseFloat(this.value) : undefined)">
                </div>
            </div>
            ` : ''}
            <div class="mcp-property-row-full">
                <label class="mcp-small-label">Description</label>
                <input type="text" class="mcp-small-input" value="${prop.description || ''}"
                    placeholder="Optional" onchange="window.mcpModule.updateMcpProperty(${index}, 'description', this.value)">
            </div>
            <label class="mcp-checkbox-label">
                <input type="checkbox" ${prop.required ? 'checked' : ''}
                    onchange="window.mcpModule.updateMcpProperty(${index}, 'required', this.checked)">
                Required
            </label>
        </div>
    `).join('');
}

/**
 * Add parameter
 */
function addMcpProperty() {
    mcpProperties.push({
        name: `param_${mcpProperties.length + 1}`,
        type: 'string',
        required: false,
        description: ''
    });
    renderMcpProperties();
}

/**
 * Update parameter
 */
function updateMcpProperty(index, field, value) {
    if (field === 'name') {
        const isDuplicate = mcpProperties.some((p, i) => i !== index && p.name === value);
        if (isDuplicate) {
            alert('Parameter name already exists, please use a different name');
            renderMcpProperties();
            return;
        }
    }

    mcpProperties[index][field] = value;

    if (field === 'type' && value !== 'integer' && value !== 'number') {
        delete mcpProperties[index].minimum;
        delete mcpProperties[index].maximum;
        renderMcpProperties();
    }
}

/**
 * Delete parameter
 */
function deleteMcpProperty(index) {
    mcpProperties.splice(index, 1);
    renderMcpProperties();
}

/**
 * Set event listeners
 */
function setupMcpEventListeners() {
    const toggleBtn = document.getElementById('toggleMcpTools');
    const panel = document.getElementById('mcpToolsPanel');
    const addBtn = document.getElementById('addMcpToolBtn');
    const modal = document.getElementById('mcpToolModal');
    const closeBtn = document.getElementById('closeMcpModalBtn');
    const cancelBtn = document.getElementById('cancelMcpBtn');
    const form = document.getElementById('mcpToolForm');
    const addPropertyBtn = document.getElementById('addMcpPropertyBtn');

    toggleBtn.addEventListener('click', () => {
        const isExpanded = panel.classList.contains('expanded');
        panel.classList.toggle('expanded');
        toggleBtn.textContent = isExpanded ? 'Expand' : 'Collapse';
    });

    addBtn.addEventListener('click', () => openMcpModal());
    closeBtn.addEventListener('click', closeMcpModal);
    cancelBtn.addEventListener('click', closeMcpModal);
    addPropertyBtn.addEventListener('click', addMcpProperty);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeMcpModal();
    });

    form.addEventListener('submit', handleMcpSubmit);
}

/**
 * Open modal
 */
function openMcpModal(index = null) {
    const isConnected = websocket && websocket.readyState === WebSocket.OPEN;
    if (isConnected) {
        alert('WebSocket is connected, cannot edit tools');
        return;
    }

    mcpEditingIndex = index;
    const errorContainer = document.getElementById('mcpErrorContainer');
    errorContainer.innerHTML = '';

    if (index !== null) {
        document.getElementById('mcpModalTitle').textContent = 'Edit Tool';
        const tool = mcpTools[index];
        document.getElementById('mcpToolName').value = tool.name;
        document.getElementById('mcpToolDescription').value = tool.description;
        document.getElementById('mcpMockResponse').value = tool.mockResponse ? JSON.stringify(tool.mockResponse, null, 2) : '';

        mcpProperties = [];
        const schema = tool.inputSchema;
        if (schema.properties) {
            Object.keys(schema.properties).forEach(key => {
                const prop = schema.properties[key];
                mcpProperties.push({
                    name: key,
                    type: prop.type || 'string',
                    minimum: prop.minimum,
                    maximum: prop.maximum,
                    description: prop.description || '',
                    required: schema.required && schema.required.includes(key)
                });
            });
        }
    } else {
        document.getElementById('mcpModalTitle').textContent = 'Add Tool';
        document.getElementById('mcpToolForm').reset();
        mcpProperties = [];
    }

    renderMcpProperties();
    document.getElementById('mcpToolModal').style.display = 'block';
}

/**
 * Close modal
 */
function closeMcpModal() {
    document.getElementById('mcpToolModal').style.display = 'none';
    mcpEditingIndex = null;
    document.getElementById('mcpToolForm').reset();
    mcpProperties = [];
    document.getElementById('mcpErrorContainer').innerHTML = '';
}

/**
 * Handle form submission
 */
function handleMcpSubmit(e) {
    e.preventDefault();
    const errorContainer = document.getElementById('mcpErrorContainer');
    errorContainer.innerHTML = '';

    const name = document.getElementById('mcpToolName').value.trim();
    const description = document.getElementById('mcpToolDescription').value.trim();
    const mockResponseText = document.getElementById('mcpMockResponse').value.trim();

    // Check for duplicate names
    const isDuplicate = mcpTools.some((tool, index) =>
        tool.name === name && index !== mcpEditingIndex
    );

    if (isDuplicate) {
        showMcpError('Tool name already exists, please use a different name');
        return;
    }

    // Parse mock response
    let mockResponse = null;
    if (mockResponseText) {
        try {
            mockResponse = JSON.parse(mockResponseText);
        } catch (e) {
            showMcpError('Mock response is not valid JSON: ' + e.message);
            return;
        }
    }

    // Build inputSchema
    const inputSchema = {
        type: "object",
        properties: {},
        required: []
    };

    mcpProperties.forEach(prop => {
        const propSchema = { type: prop.type };

        if (prop.description) {
            propSchema.description = prop.description;
        }

        if ((prop.type === 'integer' || prop.type === 'number')) {
            if (prop.minimum !== undefined && prop.minimum !== '') {
                propSchema.minimum = prop.minimum;
            }
            if (prop.maximum !== undefined && prop.maximum !== '') {
                propSchema.maximum = prop.maximum;
            }
        }

        inputSchema.properties[prop.name] = propSchema;

        if (prop.required) {
            inputSchema.required.push(prop.name);
        }
    });

    if (inputSchema.required.length === 0) {
        delete inputSchema.required;
    }

    const tool = { name, description, inputSchema, mockResponse };

    if (mcpEditingIndex !== null) {
        mcpTools[mcpEditingIndex] = tool;
        log(`Tool updated: ${name}`, 'success');
    } else {
        mcpTools.push(tool);
        log(`Tool added: ${name}`, 'success');
    }

    saveMcpTools();
    renderMcpTools();
    closeMcpModal();
}

/**
 * Show error
 */
function showMcpError(message) {
    const errorContainer = document.getElementById('mcpErrorContainer');
    errorContainer.innerHTML = `<div class="mcp-error">${message}</div>`;
}

/**
 * Edit tool
 */
function editMcpTool(index) {
    openMcpModal(index);
}

/**
 * Delete tool
 */
function deleteMcpTool(index) {
    const isConnected = websocket && websocket.readyState === WebSocket.OPEN;
    if (isConnected) {
        alert('WebSocket is connected, cannot edit tools');
        return;
    }
    if (confirm(`Are you sure you want to delete tool "${mcpTools[index].name}"?`)) {
        const toolName = mcpTools[index].name;
        mcpTools.splice(index, 1);
        saveMcpTools();
        renderMcpTools();
        log(`Tool deleted: ${toolName}`, 'info');
    }
}

/**
 * Save tools
 */
function saveMcpTools() {
    localStorage.setItem('mcpTools', JSON.stringify(mcpTools));
}

/**
 * Get tool list
 */
export function getMcpTools() {
    return mcpTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
    }));
}

/**
 * Execute tool call
 */
export function executeMcpTool(toolName, toolArgs) {
    const tool = mcpTools.find(t => t.name === toolName);

    if (!tool) {
        log(`Tool not found: ${toolName}`, 'error');
        return {
            success: false,
            error: `Unknown tool: ${toolName}`
        };
    }

    // If there is a mock response, use it
    if (tool.mockResponse) {
        // Replace template variables
        let responseStr = JSON.stringify(tool.mockResponse);

        // Replace ${paramName} format variables
        if (toolArgs) {
            Object.keys(toolArgs).forEach(key => {
                const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
                responseStr = responseStr.replace(regex, toolArgs[key]);
            });
        }

        try {
            const response = JSON.parse(responseStr);
            log(`Tool ${toolName} executed successfully, returned mock result: ${responseStr}`, 'success');
            return response;
        } catch (e) {
            log(`Failed to parse mock response: ${e.message}`, 'error');
            return tool.mockResponse;
        }
    }

    // No mock response, return default success message
    log(`Tool ${toolName} executed successfully, returned default result`, 'success');
    return {
        success: true,
        message: `Tool ${toolName} executed successfully`,
        tool: toolName,
        arguments: toolArgs
    };
}

// Expose global methods for inline HTML event handling
window.mcpModule = {
    updateMcpProperty,
    deleteMcpProperty,
    editMcpTool,
    deleteMcpTool
};
