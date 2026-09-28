// SolvX — Multi-Provider AI Settings Modal
// =========================================
// Provides full interactive control over AI Provider selection (Google Gemini vs NVIDIA NIM),
// dynamic model dropdowns, connection diagnostics, and cross-provider fallback configuration.

import { ApiClient } from '../api/apiClient.js';

let _modalEl = null;
let _currentSettings = null;

export const AISettingsModal = {
    /**
     * Initializes or opens the AI Settings Modal.
     */
    async open() {
        if (!_modalEl) {
            this._buildModal();
        }
        await this._loadSettings();
        _modalEl.classList.remove('hidden');
    },

    close() {
        if (_modalEl) {
            _modalEl.classList.add('hidden');
        }
    },

    toggle() {
        if (_modalEl && !_modalEl.classList.contains('hidden')) {
            this.close();
        } else {
            this.open();
        }
    },

    _buildModal() {
        _modalEl = document.createElement('div');
        _modalEl.id = 'aiSettingsModal';
        _modalEl.className = 'geo-modal-overlay hidden';
        _modalEl.innerHTML = `
            <div class="geo-modal-box ai-settings-dialog">
                <div class="geo-modal-header">
                    <div class="geo-modal-badge">AI ASSISTANT CONFIGURATION</div>
                    <h3>AI Provider & Reasoning Engine</h3>
                    <p>Select your preferred AI intelligence provider and foundation model for oceanographic analysis.</p>
                </div>

                <div class="ai-settings-body">
                    <!-- Provider Selection -->
                    <div class="ai-setting-group">
                        <label class="ai-setting-label">AI PROVIDER</label>
                        <div class="ai-provider-radios">
                            <label class="ai-radio-card" id="cardGemini">
                                <input type="radio" name="aiProvider" value="gemini" checked>
                                <div class="ai-card-content">
                                    <span class="ai-card-title">Google Gemini</span>
                                    <span class="ai-card-desc">Multimodal science reasoning via Google GenAI</span>
                                </div>
                            </label>
                            <label class="ai-radio-card" id="cardNvidia">
                                <input type="radio" name="aiProvider" value="nvidia">
                                <div class="ai-card-content">
                                    <span class="ai-card-title">NVIDIA NIM</span>
                                    <span class="ai-card-desc">High-throughput models (DeepSeek, Kimi, Nemotron)</span>
                                </div>
                            </label>
                        </div>
                    </div>

                    <!-- Model Selection -->
                    <div class="ai-setting-group">
                        <label class="ai-setting-label" for="aiModelSelect">MODEL</label>
                        <select id="aiModelSelect" class="ai-select-input"></select>
                    </div>

                    <!-- Status Display -->
                    <div class="ai-setting-group">
                        <label class="ai-setting-label">PROVIDER STATUS</label>
                        <div class="ai-status-row">
                            <div class="ai-status-chip" id="aiKeyStatus">
                                <span class="ai-status-dot"></span>
                                <span class="ai-status-text">Checking API key…</span>
                            </div>
                            <div class="ai-status-chip" id="aiProviderStatus">
                                <span class="ai-status-dot"></span>
                                <span class="ai-status-text">Checking status…</span>
                            </div>
                        </div>
                    </div>

                    <!-- Test Connection Diagnostic -->
                    <div class="ai-setting-group">
                        <div class="ai-test-row">
                            <button type="button" id="aiTestConnectionBtn" class="ai-test-btn">
                                <span>⚡ Test Connection</span>
                            </button>
                            <span id="aiTestResult" class="ai-test-result"></span>
                        </div>
                    </div>

                    <!-- Cross-Provider Auto-Fallback -->
                    <div class="ai-setting-group">
                        <label class="ai-checkbox-label">
                            <input type="checkbox" id="aiAutoFallbackCheckbox">
                            <span>Enable Automatic Cross-Provider Failover (OFF by default)</span>
                        </label>
                    </div>
                </div>

                <div class="geo-modal-footer ai-modal-actions">
                    <button type="button" id="aiSettingsCloseBtn" class="ai-btn-secondary">CLOSE</button>
                    <button type="button" id="aiSettingsSaveBtn" class="ai-btn-primary">SAVE SETTINGS</button>
                </div>
            </div>
        `;

        document.body.appendChild(_modalEl);
        this._bindEvents();
    },

    _bindEvents() {
        const closeBtn = _modalEl.querySelector('#aiSettingsCloseBtn');
        const saveBtn = _modalEl.querySelector('#aiSettingsSaveBtn');
        const testBtn = _modalEl.querySelector('#aiTestConnectionBtn');
        const radios = _modalEl.querySelectorAll('input[name="aiProvider"]');

        closeBtn?.addEventListener('click', () => this.close());
        _modalEl.addEventListener('click', (e) => {
            if (e.target === _modalEl) this.close();
        });

        radios.forEach(r => {
            r.addEventListener('change', () => {
                this._updateModelDropdown(r.value);
                this._updateStatusBadges(r.value);
            });
        });

        testBtn?.addEventListener('click', () => this._runTestConnection());
        saveBtn?.addEventListener('click', () => this._saveSettings());
    },

    async _loadSettings() {
        try {
            const data = await ApiClient.getAISettings();
            _currentSettings = data;

            const selProvider = data.selected_provider || 'gemini';
            const radio = _modalEl.querySelector(`input[name="aiProvider"][value="${selProvider}"]`);
            if (radio) radio.checked = true;

            const fallbackChk = _modalEl.querySelector('#aiAutoFallbackCheckbox');
            if (fallbackChk) fallbackChk.checked = Boolean(data.auto_fallback);

            this._updateModelDropdown(selProvider);
            this._updateStatusBadges(selProvider);
        } catch (err) {
            console.error('[AISettingsModal] Failed loading settings:', err);
        }
    },

    _updateModelDropdown(provider) {
        const select = _modalEl.querySelector('#aiModelSelect');
        if (!select || !_currentSettings) return;

        const provData = _currentSettings.providers?.[provider];
        const models = provData?.models || [];
        const selectedModel = _currentSettings.selected_models?.[provider] || provData?.default_model;

        select.innerHTML = models.map(m => {
            const isSel = m.id === selectedModel ? 'selected' : '';
            return `<option value="${escapeHtml(m.id)}" ${isSel}>${escapeHtml(m.name)} — ${escapeHtml(m.description || '')}</option>`;
        }).join('');
    },

    _updateStatusBadges(provider) {
        if (!_currentSettings) return;
        const provData = _currentSettings.providers?.[provider];
        const keyEl = _modalEl.querySelector('#aiKeyStatus');
        const provEl = _modalEl.querySelector('#aiProviderStatus');
        const testRes = _modalEl.querySelector('#aiTestResult');
        if (testRes) testRes.textContent = '';

        if (keyEl) {
            const isConfigured = Boolean(provData?.configured);
            keyEl.className = `ai-status-chip ${isConfigured ? 'success' : 'warning'}`;
            keyEl.innerHTML = `<span class="ai-status-dot"></span><span>API Key: ${isConfigured ? '✓ Configured' : '⚠ Not configured'}</span>`;
        }

        if (provEl) {
            const isAvail = provData?.status === 'Available';
            provEl.className = `ai-status-chip ${isAvail ? 'success' : 'warning'}`;
            provEl.innerHTML = `<span class="ai-status-dot"></span><span>Status: ${isAvail ? '✓ Available' : '⚠ Unavailable'}</span>`;
        }
    },

    async _runTestConnection() {
        const btn = _modalEl.querySelector('#aiTestConnectionBtn');
        const resEl = _modalEl.querySelector('#aiTestResult');
        const provider = _modalEl.querySelector('input[name="aiProvider"]:checked')?.value || 'gemini';
        const model = _modalEl.querySelector('#aiModelSelect')?.value;

        if (!btn || !resEl) return;

        btn.disabled = true;
        btn.innerHTML = '<span class="analysis-spinner"></span> Testing…';
        resEl.className = 'ai-test-result pending';
        resEl.textContent = 'Connecting…';

        try {
            const res = await ApiClient.testAIConnection(provider, model);
            if (res.success) {
                resEl.className = 'ai-test-result success';
                resEl.textContent = `✓ Connected (${res.latency_ms} ms)`;
            } else {
                resEl.className = 'ai-test-result error';
                resEl.textContent = `✗ ${res.message || 'Connection failed'}`;
            }
        } catch (err) {
            resEl.className = 'ai-test-result error';
            resEl.textContent = `✗ ${err.message || 'Test failed'}`;
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<span>⚡ Test Connection</span>';
        }
    },

    async _saveSettings() {
        const saveBtn = _modalEl.querySelector('#aiSettingsSaveBtn');
        const provider = _modalEl.querySelector('input[name="aiProvider"]:checked')?.value || 'gemini';
        const model = _modalEl.querySelector('#aiModelSelect')?.value;
        const autoFallback = _modalEl.querySelector('#aiAutoFallbackCheckbox')?.checked || false;

        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'SAVING…';
        }

        try {
            const updated = await ApiClient.updateAISettings({
                provider,
                model,
                auto_fallback: autoFallback
            });
            _currentSettings = updated;

            // Dispatch global event for UI badges
            window.dispatchEvent(new CustomEvent('solvx:ai-settings-changed', {
                detail: {
                    provider,
                    model,
                    autoFallback
                }
            }));

            this.close();
        } catch (err) {
            alert(`Failed saving AI settings: ${err.message}`);
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'SAVE SETTINGS';
            }
        }
    }
};

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
