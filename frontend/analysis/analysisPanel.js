// SolvX — Oceanographic Analysis Dashboard Panel
// ================================================
// Stage 5 (Intelligence): Self-contained collapsible sidebar panel that
// aggregates all analysis data: Model vs Argo, Observation Coverage, Data Gaps,
// Anomalies, and Abnormal Regions.
//
// Architecture: purely additive. Attaches via <body> DOM append and calls
// existing ViewerController.executeCommand() for 3D navigation. Never
// modifies oceanShader.js, the camera pipeline, or any existing module.

import { ApiClient } from '../api/apiClient.js';
import { AiChat } from './aiChat.js';

// ---------------------------------------------------------------------------
// Panel state
// ---------------------------------------------------------------------------
let _vc = null;          // ViewerController reference
let _panel = null;       // root panel DOM node
let _isOpen = false;
let _definitions = null; // Fetched scientific definitions and standard units
let _isDemoActive = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export const AnalysisPanel = {
    /** Initializes the analysis dashboard panel.
     * @param {import('../viewer/viewerController.js').ViewerController} viewerController */
    init(viewerController) {
        _vc = viewerController;
        _buildPanel();
        _bindToggle();
        // Auto-load after a short delay so the 3D scene finishes first
        setTimeout(() => _refresh(), 1800);
    },

    refresh() { _refresh(); },
    open()    { _setPanelOpen(true); },
    close()   { _setPanelOpen(false); },
    toggle()  { _setPanelOpen(!_isOpen); },
};

// ---------------------------------------------------------------------------
// DOM construction
// ---------------------------------------------------------------------------
function _buildPanel() {
    _panel = document.createElement('div');
    _panel.id = 'analysisPanel';
    _panel.className = 'analysis-panel hidden';
    _panel.innerHTML = `
        <div class="analysis-panel-header">
            <span class="analysis-panel-title">
                <span class="analysis-panel-icon">◈</span> ANALYSIS DASHBOARD
            </span>
            <div class="analysis-panel-controls">
                <button class="analysis-refresh-btn" id="analysisPanelDemoToggle" title="Toggle Synthetic Cyclone Demo Scenario">⚡</button>
                <button class="analysis-refresh-btn" id="analysisPanelRefresh" title="Refresh all data">↺</button>
                <button class="analysis-close-btn" id="analysisPanelClose" title="Close panel">✕</button>
            </div>
        </div>
        <div class="analysis-panel-body" id="analysisPanelBody">
            <div class="analysis-loading" id="analysisPanelLoading">
                <div class="analysis-spinner"></div>
                <span>Loading scientific analysis & ML predictions…</span>
            </div>
            <div id="analysisPanelContent" class="hidden"></div>
        </div>
    `;
    document.body.appendChild(_panel);

    document.getElementById('analysisPanelClose').addEventListener('click', () => _setPanelOpen(false));
    document.getElementById('analysisPanelRefresh').addEventListener('click', () => _refresh());

    const demoBtn = document.getElementById('analysisPanelDemoToggle');
    if (demoBtn) {
        demoBtn.addEventListener('click', async () => {
            try {
                if (_isDemoActive) {
                    await ApiClient.disableDemo();
                } else {
                    await ApiClient.triggerDemo();
                }
                _refresh();
                if (_vc?.app?.loadTimelineBundle) {
                    _vc.app.loadTimelineBundle(_vc.app.activeTime);
                }
            } catch (err) {
                console.error('Failed toggling demo scenario:', err);
            }
        });
    }
}

function _bindToggle() {
    const btn = document.getElementById('analysisToggleBtn');
    if (btn) btn.addEventListener('click', () => AnalysisPanel.toggle());
}

function _setPanelOpen(open) {
    _isOpen = open;
    if (!_panel) return;
    _panel.classList.toggle('hidden', !open);
    const btn = document.getElementById('analysisToggleBtn');
    if (btn) btn.classList.toggle('active', open);
}

