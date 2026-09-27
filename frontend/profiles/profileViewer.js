/**
 * SolvX — In-Situ Oceanographic Profile Viewer
 * ============================================
 * Renders high-fidelity vertical profiles (inverted depth: 0m at top down to 2000m+)
 * for Argo profiling floats. Supports Temperature, Salinity, Chlorophyll-a,
 * metadata exploration, thermocline detection, and tabular soundings.
 */

export class ProfileViewer {
    constructor(app = null) {
        this.app = app;
        this.currentProfile = null;
        this.activeTime = null;
        this.activeVariable = 'temperature'; // 'temperature' | 'salinity' | 'chlorophyll' | 'compare' | 'table'
        this.modalEl = null;
        this.initDOM();
    }

    // Robust variable value accessor handling varied property naming across providers
    getVal(pt, varName) {
        if (!pt) return null;
        if (varName === 'temperature') {
            const v = pt.temperature ?? pt.temp ?? pt.thetao ?? pt.TEMP;
            return (v != null && !isNaN(v)) ? Number(v) : null;
        }
        if (varName === 'salinity') {
            const v = pt.salinity ?? pt.sal ?? pt.psal ?? pt.so ?? pt.PSAL;
            return (v != null && !isNaN(v)) ? Number(v) : null;
        }
        if (varName === 'chlorophyll') {
            const v = pt.chlorophyll ?? pt.chl ?? pt.chla ?? pt.CHLA;
            return (v != null && !isNaN(v)) ? Number(v) : null;
        }
        const v = pt[varName];
        return (v != null && !isNaN(v)) ? Number(v) : null;
    }

