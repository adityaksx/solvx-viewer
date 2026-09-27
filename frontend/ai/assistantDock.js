// SolvX — AI Scientific Assistant Dock & Visualization Orchestrator
// =========================================================================
// Embeds the AI Scientific Assistant directly into the 3D Viewer & Analysis workflows.
// Compliant with Section 13, 21, and 22 of the SolvX AI Assistant Specification:
// - Live Context Bar (Region, Time, Depth, Variable)
// - Grounded Scientific Responses citing deterministic models & observations
// - Tool Call execution transparency chips
// - Inline high-resolution SVG Chart rendering (depth profiles, time-series, bars)
// - Direct 3D Viewer Action dispatching (focus, depth, variables, slices)
// - Multi-turn session continuity

import { ApiClient } from '../api/apiClient.js';

let _vc = null;
let _app = null;
let _sessionId = null;
let _sessionApiKey = '';
let _isOpen = false;

export const AssistantDock = {
    /**
     * Initializes the AI Assistant Dock.
     * @param {import('../viewer/viewerController.js').ViewerController} viewerController
     * @param {import('../app.js').SolvXApp} [app]
     */
    init(viewerController, app = null) {
        _vc = viewerController;
        _app = app || viewerController?.app;

        _sessionId = sessionStorage.getItem('solvx_ai_session_id');
        if (!_sessionId) {
            _sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `sess_${Date.now()}`;
            sessionStorage.setItem('solvx_ai_session_id', _sessionId);
        }
        _sessionApiKey = sessionStorage.getItem('solvx_gemini_key') || '';

        _bindDomEvents();
        this.updateContextBar();
    },

    toggle() {
        _isOpen = !_isOpen;
        const drawer = document.getElementById('aiAssistantDrawer');
        const btn = document.getElementById('aiAssistantToggleBtn');
        if (drawer) {
            if (_isOpen) {
                drawer.classList.remove('hidden');
                btn?.classList.add('active');
                this.updateContextBar();
                document.getElementById('aiDockInput')?.focus();
            } else {
                drawer.classList.add('hidden');
                btn?.classList.remove('active');
            }
        }
    },

    open() {
        if (!_isOpen) this.toggle();
    },

    close() {
        if (_isOpen) this.toggle();
    },

    updateContextBar() {
        if (!_vc) return;
        const ctx = _vc.getUIContext();
        const rEl = document.getElementById('aiCtxRegion');
        const tEl = document.getElementById('aiCtxTime');
        const dEl = document.getElementById('aiCtxDepth');
        const vEl = document.getElementById('aiCtxVar');

        if (rEl) {
            const regName = ctx.region.name || `${ctx.region.min_lat.toFixed(1)}°N, ${ctx.region.min_lon.toFixed(1)}°E`;
            rEl.innerHTML = `📍 <strong>Region:</strong> ${escapeHtml(regName)}`;
        }
        if (tEl) {
            const timeStr = ctx.timeline.current_time ? ctx.timeline.current_time.slice(0, 10) : 'Active';
            tEl.innerHTML = `📅 <strong>Time:</strong> ${escapeHtml(timeStr)}`;
        }
        if (dEl) {
            dEl.innerHTML = `🌊 <strong>Depth:</strong> ${Math.round(ctx.depth.current_depth)}m`;
        }
        if (vEl) {
            const varClean = (ctx.visualization.active_variable || 'ocean_temperature').replace(/^ocean_/, '');
            vEl.innerHTML = `📊 <strong>Var:</strong> ${escapeHtml(varClean)}`;
        }
    },

    /**
     * Sends a query directly to the AI Assistant.
     * @param {string} text
     */
    async ask(text) {
        this.open();
        const input = document.getElementById('aiDockInput');
        if (input) input.value = text;
        const form = document.getElementById('aiChatDockForm');
        if (form) form.dispatchEvent(new Event('submit'));
    }
};