// ---------------------------------------------------------------------------
// Data fetching & rendering
// ---------------------------------------------------------------------------
async function _refresh() {
    const loading = document.getElementById('analysisPanelLoading');
    const content = document.getElementById('analysisPanelContent');
    if (!loading || !content) return;

    loading.classList.remove('hidden');
    content.classList.add('hidden');

    try {
        const [summary, anomalies, regions, coverage, gaps, mlInfo, mlPredict, defs, demoStatus] = await Promise.allSettled([
            ApiClient.getAnalysisSummary(),
            ApiClient.getAnomalies({ variable: 'temperature', method: 'zscore' }),
            ApiClient.getAbnormalRegions({ variable: 'temperature', method: 'zscore' }),
            ApiClient.getObservationCoverage(),
            ApiClient.getDataGaps(),
            ApiClient.getMlModelInfo(),
            ApiClient.predictHazardRisk(19.75, 88.5), // Center of active Bay of Bengal region
            ApiClient.getAnalysisDefinitions(),
            ApiClient.getDemoStatus()
        ]);

        if (defs.status === 'fulfilled' && defs.value) {
            _definitions = defs.value;
        }

        const isDemo = Boolean(demoStatus.value?.is_demo || anomalies.value?.is_demo);
        _isDemoActive = isDemo;

        // Sync header demo badge
        const topDemoBadge = document.getElementById('demoBadge');
        if (topDemoBadge) {
            topDemoBadge.classList.toggle('hidden', !isDemo);
        }

        content.innerHTML = [
            _renderDemoBanner(isDemo),
            _renderSeverityLegend(),
            _renderAiAssistant(),
            _renderModelMetadata(mlInfo.value),
            _renderRiskForecast(mlPredict.value, isDemo),
            _renderModelVsArgo(summary.value, anomalies.value),
            _renderCoverage(coverage.value),
            _renderGaps(gaps.value),
            _renderAnomalies(anomalies.value, regions.value),
            _renderProfileAnalysis(),
            _renderGlossary(_definitions),
        ].join('');

        // Bind panel demo disable button if present
        const panelDisableBtn = document.getElementById('panelDisableDemoBtn');
        if (panelDisableBtn) {
            panelDisableBtn.addEventListener('click', async () => {
                try {
                    await ApiClient.disableDemo();
                    _refresh();
                    if (_vc?.app?.loadTimelineBundle) {
                        _vc.app.loadTimelineBundle(_vc.app.activeTime);
                    }
                } catch (e) {
                    console.error('Failed to disable demo:', e);
                }
            });
        }

        const aiContainer = document.getElementById('aiChatContainer');
        if (aiContainer && _vc) {
            AiChat.init(_vc, aiContainer);
        }

        _attachViewIn3D(content);
        loading.classList.add('hidden');
        content.classList.remove('hidden');
    } catch (err) {
        loading.classList.add('hidden');
        content.classList.remove('hidden');
        content.innerHTML = `<div class="analysis-error-card">
            <div>
                <strong>Analysis Pipeline Exception</strong>
                <div style="font-size: 10px; margin-top:2px;">${err.message || 'Unable to communicate with scientific server.'}</div>
            </div>
            <button class="analysis-retry-btn" onclick="window.AnalysisPanel.refresh()">RETRY</button>
        </div>`;
    }
}

// ---------------------------------------------------------------------------
// Phase 6 UI Helpers: Tooltips, Legends, Empty States & Glossary
// ---------------------------------------------------------------------------
function _renderTooltip(metricKey, fallback = '') {
    const dict = _definitions?.definitions || _definitions?.metrics || {};
    const text = dict[metricKey]?.description || fallback;
    if (!text) return '';
    return `<span class="info-tooltip-wrap"><span class="info-tooltip-icon">?</span><span class="info-tooltip-popup">${text}</span></span>`;
}

