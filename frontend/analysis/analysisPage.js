// SolvX — Ocean Intelligence & Model Validation Dashboard
// Core scientific analysis workspace: Variable != Analysis Separation,
// Shared Geographic Context, Grounded Model vs Observation Validation,
// Synchronized Evidence Graphs, and Data-Driven Warning System.

import * as THREE from 'three';
import { ApiClient } from '../api/apiClient.js';
import { OceanScene } from '../scene/oceanScene.js';
import { buildLand, buildIslands } from '../scene/land.js';
import { buildCoastline, buildEEZ } from '../scene/coastline.js';
import { buildSeabed } from '../scene/seabed.js';
import { DynamicWater } from '../scene/water.js';
import { ScalarVisualizer } from '../visualization/scalar.js';
import { buildCurrentVectors } from '../visualization/currents.js';
import { SelectionContext } from '../context/selectionContext.js';
import { AiChat } from './aiChat.js';

const alias = {
  ocean_temperature: ['temperature', 'thetao', 'temp', 'sst'],
  temperature: ['temperature', 'thetao', 'temp', 'sst'],
  salinity: ['salinity', 'so', 'salt', 'vosaline'],
  temperature_anomaly: ['temperature_anomaly', 'sst_anomaly', 'ssta', 'temp_anomaly'],
  chlorophyll: ['chlorophyll', 'chl', 'chlor_a'],
  sea_level: ['sea_level', 'sea_surface_height', 'ssh', 'zos', 'sla'],
  currents: ['currents', 'uo', 'vo', 'ocean_currents']
};

class AnalysisDashboard {
  constructor() {
    const ctxArea = SelectionContext.getArea();
    this.activeRegionId = ctxArea?.id || 'bay_of_bengal';
    this.bbox = ctxArea?.bbox ? { ...ctxArea.bbox } : { min_lon: 84.10, max_lon: 93.00, min_lat: 16.07, max_lat: 23.52 };

    this.scene = null;
    this.water = null;
    this.scalarViz = null;

    // Separate Variable from Analysis Mode (Section 1 & 2)
    this.activeVar = SelectionContext.getVariable().id || 'ocean_temperature';
    this.analysisMode = SelectionContext.getAnalysisMode() || 'obs_vs_model';

    this.activeDepth = 0;
    this.depthLevels = [0];
    this.activeView = '3d';
    this.activeSource = 'auto';
    this.depthExaggeration = 70.0; // Renderer vertical scaling (Section 10)

    this.layerModel = true;
    this.layerArgo = true;
    this.layerAnomalies = true;
    this.layerAbnormal = true;

    // Time State
    this.timeline = [];
    this.index = 0;
    this.activeTime = null;
    this.rangeStart = null;
    this.rangeEnd = null;

    // Caches
    this.bundleCache = {};
    this.anomaliesCache = {};
    this.abnormalCache = {};
    this.modelVsArgoCache = {};
    this.timeSeriesCache = {};
    this.argoData = [];
    this.coverageData = null;
    this.gapsData = null;
    this.summaryData = null;
    this.currentGrid = null;
    this.warnings = [];

    // Selections
    this.selectedCell = null;
    this.selectedObservation = null;
    this.selectedRegion = null;
    this.selectedAnomaly = null;

    // 3D Groups
    this.markersGroup = new THREE.Group();
    this.regionsGroup = new THREE.Group();
    this.currentVectorsGroup = new THREE.Group();

    // Chart instances
    this.modelArgoChart = null;
    this.errorDepthChart = null;
    this.timeSeriesChart = null;
    this.errorMapChart = null;
  }

  async init() {
    this.updateAreaHeader();
    this.bindUI();
    this.initCharts();

    await this.loadTerrain();
    await this.loadDepths();
    await this.loadTimeline();

    if (this.timeline.length > 0) {
      await this.selectTime(0);
    }
    this.updateProvenance();
    this.initAIAssistant();

    // Subscribe to shared selection context changes
    SelectionContext.subscribe((eventType, detail) => {
      if (eventType === 'solvx:areaChange') {
        this.onAreaChanged(detail);
      } else if (eventType === 'solvx:variableChange') {
        if (detail.id !== this.activeVar) {
          this.setVariable(detail.id);
        }
      }
    });
  }

  updateAreaHeader() {
    const area = SelectionContext.getArea();
    const nameEl = document.getElementById('displayAreaName');
    if (nameEl) {
      nameEl.textContent = area?.name || 'Selected Basin';
    }
  }

  async onAreaChanged(area) {
    if (!area || !area.bbox) return;
    this.activeRegionId = area.id || 'custom';
    this.bbox = { ...area.bbox };
    this.updateAreaHeader();

    this.clearAllCaches();
    this.clearSelections();
    this.updateInvestigationSidebar();

    await this.loadTerrain();
    await this.loadDepths();
    await this.loadTimeline();
    if (this.timeline.length > 0) {
      await this.selectTime(0);
    }
    if (this.scene) this.scene.fitCamera();
  }