function _bindDomEvents() {
    const toggleBtn = document.getElementById('aiAssistantToggleBtn');
    const closeBtn = document.getElementById('aiDockCloseBtn');
    const settingsBtn = document.getElementById('aiDockSettingsBtn');
    const keyRow = document.getElementById('aiDockKeyRow');
    const apiKeyInput = document.getElementById('aiDockApiKey');
    const saveKeyBtn = document.getElementById('aiDockSaveKey');
    const form = document.getElementById('aiChatDockForm');
    const input = document.getElementById('aiDockInput');
    const chips = document.getElementById('aiPromptChips');

    toggleBtn?.addEventListener('click', () => AssistantDock.toggle());
    closeBtn?.addEventListener('click', () => AssistantDock.close());

    // Keyboard shortcut: Alt+A or Ctrl+Shift+A
    window.addEventListener('keydown', (e) => {
        if ((e.altKey && e.key.toLowerCase() === 'a') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a')) {
            e.preventDefault();
            AssistantDock.toggle();
        }
    });

    settingsBtn?.addEventListener('click', () => {
        if (keyRow) {
            keyRow.classList.toggle('hidden');
            if (!keyRow.classList.contains('hidden') && apiKeyInput) {
                apiKeyInput.value = _sessionApiKey;
                apiKeyInput.focus();
            }
        }
    });

    saveKeyBtn?.addEventListener('click', () => {
        _sessionApiKey = apiKeyInput?.value.trim() || '';
        if (_sessionApiKey) {
            sessionStorage.setItem('solvx_gemini_key', _sessionApiKey);
        } else {
            sessionStorage.removeItem('solvx_gemini_key');
        }
        keyRow?.classList.add('hidden');
    });

    chips?.addEventListener('click', (e) => {
        const chip = e.target.closest('.ai-chip');
        if (chip) {
            const prompt = chip.getAttribute('data-prompt');
            if (prompt && input) {
                input.value = prompt;
                form?.dispatchEvent(new Event('submit'));
            }
        }
    });

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const query = input?.value.trim();
        if (!query) return;

        input.value = '';
        AssistantDock.updateContextBar();

        const stream = document.getElementById('aiMessageStream');
        if (!stream) return;

        _appendUserMsg(stream, query);
        const loadingMsg = _appendLoadingMsg(stream);

        try {
            const uiCtx = _vc?.getUIContext ? _vc.getUIContext() : null;
            const res = await ApiClient.sendAIChat(query, uiCtx, _sessionId, _sessionApiKey);
            loadingMsg.remove();
            _appendAssistantMsg(stream, res);

            // If visualization actions were returned, execute them
            if (res.vis_actions && res.vis_actions.length > 0 && _vc) {
                for (const act of res.vis_actions) {
                    _vc.executeCommand(act);
                }
                AssistantDock.updateContextBar();
            }
        } catch (err) {
            loadingMsg.remove();
            _appendErrorMsg(stream, err.message || 'Error processing AI assistant request.');
        }
    });

    // Listen for custom graph display requests
    window.addEventListener('solvx:show-graph', (e) => {
        const detail = e.detail;
        if (detail?.chart) {
            AssistantDock.open();
            const stream = document.getElementById('aiMessageStream');
            if (stream) {
                const chartBox = document.createElement('div');
                chartBox.className = 'ai-chart-standalone';
                chartBox.innerHTML = renderChartSvg(detail.chart);
                stream.appendChild(chartBox);
                stream.scrollTop = stream.scrollHeight;
            }
        }
    });
}

function _appendUserMsg(stream, text) {
    const msg = document.createElement('div');
    msg.className = 'ai-message ai-message-user';
    msg.innerHTML = `
        <div class="ai-message-header">YOU</div>
        <div class="ai-message-body">${escapeHtml(text)}</div>
    `;
    stream.appendChild(msg);
    stream.scrollTop = stream.scrollHeight;
}