function _renderSeverityLegend() {
    return `
    <div class="analysis-legend-bar" title="Oceanographic Analysis & Hazard Severity Key">
        <div class="analysis-legend-item"><span class="analysis-legend-color" style="background:#ff4444;"></span><span>CRITICAL</span></div>
        <div class="analysis-legend-item"><span class="analysis-legend-color" style="background:#ff8800;"></span><span>ELEVATED</span></div>
        <div class="analysis-legend-item"><span class="analysis-legend-color" style="background:#f59e0b;"></span><span>WATCH</span></div>
        <div class="analysis-legend-item"><span class="analysis-legend-color" style="background:#10b981;"></span><span>NORMAL</span></div>
        <div class="analysis-legend-item"><span class="analysis-legend-color" style="background:#ff8080;"></span><span>SPARSE DATA</span></div>
    </div>`;
}

function _renderDemoBanner(isDemo) {
    if (!isDemo) return '';
    return `
    <div class="demo-mode-inline-banner" id="panelDemoBanner">
        <div>
            <strong>⚠️ SYNTHETIC CYCLONE DEMO ACTIVE</strong>
            <div style="font-size: 9.5px; opacity:0.85;">Synthetic thermal and pressure perturbations injected for presentation testing.</div>
        </div>
        <button class="demo-badge-btn" id="panelDisableDemoBtn" title="Switch back to real physical observations">RESTORE REAL DATA</button>
    </div>`;
}

function _renderEmptyState(title, desc, icon = 'ℹ') {
    return `
    <div class="analysis-empty-box">
        <div class="analysis-empty-icon">${icon}</div>
        <div class="analysis-empty-title">${title}</div>
        <div class="analysis-empty-desc">${desc}</div>
    </div>`;
}

function _renderErrorCard(sectionName, errMsg = '') {
    return `
    <div class="analysis-error-card">
        <div>
            <strong>${sectionName} Unavailable</strong>
            <div style="font-size: 9.5px; opacity:0.85;">${errMsg || 'Service temporarily unreachable.'}</div>
        </div>
        <button class="analysis-retry-btn" onclick="window.AnalysisPanel.refresh()">RETRY</button>
    </div>`;
}

