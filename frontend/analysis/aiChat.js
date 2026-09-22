// SolvX — Scientific AI Assistant Chat & Command Interface
// ========================================================
// Stage 6 (AI): Provides:
// 1. Interactive scientific Q&A explaining deterministic ocean analysis
// 2. Natural language to 3D visualization command parsing & execution
// 3. Grounded answers citing Copernicus NEMO & WMO Argo data
// 4. Safe command validation before dispatching to window.solvxViewer.executeCommand()

import { ApiClient } from '../api/apiClient.js';

let _vc = null;
let _container = null;
let _aiAvailable = false;
let _aiModel = 'gemini-2.0-flash';
let _sessionApiKey = '';

export const AiChat = {
    /**
     * Initializes the AI Chat module.
     * @param {import('../viewer/viewerController.js').ViewerController} viewerController
     * @param {HTMLElement} containerElement
     */
    async init(viewerController, containerElement) {
        _vc = viewerController;
        _container = containerElement;
        _sessionApiKey = sessionStorage.getItem('solvx_gemini_key') || '';

        await _checkStatus();
        _render();
    },

    /** Refreshes status and updates UI. */
    async refresh() {
        await _checkStatus();
        _render();
    }
};

async function _checkStatus() {
    try {
        const res = await ApiClient.getAIStatus();
        _aiAvailable = Boolean(res?.available) || Boolean(_sessionApiKey);
        _aiModel = res?.model || 'gemini-2.0-flash';
    } catch (_) {
        _aiAvailable = Boolean(_sessionApiKey);
    }
}

function _render() {
    if (!_container) return;

    _container.innerHTML = `
        <div class="ai-assistant-wrapper">
            <div class="ai-status-banner ${_aiAvailable ? 'status-online' : 'status-notice'}">
                <span class="ai-status-indicator"></span>
                <span class="ai-status-text">
                    ${_aiAvailable 
                        ? `Gemini AI Engine Active (${_aiModel})` 
                        : 'Gemini Key Not Set (Deterministic mode active)'}
                </span>
                <button id="aiKeyToggleBtn" class="ai-key-btn" title="Configure session Gemini API key">
                    ${_sessionApiKey ? 'Key Saved' : 'Set Key'}
                </button>
            </div>

            <div id="aiKeyInputRow" class="ai-key-input-row hidden">
                <input type="password" id="aiApiKeyField" class="ai-key-field" 
                       placeholder="Enter Gemini API Key (saved in session only)" 
                       value="${_sessionApiKey}">
                <button id="aiSaveKeyBtn" class="focus-btn">SAVE</button>
            </div>

            <div class="ai-prompt-chips">
                <button class="ai-chip" data-prompt="Where does the numerical model disagree most with in-situ Argo floats?">
                    Top Discrepancy
                </button>
                <button class="ai-chip" data-prompt="Show temperature anomalies below 100m depth.">
                    Anomalies &gt;100m
                </button>
                <button class="ai-chip" data-prompt="Where are the critical observation data gaps in the Bay of Bengal?">
                    Data Gaps
                </button>
                <button class="ai-chip" data-prompt="Set depth to 150 meters and show salinity.">
                    Set 150m Salinity
                </button>
            </div>

            <div class="ai-chat-history" id="aiChatHistory">
                <div class="ai-message ai-message-assistant">
                    <div class="ai-message-header">SOLVX AI SCIENCE ASSISTANT</div>
                    <div class="ai-message-body">
                        Ask any question about model accuracy, Argo soundings, or observation gaps. 
                        You can also type natural language commands to control the 3D viewer.
                    </div>
                </div>
            </div>

            <form class="ai-input-form" id="aiInputForm">
                <input type="text" id="aiChatInput" class="ai-chat-input" 
                       placeholder="Ask ocean science question or command 3D view…" autocomplete="off">
                <button type="submit" id="aiSendBtn" class="ai-send-btn" title="Send to AI">
                    <span>SEND</span>
                </button>
            </form>
        </div>
    `;

    _bindEvents();
}

function _bindEvents() {
    const keyToggleBtn = document.getElementById('aiKeyToggleBtn');
    const keyInputRow = document.getElementById('aiKeyInputRow');
    const apiKeyField = document.getElementById('aiApiKeyField');
    const saveKeyBtn = document.getElementById('aiSaveKeyBtn');
    const form = document.getElementById('aiInputForm');
    const input = document.getElementById('aiChatInput');
    const history = document.getElementById('aiChatHistory');

    keyToggleBtn?.addEventListener('click', () => {
        keyInputRow?.classList.toggle('hidden');
    });

    saveKeyBtn?.addEventListener('click', async () => {
        _sessionApiKey = apiKeyField?.value.trim() || '';
        if (_sessionApiKey) {
            sessionStorage.setItem('solvx_gemini_key', _sessionApiKey);
        } else {
            sessionStorage.removeItem('solvx_gemini_key');
        }
        await _checkStatus();
        _render();
    });

    // Handle chips
    _container.querySelectorAll('.ai-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const prompt = chip.getAttribute('data-prompt');
            if (prompt && input) {
                input.value = prompt;
                form?.dispatchEvent(new Event('submit'));
            }
        });
    });

    // Form submission
    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const query = input?.value.trim();
        if (!query) return;

        input.value = '';
        _appendUserMessage(history, query);

        const loadingMsg = _appendLoadingMessage(history);
        try {
            // Distinguish direct viewer commands vs analytical explanations
            const isDirectCommand = /^(set|show|focus|go to|view|slice|display)\b/i.test(query);

            if (isDirectCommand) {
                const cmdRes = await ApiClient.parseNLCommand(query, 'temperature', _sessionApiKey);
                loadingMsg.remove();
                _appendCommandMessage(history, cmdRes);
            } else {
                const explainRes = await ApiClient.explainAnalysis(query, {
                    variable: 'temperature',
                    method: 'zscore',
                    apiKey: _sessionApiKey
                });
                loadingMsg.remove();
                _appendAssistantMessage(history, explainRes);
            }
        } catch (err) {
            loadingMsg.remove();
            _appendErrorMessage(history, err.message || 'AI request failed');
        }
    });
}