    initDOM() {
        let modal = document.getElementById('profileViewerModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'profileViewerModal';
            modal.className = 'profile-modal-backdrop hidden';
            modal.innerHTML = `
                <div class="profile-modal-dialog panel">
                    <div class="profile-header">
                        <div class="profile-title-group">
                            <div class="profile-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="5" r="3"></circle>
                                    <line x1="12" y1="8" x2="12" y2="22"></line>
                                    <path d="M5 12h14"></path>
                                    <circle cx="12" cy="18" r="2"></circle>
                                </svg>
                            </div>
                            <div>
                                <h3 id="pvTitle">Argo Profiling Float</h3>
                                <div class="profile-badges" id="pvBadges"></div>
                            </div>
                        </div>
                        <button id="pvCloseBtn" class="close-btn" title="Close (Esc)">×</button>
                    </div>

                    <div class="profile-meta-bar" id="pvMetaBar"></div>

                    <div class="profile-tabs" id="pvTabs">
                        <button class="pv-tab active" data-var="temperature">
                            <span class="pv-dot pv-dot-temp"></span> Temperature (°C)
                        </button>
                        <button class="pv-tab" data-var="salinity">
                            <span class="pv-dot pv-dot-sal"></span> Salinity (PSU)
                        </button>
                        <button class="pv-tab" data-var="chlorophyll" id="pvChlTab" style="display:none;">
                            <span class="pv-dot pv-dot-chl"></span> Chlorophyll-a (mg/m³)
                        </button>
                        <button class="pv-tab" data-var="compare">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="8" x2="12" y2="12"></line>
                                <line x1="12" y1="16" x2="12.01" y2="16"></line>
                            </svg>
                            Model Comparison
                        </button>
                        <button class="pv-tab" data-var="table">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18"></path>
                            </svg>
                            Sounding Table
                        </button>
                    </div>

                    <div class="profile-body">
                        <div id="pvChartContainer" class="pv-chart-container">
                            <svg id="pvSvgChart" class="pv-svg" preserveAspectRatio="xMidYMid meet"></svg>
                            <div id="pvTooltip" class="pv-tooltip hidden"></div>
                        </div>
                        <div id="pvTableContainer" class="pv-table-container hidden"></div>
                        <div id="pvCompareContainer" class="pv-compare-container hidden"></div>
                    </div>

                    <div class="profile-footer">
                        <div class="pv-footer-info" id="pvFooterInfo"></div>
                        <div class="pv-footer-actions">
                            <button id="pvFocusBtn" class="action-btn secondary pv-action-btn">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <circle cx="12" cy="12" r="3"></circle>
                                </svg>
                                Focus in 3D
                            </button>
                            <button id="pvInspectPointBtn" class="action-btn secondary pv-action-btn">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="11" cy="11" r="8"></circle>
                                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                                </svg>
                                Inspect Point
                            </button>
                            <button id="pvExportBtn" class="action-btn secondary pv-action-btn">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                                Export JSON
                            </button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        this.modalEl = modal;

        // Hook close button and backdrop click
        document.getElementById('pvCloseBtn')?.addEventListener('click', () => this.close());
        this.modalEl.addEventListener('click', (e) => {
            if (e.target === this.modalEl) this.close();
        });

        // Tab clicking
        const tabs = this.modalEl.querySelectorAll('.pv-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const varName = tab.dataset.var;
                this.setActiveVariable(varName);
            });
        });

        // Focus in 3D
        document.getElementById('pvFocusBtn')?.addEventListener('click', () => {
            if (this.currentProfile) {
                const lat = this.currentProfile.latitude;
                const lon = this.currentProfile.longitude;
                if (lat != null && lon != null) {
                    if (window.solvxViewer) {
                        window.solvxViewer.focusLocation(lat, lon);
                    } else if (this.app?.focusLocation) {
                        this.app.focusLocation(lat, lon);
                    }
                }
            }
        });

        // Inspect Point in SolvX Point Inspector
        document.getElementById('pvInspectPointBtn')?.addEventListener('click', () => {
            if (this.currentProfile) {
                const lat = this.currentProfile.latitude;
                const lon = this.currentProfile.longitude;
                const depth = this.currentProfile.depth ?? 0;
                if (lat != null && lon != null && this.app?.inspectPoint) {
                    this.app.inspectPoint({ lat, lon, depthM: depth });
                }
            }
        });

        // Export JSON
        document.getElementById('pvExportBtn')?.addEventListener('click', () => {
            if (this.currentProfile) {
                const blob = new Blob([JSON.stringify(this.currentProfile, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `argo_${this.currentProfile.wmo || this.currentProfile.id}_profile.json`;
                a.click();
                URL.revokeObjectURL(url);
            }
        });

        // Escape key to close
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.modalEl.classList.contains('hidden')) {
                this.close();
            }
        });
    }

    /**
     * Opens the profile viewer for a float profile or float ID.
     * @param {Object|string} profileOrId
     * @param {string} [activeTime]
     */
    async show(profileOrId, activeTime = null) {
        if (!profileOrId) return;
        this.activeTime = activeTime || this.app?.activeTime || null;

        let profile = profileOrId;
        if (typeof profileOrId === 'string' || typeof profileOrId === 'number') {
            try {
                if (this.app?.status) this.app.status(`Fetching In-Situ Profile #${profileOrId}…`, 'busy');
                const { ApiClient } = await import('../api/apiClient.js');
                profile = await ApiClient.getArgoFloat(String(profileOrId));
            } catch (err) {
                console.error('Failed fetching float profile:', err);
                if (this.app?.status) this.app.status(`Failed loading profile #${profileOrId}`, 'error');
                return;
            }
        }

        this.currentProfile = profile;
        this.renderMetadata();
        this.setupAvailableTabs();
        this.renderActiveView();