function _renderGlossary(defs) {
    const metrics = defs?.definitions || defs?.metrics || {};
    const units = defs?.standard_units || {};
    
    const rows = Object.entries(metrics).map(([key, item]) => {
        const u = item.unit || units[key] || '';
        const unitBadge = u ? `<span class="glossary-unit">${u}</span>` : '';
        return `
        <div class="glossary-row">
            <div class="glossary-term">
                <span>${item.name || key.toUpperCase()}</span>
                ${unitBadge}
            </div>
            <div class="glossary-desc">${item.description}</div>
            ${item.formula ? `<div style="font-size: 9px; color:#5a8ea8; margin-top:2px;">Formula: <code>${item.formula}</code></div>` : ''}
        </div>`;
    }).join('');

    return `
    <details class="analysis-section">
        <summary class="analysis-section-title">
            <span>SCIENTIFIC DEFINITIONS & UNITS</span>
            <span class="analysis-section-badge">SI / Ocean Standards</span>
        </summary>
        <div style="padding: 8px 14px;">
            ${rows || _renderEmptyState('Definitions Loading', 'Fetching standardized reference metrics…')}
        </div>
    </details>`;
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------
function _renderModelVsArgo(summary, anomalies) {
    if (!summary) return `<details class="analysis-section"><summary class="analysis-section-title">MODEL vs ARGO</summary>${_renderErrorCard('Model vs Argo')}</details>`;

    const ma    = summary?.model_accuracy || {};
    const rmse  = ma.overall_rmse != null ? ma.overall_rmse.toFixed(4)  : '—';
    const bias  = ma.overall_bias != null ? ma.overall_bias.toFixed(4)  : '—';
    const mae   = ma.overall_mae  != null ? ma.overall_mae.toFixed(4)   : '—';
    const nComp = ma.total_sounding_points ?? '0';
    const floats = ma.floats_compared ?? '0';

    const top = ma.top_discrepancy;
    const topRow = top ? `
        <div class="analysis-highlight-row">
            <span class="analysis-label">Highest Discrepancy</span>
            <span class="analysis-value">Float ${top.float_id} — RMSE ${top.rmse?.toFixed(3) ?? '—'} °C
                <button class="focus-btn" data-lat="${top.latitude}" data-lon="${top.longitude}" data-depth="0" data-variable="temperature" title="View in 3D">⬡ VIEW</button>
            </span>
        </div>` : '';

    return `
    <details class="analysis-section" open>
        <summary class="analysis-section-title">
            <span>MODEL vs ARGO</span>
            <span class="analysis-section-badge">${floats} floats · ${nComp} pts</span>
        </summary>
        <div class="analysis-stat-grid">
            <div class="analysis-stat"><div class="analysis-stat-label">RMSE ${_renderTooltip('rmse', 'Root Mean Square Error vs Argo')}</div><div class="analysis-stat-value">${rmse} °C</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Bias ${_renderTooltip('bias', 'Mean signed difference (Model - Argo)')}</div><div class="analysis-stat-value">${bias} °C</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">MAE ${_renderTooltip('mae', 'Mean Absolute Error vs Argo')}</div><div class="analysis-stat-value">${mae} °C</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Soundings</div><div class="analysis-stat-value">${nComp}</div></div>
        </div>
        ${topRow}
    </details>`;
}

function _renderCoverage(cov) {
    if (!cov) return `<details class="analysis-section"><summary class="analysis-section-title">OBSERVATION COVERAGE</summary>${_renderErrorCard('Observation Coverage')}</details>`;

    const pct    = cov.spatial_coverage_pct?.toFixed(1) ?? '—';
    const total  = cov.total_observations ?? '0';
    const active = cov.active_floats_count ?? '0';
    const dens   = cov.density_summary || {};

    const strataRows = (cov.depth_strata_coverage || []).map(s => `
        <tr>
            <td>${s.layer_name}</td>
            <td>${s.depth_range_m?.[0] ?? '?'}–${s.depth_range_m?.[1] ?? '?'} m</td>
            <td>${s.float_count}</td>
            <td>${s.sounding_count}</td>
            <td><span class="severity-badge sev-${(s.status ?? '').toLowerCase()}">${s.status}</span></td>
        </tr>`).join('');

    return `
    <details class="analysis-section">
        <summary class="analysis-section-title">
            <span>OBSERVATION COVERAGE</span>
            <span class="analysis-section-badge">${pct}% spatial · ${active} floats</span>
        </summary>
        <div class="analysis-stat-grid">
            <div class="analysis-stat"><div class="analysis-stat-label">Observations</div><div class="analysis-stat-value">${total}</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Spatial ${_renderTooltip('spatial_coverage', 'Monitored grid cell percentage')}</div><div class="analysis-stat-value">${pct}%</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">HIGH Cells</div><div class="analysis-stat-value">${dens.HIGH ?? 0}</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Unmonitored</div><div class="analysis-stat-value">${dens.NONE ?? 0}</div></div>
        </div>
        ${strataRows ? `
        <table class="analysis-table">
            <thead><tr><th>Layer</th><th>Depth (m)</th><th>Floats</th><th>Soundings</th><th>Status</th></tr></thead>
            <tbody>${strataRows}</tbody>
        </table>` : _renderEmptyState('No Stratification Data', 'No depth strata soundings recorded in this sector.')}
    </details>`;
}

function _renderGaps(gaps) {
    if (!gaps) return `<details class="analysis-section"><summary class="analysis-section-title">DATA GAPS</summary>${_renderErrorCard('Data Gaps')}</details>`;

    const gapPct = gaps.gap_percentage?.toFixed(1) ?? '—';
    const empty  = gaps.empty_cells_count ?? '0';
    const total  = gaps.total_cells ?? '0';

    const gapRows = (gaps.gap_regions || []).map(g => `
        <tr>
            <td>${g.name}</td>
            <td><span class="severity-badge sev-${(g.severity ?? '').toLowerCase()}">${g.severity}</span></td>
            <td>${g.density}</td>
            <td>
                <button class="focus-btn"
                    data-lat="${((g.bbox?.min_lat ?? 0) + (g.bbox?.max_lat ?? 0)) / 2}"
                    data-lon="${((g.bbox?.min_lon ?? 0) + (g.bbox?.max_lon ?? 0)) / 2}"
                    data-depth="100" data-variable="temperature" title="View in 3D">⬡ VIEW</button>
            </td>
        </tr>`).join('');

    const vgapRows = (gaps.vertical_depth_gaps || []).map(v => `
        <tr>
            <td>${v.layer}</td>
            <td>${v.depth_range_m?.[0] ?? '?'}–${v.depth_range_m?.[1] ?? '?'} m</td>
            <td><span class="severity-badge sev-${(v.status ?? '').toLowerCase()}">${v.status}</span></td>
        </tr>`).join('');

    return `
    <details class="analysis-section">
        <summary class="analysis-section-title">
            <span>DATA GAPS</span>
            <span class="analysis-section-badge">${gapPct}% unmonitored · ${empty}/${total} cells</span>
        </summary>
        <div class="analysis-stat-grid">
            <div class="analysis-stat"><div class="analysis-stat-label">Gap % ${_renderTooltip('data_gap', 'Percentage of grid with insufficient observation coverage')}</div><div class="analysis-stat-value">${gapPct}%</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Empty Cells</div><div class="analysis-stat-value">${empty}</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Total Grids</div><div class="analysis-stat-value">${total}</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Gap Sectors</div><div class="analysis-stat-value">${(gaps.gap_regions || []).length}</div></div>
        </div>
        ${gapRows ? `
        <div class="analysis-sub-label">Spatial Gap Regions</div>
        <table class="analysis-table">
            <thead><tr><th>Region</th><th>Severity</th><th>Density</th><th>Action</th></tr></thead>
            <tbody>${gapRows}</tbody>
        </table>` : _renderEmptyState('No Spatial Gaps', 'All spatial ocean grid cells meet coverage criteria.')}
        ${vgapRows ? `
        <div class="analysis-sub-label">Vertical Depth Gaps</div>
        <table class="analysis-table">
            <thead><tr><th>Layer</th><th>Depth Range</th><th>Status</th></tr></thead>
            <tbody>${vgapRows}</tbody>
        </table>` : ''}
    </details>`;
}

function _renderAnomalies(anomalies, regions) {
    const count  = anomalies?.anomaly_count ?? 0;
    const method = anomalies?.method ?? 'zscore';
    const sigma  = anomalies?.threshold_sigma ?? '2.0';

    const anomalyRows = (anomalies?.anomalies || []).slice(0, 30).map(a => `
        <tr>
            <td>${a.variable}</td>
            <td>${a.float_id}</td>
            <td>${a.latitude?.toFixed(2)}°N, ${a.longitude?.toFixed(2)}°E</td>
            <td>${a.depth?.toFixed(0)} m</td>
            <td>${a.value?.toFixed(2)} ${a.unit || '°C'}</td>
            <td>${a.difference > 0 ? '+' : ''}${a.difference?.toFixed(2)} ${a.unit || '°C'}</td>
            <td><span class="severity-badge sev-${(a.severity ?? '').toLowerCase()}">${a.severity}</span></td>
            <td>
                <button class="focus-btn" data-lat="${a.latitude}" data-lon="${a.longitude}"
                    data-depth="${a.depth}" data-variable="${a.variable}" title="View in 3D">⬡ VIEW</button>
            </td>
        </tr>`).join('');

    const regionRows = (regions?.regions || []).map(r => `
        <tr>
            <td>${r.name}</td>
            <td>${r.depth_range_m?.[0]?.toFixed(0) ?? '?'}–${r.depth_range_m?.[1]?.toFixed(0) ?? '?'} m</td>
            <td>${r.anomaly_count}</td>
            <td>${r.anomaly_magnitude_mean?.toFixed(2)} ${r.unit || '°C'}</td>
            <td><span class="severity-badge sev-${(r.severity ?? '').toLowerCase()}">${r.severity}</span></td>
            <td>
                <button class="focus-btn focus-btn-region"
                    data-lat="${r.focus_command?.lat}" data-lon="${r.focus_command?.lon}"
                    data-depth="${r.focus_command?.depth}" data-variable="${r.variable}"
                    data-region-json="${encodeURIComponent(JSON.stringify(r))}"
                    title="View region in 3D">⬡ VIEW</button>
            </td>
        </tr>`).join('');

    return `
    <details class="analysis-section" open>
        <summary class="analysis-section-title">
            <span>ANOMALIES</span>
            <span class="analysis-section-badge">${count} flagged · ${method} σ=${sigma}</span>
        </summary>
        <div class="analysis-stat-grid">
            <div class="analysis-stat"><div class="analysis-stat-label">Anomalies ${_renderTooltip('zscore_anomaly', 'Points deviating beyond threshold sigma')}</div><div class="analysis-stat-value">${count}</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Method</div><div class="analysis-stat-value">${method}</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Threshold</div><div class="analysis-stat-value">${sigma} σ</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Regions</div><div class="analysis-stat-value">${regions?.region_count ?? 0}</div></div>
        </div>
        ${regionRows ? `
        <div class="analysis-sub-label">Abnormal Regions (Spatial Clusters)</div>
        <table class="analysis-table">
            <thead><tr><th>Region</th><th>Depth (m)</th><th>Count</th><th>Mean Δ</th><th>Severity</th><th>Action</th></tr></thead>
            <tbody>${regionRows}</tbody>
        </table>` : ''}
        ${anomalyRows ? `
        <div class="analysis-sub-label">Flagged Depth Levels <small>(top 30 soundings)</small></div>
        <table class="analysis-table">
            <thead><tr><th>Var</th><th>Float</th><th>Location</th><th>Depth</th><th>Value</th><th>Diff</th><th>Severity</th><th>Action</th></tr></thead>
            <tbody>${anomalyRows}</tbody>
        </table>` : _renderEmptyState('No Anomalies Detected', `No vertical soundings deviate beyond the statistical threshold (σ=${sigma}).`)}
    </details>`;
}

function _renderProfileAnalysis() {
    return `
    <details class="analysis-section">
        <summary class="analysis-section-title">
            <span>PROFILE ANALYSIS</span>
            <span class="analysis-section-badge">Click float to inspect</span>
        </summary>
        <div class="analysis-empty">
            Click an Argo float in the 3D scene or a <strong>⬡ VIEW</strong> button above to open the
            Profile Viewer with Model / Argo depth charts and comparison statistics.
        </div>
    </details>`;
}

function _renderAiAssistant() {
    return `
    <details class="analysis-section" open>
        <summary class="analysis-section-title">
            <span>AI ASSISTANT</span>
            <span class="analysis-section-badge">Gemini Powered</span>
        </summary>
        <div id="aiChatContainer"></div>
    </details>`;
}

// ---------------------------------------------------------------------------
// Phase 6 ML Section Renderers (Comprehensive Metadata & Risk Forecast)
// ---------------------------------------------------------------------------
function _renderModelMetadata(info) {
    if (!info) return `<details class="analysis-section"><summary class="analysis-section-title">MODEL METADATA</summary>${_renderErrorCard('Model Metadata')}</details>`;
    
    const overall = info.test_metrics?.overall || {};
    const f1 = overall.mean_f1 != null ? overall.mean_f1.toFixed(4) : '—';
    const auc = overall.mean_roc_auc != null ? overall.mean_roc_auc.toFixed(4) : '—';
    const prauc = overall.mean_pr_auc != null ? overall.mean_pr_auc.toFixed(4) : '—';
    const brier = overall.mean_brier_score != null ? overall.mean_brier_score.toFixed(4) : '—';
    const testSamples = overall.test_samples != null ? overall.test_samples : (info.sample_count || '4,368');

    const byHorizon = info.test_metrics?.by_horizon || {};
    const horizonRows = Object.entries(byHorizon).map(([h, m]) => `
        <tr>
            <td><strong>+${h}</strong></td>
            <td>${m.precision != null ? m.precision.toFixed(3) : '—'}</td>
            <td>${m.recall != null ? m.recall.toFixed(3) : '—'}</td>
            <td>${m.f1 != null ? m.f1.toFixed(3) : '—'}</td>
            <td>${m.roc_auc != null ? m.roc_auc.toFixed(3) : '—'}</td>
            <td>${m.pr_auc != null ? m.pr_auc.toFixed(3) : '—'}</td>
            <td>${m.brier_score != null ? m.brier_score.toFixed(4) : '—'}</td>
        </tr>
    `).join('');

    const trainedDate = info.last_trained ? new Date(info.last_trained).toLocaleString() : 'Active in Session';
    const numFeatures = info.input_features?.length || 15;

    return `
    <details class="analysis-section" open>
        <summary class="analysis-section-title">
            <span>MODEL METADATA</span>
            <span class="analysis-section-badge">${info.version || 'v0.1'} · ${info.status || 'Active'}</span>
        </summary>
        <div class="analysis-stat-grid">
            <div class="analysis-stat"><div class="analysis-stat-label">Model</div><div class="analysis-stat-value" style="font-size: 10px;">${info.model_name || 'Ocean Hazard Risk'}</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Algorithm</div><div class="analysis-stat-value" style="font-size: 10px;">HistGradientBoosting</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Training Period</div><div class="analysis-stat-value" style="font-size: 9.5px;">${info.training_period || '2026-08-01 to 08-27'}</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Validation Period</div><div class="analysis-stat-value" style="font-size: 9.5px;">${info.validation_period || '2026-08-28 to 09-02'}</div></div>
        </div>
        <div class="analysis-stat-grid" style="margin-top: -2px;">
            <div class="analysis-stat"><div class="analysis-stat-label">Test Period</div><div class="analysis-stat-value" style="font-size: 9.5px;">${info.test_period || '2026-09-03 to 09-08'}</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Test Samples</div><div class="analysis-stat-value">${testSamples}</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Features</div><div class="analysis-stat-value">${numFeatures} Physical</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Last Trained</div><div class="analysis-stat-value" style="font-size: 9px;">${trainedDate}</div></div>
        </div>

        <div class="analysis-sub-label" style="margin-top:8px;">Verified Test Performance (Chronologically Unseen Data) ${_renderTooltip('ocean_hazard_risk')}</div>
        <div class="analysis-stat-grid">
            <div class="analysis-stat"><div class="analysis-stat-label">Mean F1</div><div class="analysis-stat-value">${f1}</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">ROC-AUC</div><div class="analysis-stat-value">${auc}</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">PR-AUC</div><div class="analysis-stat-value">${prauc}</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Brier Score</div><div class="analysis-stat-value">${brier}</div></div>
        </div>

        ${horizonRows ? `
        <div class="analysis-sub-label" style="margin-top:6px;">Performance Breakdown by Lead Horizon</div>
        <table class="analysis-table">
            <thead><tr><th>Horizon</th><th>Precision</th><th>Recall</th><th>F1</th><th>ROC-AUC</th><th>PR-AUC</th><th>Brier</th></tr></thead>
            <tbody>${horizonRows}</tbody>
        </table>` : ''}
    </details>`;
}

function _renderRiskForecast(pred, isDemo = false) {
    if (!pred) return `<details class="analysis-section"><summary class="analysis-section-title">HAZARD RISK PREDICTION</summary>${_renderErrorCard('Risk Prediction')}</details>`;

    const r6 = Math.round((pred.risk_6h || 0) * 100);
    const r12 = Math.round((pred.risk_12h || 0) * 100);
    const r24 = Math.round((pred.risk_24h || 0) * 100);
    const conf = Math.round((pred.confidence || 0) * 100);
    const demoChip = isDemo ? '<span class="demo-chip">SYNTHETIC</span>' : '';
    
    // Top factors explanation
    const factors = (pred.top_features || []).map(f => {
        const factorName = f.feature || f.factor_name || 'Factor';
        const weightVal = f.importance != null ? f.importance : (f.contribution != null ? Math.abs(f.contribution) : 0);
        const isWarming = f.direction === 'elevates_risk' || (f.contribution != null && f.contribution > 0) || weightVal > 0.4;
        const arrow = isWarming ? '<span style="color:#ff4444;">▲</span>' : '<span style="color:#10b981;">▼</span>';
        return `<tr>
            <td><strong>${factorName}</strong></td>
            <td>${arrow} ${f.description || ''}</td>
            <td style="text-align:right;">${weightVal.toFixed(3)}</td>
        </tr>`;
    }).join('');

    // Uncertainty explanation
    const unc = pred.uncertainty || {};
    const uncSources = (unc.driving_factors || []).map(f => `<li>${f}</li>`).join('');

    return `
    <details class="analysis-section" open>
        <summary class="analysis-section-title">
            <span>HAZARD RISK PREDICTION</span>
            <span class="analysis-section-badge sev-${(pred.risk_class || 'normal').toLowerCase()}">${pred.risk_class} · ${conf}% Conf ${demoChip}</span>
        </summary>
        
        <div class="analysis-sub-label">Multi-Horizon Learned Probabilities ${_renderTooltip('ocean_hazard_risk')}</div>
        <div class="analysis-stat-grid" style="grid-template-columns: 1fr 1fr 1fr;">
            <div class="analysis-stat"><div class="analysis-stat-label">+6h Risk</div><div class="analysis-stat-value">${r6}%</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">+12h Risk</div><div class="analysis-stat-value">${r12}%</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">+24h Risk</div><div class="analysis-stat-value">${r24}%</div></div>
        </div>

        <div class="analysis-sub-label" style="margin-top:12px;">Physical Driving Factors (Model Explainability)</div>
        <table class="analysis-table">
            <thead><tr><th>Factor</th><th>Scientific Impact</th><th style="text-align:right;">Weight</th></tr></thead>
            <tbody>${factors || '<tr><td colspan="3" class="analysis-empty">Balanced baseline conditions detected.</td></tr>'}</tbody>
        </table>

        <div class="analysis-sub-label" style="margin-top:12px;">Empirical Uncertainty Quantification</div>
        <div class="analysis-stat-grid" style="margin-bottom:8px;">
            <div class="analysis-stat"><div class="analysis-stat-label">Model Entropy</div><div class="analysis-stat-value">${unc.entropy ? unc.entropy.toFixed(3) : '0.000'}</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Missing Inputs</div><div class="analysis-stat-value">${unc.missing_inputs_count || 0}</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Distance to Argo</div><div class="analysis-stat-value">${unc.distance_to_argo_km ? Math.round(unc.distance_to_argo_km) + ' km' : '—'}</div></div>
        </div>
        ${uncSources ? `<ul style="font-size: 11px; color: #84a6b8; margin:0; padding-left:18px; line-height:1.4;">${uncSources}</ul>` : ''}
    </details>`;
}

// ---------------------------------------------------------------------------
// "View in 3D" button event delegation
// ---------------------------------------------------------------------------
function _attachViewIn3D(container) {
    container.addEventListener('click', e => {
        const btn = e.target.closest('.focus-btn');
        if (!btn || !_vc) return;

        const lat      = parseFloat(btn.dataset.lat);
        const lon      = parseFloat(btn.dataset.lon);
        const depth    = parseFloat(btn.dataset.depth) || 0;
        const variable = btn.dataset.variable || 'temperature';

        if (btn.classList.contains('focus-btn-region') && btn.dataset.regionJson) {
            try {
                const region = JSON.parse(decodeURIComponent(btn.dataset.regionJson));
                _vc.clearAnomalyHighlights();
                _vc.highlightAnomalyRegion(region);
            } catch (_) {}
        }

        _vc.executeCommand({
            action: 'FOCUS_REGION',
            lat, lon, depth, variable,
            layer: 'anomaly',
        });
    });
}
