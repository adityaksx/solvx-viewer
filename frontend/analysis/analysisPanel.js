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
                <button class="analysis-refresh-btn" id="analysisPanelRefresh" title="Refresh all data">↺</button>
                <button class="analysis-close-btn" id="analysisPanelClose" title="Close panel">✕</button>
            </div>
        </div>
        <div class="analysis-panel-body" id="analysisPanelBody">
            <div class="analysis-loading" id="analysisPanelLoading">
                <div class="analysis-spinner"></div>
                <span>Loading analysis data…</span>
            </div>
            <div id="analysisPanelContent" class="hidden"></div>
        </div>
    `;
    document.body.appendChild(_panel);

    document.getElementById('analysisPanelClose').addEventListener('click', () => _setPanelOpen(false));
    document.getElementById('analysisPanelRefresh').addEventListener('click', () => _refresh());
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
        const [summary, anomalies, regions, coverage, gaps] = await Promise.allSettled([
            ApiClient.getAnalysisSummary(),
            ApiClient.getAnomalies({ variable: 'temperature', method: 'zscore' }),
            ApiClient.getAbnormalRegions({ variable: 'temperature', method: 'zscore' }),
            ApiClient.getObservationCoverage(),
            ApiClient.getDataGaps(),
        ]);

        content.innerHTML = [
            _renderAiAssistant(),
            _renderModelVsArgo(summary.value, anomalies.value),
            _renderCoverage(coverage.value),
            _renderGaps(gaps.value),
            _renderAnomalies(anomalies.value, regions.value),
            _renderProfileAnalysis(),
        ].join('');

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
        content.innerHTML = `<div class="analysis-error">Failed to load analysis data.<br><small>${err.message}</small></div>`;
    }
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------
function _renderModelVsArgo(summary, anomalies) {
    const ma    = summary?.model_accuracy || {};
    const rmse  = ma.overall_rmse != null ? ma.overall_rmse.toFixed(4)  : '—';
    const bias  = ma.overall_bias != null ? ma.overall_bias.toFixed(4)  : '—';
    const mae   = ma.overall_mae  != null ? ma.overall_mae.toFixed(4)   : '—';
    const nComp = ma.total_sounding_points ?? '—';
    const floats = ma.floats_compared ?? '—';

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
            <div class="analysis-stat"><div class="analysis-stat-label">RMSE</div><div class="analysis-stat-value">${rmse} °C</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Bias</div><div class="analysis-stat-value">${bias} °C</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">MAE</div><div class="analysis-stat-value">${mae} °C</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Comparisons</div><div class="analysis-stat-value">${nComp}</div></div>
        </div>
        ${topRow}
    </details>`;
}

function _renderCoverage(cov) {
    if (!cov) return `<details class="analysis-section"><summary class="analysis-section-title">OBSERVATION COVERAGE</summary><div class="analysis-error-inline">Unavailable</div></details>`;

    const pct    = cov.spatial_coverage_pct?.toFixed(1) ?? '—';
    const total  = cov.total_observations ?? '—';
    const active = cov.active_floats_count ?? '—';
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
            <div class="analysis-stat"><div class="analysis-stat-label">Spatial</div><div class="analysis-stat-value">${pct}%</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">HIGH cells</div><div class="analysis-stat-value">${dens.HIGH ?? 0}</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">No coverage</div><div class="analysis-stat-value">${dens.NONE ?? 0}</div></div>
        </div>
        <table class="analysis-table">
            <thead><tr><th>Layer</th><th>Depth</th><th>Floats</th><th>Soundings</th><th>Status</th></tr></thead>
            <tbody>${strataRows}</tbody>
        </table>
    </details>`;
}

function _renderGaps(gaps) {
    if (!gaps) return `<details class="analysis-section"><summary class="analysis-section-title">DATA GAPS</summary><div class="analysis-error-inline">Unavailable</div></details>`;

    const gapPct = gaps.gap_percentage?.toFixed(1) ?? '—';
    const empty  = gaps.empty_cells_count ?? '—';
    const total  = gaps.total_cells ?? '—';

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
            <div class="analysis-stat"><div class="analysis-stat-label">Gap %</div><div class="analysis-stat-value">${gapPct}%</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Empty</div><div class="analysis-stat-value">${empty}</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Total Cells</div><div class="analysis-stat-value">${total}</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Gap Regions</div><div class="analysis-stat-value">${(gaps.gap_regions || []).length}</div></div>
        </div>
        ${gapRows ? `
        <div class="analysis-sub-label">Spatial Gap Regions</div>
        <table class="analysis-table">
            <thead><tr><th>Region</th><th>Severity</th><th>Density</th><th></th></tr></thead>
            <tbody>${gapRows}</tbody>
        </table>` : ''}
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
    const method = anomalies?.method ?? '—';
    const sigma  = anomalies?.threshold_sigma ?? '—';

    const anomalyRows = (anomalies?.anomalies || []).slice(0, 30).map(a => `
        <tr>
            <td>${a.variable}</td>
            <td>${a.float_id}</td>
            <td>${a.latitude?.toFixed(2)}, ${a.longitude?.toFixed(2)}</td>
            <td>${a.depth?.toFixed(0)} m</td>
            <td>${a.value?.toFixed(3)}</td>
            <td>${a.difference?.toFixed(3)}</td>
            <td>${a.detection_method}</td>
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
            <td>${r.anomaly_magnitude_mean?.toFixed(3)}</td>
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
            <div class="analysis-stat"><div class="analysis-stat-label">Anomalies</div><div class="analysis-stat-value">${count}</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Method</div><div class="analysis-stat-value">${method}</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">σ</div><div class="analysis-stat-value">${sigma}</div></div>
            <div class="analysis-stat"><div class="analysis-stat-label">Regions</div><div class="analysis-stat-value">${regions?.region_count ?? 0}</div></div>
        </div>
        ${regionRows ? `
        <div class="analysis-sub-label">Abnormal Regions</div>
        <table class="analysis-table">
            <thead><tr><th>Region</th><th>Depth</th><th>Count</th><th>Mean Δ</th><th>Severity</th><th></th></tr></thead>
            <tbody>${regionRows}</tbody>
        </table>` : ''}
        ${anomalyRows ? `
        <div class="analysis-sub-label">Flagged Depth Levels <small>(top 30)</small></div>
        <table class="analysis-table">
            <thead><tr><th>Var</th><th>Float</th><th>Lat,Lon</th><th>Depth</th><th>Value</th><th>Diff</th><th>Method</th><th>Sev.</th><th></th></tr></thead>
            <tbody>${anomalyRows}</tbody>
        </table>` : `<div class="analysis-empty">No anomalies detected at σ=${sigma}.</div>`}
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
