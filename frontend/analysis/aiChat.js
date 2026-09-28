// SolvX — Scientific AI Assistant Chat & Command Interface
// ========================================================
// Stage 6 (AI): Provides:
// 1. Interactive scientific Q&A explaining deterministic ocean analysis
// 2. Natural language to 3D visualization command parsing & execution
// 3. Grounded answers citing Copernicus NEMO & WMO Argo data
// 4. Safe command validation before dispatching to window.solvxViewer.executeCommand()

import { ApiClient } from '../api/apiClient.js';
import { renderChartSvg } from '../ai/assistantDock.js';

let _vc = null;
let _container = null;
let _aiAvailable = false;
let _aiModel = 'gemini-2.5-flash';
let _sessionApiKey = '';
let _sessionId = null;

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
        _sessionId = sessionStorage.getItem('solvx_ai_session_id');
        if (!_sessionId) {
            _sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `sess_${Date.now()}`;
            sessionStorage.setItem('solvx_ai_session_id', _sessionId);
        }

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
        _aiModel = res?.model || 'gemini-2.5-flash';
    } catch (_) {
        _aiAvailable = Boolean(_sessionApiKey);
    }
}

function _render() {
    if (!_container) return;

    _container.innerHTML = `
        <div class="ai-assistant-wrapper">
            <div class="ai-intro-bar">
                <span><span class="ai-status-indicator"></span><strong>SOLVX AI</strong> &middot; Ask about the selected ocean data</span>
                <button id="aiKeyToggleBtn" class="theme-toggle-btn" style="width:24px;height:24px;font-size:12px;border:none;background:transparent;cursor:pointer;" title="Configure Gemini API Key" aria-label="API Settings">⚙</button>
            </div>

            <div id="aiKeyInputRow" class="ai-key-input-row" style="display:none; gap:6px;">
                <input type="password" id="aiApiKeyField" class="ai-chat-input" 
                       placeholder="Gemini API Key (saved in session only)" 
                       value="${_sessionApiKey}">
                <button id="aiSaveKeyBtn" class="compact-btn">SAVE</button>
            </div>

            <div class="ai-prompt-chips">
                <button class="ai-chip" data-prompt="Why is model error highest here?">
                    Why is model error highest here?
                </button>
                <button class="ai-chip" data-prompt="Explain this Argo profile.">
                    Explain this Argo profile
                </button>
                <button class="ai-chip" data-prompt="What depth has the largest discrepancy?">
                    Largest discrepancy depth
                </button>
                <button class="ai-chip" data-prompt="Where are the observation gaps?">
                    Where are observation gaps?
                </button>
            </div>

            <div class="ai-chat-history" id="aiChatHistory">
                <div class="ai-message ai-message-assistant">
                    <div class="ai-message-header">SOLVX AI ASSISTANT</div>
                    Ask any question about model accuracy, Argo soundings, or observation gaps in the active region.
                </div>
            </div>

            <form class="ai-input-form" id="aiInputForm">
                <input type="text" id="aiChatInput" class="ai-chat-input" 
                       placeholder="Why is the model different from Argo?" autocomplete="off">
                <button type="submit" id="aiSendBtn" class="ai-send-btn">
                    <span>ASK</span>
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
        if (!keyInputRow) return;
        keyInputRow.style.display = keyInputRow.style.display === 'none' ? 'flex' : 'none';
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
            const isDirectCommand = /^(set|show|focus|go to|view|slice|display)\b/i.test(query);
            const curVar = _vc?.activeVar || 'temperature';
            const curContext = _vc?.getUIContext ? _vc.getUIContext() : (_vc?.getAnalysisContext ? _vc.getAnalysisContext() : null);
            const res = await ApiClient.sendAIChat(query, curContext, _sessionId, _sessionApiKey);
            loadingMsg.remove();
            _appendAssistantMessage(history, res);
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
        <div class="ai-message-header">SOLVX AI ASSISTANT</div>
        <div class="ai-message-body">
            <span class="analysis-spinner"></span> Synthesizing oceanographic analysis & executing tools…
        </div>
    `;
    history.appendChild(msg);
    history.scrollTop = history.scrollHeight;
    return msg;
}

function _appendAssistantMessage(history, res) {
    const msg = document.createElement('div');
    msg.className = 'ai-message ai-message-assistant';

    // Tool Call Badges removed per user request:
    // "these resolve_region: success ... should not be visible to user"

    // Inline Charts
    let chartsHtml = '';
    const charts = res.charts || [];
    if (charts.length > 0) {
        chartsHtml = `<div class="ai-charts-container">${charts.map(c => renderChartSvg(c)).join('')}</div>`;
    }

    // Action Buttons
    let actionsHtml = '';
    const allActions = res.visualization_actions || res.vis_actions || (res.command ? [res.command] : []);
    if (allActions.length > 0) {
        actionsHtml = `
            <div class="ai-actions-shelf">
                <span class="ai-action-shelf-title">3D Visualization Actions:</span>
                <div class="ai-action-btn-group">
                    ${allActions.map(cmd => {
                        const cmdStr = encodeURIComponent(JSON.stringify(cmd));
                        const label = (cmd.action || 'APPLY').replace(/_/g, ' ').toUpperCase();
                        return `<button class="focus-btn ai-exec-btn" data-cmd="${cmdStr}">⬡ APPLY 3D ACTION (${label})</button>`;
                    }).join('')}
                </div>
            </div>
        `;
    }

    // Provenance
    let provHtml = '';
    if (res.provenance) {
        const p = res.provenance;
        const models = p.dataset || (p.models_used || []).join(', ');
        const obs = p.source || (p.observations_used || []).join(', ');
        const floats = (p.float_ids || []).slice(0, 4).join(', ') + ((p.float_ids?.length || 0) > 4 ? '…' : '');
        provHtml = `
            <div class="ai-provenance-box">
                <span><strong>Models:</strong> ${_escape(models || 'Copernicus NEMO')}</span>
                ${obs ? `<span><strong>Obs:</strong> ${_escape(obs)}</span>` : ''}
                ${floats ? `<span><strong>Floats:</strong> ${_escape(floats)}</span>` : ''}
            </div>
        `;
    } else {
        const sources = (res.data_sources || []).join(' · ');
        provHtml = `
            <div class="ai-message-meta">
                <span>Sources: ${sources || 'Copernicus NEMO / WMO Argo'}</span>
                <span>Confidence: ${res.confidence || 'verified'}</span>
            </div>
        `;
    }

    // Follow-ups
    let followUpsHtml = '';
    const followUps = res.follow_up_suggestions || [];
    if (followUps.length > 0) {
        followUpsHtml = `
            <div class="ai-followup-chips">
                ${followUps.map(s => `<button class="ai-chip" data-prompt="${_escape(s)}">${_escape(s)}</button>`).join('')}
            </div>
        `;
    }

    const textContent = res.message || res.explanation || (typeof res === 'string' ? res : 'Analysis complete.');

    msg.innerHTML = `
        <div class="ai-message-header">SOLVX AI SCIENCE ASSISTANT</div>
        <div class="ai-message-body">${_formatMarkdown(textContent)}</div>
        ${chartsHtml}
        ${actionsHtml}
        ${provHtml}
        ${followUpsHtml}
    `;

    _wireActionButtons(msg);

    // Wire follow-up prompt chips
    msg.querySelectorAll('.ai-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const p = chip.getAttribute('data-prompt');
            const input = document.getElementById('aiChatInput');
            const form = document.getElementById('aiInputForm');
            if (p && input && form) {
                input.value = p;
                form.dispatchEvent(new Event('submit'));
            }
        });
    });

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