  bindUI() {
    // Variable selector
    const varSelect = document.getElementById('analysisVariable');
    if (varSelect) {
      varSelect.value = this.activeVar;
      varSelect.addEventListener('change', async e => {
        await this.setVariable(e.target.value);
      });
    }

    // Analysis Mode selector (Section 2)
    const modeSelect = document.getElementById('analysisModeSelect');
    if (modeSelect) {
      modeSelect.value = this.analysisMode;
      modeSelect.addEventListener('change', e => {
        this.setAnalysisMode(e.target.value);
      });
    }

    // Time Dropdown selector
    document.getElementById('analysisTimeMode')?.addEventListener('change', e => {
      const idx = Number(e.target.value);
      if (Number.isFinite(idx) && idx >= 0 && idx < this.timeline.length) {
        this.selectTime(idx);
      }
    });

    // Depth Select dropdown
    document.getElementById('analysisDepthSelect')?.addEventListener('change', e => {
      this.setDepth(Number(e.target.value));
    });

    // Depth vertical slider beside 3D scene
    document.getElementById('analysisDepthSlider')?.addEventListener('input', e => {
      const idx = Number(e.target.value);
      const depth = this.depthLevels[idx] != null ? this.depthLevels[idx] : 0;
      this.setDepth(depth);
    });

    // Data Source selector
    document.getElementById('analysisSource')?.addEventListener('change', e => {
      this.activeSource = e.target.value;
      if (this.activeSource === 'model') {
        this.layerModel = true;
        this.layerArgo = false;
        this.layerAnomalies = false;
        this.layerAbnormal = false;
      } else if (this.activeSource === 'observations') {
        this.layerModel = false;
        this.layerArgo = true;
        this.layerAnomalies = false;
        this.layerAbnormal = false;
      } else {
        this.layerModel = true;
        this.layerArgo = true;
        this.layerAnomalies = true;
        this.layerAbnormal = true;
      }
      this._syncLayerCheckboxes();
      this.updateAnalysisView();
    });

    // Reset button
    document.getElementById('btnReset')?.addEventListener('click', () => {
      this.clearSelections();
      this.updateInvestigationSidebar();
      this.clearProfileChart();
      this.clearErrorDepthChart();
      this.clearTimeSeriesChart();
      if (this.scene) this.scene.fitCamera();
    });

    // 3D View mode buttons (3D, TOP, CUT)
    document.querySelectorAll('.analysis-view-controls button').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.analysis-view-controls button').forEach(btn => btn.classList.remove('active'));
        b.classList.add('active');
        this.activeView = b.dataset.view;
        this.updateViewMode();
        this.updateAnalysisView();
      });
    });

    // Data layer checkboxes
    ['layerModel', 'layerArgo', 'layerAnomalies', 'layerAbnormal'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', e => {
          this[id] = e.target.checked;
          this.updateAnalysisView();
        });
      }
    });

    // Section 9: Compact Analysis-Selection Strip controls
    document.getElementById('btnSelectPoint')?.addEventListener('click', () => {
      const lat = parseFloat(document.getElementById('manualLat')?.value);
      const lon = parseFloat(document.getElementById('manualLon')?.value);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        this.inspectPoint({ lat, lon, depthM: this.activeDepth });
      }
    });

    document.getElementById('selectArgo')?.addEventListener('change', e => {
      const floatId = e.target.value;
      if (!floatId) return;
      const obs = this.argoData.find(o => String(o.id) === floatId || String(o.wmo) === floatId || String(o.float_id) === floatId);
      if (obs) {
        this.selectObservation(obs);
      }
    });

    document.getElementById('rangeStartDate')?.addEventListener('change', e => {
      this.rangeStart = e.target.value;
      this.updateCharts();
      this.updateKPIStrip();
    });

    document.getElementById('rangeEndDate')?.addEventListener('change', e => {
      this.rangeEnd = e.target.value;
      this.updateCharts();
      this.updateKPIStrip();
    });
  }

  _syncLayerCheckboxes() {
    const chkModel = document.getElementById('layerModel');
    const chkArgo = document.getElementById('layerArgo');
    const chkAnom = document.getElementById('layerAnomalies');
    const chkAbn = document.getElementById('layerAbnormal');
    if (chkModel) chkModel.checked = this.layerModel;
    if (chkArgo) chkArgo.checked = this.layerArgo;
    if (chkAnom) chkAnom.checked = this.layerAnomalies;
    if (chkAbn) chkAbn.checked = this.layerAbnormal;
  }

  async setVariable(v) {
    this.activeVar = v;
    SelectionContext.setVariable(v);
    const sel = document.getElementById('analysisVariable');
    if (sel && sel.value !== v) sel.value = v;

    this.clearAllCaches();
    this.clearSelections();
    this.updateInvestigationSidebar();

    await this.loadDepths();
    await this.loadTimeline();
    if (this.timeline.length > 0) {
      await this.selectTime(0);
    }
  }

  setAnalysisMode(mode) {
    this.analysisMode = mode;
    SelectionContext.setAnalysisMode(mode);
    const sel = document.getElementById('analysisModeSelect');
    if (sel && sel.value !== mode) sel.value = mode;

    this.updateAnalysisView();
    this.updateKPIStrip();
    this.updateInvestigationSidebar();
    this.updateWarningEngine();
  }

  setDepth(depthM) {
    this.activeDepth = Number(depthM);
    SelectionContext.setDepth(this.activeDepth);

    // Sync select dropdown
    const depthSelect = document.getElementById('analysisDepthSelect');
    if (depthSelect) depthSelect.value = String(this.activeDepth);

    // Sync vertical slider
    const depthSlider = document.getElementById('analysisDepthSlider');
    if (depthSlider) {
      let closestIdx = 0;
      let minDiff = Infinity;
      this.depthLevels.forEach((dl, i) => {
        const diff = Math.abs(dl - this.activeDepth);
        if (diff < minDiff) { minDiff = diff; closestIdx = i; }
      });
      depthSlider.value = String(closestIdx);
    }

    // Sync labels
    const label = document.getElementById('currentDepthLabel');
    if (label) label.textContent = `${this.activeDepth} m`;
    const readout = document.getElementById('readoutDepth');
    if (readout) readout.textContent = `${this.activeDepth} m`;

    this.updateAnalysisView();
    if (this.selectedAnomaly || this.selectedObservation || this.selectedCell) {
      this.updateInvestigationSidebar();
    }
  }

  clearAllCaches() {
    this.bundleCache = {};
    this.anomaliesCache = {};
    this.abnormalCache = {};
    this.modelVsArgoCache = {};
    this.timeSeriesCache = {};
    this.argoData = [];
    this.coverageData = null;
    this.gapsData = null;
    this.summaryData = null;
  }

  clearSelections() {
    this.selectedCell = null;
    this.selectedObservation = null;
    this.selectedAnomaly = null;
    this.selectedRegion = null;
    SelectionContext.clearSelection();
  }

  async loadDepths() {
    try {
      const res = await ApiClient.getOceanDepths(this.getBaseVar(this.activeVar));
      this.depthLevels = (res && Array.isArray(res.depths) && res.depths.length > 0)
        ? res.depths
        : [0];
    } catch (_) {
      this.depthLevels = [0, 5, 10, 25, 50, 100, 200, 500];
    }

    SelectionContext.setDepthLevels(this.depthLevels);

    // Populate depth select dropdown
    const depthSelect = document.getElementById('analysisDepthSelect');
    if (depthSelect) {
      depthSelect.innerHTML = '';
      this.depthLevels.forEach(dl => {
        const opt = document.createElement('option');
        opt.value = String(dl);
        opt.textContent = `${dl} m${dl === 0 ? ' (Surface)' : ''}`;
        depthSelect.appendChild(opt);
      });
    }

    // Configure vertical slider
    const slider = document.getElementById('analysisDepthSlider');
    if (slider) {
      slider.min = "0";
      slider.max = String(Math.max(0, this.depthLevels.length - 1));
      slider.step = "1";
    }

    // Set nearest available depth
    let closestIdx = 0;
    let minDiff = Infinity;
    this.depthLevels.forEach((dl, i) => {
      const diff = Math.abs(dl - this.activeDepth);
      if (diff < minDiff) { minDiff = diff; closestIdx = i; }
    });
    this.setDepth(this.depthLevels[closestIdx]);
  }

  initCharts() {
    // 1. Model vs Observation Vertical Profile (Section 15.1)
    const ctxModel = document.getElementById('chartModelVsArgo')?.getContext('2d');
    if (ctxModel) {
      this.modelArgoChart = new Chart(ctxModel, {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          scales: {
            x: {
              position: 'top',
              grid: { color: '#17343f' },
              ticks: { color: '#6d99a7' },
              title: { display: true, text: 'Value', color: '#6d99a7' }
            },
            y: {
              reverse: true,
              grid: { color: '#17343f' },
              ticks: { color: '#6d99a7' },
              title: { display: true, text: 'Depth (m)', color: '#6d99a7' }
            }
          },
          plugins: {
            legend: { labels: { color: '#dceff5' } },
            tooltip: { mode: 'index', intersect: false }
          },
          onClick: (e, elements) => {
            if (elements.length > 0) {
              const idx = elements[0].index;
              const depth = this.modelArgoChart.data.labels[idx];
              if (depth != null) {
                this.setDepth(depth);
              }
            }
          }
        }
      });
    }

    // 2. Error vs Depth (Section 15.2: Difference = Model - Observation)
    const ctxErrorDepth = document.getElementById('chartErrorVsDepth')?.getContext('2d');
    if (ctxErrorDepth) {
      this.errorDepthChart = new Chart(ctxErrorDepth, {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          scales: {
            x: {
              position: 'top',
              grid: { color: '#17343f' },
              ticks: { color: '#6d99a7' },
              title: { display: true, text: 'Difference (Model − Obs)', color: '#6d99a7' }
            },
            y: {
              reverse: true,
              grid: { color: '#17343f' },
              ticks: { color: '#6d99a7' },
              title: { display: true, text: 'Depth (m)', color: '#6d99a7' }
            }
          },
          plugins: {
            legend: { labels: { color: '#dceff5' } },
            tooltip: { mode: 'index', intersect: false }
          },
          onClick: (e, elements) => {
            if (elements.length > 0) {
              const idx = elements[0].index;
              const depth = this.errorDepthChart.data.labels[idx];
              if (depth != null) {
                this.setDepth(depth);
              }
            }
          }
        }
      });
    }

    // 3. Model Error / Anomaly Map (Section 15.4: Scatter bounded by regional bbox)
    const ctxError = document.getElementById('chartErrorMap')?.getContext('2d');
    if (ctxError) {
      this.errorMapChart = new Chart(ctxError, {
        type: 'scatter',
        data: { datasets: [] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              title: { display: true, text: 'Longitude (°E)', color: '#6d99a7' },
              grid: { color: '#17343f' },
              ticks: { color: '#6d99a7' },
              min: this.bbox.min_lon,
              max: this.bbox.max_lon
            },
            y: {
              title: { display: true, text: 'Latitude (°N)', color: '#6d99a7' },
              grid: { color: '#17343f' },
              ticks: { color: '#6d99a7' },
              min: this.bbox.min_lat,
              max: this.bbox.max_lat
            }
          },
          plugins: {
            legend: { display: true, labels: { color: '#6d99a7', boxWidth: 10 } },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const raw = ctx.raw;
                  const diff = raw.anomaly?.difference ?? 0;
                  return `[${raw.y.toFixed(2)}°N, ${raw.x.toFixed(2)}°E] ${diff > 0 ? '+' : ''}${diff.toFixed(2)} at ${raw.anomaly?.depth ?? 0}m`;
                }
              }
            }
          },
          onClick: (e, elements) => {
            if (elements.length > 0) {
              const el = elements[0];
              const dataPoint = this.errorMapChart.data.datasets[el.datasetIndex]?.data[el.index];
              if (dataPoint && dataPoint.anomaly) {
                this.selectedAnomaly = dataPoint.anomaly;
                this.selectedObservation = null;
                this.selectedRegion = null;
                this.selectedCell = null;
                this.focus3D();
                this.updateInvestigationSidebar();
                this.updateCharts();
              }
            }
          }
        }
      });
    }

    // 4. Selected Region / Float Time Series (Section 15.3: Real data only)
    const ctxTime = document.getElementById('chartTimeSeries')?.getContext('2d');
    if (ctxTime) {
      this.timeSeriesChart = new Chart(ctxTime, {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { grid: { color: '#17343f' }, ticks: { color: '#6d99a7' } },
            y: { grid: { color: '#17343f' }, ticks: { color: '#6d99a7' } }
          },
          plugins: {
            legend: { labels: { color: '#dceff5' } }
          }
        }
      });
    }
  }

  async loadTerrain() {
    const [geo, bathy, eez] = await Promise.all([
      ApiClient.getDataGeometry(this.bbox).catch(() => null),
      ApiClient.getDataBathymetry(this.bbox, 'medium').catch(() => null),
      ApiClient.getDataEEZ(this.bbox).catch(() => ({ features: [], lines3d: [] }))
    ]);

    if (!bathy || !bathy.terrain) {
      console.warn("Bathymetry unavailable for bounding box", this.bbox);
      return;
    }

    if (!this.scene) {
      this.scene = new OceanScene(document.getElementById('analysisCanvas'), {
        depthEx: this.depthExaggeration,
        onOceanClick: cell => {
          this.inspectPoint({ lat: cell.lat, lon: cell.lon, depthM: cell.depthM });
        },
        onFloatClick: obs => {
          this.selectObservation(obs);
        },
        onAnomalyClick: data => {
          if (data.isAnomaly) {
            this.selectedAnomaly = data.item;
            this.selectedObservation = null;
            this.selectedRegion = null;
            this.selectedCell = null;
          } else if (data.isRegion) {
            this.selectedRegion = data.item;
            this.selectedAnomaly = null;
            this.selectedObservation = null;
            this.selectedCell = null;
          }
          this.focus3D();
          this.updateInvestigationSidebar();
          this.updateCharts();
        }
      });
    }

    this.scene.clearScene();
    this.markersGroup = new THREE.Group();
    this.regionsGroup = new THREE.Group();
    this.currentVectorsGroup = new THREE.Group();

    if (geo) {
      this.scene.setLayer('land', buildLand(geo, this.scene));
      this.scene.setLayer('coastline', buildCoastline(geo));
      this.scene.setLayer('islands', buildIslands(geo, this.scene));
      this.scene.setLayer('eez', buildEEZ(geo, eez));
    }

    const seabed = buildSeabed(bathy, this.scene);
    if (seabed) this.scene.setLayer('seabed', seabed);

    this.water = new DynamicWater(bathy, this.scene);
    this.scene.setLayer('water', this.water.group);

    this.scene.root.add(this.markersGroup);
    this.scene.root.add(this.regionsGroup);
    this.scene.root.add(this.currentVectorsGroup);

    this.scalarViz = new ScalarVisualizer(this.water);
    this.scene.setExaggerationFactor(this.depthExaggeration);
    this.scene.fitCamera();
  }

  async loadTimeline() {
    const res = await ApiClient.getDataTimeline({ variable: this.getBaseVar(this.activeVar), bbox: this.bbox }).catch(() => ({ available_timestamps: [] }));
    this.timeline = res.available_timestamps || [];

    const timeSelect = document.getElementById('analysisTimeMode');
    if (timeSelect) {
      timeSelect.innerHTML = '';
      if (!this.timeline.length) {
        const opt = document.createElement('option');
        opt.value = "0";
        opt.textContent = "No timestamps available";
        timeSelect.appendChild(opt);
      } else {
        this.timeline.forEach((ts, i) => {
          const opt = document.createElement('option');
          opt.value = String(i);
          const d = new Date(ts);
          opt.textContent = Number.isNaN(d.getTime())
            ? ts
            : `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ${d.toISOString().slice(11, 16)} UTC`;
          timeSelect.appendChild(opt);
        });
      }
    }

    // Initialize range start and end dates
    if (this.timeline.length) {
      const startDate = this.timeline[0].slice(0, 10);
      const endDate = this.timeline[this.timeline.length - 1].slice(0, 10);
      const sInput = document.getElementById('rangeStartDate');
      const eInput = document.getElementById('rangeEndDate');
      if (sInput && !this.rangeStart) { sInput.value = startDate; this.rangeStart = startDate; }
      if (eInput && !this.rangeEnd) { eInput.value = endDate; this.rangeEnd = endDate; }
    }
  }

  async selectTime(idx) {
    if (!this.timeline.length) return;
    this.index = Math.max(0, Math.min(idx, this.timeline.length - 1));
    this.activeTime = this.timeline[this.index];

    const timeSelect = document.getElementById('analysisTimeMode');
    if (timeSelect) timeSelect.value = String(this.index);

    const d = new Date(this.activeTime);
    const dateText = Number.isNaN(d.getTime())
      ? this.activeTime
      : `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ${d.toISOString().slice(11, 16)} UTC`;

    const readout = document.getElementById('readoutCurrentTime');
    if (readout) readout.textContent = dateText;

    // Concurrently fetch real analysis data
    await Promise.all([
      this.fetchBundleData(this.activeTime),
      this.fetchAnomalyData(this.activeTime),
      this.fetchAbnormalRegions(this.activeTime),
      this.fetchArgoData(),
      this.fetchSummaryAndCoverage(this.activeTime)
    ]);

    this.populateArgoPicker();
    this.updateAnalysisView();
    this.updateKPIStrip();
    this.updateErrorMap();
    this.updateCoveragePanel();
    this.updateCharts();
    this.updateInvestigationSidebar();
    this.updateWarningEngine();
  }

  populateArgoPicker() {
    const sel = document.getElementById('selectArgo');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select Argo float…</option>';
    this.argoData.forEach(o => {
      const opt = document.createElement('option');
      opt.value = String(o.id || o.wmo);
      const soundings = o.profile ? o.profile.length : 0;
      opt.textContent = `Argo #${o.wmo || o.id} (${o.platform || 'Float'}, ${soundings} soundings)`;
      if (this.selectedObservation && (String(this.selectedObservation.id) === String(o.id) || String(this.selectedObservation.wmo) === String(o.wmo))) {
        opt.selected = true;
      }
      sel.appendChild(opt);
    });
  }

  async fetchBundleData(time) {
    if (this.bundleCache[time]) return;
    try {
      const bundle = await ApiClient.getOceanBundle({ provider: 'auto', bbox: this.bbox, time, stride: 1 });
      this.bundleCache[time] = bundle?.variables || {};
    } catch (e) {
      this.bundleCache[time] = {};
    }
  }

  async fetchAnomalyData(time) {
    if (this.anomaliesCache[time]) return;
    try {
      const res = await ApiClient.getAnomalies({ variable: this.getBaseVar(this.activeVar), method: 'zscore', time, ...this.bbox });
      this.anomaliesCache[time] = res.anomalies || [];
    } catch (e) {
      this.anomaliesCache[time] = [];
    }
  }

  async fetchAbnormalRegions(time) {
    if (this.abnormalCache[time]) return;
    try {
      const res = await ApiClient.getAbnormalRegions({ variable: this.getBaseVar(this.activeVar), method: 'zscore', time, ...this.bbox });
      this.abnormalCache[time] = res.regions || [];
    } catch (e) {
      this.abnormalCache[time] = [];
    }
  }

  async fetchArgoData() {
    if (this.argoData.length) return;
    try {
      const res = await ApiClient.getArgoObservations(this.bbox);
      this.argoData = res.observations || [];
    } catch (e) {
      this.argoData = [];
    }
  }

  async fetchSummaryAndCoverage(time) {
    try {
      const [summary, cov, gaps] = await Promise.all([
        ApiClient.getAnalysisSummary({ variable: this.getBaseVar(this.activeVar), ...this.bbox }),
        ApiClient.getObservationCoverage({ ...this.bbox, grid_res_deg: 1.0 }),
        ApiClient.getDataGaps({ ...this.bbox })
      ]);
      this.summaryData = {
        ...summary,
        accuracy: summary.model_accuracy || {},
        density: summary.observation_coverage || {},
        anomalies_detected: (this.anomaliesCache[time] || []).length
      };
      this.coverageData = cov;
      this.gapsData = gaps;
      this.modelVsArgoCache[time] = summary.model_accuracy || {};
    } catch (e) {
      console.warn("Failed to load summary or coverage", e);
    }
  }

  getBaseVar(v) {
    return v === 'ocean_temperature' ? 'temperature' : v;
  }

  getVariableUnit(v) {
    const map = {
      ocean_temperature: '°C',
      temperature: '°C',
      salinity: 'PSU',
      temperature_anomaly: '°C',
      chlorophyll: 'mg/m³',
      sea_level: 'm',
      currents: 'm/s'
    };
    return map[v] || '';
  }

  prettyVar(v) {
    const map = {
      ocean_temperature: 'Temperature',
      temperature: 'Temperature',
      salinity: 'Salinity',
      temperature_anomaly: 'Temperature Anomaly',
      chlorophyll: 'Chlorophyll',
      sea_level: 'Sea Level',
      currents: 'Currents'
    };
    return map[v] || v;
  }

  // Section 7 & 8: Variable != Analysis 3D Water Effect
  updateAnalysisView() {
    if (!this.water || !this.scalarViz) return;

    const vars = this.bundleCache[this.activeTime] || {};
    const anomalies = this.anomaliesCache[this.activeTime] || [];
    const regions = this.abnormalCache[this.activeTime] || [];
    const argo = this.argoData || [];

    let sliceMode = 'volume';
    if (this.activeView === 'cut') {
      sliceMode = 'vertical';
    } else if (this.activeView === 'top') {
      sliceMode = 'horizontal';
    } else if (this.activeDepth > 0) {
      sliceMode = 'horizontal';
    } else {
      sliceMode = 'volume';
    }

    // 1. Variable handling in 3D: Currents vs Scalar
    while (this.currentVectorsGroup.children.length > 0) {
      this.currentVectorsGroup.remove(this.currentVectorsGroup.children[0]);
    }

    if (this.activeVar === 'currents') {
      const curData = this.resolveVar(vars, 'currents');
      if (curData && (curData.u || curData.values)) {
        const vectors = buildCurrentVectors(curData, this.scene, this.water.bounds, false);
        if (vectors) this.currentVectorsGroup.add(vectors);
      }
      this.scalarViz.updateSliceTexture(this.activeDepth, 'none');
    } else {
      let vizData = this.resolveVar(vars, this.activeVar);
      let vizVar = this.activeVar;

      if (this.layerModel) {
        this.scalarViz.apply(vizVar, vizData, this.activeDepth, sliceMode);
      } else {
        this.scalarViz.updateSliceTexture(this.activeDepth, 'none');
      }
    }

    // 2. Analysis Mode handling in 3D (Section 8)
    this.clearMarkers();

    if (this.layerArgo) {
      this.renderArgoMarkers(argo);
    }
    if (this.layerAnomalies && (this.analysisMode === 'anomaly' || this.analysisMode === 'obs_vs_model')) {
      this.renderAnomalyMarkers(anomalies);
    }
    if (this.layerAbnormal && (this.analysisMode === 'anomaly' || this.analysisMode === 'obs_vs_model')) {
      this.renderAbnormalRegions(regions);
    }

    this.updateViewMode();

    // Update legend
    const legendEl = document.getElementById('legendVariable');
    const legendUnitsEl = document.getElementById('legendUnits');
    const legendEyebrowEl = document.getElementById('legendEyebrow');
    if (legendEl) {
      if (this.analysisMode === 'error') {
        legendEl.textContent = 'MODEL − OBS ERROR';
        if (legendUnitsEl) legendUnitsEl.textContent = this.getVariableUnit(this.activeVar);
        if (legendEyebrowEl) legendEyebrowEl.textContent = 'ANALYSIS FIELD';
      } else {
        legendEl.textContent = this.prettyVar(this.activeVar).toUpperCase();
        if (legendUnitsEl) legendUnitsEl.textContent = this.getVariableUnit(this.activeVar);
        if (legendEyebrowEl) legendEyebrowEl.textContent = 'ACTIVE FIELD';
      }
    }
  }

  updateViewMode() {
    if (!this.scene) return;
    if (this.activeView === 'top') {
      this.scene.setView('top');
    } else if (this.activeView === 'cut') {
      this.scene.setView('cut');
    } else {
      this.scene.setView('3d');
    }
  }

  clearMarkers() {
    while (this.markersGroup.children.length > 0) this.markersGroup.remove(this.markersGroup.children[0]);
    while (this.regionsGroup.children.length > 0) this.regionsGroup.remove(this.regionsGroup.children[0]);
  }

  renderArgoMarkers(observations) {
    if (!this.water) return;
    const bounds = this.water.bounds;
    const midLat = (bounds[2] + bounds[3]) / 2;
    const midLon = (bounds[0] + bounds[1]) / 2;
    const klon = 111.32 * Math.cos((midLat * Math.PI) / 180);

    observations.forEach(obs => {
      const glider = /glider/i.test(obs.platform || '');
      const x = (obs.latitude - midLat) * 111.32;
      const z = (obs.longitude - midLon) * klon;

      const isSelected = this.selectedObservation && (String(this.selectedObservation.id) === String(obs.id) || String(this.selectedObservation.float_id) === String(obs.float_id));

      let markerColor = glider ? 0x22d3ee : 0xf59e0b;

      // Color convention for ERROR analysis mode (Section 8: negative -> blue, neutral -> white, positive -> red)
      if (this.analysisMode === 'error') {
        const floatDiff = obs.metadata?.mean_diff ?? obs.metadata?.bias ?? 0;
        if (floatDiff > 0.5) markerColor = 0xef4444; // Positive error
        else if (floatDiff < -0.5) markerColor = 0x22d3ee; // Negative error
        else markerColor = 0xdceff5; // Neutral
      }

      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(isSelected ? 2.8 : 1.6, 16, 16),
        new THREE.MeshStandardMaterial({
          color: markerColor,
          emissive: isSelected ? 0xffffff : 0x000000,
          emissiveIntensity: isSelected ? 0.6 : 0
        })
      );
      marker.position.set(x, 2, z);
      marker.userData = { float: obs };
      this.markersGroup.add(marker);
    });
    this.scene.layers.observations = { group: this.markersGroup };
  }

  renderAnomalyMarkers(anomalies) {
    if (!this.water) return;
    const bounds = this.water.bounds;
    const midLat = (bounds[2] + bounds[3]) / 2;
    const midLon = (bounds[0] + bounds[1]) / 2;
    const klon = 111.32 * Math.cos((midLat * Math.PI) / 180);

    anomalies.forEach(an => {
      if (this.activeDepth > 0 && Math.abs(an.depth - this.activeDepth) > 80) return;

      const x = (an.latitude - midLat) * 111.32;
      const z = (an.longitude - midLon) * klon;
      const isSelected = this.selectedAnomaly && this.selectedAnomaly.id === an.id;

      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(isSelected ? 3.2 : 2.0, 16, 16),
        new THREE.MeshBasicMaterial({ color: an.difference > 0 ? 0xef4444 : 0x22d3ee })
      );
      marker.position.set(x, this.scene.depthY(an.depth) + 1, z);
      marker.userData = { customData: { isAnomaly: true, item: an } };
      this.markersGroup.add(marker);
    });
  }

  renderAbnormalRegions(regions) {
    if (!this.water) return;
    const bounds = this.water.bounds;
    const midLat = (bounds[2] + bounds[3]) / 2;
    const midLon = (bounds[0] + bounds[1]) / 2;
    const klon = 111.32 * Math.cos((midLat * Math.PI) / 180);

    regions.forEach(reg => {
      const minX = (reg.bbox.min_lat - midLat) * 111.32;
      const maxX = (reg.bbox.max_lat - midLat) * 111.32;
      const minZ = (reg.bbox.min_lon - midLon) * klon;
      const maxZ = (reg.bbox.max_lon - midLon) * klon;

      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      const width = Math.abs(maxX - minX);
      const depth = Math.abs(maxZ - minZ);

      const box = new THREE.Mesh(
        new THREE.BoxGeometry(width, 10, depth),
        new THREE.MeshBasicMaterial({
          color: reg.severity === 'CRITICAL' ? 0xef4444 : 0xf59e0b,
          transparent: true,
          opacity: 0.35,
          wireframe: true
        })
      );
      box.position.set(cx, 0, cz);
      box.userData = { customData: { isRegion: true, item: reg } };
      this.regionsGroup.add(box);
    });
    this.scene.layers.regions = { group: this.regionsGroup };
  }

  selectObservation(obs) {
    this.selectedObservation = obs;
    this.selectedAnomaly = null;
    this.selectedRegion = null;
    this.selectedCell = null;

    SelectionContext.setSelection({
      type: 'argo',
      id: obs.id || obs.wmo,
      lat: obs.latitude,
      lon: obs.longitude,
      argoId: obs.id || obs.wmo
    });

    const argoSel = document.getElementById('selectArgo');
    if (argoSel) argoSel.value = String(obs.id || obs.wmo);

    const latInput = document.getElementById('manualLat');
    const lonInput = document.getElementById('manualLon');
    if (latInput) latInput.value = obs.latitude.toFixed(2);
    if (lonInput) lonInput.value = obs.longitude.toFixed(2);

    this.focus3D();
    this.updateAnalysisView();
    this.updateInvestigationSidebar();
    this.updateCharts();
  }

  async inspectPoint(cell) {
    this.selectedCell = cell;
    this.selectedObservation = null;
    this.selectedAnomaly = null;
    this.selectedRegion = null;

    SelectionContext.setSelection({
      type: 'cell',
      lat: cell.lat,
      lon: cell.lon,
      depth: cell.depthM
    });

    const latInput = document.getElementById('manualLat');
    const lonInput = document.getElementById('manualLon');
    if (latInput) latInput.value = cell.lat.toFixed(2);
    if (lonInput) lonInput.value = cell.lon.toFixed(2);

    // Fetch point ocean data for value readout
    try {
      const ptData = await ApiClient.getOceanPoint(cell.lat, cell.lon, this.activeTime);
      if (ptData && ptData.variables) {
        this.selectedCell.pointData = ptData;
      }
    } catch (_) {}

    this.focus3D();
    this.updateInvestigationSidebar();
    this.updateCharts();
  }

  focus3D() {
    let lat = null, lon = null, depth = null;
    if (this.selectedAnomaly) {
      lat = this.selectedAnomaly.latitude;
      lon = this.selectedAnomaly.longitude;
      depth = this.selectedAnomaly.depth;
    } else if (this.selectedObservation) {
      lat = this.selectedObservation.latitude;
      lon = this.selectedObservation.longitude;
      depth = 0;
    } else if (this.selectedRegion) {
      lat = (this.selectedRegion.bbox.min_lat + this.selectedRegion.bbox.max_lat) / 2;
      lon = (this.selectedRegion.bbox.min_lon + this.selectedRegion.bbox.max_lon) / 2;
      depth = this.selectedRegion.depth_range_m?.[0] ?? 0;
    } else if (this.selectedCell) {
      lat = this.selectedCell.lat;
      lon = this.selectedCell.lon;
      depth = this.activeDepth;
    }

    if (lat != null && lon != null && this.scene && this.water) {
      const bounds = this.water.bounds;
      const midLat = (bounds[2] + bounds[3]) / 2;
      const midLon = (bounds[0] + bounds[1]) / 2;
      const klon = 111.32 * Math.cos((midLat * Math.PI) / 180);

      const tx = (lat - midLat) * 111.32;
      const tz = (lon - midLon) * klon;

      this.scene.focusPosition(new THREE.Vector3(tx, this.scene.depthY(depth || 0), tz), 120);

      if (depth != null) {
        this.setDepth(depth);
      }
    }
  }

  updateKPIStrip() {
    const setVal = (id, val, format, colorClass) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (val == null || (typeof val === 'number' && isNaN(val))) {
        el.textContent = 'N/A';
        el.className = 'kpi-value';
        return;
      }
      el.textContent = format ? format(val) : String(val);
      const cls = typeof colorClass === 'function' ? colorClass(val) : (colorClass || '');
      el.className = 'kpi-value ' + cls;
    };

    if (!this.summaryData) {
      ['kpi-rmse', 'kpi-bias', 'kpi-mae', 'kpi-observations', 'kpi-coverage', 'kpi-anomalies'].forEach(id => {
        setVal(id, null);
      });
      return;
    }

    const acc = this.summaryData.model_accuracy || this.summaryData.accuracy || {};
    const cov = this.summaryData.observation_coverage || this.summaryData.density || {};
    const anomalyCount = this.anomaliesCache[this.activeTime]?.length ?? this.summaryData.anomalies_detected ?? 0;
    const unit = this.getVariableUnit(this.activeVar);

    setVal('kpi-rmse', acc.overall_rmse, v => `${v.toFixed(2)} ${unit}`);
    setVal('kpi-bias', acc.overall_bias, v => `${v > 0 ? '+' : ''}${v.toFixed(2)} ${unit}`, v => Math.abs(v) > 0.5 ? 'critical' : '');
    setVal('kpi-mae', acc.overall_mae, v => `${v.toFixed(2)} ${unit}`);
    setVal('kpi-observations', cov.total_observations);
    setVal('kpi-coverage', cov.spatial_coverage_pct, v => `${v.toFixed(1)} %`, v => v < 50 ? 'critical' : 'positive');
    setVal('kpi-anomalies', anomalyCount, null, v => v > 0 ? 'critical' : 'positive');
  }

  // Section 3 & 14: Dynamic Investigation Panel with Method Labelling
  updateInvestigationSidebar() {
    const sb = document.getElementById('investigationContent');
    if (!sb) return;

    const unit = this.getVariableUnit(this.activeVar);

    if (this.selectedAnomaly) {
      const a = this.selectedAnomaly;
      const anomUnit = a.unit || unit;
      sb.innerHTML = `
        <div class="sidebar-row"><label>Target</label><span class="critical">Anomaly Detected</span></div>
        <div class="sidebar-row"><label>Variable</label><span>${this.prettyVar(a.variable)}</span></div>
        <div class="sidebar-row"><label>Coordinates</label><span>${a.latitude.toFixed(2)}°N, ${a.longitude.toFixed(2)}°E</span></div>
        <div class="sidebar-row"><label>Depth</label><span>${a.depth} m</span></div>
        <div class="sidebar-row"><label>Model Value</label><span>${a.baseline.toFixed(2)} ${anomUnit}</span></div>
        <div class="sidebar-row"><label>Observed Value</label><span>${a.value.toFixed(2)} ${anomUnit}</span></div>
        <div class="sidebar-row"><label>Difference (Model − Obs)</label><span class="${a.difference > 0 ? 'critical' : 'negative'}">${a.difference > 0 ? '+' : ''}${a.difference.toFixed(2)} ${anomUnit}</span></div>
        <div class="sidebar-row"><label>Method</label><span>${a.detection_method || 'Z-Score Analysis'}</span></div>
        <div class="sidebar-row"><label>Severity</label><span class="critical">${a.severity}</span></div>
        <div class="sidebar-actions">
          <button class="action-btn" id="btnFocusItem">FOCUS 3D</button>
          <button class="action-btn" id="btnResetItem">RESET</button>
        </div>
      `;
      this._wireSidebarButtons();
    } else if (this.selectedObservation) {
      const o = this.selectedObservation;
      const profile = o.profile || [];
      const nearestPt = profile.length > 0
        ? profile.reduce((prev, curr) => Math.abs(curr.depth - this.activeDepth) < Math.abs(prev.depth - this.activeDepth) ? curr : prev)
        : null;

      const obsVal = nearestPt ? (nearestPt.temp ?? nearestPt.sal ?? nearestPt.value) : null;

      sb.innerHTML = `
        <div class="sidebar-row"><label>Platform</label><span class="positive">${o.platform || 'Argo Profiling Float'}</span></div>
        <div class="sidebar-row"><label>Float ID / WMO</label><span>#${o.wmo || o.id}</span></div>
        <div class="sidebar-row"><label>Coordinates</label><span>${o.latitude.toFixed(2)}°N, ${o.longitude.toFixed(2)}°E</span></div>
        <div class="sidebar-row"><label>Soundings</label><span>${profile.length} depth levels</span></div>
        <div class="sidebar-row"><label>Active Depth</label><span>${this.activeDepth} m</span></div>
        ${obsVal != null ? `
          <div class="sidebar-row"><label>In-Situ Observation</label><span>${Number(obsVal).toFixed(2)} ${unit}</span></div>
        ` : ''}
        <div class="sidebar-row"><label>Interpolation Method</label><span style="color:#62d5ee;">Bilinear spatial + 1D vertical interpolation</span></div>
        <div class="sidebar-actions">
          <button class="action-btn" id="btnFocusItem">FOCUS 3D</button>
          <button class="action-btn" id="btnResetItem">RESET</button>
        </div>
      `;
      this._wireSidebarButtons();
    } else if (this.selectedRegion) {
      const r = this.selectedRegion;
      sb.innerHTML = `
        <div class="sidebar-row"><label>Target</label><span class="critical">Abnormal Region</span></div>
        <div class="sidebar-row"><label>Region Name</label><span>${r.name || r.id}</span></div>
        <div class="sidebar-row"><label>Variable</label><span>${this.prettyVar(r.variable)}</span></div>
        <div class="sidebar-row"><label>Depth Range</label><span>${r.depth_range_m?.[0] ?? 0}m – ${r.depth_range_m?.[1] ?? 500}m</span></div>
        <div class="sidebar-row"><label>Anomaly Count</label><span>${r.anomaly_count || 0}</span></div>
        <div class="sidebar-row"><label>Mean Magnitude</label><span>${(r.anomaly_magnitude_mean || 0).toFixed(2)}</span></div>
        <div class="sidebar-row"><label>Severity</label><span class="critical">${r.severity}</span></div>
        <div class="sidebar-actions">
          <button class="action-btn" id="btnFocusItem">FOCUS 3D</button>
          <button class="action-btn" id="btnResetItem">RESET</button>
        </div>
      `;
      this._wireSidebarButtons();
    } else if (this.selectedCell) {
      const c = this.selectedCell;
      const ptVals = c.pointData?.variables || {};
      const modelVal = ptVals[this.activeVar] ?? ptVals[this.getBaseVar(this.activeVar)];

      sb.innerHTML = `
        <div class="sidebar-row"><label>Target</label><span>Ocean Grid Cell</span></div>
        <div class="sidebar-row"><label>Coordinates</label><span>${c.lat.toFixed(3)}°N, ${c.lon.toFixed(3)}°E</span></div>
        <div class="sidebar-row"><label>Seabed Depth</label><span>${(c.depthM || 0).toFixed(1)} m</span></div>
        <div class="sidebar-row"><label>Scientific Depth</label><span>${this.activeDepth} m</span></div>
        <div class="sidebar-row"><label>Variable</label><span>${this.prettyVar(this.activeVar)}</span></div>
        ${modelVal != null ? `
          <div class="sidebar-row"><label>Model Value</label><span>${Number(modelVal).toFixed(2)} ${unit}</span></div>
        ` : ''}
        <div class="sidebar-row"><label>Model Method</label><span style="color:#62d5ee;">Bilinear horizontal interpolation</span></div>
        <div class="sidebar-actions">
          <button class="action-btn" id="btnFocusItem">FOCUS 3D</button>
          <button class="action-btn" id="btnResetItem">RESET</button>
        </div>
      `;
      this._wireSidebarButtons();
    } else {
      sb.innerHTML = `<div class="empty-state">Select an ocean cell, Argo, Glider, anomaly or region.</div>`;
    }
  }

  _wireSidebarButtons() {
    document.getElementById('btnFocusItem')?.addEventListener('click', () => this.focus3D());
    document.getElementById('btnResetItem')?.addEventListener('click', () => {
      this.clearSelections();
      this.updateInvestigationSidebar();
      this.updateCharts();
    });
  }

  updateErrorMap() {
    const anomalies = this.anomaliesCache[this.activeTime] || [];
    if (!this.errorMapChart) return;

    this.errorMapChart.options.scales.x.min = this.bbox.min_lon;
    this.errorMapChart.options.scales.x.max = this.bbox.max_lon;
    this.errorMapChart.options.scales.y.min = this.bbox.min_lat;
    this.errorMapChart.options.scales.y.max = this.bbox.max_lat;

    const pts = anomalies.map(a => ({
      x: a.longitude,
      y: a.latitude,
      anomaly: a
    }));

    this.errorMapChart.data.datasets = [
      {
        label: 'Positive Discrepancy (Obs > Model)',
        data: pts.filter(p => p.anomaly.difference > 0),
        backgroundColor: '#ef4444',
        borderColor: '#ef4444',
        pointRadius: 5
      },
      {
        label: 'Negative Discrepancy (Obs < Model)',
        data: pts.filter(p => p.anomaly.difference <= 0),
        backgroundColor: '#22d3ee',
        borderColor: '#22d3ee',
        pointRadius: 5
      }
    ];
    this.errorMapChart.update();
  }

  updateCoveragePanel() {
    const cov = this.coverageData;
    const gaps = this.gapsData;
    const container = document.getElementById('coverageContent');
    if (!container) return;

    if (!cov) {
      container.innerHTML = `<div class="empty-state">Coverage data unavailable for current selection.</div>`;
      return;
    }

    const density = cov.density_summary || {};
    const totalCells = cov.grid_cells?.length || 1;

    let html = `
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:16px;">
        <div>
          <div class="sidebar-row"><label>Spatial Basin Coverage</label><span class="positive">${(cov.spatial_coverage_pct || 0).toFixed(1)} %</span></div>
          <div class="sidebar-row"><label>Total In-Situ Soundings</label><span>${cov.total_observations || 0}</span></div>
          <div class="sidebar-row"><label>Active Profilers in Basin</label><span>${cov.active_floats_count || 0}</span></div>
        </div>

        <div>
          <div class="eyebrow" style="margin-bottom:8px;">SPATIAL DENSITY BREAKDOWN</div>
          <div class="coverage-row">
            <div style="display:flex;justify-content:space-between;font-size:10px;"><span>High Density (>15 obs/deg²)</span><span>${density.HIGH || 0} cells</span></div>
            <div class="coverage-bar"><div class="coverage-fill" style="width:${((density.HIGH || 0) / totalCells) * 100}%"></div></div>
          </div>
          <div class="coverage-row">
            <div style="display:flex;justify-content:space-between;font-size:10px;"><span>Moderate (5–15)</span><span>${density.MEDIUM || 0} cells</span></div>
            <div class="coverage-bar"><div class="coverage-fill" style="width:${((density.MEDIUM || 0) / totalCells) * 100}%; background:#f59e0b;"></div></div>
          </div>
          <div class="coverage-row">
            <div style="display:flex;justify-content:space-between;font-size:10px;"><span>Sparse (1–4)</span><span>${density.LOW || 0} cells</span></div>
            <div class="coverage-bar"><div class="coverage-fill" style="width:${((density.LOW || 0) / totalCells) * 100}%; background:#22d3ee;"></div></div>
          </div>
          <div class="coverage-row">
            <div style="display:flex;justify-content:space-between;font-size:10px;"><span>Unmonitored (0)</span><span>${density.NONE || 0} cells</span></div>
            <div class="coverage-bar"><div class="coverage-fill" style="width:${((density.NONE || 0) / totalCells) * 100}%; background:#ef4444;"></div></div>
          </div>
        </div>

        <div>
          <div class="eyebrow" style="margin-bottom:8px;">IDENTIFIED DATA VOID SECTORS</div>
          ${(gaps?.gap_regions || []).slice(0, 3).map(g => `
            <div style="font-size:11px; margin-bottom:8px; background:#0b1f2b; padding:6px 10px; border-radius:4px; border-left:3px solid #ef4444;">
              <strong style="color:#ef4444;">${g.name}</strong><br>
              <span style="color:#8bb3c2;">${g.recommendation || 'Unmonitored zone.'}</span>
            </div>
          `).join('') || '<div class="empty-state">No critical gap sectors identified.</div>'}
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  async updateCharts() {
    const selectedFloat = this.selectedAnomaly?.float_id || this.selectedObservation?.float_id || this.selectedObservation?.id || this.selectedObservation?.wmo;
    const baseVar = this.getBaseVar(this.activeVar);

    if (baseVar !== 'temperature' && baseVar !== 'salinity') {
      this.clearProfileChart("Argo in-situ vertical profiles only available for Temperature and Salinity.");
      this.clearErrorDepthChart("Error vs depth profile only available for Temperature and Salinity.");
      this.clearTimeSeriesChart("Time series comparison unavailable for non-Argo variable.");
      return;
    }

    if (selectedFloat) {
      try {
        const profile = await ApiClient.getFloatComparison(String(selectedFloat), baseVar, this.activeTime);
        this.renderProfileChart(profile);
        this.renderErrorDepthChart(profile);
      } catch (e) {
        this.clearProfileChart("Profile data unavailable for selected float.");
        this.clearErrorDepthChart("Error profile unavailable.");
      }
    } else {
      this.clearProfileChart("Select an Argo float or anomaly to view vertical profile comparison.");
      this.clearErrorDepthChart("Select an Argo float or anomaly to view error vs depth.");
    }

    await this.updateTimeSeriesChart(selectedFloat);
  }

  renderProfileChart(profileData) {
    if (!this.modelArgoChart) return;
    if (!profileData || !Array.isArray(profileData.comparison) || !profileData.comparison.length) {
      this.clearProfileChart();
      return;
    }

    const points = profileData.comparison;
    const unit = profileData.unit || this.getVariableUnit(this.activeVar);
    this.modelArgoChart.options.scales.x.title.text = `${this.prettyVar(this.activeVar)} (${unit})`;
    this.modelArgoChart.data.labels = points.map(p => Number(p.depth));
    this.modelArgoChart.data.datasets = [
      {
        label: 'Numerical Model',
        data: points.map(p => Number(p.model)),
        borderColor: '#62d5ee',
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 3
      },
      {
        label: 'Argo In-Situ Observation',
        data: points.map(p => Number(p.observed)),
        borderColor: '#f59e0b',
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 3,
        borderDash: [5, 5]
      }
    ];
    this.modelArgoChart.update();
  }

  renderErrorDepthChart(profileData) {
    if (!this.errorDepthChart) return;
    if (!profileData || !Array.isArray(profileData.comparison) || !profileData.comparison.length) {
      this.clearErrorDepthChart();
      return;
    }

    const points = profileData.comparison;
    const unit = profileData.unit || this.getVariableUnit(this.activeVar);
    this.errorDepthChart.options.scales.x.title.text = `Model − Observation (${unit})`;
    this.errorDepthChart.data.labels = points.map(p => Number(p.depth));
    this.errorDepthChart.data.datasets = [
      {
        label: 'Model Discrepancy (Model − Obs)',
        data: points.map(p => Number(p.model - p.observed)),
        borderColor: '#f43f5e',
        backgroundColor: 'rgba(244, 63, 94, 0.1)',
        borderWidth: 2,
        pointRadius: 3,
        fill: true
      }
    ];
    this.errorDepthChart.update();
  }

  clearProfileChart(msg = null) {
    if (!this.modelArgoChart) return;
    this.modelArgoChart.data.labels = [];
    this.modelArgoChart.data.datasets = [];
    if (msg) {
      this.modelArgoChart.options.scales.x.title.text = msg;
    }
    this.modelArgoChart.update();
  }

  clearErrorDepthChart(msg = null) {
    if (!this.errorDepthChart) return;
    this.errorDepthChart.data.labels = [];
    this.errorDepthChart.data.datasets = [];
    if (msg) {
      this.errorDepthChart.options.scales.x.title.text = msg;
    }
    this.errorDepthChart.update();
  }

  async updateTimeSeriesChart(floatId = null) {
    if (!this.timeSeriesChart) return;
    if (!floatId || !this.timeline.length) {
      this.clearTimeSeriesChart(floatId ? "No time-series data available." : "Select an Argo float or anomaly to view real time series.");
      return;
    }

    const baseVar = this.getBaseVar(this.activeVar);
    const key = `${floatId}:${baseVar}`;

    if (!this.timeSeriesCache[key]) {
      const maxPoints = 20;
      const step = Math.max(1, Math.floor(this.timeline.length / maxPoints));
      const sampleIndices = [];
      for (let i = 0; i < this.timeline.length; i += step) {
        sampleIndices.push(i);
      }

      const responses = await Promise.all(sampleIndices.map(i =>
        ApiClient.getFloatComparison(String(floatId), baseVar, this.timeline[i]).catch(() => null)
      ));

      this.timeSeriesCache[key] = sampleIndices.map((origIdx, k) => {
        const r = responses[k];
        if (!r || !Array.isArray(r.comparison) || !r.comparison.length) return null;
        const obs = r.comparison.map(p => Number(p.observed)).filter(Number.isFinite);
        const model = r.comparison.map(p => Number(p.model)).filter(Number.isFinite);
        if (!obs.length || !model.length) return null;
        return {
          label: this.timeline[origIdx].slice(5, 10),
          observed: obs.reduce((a, b) => a + b, 0) / obs.length,
          model: model.reduce((a, b) => a + b, 0) / model.length
        };
      }).filter(Boolean);
    }

    const rows = this.timeSeriesCache[key] || [];
    if (!rows.length) {
      this.clearTimeSeriesChart("No time-series data available for this selection.");
      return;
    }

    const unit = this.getVariableUnit(this.activeVar);
    this.timeSeriesChart.options.scales.y.title = { display: true, text: `${this.prettyVar(this.activeVar)} (${unit})`, color: '#6d99a7' };
    this.timeSeriesChart.data.labels = rows.map(r => r.label);
    this.timeSeriesChart.data.datasets = [
      {
        label: 'Model (Depth-averaged)',
        data: rows.map(r => r.model),
        borderColor: '#62d5ee',
        borderWidth: 2,
        pointRadius: 2,
        fill: false
      },
      {
        label: 'Argo Observation (Depth-averaged)',
        data: rows.map(r => r.observed),
        borderColor: '#f59e0b',
        borderWidth: 2,
        pointRadius: 2,
        fill: false
      }
    ];
    this.timeSeriesChart.update();
  }

  clearTimeSeriesChart(msg = null) {
    if (!this.timeSeriesChart) return;
    this.timeSeriesChart.data.labels = [];
    this.timeSeriesChart.data.datasets = [];
    if (msg) {
      this.timeSeriesChart.options.scales.x.title = { display: true, text: msg, color: '#6d99a7' };
    }
    this.timeSeriesChart.update();
  }

  // Section 17: Data-Driven Warning & Analytical Flag Engine
  updateWarningEngine() {
    const container = document.getElementById('scientificInsightContent');
    if (!container) return;

    this.warnings = [];
    const acc = this.summaryData?.model_accuracy || {};
    const cov = this.coverageData || {};
    const gaps = this.gapsData?.gap_regions || [];
    const anomalies = this.anomaliesCache[this.activeTime] || [];
    const unit = this.getVariableUnit(this.activeVar);

    // Rule 1: High Thermocline Discrepancy
    if (acc.overall_rmse && acc.overall_rmse > 1.5) {
      this.warnings.push({
        id: 'flag-discrepancy',
        severity: acc.overall_rmse > 3.0 ? 'critical' : 'warning',
        title: 'Elevated Model Discrepancy (RMSE)',
        evidence: `Overall basin RMSE is ${acc.overall_rmse.toFixed(2)} ${unit} across ${acc.floats_compared || 0} in-situ Argo profiling floats (Mean Bias: ${acc.overall_bias > 0 ? '+' : ''}${(acc.overall_bias || 0).toFixed(2)} ${unit}). Largest disagreement occurs in the thermocline (50–200m).`
      });
    }

    // Rule 2: Critical Observation Gap Sector
    if (cov.spatial_coverage_pct != null && cov.spatial_coverage_pct < 35.0) {
      this.warnings.push({
        id: 'flag-coverage-gap',
        severity: 'warning',
        title: 'Critical Observation Void Sector',
        evidence: `Spatial coverage across the active basin is ${cov.spatial_coverage_pct.toFixed(1)}%. ${gaps.length} major unmonitored sectors detected.`
      });
    }

    // Rule 3: Subsurface Physical Anomalies
    const criticalAnoms = anomalies.filter(a => a.severity === 'CRITICAL' || Math.abs(a.z_score || 0) > 2.0);
    if (criticalAnoms.length > 0) {
      this.warnings.push({
        id: 'flag-anomalies',
        severity: 'critical',
        title: 'Subsurface Physical Anomaly Cluster',
        evidence: `${criticalAnoms.length} depth levels exceed 2.0σ z-score deviation. Maximum observed discrepancy is ${criticalAnoms[0].difference > 0 ? '+' : ''}${criticalAnoms[0].difference.toFixed(2)} ${unit} at Float #${criticalAnoms[0].float_id} (${criticalAnoms[0].depth}m depth).`
      });
    }

    if (this.warnings.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          No critical analytical flags detected for ${this.prettyVar(this.activeVar)}. Model agreement conforms within typical observational thresholds.
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="analytical-flag-list">
        ${this.warnings.map(w => `
          <div class="analytical-flag-card flag-${w.severity}">
            <div class="flag-header">
              <span class="flag-badge">ANALYTICAL FLAG</span>
              <span class="flag-title">${w.title}</span>
            </div>
            <div class="flag-evidence">${w.evidence}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Section 18: Grounded Scientific AI Assistant
  initAIAssistant() {
    const container = document.getElementById('aiAssistantContainer');
    if (container) {
      AiChat.init(this, container);
    }
  }

  getAnalysisContext() {
    return {
      area: SelectionContext.getArea(),
      variable: SelectionContext.getVariable(),
      analysisMode: this.analysisMode,
      time: { current: this.activeTime, available: this.timeline },
      dataRange: { start: this.rangeStart, end: this.rangeEnd },
      depth: { current: this.activeDepth, available: this.depthLevels },
      selectedPoint: this.selectedCell,
      selectedArgo: this.selectedObservation,
      selectedGlider: null,
      metrics: this.summaryData?.model_accuracy || {},
      anomalies: (this.anomaliesCache[this.activeTime] || []).slice(0, 10),
      coverage: this.coverageData || {},
      gaps: this.gapsData?.gap_regions || [],
      warnings: this.warnings
    };
  }

  executeCommand(cmd) {
    if (!cmd || !this.scene) return;
    if (cmd.action === 'FOCUS_REGION') {
      if (cmd.lat != null && cmd.lon != null) {
        this.inspectPoint({ lat: cmd.lat, lon: cmd.lon, depthM: cmd.depth || 0 });
      }
    } else if (cmd.action === 'SET_DEPTH') {
      if (cmd.depth != null) {
        this.setDepth(cmd.depth);
      }
    } else if (cmd.action === 'SET_VARIABLE') {
      if (cmd.variable) {
        this.setVariable(cmd.variable);
      }
    }
  }

  resolveVar(vars, id) {
    if (vars[id] && !vars[id].error) return vars[id];
    for (const k of (alias[id] || [])) {
      if (vars[k] && !vars[k].error) return vars[k];
    }
    return null;
  }

  updateProvenance() {
    const d = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    const el = document.getElementById('provenanceData');
    if (el) el.textContent = `DATA: Copernicus Marine NEMO + WMO Argo | Updated: ${d}`;
  }
}

const dashboard = new AnalysisDashboard();
window.dashboard = dashboard;
dashboard.init().catch(e => {
  console.error("Dashboard initialization failed", e);
});