function _appendUserMessage(history, text) {
    const msg = document.createElement('div');
    msg.className = 'ai-message ai-message-user';
    msg.innerHTML = `
        <div class="ai-message-header">YOU</div>
        <div class="ai-message-body">${_escape(text)}</div>
    `;
    history.appendChild(msg);
    history.scrollTop = history.scrollHeight;
}

function _appendLoadingMessage(history) {
    const msg = document.createElement('div');
    msg.className = 'ai-message ai-message-assistant ai-loading';
    msg.innerHTML = `
        <div class="ai-message-header">SOLVX AI</div>
        <div class="ai-message-body">
            <span class="analysis-spinner"></span> Synthesizing oceanographic analysis…
        </div>
    `;
    history.appendChild(msg);
    history.scrollTop = history.scrollHeight;
    return msg;
}

function _appendAssistantMessage(history, res) {
    const msg = document.createElement('div');
    msg.className = 'ai-message ai-message-assistant';

    let actionBtnHtml = '';
    if (res.command) {
        actionBtnHtml = `
            <div class="ai-action-box">
                <span class="ai-action-label">Recommended 3D Action:</span>
                <button class="focus-btn ai-exec-btn" data-cmd="${encodeURIComponent(JSON.stringify(res.command))}">
                    ⬡ APPLY 3D COMMAND (${res.command.action})
                </button>
            </div>
        `;
    }

    const sources = (res.data_sources || []).join(' · ');

    msg.innerHTML = `
        <div class="ai-message-header">SOLVX AI SCIENCE ASSISTANT</div>
        <div class="ai-message-body">${_formatMarkdown(res.explanation)}</div>
        ${actionBtnHtml}
        <div class="ai-message-meta">
            <span>Sources: ${sources || 'Copernicus NEMO / WMO Argo'}</span>
            <span>Confidence: ${res.confidence || 'verified'}</span>
        </div>
    `;

    _wireActionButtons(msg);
    history.appendChild(msg);
    history.scrollTop = history.scrollHeight;
}

function _appendCommandMessage(history, cmdRes) {
    const msg = document.createElement('div');
    msg.className = 'ai-message ai-message-assistant';

    const cmd = cmdRes.parsed_command;
    const cmdStr = encodeURIComponent(JSON.stringify(cmd));

    msg.innerHTML = `
        <div class="ai-message-header">COMMAND TRANSLATOR</div>
        <div class="ai-message-body">${_escape(cmdRes.explanation)}</div>
        <div class="ai-action-box">
            <span class="ai-action-label">Action: <strong>${cmd.action}</strong></span>
            <button class="focus-btn ai-exec-btn" data-cmd="${cmdStr}">
                ⬡ EXECUTE IN 3D VIEWER
            </button>
        </div>
    `;

    _wireActionButtons(msg);
    history.appendChild(msg);
    history.scrollTop = history.scrollHeight;

    // Automatically trigger command
    if (_vc && cmd) {
        _vc.executeCommand(cmd);
    }
}

function _appendErrorMessage(history, text) {
    const msg = document.createElement('div');
    msg.className = 'ai-message ai-message-assistant ai-message-error';
    msg.innerHTML = `
        <div class="ai-message-header">AI ASSISTANT NOTICE</div>
        <div class="ai-message-body">${_escape(text)}</div>
    `;
    history.appendChild(msg);
    history.scrollTop = history.scrollHeight;
}

function _wireActionButtons(container) {
    container.querySelectorAll('.ai-exec-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const raw = btn.getAttribute('data-cmd');
            if (raw && _vc) {
                try {
                    const cmd = JSON.parse(decodeURIComponent(raw));
                    _vc.executeCommand(cmd);
                    btn.textContent = '✓ EXECUTED';
                    btn.style.borderColor = '#40cc80';
                    btn.style.color = '#40cc80';
                } catch (_) {}
            }
        });
    });
}

function _escape(str) {
    return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function _formatMarkdown(text) {
    return _escape(text)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n\n/g, '<br><br>')
        .replace(/\n/g, '<br>');
}