        this.modalEl.classList.remove('hidden');
        if (this.app?.status) {
            this.app.status(`Viewing In-Situ Observation #${profile.wmo || profile.id || profile.glider_id || ''}`);
        }
    }

    updateActiveTime(timeIso) {
        this.activeTime = timeIso;
        if (this.currentProfile && !this.modalEl?.classList.contains('hidden')) {
            this.renderMetadata();
            if (this.activeVariable === 'compare') {
                this.renderComparison();
            }
        }
    }

    close() {
        this.modalEl?.classList.add('hidden');
    }

    renderMetadata() {
        const p = this.currentProfile;
        if (!p) return;

        const isGlider = p.type === 'glider' || /glider/i.test(p.platform || '') || /glider/i.test(p.platform_type || '') || p.glider_id != null;
        const dialogEl = this.modalEl?.querySelector('.profile-modal-dialog');
        if (dialogEl) {
            if (isGlider) {
                dialogEl.classList.add('glider-theme');
            } else {
                dialogEl.classList.remove('glider-theme');
            }
        }

        // Title
        const titleEl = document.getElementById('pvTitle');
        if (titleEl) {
            titleEl.textContent = isGlider 
                ? `Autonomous Glider #${p.id || p.glider_id || p.name || 'In-Situ'}`
                : `Argo Float #${p.wmo || p.id}`;
        }

        // Badges
        const badgesEl = document.getElementById('pvBadges');
        if (badgesEl) {
            const hasChl = (p.profile || []).some(pt => this.getVal(pt, 'chlorophyll') != null);
            if (isGlider) {
                badgesEl.innerHTML = `
                    <span class="badge badge-primary">UNDERWATER GLIDER</span>
                    ${hasChl ? '<span class="badge badge-success">BGC OPTICAL</span>' : '<span class="badge badge-info">PHYSICAL CTD</span>'}
                    <span class="badge badge-secondary">${p.mission_name || `MISSION ${p.dive_count ? `(DIVE ${p.dive_count})` : 'SURVEY'}`}</span>
                `;
            } else {
                badgesEl.innerHTML = `
                    <span class="badge badge-primary">${p.platform_type || 'PROFILING FLOAT'}</span>
                    ${hasChl ? '<span class="badge badge-success">BGC-ARGO (BIO)</span>' : '<span class="badge badge-info">CORE ARGO (CTD)</span>'}
                    <span class="badge badge-secondary">CYCLE #${p.cycle_number ?? p.cycle ?? 1}</span>
                `;
            }
        }

        // Meta bar
        const metaBar = document.getElementById('pvMetaBar');
        if (metaBar) {
            const latStr = p.latitude != null ? `${Math.abs(p.latitude).toFixed(3)}° ${p.latitude >= 0 ? 'N' : 'S'}` : '—';
            const lonStr = p.longitude != null ? `${Math.abs(p.longitude).toFixed(3)}° ${p.longitude >= 0 ? 'E' : 'W'}` : '—';
            const obsDate = p.date || p.timestamp;
            const obsDateStr = obsDate ? new Date(obsDate).toUTCString() : '—';
            const activeTimeStr = this.activeTime ? new Date(this.activeTime).toUTCString() : 'Active Timeline';
            const maxD = p.max_depth ? `${p.max_depth} m` : (p.depth_range ? `${p.depth_range[1]} m` : '—');
            const nLevels = (p.profile || []).length;

            metaBar.innerHTML = `
                <div class="pv-meta-item">
                    <span class="pv-meta-label">COORDINATES</span>
                    <span class="pv-meta-val mono">${latStr}, ${lonStr}</span>
                </div>
                <div class="pv-meta-item">
                    <span class="pv-meta-label">OBSERVATION DATE</span>
                    <span class="pv-meta-val">${obsDateStr}</span>
                </div>
                <div class="pv-meta-item">
                    <span class="pv-meta-label">SELECTED MODEL TIME</span>
                    <span class="pv-meta-val" style="color: #38bdf8;">${activeTimeStr}</span>
                </div>
                <div class="pv-meta-item">
                    <span class="pv-meta-label">INSTITUTION & PROFILE</span>
                    <span class="pv-meta-val mono">${p.institution || 'INCOIS / Argo'} · ${nLevels} lvls (${maxD})</span>
                </div>
            `;
        }

        // Footer info
        const footerInfo = document.getElementById('pvFooterInfo');
        if (footerInfo) {
            const firstPt = (p.profile || [])[0];
            const sTemp = this.getVal(firstPt, 'temperature');
            const sSal = this.getVal(firstPt, 'salinity');
            const sTempStr = sTemp != null ? `${sTemp.toFixed(2)} °C` : (p.surface_temp != null ? `${p.surface_temp.toFixed(2)} °C` : '—');
            const sSalStr = sSal != null ? `${sSal.toFixed(2)} PSU` : (p.surface_salinity != null ? `${p.surface_salinity.toFixed(2)} PSU` : '—');
            footerInfo.innerHTML = `
                <span>Surface Temp: <b>${sTempStr}</b></span>
                <span class="pv-sep">|</span>
                <span>Surface Salinity: <b>${sSalStr}</b></span>
            `;
        }
    }

    setupAvailableTabs() {
        const p = this.currentProfile;
        const chlTab = document.getElementById('pvChlTab');
        const hasChl = (p?.profile || []).some(pt => this.getVal(pt, 'chlorophyll') != null);
        if (chlTab) {
            chlTab.style.display = hasChl ? 'flex' : 'none';
        }

        if (this.activeVariable === 'chlorophyll' && !hasChl) {
            this.activeVariable = 'temperature';
        }

        const tabs = this.modalEl.querySelectorAll('.pv-tab');
        tabs.forEach(tab => {
            if (tab.dataset.var === this.activeVariable) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });
    }

    setActiveVariable(varName) {
        this.activeVariable = varName;
        const tabs = this.modalEl.querySelectorAll('.pv-tab');
        tabs.forEach(tab => {
            if (tab.dataset.var === varName) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });
        this.renderActiveView();
    }

    renderActiveView() {
        const chartBox = document.getElementById('pvChartContainer');
        const tableBox = document.getElementById('pvTableContainer');
        const compareBox = document.getElementById('pvCompareContainer');

        if (this.activeVariable === 'table') {
            chartBox?.classList.add('hidden');
            tableBox?.classList.remove('hidden');
            compareBox?.classList.add('hidden');
            this.renderTable();
        } else if (this.activeVariable === 'compare') {
            chartBox?.classList.add('hidden');
            tableBox?.classList.add('hidden');
            compareBox?.classList.remove('hidden');
            this.renderComparison();
        } else {
            chartBox?.classList.remove('hidden');
            tableBox?.classList.add('hidden');
            compareBox?.classList.add('hidden');
            this.renderSvgChart();
        }
    }

    async renderComparison(variable = 'temperature') {
        const compareBox = document.getElementById('pvCompareContainer');
        if (!compareBox || !this.currentProfile) return;

        const floatId = this.currentProfile.id || this.currentProfile.wmo || this.currentProfile.glider_id;
        const unit = variable === 'salinity' ? 'PSU' : '°C';
        const modelTime = this.activeTime || this.currentProfile.timestamp || this.currentProfile.date;

        compareBox.innerHTML = `
            <div style="padding: 24px; text-align: center; color: #94a3b8;">
                <div style="margin-bottom: 8px;">Collocating ${variable} profile with Copernicus NEMO at ${modelTime ? new Date(modelTime).toUTCString() : 'Active Date'}…</div>
                <div class="mono" style="font-size: 11px; color: #38bdf8;">Spatial Bilinear + Vertical 1D Interpolation</div>
            </div>
        `;

        try {
            const { ApiClient } = await import('../api/apiClient.js');
            let cmp;
            try {
                cmp = await ApiClient.getFloatComparison(floatId, variable, modelTime);
            } catch (_) {
                cmp = await ApiClient.compareObservation(floatId, variable, modelTime);
            }

            const rmseStr = cmp.rmse != null ? `${cmp.rmse.toFixed(3)} ${unit}` : '—';
            const biasStr = cmp.bias != null ? `${cmp.bias.toFixed(3)} ${unit}` : '—';
            const maeStr = cmp.mae != null ? `${cmp.mae.toFixed(3)} ${unit}` : '—';
            const maxDiffStr = cmp.max_diff != null ? `${cmp.max_diff.toFixed(3)} ${unit}` : '—';
            const compRows = Array.isArray(cmp.comparison) ? cmp.comparison : [];

            compareBox.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <div style="font-size: 11px; color: #94a3b8;">
                        Model Date: <b style="color: #38bdf8;">${modelTime ? new Date(modelTime).toISOString().slice(0, 10) : 'Active'}</b> · Source: <b style="color: #00d2ff;">${cmp.model_source || 'Copernicus NEMO 1/12°'}</b>
                    </div>
                    <div style="display: flex; gap: 6px;">
                        <button id="pvCmpTempBtn" class="pv-tab ${variable === 'temperature' ? 'active' : ''}" style="padding: 4px 8px; font-size: 10px;">Temp (°C)</button>
                        <button id="pvCmpSalBtn" class="pv-tab ${variable === 'salinity' ? 'active' : ''}" style="padding: 4px 8px; font-size: 10px;">Salinity (PSU)</button>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px;">
                    <div style="background: rgba(5, 15, 25, 0.7); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 8px; padding: 8px 10px;">
                        <div style="font-size: 9px; color: #94a3b8; text-transform: uppercase; font-weight: 700; margin-bottom: 2px;">RMSE</div>
                        <div style="font-size: 14px; font-weight: 700; color: #00d2ff; font-family: monospace;">${rmseStr}</div>
                    </div>
                    <div style="background: rgba(5, 15, 25, 0.7); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 8px; padding: 8px 10px;">
                        <div style="font-size: 9px; color: #94a3b8; text-transform: uppercase; font-weight: 700; margin-bottom: 2px;">Mean Bias</div>
                        <div style="font-size: 14px; font-weight: 700; color: #38bdf8; font-family: monospace;">${biasStr}</div>
                    </div>
                    <div style="background: rgba(5, 15, 25, 0.7); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 8px; padding: 8px 10px;">
                        <div style="font-size: 9px; color: #94a3b8; text-transform: uppercase; font-weight: 700; margin-bottom: 2px;">MAE</div>
                        <div style="font-size: 14px; font-weight: 700; color: #34d399; font-family: monospace;">${maeStr}</div>
                    </div>
                    <div style="background: rgba(5, 15, 25, 0.7); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 8px; padding: 8px 10px;">
                        <div style="font-size: 9px; color: #94a3b8; text-transform: uppercase; font-weight: 700; margin-bottom: 2px;">Max Diff</div>
                        <div style="font-size: 14px; font-weight: 700; color: #fbbf24; font-family: monospace;">${maxDiffStr}</div>
                    </div>
                </div>

                <div class="pv-table-container">
                    <table class="pv-table">
                        <thead>
                            <tr>
                                <th>Depth (m)</th>
                                <th>Observed (${unit})</th>
                                <th>Model (${unit})</th>
                                <th>Diff (Obs - Mod)</th>
                                <th>Abs Diff</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${compRows.map(row => {
                                const obs = row.observed != null ? row.observed : row.observed_temp;
                                const mod = row.model != null ? row.model : row.model_temp;
                                const diff = row.diff != null ? row.diff : (obs - mod);
                                const absDiff = row.abs_diff != null ? row.abs_diff : Math.abs(diff);
                                const diffColor = Math.abs(diff) < 0.5 ? '#10b981' : (diff > 0 ? '#f59e0b' : '#38bdf8');
                                return `
                                    <tr>
                                        <td class="mono font-bold">${row.depth}</td>
                                        <td class="mono">${obs != null ? obs.toFixed(2) : '—'}</td>
                                        <td class="mono">${mod != null ? mod.toFixed(2) : '—'}</td>
                                        <td class="mono font-bold" style="color: ${diffColor};">
                                            ${diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}
                                        </td>
                                        <td class="mono">${absDiff != null ? absDiff.toFixed(2) : '—'}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;

            document.getElementById('pvCmpTempBtn')?.addEventListener('click', () => this.renderComparison('temperature'));
            document.getElementById('pvCmpSalBtn')?.addEventListener('click', () => this.renderComparison('salinity'));
        } catch (err) {
            compareBox.innerHTML = `
                <div style="padding: 20px; text-align: center; color: #f87171;">
                    Model comparison data unavailable for this float cycle (${err.message}).
                </div>
            `;
        }
    }

    renderTable() {
        const tableBox = document.getElementById('pvTableContainer');
        if (!tableBox || !this.currentProfile) return;

        const profile = this.currentProfile.profile || [];
        const hasChl = profile.some(p => this.getVal(p, 'chlorophyll') != null);

        tableBox.innerHTML = `
            <table class="pv-table">
                <thead>
                    <tr>
                        <th>Depth (m)</th>
                        <th>Temp (°C)</th>
                        <th>Salinity (PSU)</th>
                        ${hasChl ? '<th>Chlorophyll-a (mg/m³)</th>' : ''}
                        <th>QC</th>
                    </tr>
                </thead>
                <tbody>
                    ${profile.map(row => {
                        const tempVal = this.getVal(row, 'temperature');
                        const salVal = this.getVal(row, 'salinity');
                        const chlVal = this.getVal(row, 'chlorophyll');
                        return `
                            <tr>
                                <td class="mono font-bold">${row.depth}</td>
                                <td class="mono text-amber">${tempVal != null ? tempVal.toFixed(2) : '—'}</td>
                                <td class="mono text-cyan">${salVal != null ? salVal.toFixed(2) : '—'}</td>
                                ${hasChl ? `<td class="mono text-emerald">${chlVal != null ? chlVal.toFixed(3) : '—'}</td>` : ''}
                                <td><span class="pv-qc-badge">QC ${row.qc ?? 1}</span></td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    }

    renderSvgChart() {
        const svg = document.getElementById('pvSvgChart');
        if (!svg || !this.currentProfile) return;

        const profile = (this.currentProfile.profile || []).slice().sort((a, b) => a.depth - b.depth);
        if (profile.length === 0) {
            svg.innerHTML = `<text x="50%" y="50%" fill="#94a3b8" text-anchor="middle">No sounding levels available</text>`;
            return;
        }

        const varKey = this.activeVariable;
        let unit = '°C';
        let varLabel = 'Temperature';
        let strokeColor = '#f59e0b'; // amber
        let fillColor = 'rgba(245, 158, 11, 0.15)';

        if (varKey === 'salinity') {
            unit = 'PSU';
            varLabel = 'Practical Salinity';
            strokeColor = '#06b6d4'; // cyan
            fillColor = 'rgba(6, 182, 212, 0.15)';
        } else if (varKey === 'chlorophyll') {
            unit = 'mg/m³';
            varLabel = 'Chlorophyll-a';
            strokeColor = '#10b981'; // emerald
            fillColor = 'rgba(16, 185, 129, 0.15)';
        }

        // Filter valid points using robust getVal
        const points = [];
        for (const p of profile) {
            const val = this.getVal(p, varKey);
            if (val != null && !isNaN(val)) {
                points.push({ ...p, value: val });
            }
        }

        if (points.length === 0) {
            svg.innerHTML = `<text x="50%" y="50%" fill="#94a3b8" text-anchor="middle">No ${varLabel} data points available</text>`;
            return;
        }

        const width = 640;
        const height = 400;
        const margin = { top: 35, right: 35, bottom: 45, left: 65 };
        const plotWidth = width - margin.left - margin.right;
        const plotHeight = height - margin.top - margin.bottom;

        // Depth scale (INVERTED Y-AXIS: 0m at top, maxDepth at bottom)
        const minDepth = 0;
        const maxDepth = Math.max(...points.map(p => p.depth), 100);

        // Value scale (X-AXIS)
        let minVal = Math.min(...points.map(p => p.value));
        let maxVal = Math.max(...points.map(p => p.value));
        if (minVal === maxVal) {
            minVal -= 1;
            maxVal += 1;
        }
        // Add 5% padding to value domain
        const valSpan = maxVal - minVal;
        minVal = Math.max(0, minVal - valSpan * 0.05);
        maxVal = maxVal + valSpan * 0.05;

        // Coordinate transforms
        const valToX = (val) => margin.left + ((val - minVal) / (maxVal - minVal)) * plotWidth;
        const depthToY = (depth) => margin.top + (depth / maxDepth) * plotHeight;

        // Find thermocline / maximum vertical gradient if temperature
        let thermoclineDepth = null;
        if (varKey === 'temperature' && points.length > 2) {
            let maxGrad = 0;
            for (let i = 0; i < points.length - 1; i++) {
                const dz = Math.abs(points[i + 1].depth - points[i].depth);
                if (dz > 0) {
                    const dt = Math.abs(points[i + 1].value - points[i].value);
                    const grad = dt / dz;
                    if (grad > maxGrad) {
                        maxGrad = grad;
                        thermoclineDepth = (points[i].depth + points[i + 1].depth) / 2;
                    }
                }
            }
        }

        // Generate depth ticks (5-6 levels)
        const depthTicks = [0];
        const step = maxDepth <= 500 ? 100 : (maxDepth <= 1000 ? 200 : 500);
        for (let d = step; d <= maxDepth; d += step) {
            depthTicks.push(d);
        }
        if (depthTicks[depthTicks.length - 1] < maxDepth) {
            depthTicks.push(Math.round(maxDepth));
        }

        // Generate value ticks (5 intervals)
        const valTicks = [];
        const nValTicks = 5;
        for (let i = 0; i <= nValTicks; i++) {
            valTicks.push(minVal + (i / nValTicks) * (maxVal - minVal));
        }

        // Build SVG Elements
        let svgContent = `
            <defs>
                <linearGradient id="pvFillGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="${strokeColor}" stop-opacity="0.3"/>
                    <stop offset="100%" stop-color="${strokeColor}" stop-opacity="0.02"/>
                </linearGradient>
            </defs>

            <!-- Plot Background Grid -->
            <rect x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}" fill="#081420" stroke="#1e293b" stroke-width="1"/>
        `;

        // Horizontal Depth Grid Lines & Y-Axis labels (Inverted depth)
        depthTicks.forEach(d => {
            const y = depthToY(d);
            svgContent += `
                <line x1="${margin.left}" y1="${y}" x2="${margin.left + plotWidth}" y2="${y}" stroke="#1e293b" stroke-dasharray="3 3"/>
                <text x="${margin.left - 10}" y="${y + 4}" fill="#94a3b8" font-size="11" font-family="monospace" text-anchor="end">${d}m</text>
            `;
        });

        // Vertical Value Grid Lines & X-Axis labels
        valTicks.forEach(v => {
            const x = valToX(v);
            const label = varKey === 'chlorophyll' ? v.toFixed(2) : v.toFixed(1);
            svgContent += `
                <line x1="${x}" y1="${margin.top}" x2="${x}" y2="${margin.top + plotHeight}" stroke="#1e293b" stroke-dasharray="3 3"/>
                <text x="${x}" y="${margin.top + plotHeight + 18}" fill="#94a3b8" font-size="11" font-family="monospace" text-anchor="middle">${label}</text>
            `;
        });

        // Thermocline indicator
        if (thermoclineDepth != null) {
            const ty = depthToY(thermoclineDepth);
            svgContent += `
                <line x1="${margin.left}" y1="${ty}" x2="${margin.left + plotWidth}" y2="${ty}" stroke="#fb7185" stroke-width="1.5" stroke-dasharray="4 2"/>
                <text x="${margin.left + plotWidth - 8}" y="${ty - 6}" fill="#fb7185" font-size="10" font-weight="600" text-anchor="end">
                    Thermocline Layer (~${Math.round(thermoclineDepth)}m)
                </text>
            `;
        }

        // Axis Titles
        svgContent += `
            <text x="${margin.left + plotWidth / 2}" y="${height - 8}" fill="#cbd5e1" font-size="12" font-weight="500" text-anchor="middle">
                ${varLabel} (${unit})
            </text>
            <text x="18" y="${margin.top + plotHeight / 2}" fill="#cbd5e1" font-size="12" font-weight="500" text-anchor="middle" transform="rotate(-90 18 ${margin.top + plotHeight / 2})">
                Depth (meters, dbar) ↓
            </text>
        `;

        // SVG Curve Path & Shaded Area
        const pathCoords = points.map(p => `${valToX(p.value).toFixed(1)},${depthToY(p.depth).toFixed(1)}`);
        const polylineD = `M ` + pathCoords.join(' L ');

        // Area polygon closed back to minVal axis
        const areaD = `M ${valToX(minVal).toFixed(1)},${depthToY(points[0].depth).toFixed(1)} L ` +
                      pathCoords.join(' L ') +
                      ` L ${valToX(minVal).toFixed(1)},${depthToY(points[points.length - 1].depth).toFixed(1)} Z`;

        svgContent += `
            <path d="${areaD}" fill="url(#pvFillGrad)"/>
            <path d="${polylineD}" fill="none" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        `;

        // Interactive Data Circles
        points.forEach((p, idx) => {
            const cx = valToX(p.value).toFixed(1);
            const cy = depthToY(p.depth).toFixed(1);
            svgContent += `
                <circle class="pv-point" cx="${cx}" cy="${cy}" r="4" fill="${strokeColor}" stroke="#0f172a" stroke-width="1.5"
                    data-idx="${idx}" data-depth="${p.depth}" data-val="${p.value}" data-unit="${unit}" data-var="${varLabel}" data-qc="${p.qc ?? 1}">
                </circle>
            `;
        });

        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.innerHTML = svgContent;

        this.bindTooltipEvents(svg);
    }

    bindTooltipEvents(svg) {
        const tooltip = document.getElementById('pvTooltip');
        if (!tooltip) return;

        const circles = svg.querySelectorAll('.pv-point');
        circles.forEach(circle => {
            circle.addEventListener('mouseenter', (e) => {
                const depth = circle.dataset.depth;
                const val = parseFloat(circle.dataset.val);
                const unit = circle.dataset.unit;
                const varLabel = circle.dataset.var;
                const qc = circle.dataset.qc;

                circle.setAttribute('r', '7');
                circle.setAttribute('stroke', '#ffffff');

                tooltip.innerHTML = `
                    <div class="pv-tt-title">Depth: <b>${depth} m</b></div>
                    <div class="pv-tt-val">${varLabel}: <b>${val.toFixed(2)} ${unit}</b></div>
                    <div class="pv-tt-qc">Quality: <span class="badge badge-success">QC Flag ${qc} (Passed)</span></div>
                `;
                tooltip.classList.remove('hidden');

                const container = document.getElementById('pvChartContainer');
                const rect = container.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                tooltip.style.left = `${Math.min(mouseX + 15, rect.width - 160)}px`;
                tooltip.style.top = `${Math.max(mouseY - 45, 10)}px`;
            });

            circle.addEventListener('mouseleave', () => {
                circle.setAttribute('r', '4');
                circle.setAttribute('stroke', '#0f172a');
                tooltip.classList.add('hidden');
            });
        });
    }
}