function _appendLoadingMsg(stream) {
    const msg = document.createElement('div');
    msg.className = 'ai-message ai-message-assistant ai-loading';
    msg.innerHTML = `
        <div class="ai-message-header">SOLVX AI ASSISTANT</div>
        <div class="ai-message-body">
            <span class="analysis-spinner"></span> Reasoning, executing data tools & synthesizing response…
        </div>
    `;
    stream.appendChild(msg);
    stream.scrollTop = stream.scrollHeight;
    return msg;
}

function _appendAssistantMsg(stream, res) {
    const msg = document.createElement('div');
    msg.className = 'ai-message ai-message-assistant';

    // 1. Tool Call Badges
    let toolsHtml = '';
    if (res.tool_calls && res.tool_calls.length > 0) {
        const badges = res.tool_calls.map(t => {
            const statusClass = t.status === 'success' ? 'status-ok' : (t.status === 'error' ? 'status-err' : 'status-empty');
            return `<span class="ai-tool-pill ${statusClass}" title="${escapeHtml(JSON.stringify(t.arguments || {}))}">⚙ ${escapeHtml(t.tool)}: ${t.status}</span>`;
        }).join(' ');
        toolsHtml = `<div class="ai-tools-row">${badges}</div>`;
    }

    // 2. Inline Charts
    let chartsHtml = '';
    if (res.charts && res.charts.length > 0) {
        chartsHtml = `<div class="ai-charts-container">${res.charts.map(c => renderChartSvg(c)).join('')}</div>`;
    }

    // 3. Visualization Actions
    let actionsHtml = '';
    if (res.vis_actions && res.vis_actions.length > 0) {
        actionsHtml = `
            <div class="ai-actions-shelf">
                <span class="ai-action-shelf-title">3D Visualization Actions:</span>
                <div class="ai-action-btn-group">
                    ${res.vis_actions.map(act => {
                        const actStr = encodeURIComponent(JSON.stringify(act));
                        const label = act.action.replace('_', ' ').toUpperCase();
                        return `<button class="ai-action-btn" data-act="${actStr}">⬡ Apply ${label}</button>`;
                    }).join('')}
                </div>
            </div>
        `;
    }

    // 4. Provenance
    let provHtml = '';
    if (res.provenance) {
        const p = res.provenance;
        const models = (p.models_used || []).join(', ');
        const obs = (p.observations_used || []).join(', ');
        const floats = (p.float_ids || []).slice(0, 5).join(', ') + ((p.float_ids?.length || 0) > 5 ? '…' : '');
        provHtml = `
            <div class="ai-provenance-box">
                <span class="ai-prov-item"><strong>Models:</strong> ${escapeHtml(models || 'Copernicus NEMO')}</span>
                ${obs ? `<span class="ai-prov-item"><strong>Obs:</strong> ${escapeHtml(obs)}</span>` : ''}
                ${floats ? `<span class="ai-prov-item"><strong>Floats:</strong> ${escapeHtml(floats)}</span>` : ''}
                ${p.spatial_coverage ? `<span class="ai-prov-item"><strong>BBox:</strong> [${p.spatial_coverage.min_lat?.toFixed(1)}°-${p.spatial_coverage.max_lat?.toFixed(1)}°N, ${p.spatial_coverage.min_lon?.toFixed(1)}°-${p.spatial_coverage.max_lon?.toFixed(1)}°E]</span>` : ''}
            </div>
        `;
    }

    // 5. Follow-up Suggestions
    let followUpsHtml = '';
    if (res.follow_up_suggestions && res.follow_up_suggestions.length > 0) {
        followUpsHtml = `
            <div class="ai-followup-chips">
                <span class="ai-followup-label">Follow-up:</span>
                ${res.follow_up_suggestions.map(s => `<button class="ai-chip" data-prompt="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}
            </div>
        `;
    }

    msg.innerHTML = `
        <div class="ai-message-header">SOLVX AI ASSISTANT</div>
        ${toolsHtml}
        <div class="ai-message-body">${formatMarkdown(res.explanation)}</div>
        ${chartsHtml}
        ${actionsHtml}
        ${provHtml}
        ${followUpsHtml}
    `;

    // Wire action buttons
    msg.querySelectorAll('.ai-action-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const raw = btn.getAttribute('data-act');
            if (raw && _vc) {
                try {
                    const act = JSON.parse(decodeURIComponent(raw));
                    _vc.executeCommand(act);
                    AssistantDock.updateContextBar();
                    btn.textContent = '✓ APPLIED';
                    btn.classList.add('applied');
                } catch (_) {}
            }
        });
    });

    // Wire follow-up chips
    msg.querySelectorAll('.ai-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const p = chip.getAttribute('data-prompt');
            if (p) {
                const input = document.getElementById('aiDockInput');
                const form = document.getElementById('aiChatDockForm');
                if (input && form) {
                    input.value = p;
                    form.dispatchEvent(new Event('submit'));
                }
            }
        });
    });

    stream.appendChild(msg);
    stream.scrollTop = stream.scrollHeight;
}

function _appendErrorMsg(stream, text) {
    const msg = document.createElement('div');
    msg.className = 'ai-message ai-message-assistant ai-message-error';
    msg.innerHTML = `
        <div class="ai-message-header">AI ASSISTANT NOTICE</div>
        <div class="ai-message-body">${escapeHtml(text)}</div>
    `;
    stream.appendChild(msg);
    stream.scrollTop = stream.scrollHeight;
}

/**
 * High-performance SVG Chart Renderer for SolvX AI Assistant Chart Specifications.
 * Supports: line, depth_profile (inverted y-axis), bar, and scatter charts.
 * @param {Object} chart - ChartSpecification
 * @returns {string} - SVG markup
 */
export function renderChartSvg(chart) {
    if (!chart || !chart.series || chart.series.length === 0) return '';

    const width = 380;
    const height = 220;
    const padLeft = 45;
    const padRight = 20;
    const padTop = 30;
    const padBottom = 35;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const isDepthProfile = chart.chart_type === 'depth_profile';
    const isBar = chart.chart_type === 'bar';

    // Compute min and max ranges
    let allX = [];
    let allY = [];
    chart.series.forEach(s => {
        if (Array.isArray(s.x_values)) allX.push(...s.x_values);
        if (Array.isArray(s.y_values)) allY.push(...s.y_values);
    });

    const numX = allX.filter(v => typeof v === 'number' && !isNaN(v));
    const numY = allY.filter(v => typeof v === 'number' && !isNaN(v));

    let minX = numX.length ? Math.min(...numX) : 0;
    let maxX = numX.length ? Math.max(...numX) : 10;
    if (minX === maxX) { minX -= 1; maxX += 1; }

    let minY = numY.length ? Math.min(...numY) : 0;
    let maxY = numY.length ? Math.max(...numY) : 10;
    if (minY === maxY) { minY -= 1; maxY += 1; }

    const scaleX = (x) => padLeft + ((x - minX) / (maxX - minX)) * plotW;
    const scaleY = (y) => {
        if (isDepthProfile) {
            // 0m at top (padTop), deep water at bottom (padTop + plotH)
            return padTop + ((y - minY) / (maxY - minY)) * plotH;
        } else {
            // standard Cartesian: max at top, min at bottom
            return padTop + plotH - ((y - minY) / (maxY - minY)) * plotH;
        }
    };

    // Render Grid lines & Ticks
    let gridLines = '';
    const yTicks = 4;
    for (let i = 0; i <= yTicks; i++) {
        const val = minY + (i / yTicks) * (maxY - minY);
        const yPos = scaleY(val);
        gridLines += `<line x1="${padLeft}" y1="${yPos}" x2="${width - padRight}" y2="${yPos}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="2,2" />`;
        gridLines += `<text x="${padLeft - 6}" y="${yPos + 3}" fill="#88a0b0" font-size="9" text-anchor="end">${val.toFixed(1)}</text>`;
    }

    const xTicks = 4;
    for (let i = 0; i <= xTicks; i++) {
        const val = minX + (i / xTicks) * (maxX - minX);
        const xPos = scaleX(val);
        gridLines += `<line x1="${xPos}" y1="${padTop}" x2="${xPos}" y2="${height - padBottom}" stroke="rgba(255,255,255,0.05)" />`;
        gridLines += `<text x="${xPos}" y="${height - padBottom + 14}" fill="#88a0b0" font-size="9" text-anchor="middle">${val.toFixed(1)}</text>`;
    }

    // Render Data Series
    let seriesSvg = '';
    let legendSvg = '';
    const defaultColors = ['#00c8ff', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6'];

    chart.series.forEach((s, idx) => {
        const color = s.color || defaultColors[idx % defaultColors.length];
        const dash = s.dash_style === 'dashed' ? 'stroke-dasharray="4,3"' : '';

        if (isBar) {
            const barW = Math.max(8, (plotW / s.x_values.length) * 0.6);
            for (let i = 0; i < s.x_values.length; i++) {
                const xVal = typeof s.x_values[i] === 'number' ? scaleX(s.x_values[i]) : padLeft + (i + 0.5) * (plotW / s.x_values.length);
                const yVal = scaleY(s.y_values[i]);
                const baseY = scaleY(0);
                const barH = Math.abs(baseY - yVal);
                const topY = Math.min(yVal, baseY);
                seriesSvg += `<rect x="${xVal - barW / 2}" y="${topY}" width="${barW}" height="${barH}" fill="${color}" opacity="0.85" rx="2" />`;
            }
        } else {
            // Line or depth profile
            const points = [];
            for (let i = 0; i < s.x_values.length; i++) {
                const px = scaleX(s.x_values[i]);
                const py = scaleY(s.y_values[i]);
                if (!isNaN(px) && !isNaN(py)) {
                    points.push(`${px},${py}`);
                    seriesSvg += `<circle cx="${px}" cy="${py}" r="2.5" fill="${color}" />`;
                }
            }
            if (points.length > 1) {
                seriesSvg += `<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="2" ${dash} />`;
            }
        }

        // Add legend entry
        const legX = padLeft + idx * 95;
        legendSvg += `
            <g transform="translate(${legX}, ${height - 6})">
                <rect x="0" y="-6" width="10" height="4" fill="${color}" />
                <text x="14" y="-2" fill="#a0c0d8" font-size="8.5">${escapeHtml(s.name || `Series ${idx+1}`)}</text>
            </g>
        `;
    });

    return `
        <div class="ai-chart-card">
            <div class="ai-chart-header">
                <span class="ai-chart-title">${escapeHtml(chart.title || 'Ocean Data Chart')}</span>
                <span class="ai-chart-badge">${escapeHtml(chart.chart_type)}</span>
            </div>
            <svg class="ai-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
                ${gridLines}
                ${seriesSvg}
                <!-- Axes labels -->
                <text x="${width / 2}" y="${height - padBottom + 26}" fill="#6488a0" font-size="9" text-anchor="middle">${escapeHtml(chart.x_label || 'X Axis')}</text>
                <text x="12" y="${padTop + plotH / 2}" fill="#6488a0" font-size="9" text-anchor="middle" transform="rotate(-90, 12, ${padTop + plotH / 2})">${escapeHtml(chart.y_label || 'Y Axis')}</text>
                ${legendSvg}
            </svg>
        </div>
    `;
}

function escapeHtml(str) {
    return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatMarkdown(text) {
    if (!text) return '';
    return escapeHtml(text)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code class="mono">$1</code>')
        .replace(/\n\n/g, '<br><br>')
        .replace(/\n/g, '<br>');
}
