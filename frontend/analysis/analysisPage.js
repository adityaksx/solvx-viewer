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
    this.comparisonFieldCache = {};
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

    // Theme & Playback
    this.currentTheme = localStorage.getItem('solvx_theme') || 'light';
    this.isPlaying = false;
    this.playInterval = null;
  }

  async init() {
    this.initTheme();
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

  initTheme() {
    this.setTheme(this.currentTheme);
    document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
      const nextTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
      this.setTheme(nextTheme);
    });
  }

  setTheme(themeName) {
    this.currentTheme = themeName;
    localStorage.setItem('solvx_theme', themeName);
    document.documentElement.setAttribute('data-theme', themeName);

    const icon = document.getElementById('themeToggleIcon');
    if (icon) {
      icon.textContent = themeName === 'dark' ? '☼' : '☾';
      icon.title = themeName === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }

    if (this.scene) {
      this.scene.setTheme(themeName);
    }
    this.updateChartThemes(themeName === 'dark');
  }

  getChartThemeColors(isDark) {
    return {
      grid: isDark ? '#2C3A48' : '#E2E8F0',
      ticks: isDark ? '#94A3B8' : '#64748B',
      title: isDark ? '#CBD5E1' : '#475569',
      legend: isDark ? '#F1F5F9' : '#0F172A'
    };
  }

  updateChartThemes(isDark) {
    const c = this.getChartThemeColors(isDark);
    const charts = [this.modelArgoChart, this.errorDepthChart, this.errorMapChart, this.timeSeriesChart];
    charts.forEach(chart => {
      if (!chart) return;
      if (chart.options?.scales?.x) {
        if (chart.options.scales.x.grid) chart.options.scales.x.grid.color = c.grid;
        if (chart.options.scales.x.ticks) chart.options.scales.x.ticks.color = c.ticks;
        if (chart.options.scales.x.title) chart.options.scales.x.title.color = c.title;
      }
      if (chart.options?.scales?.y) {
        if (chart.options.scales.y.grid) chart.options.scales.y.grid.color = c.grid;
        if (chart.options.scales.y.ticks) chart.options.scales.y.ticks.color = c.ticks;
        if (chart.options.scales.y.title) chart.options.scales.y.title.color = c.title;
      }
      if (chart.options?.plugins?.legend?.labels) {
        chart.options.plugins.legend.labels.color = c.legend;
      }
      chart.update();
    });
  }

  togglePlayback() {
    const playBtn = document.getElementById('btnTimePlay');
    if (this.isPlaying) {
      clearInterval(this.playInterval);
      this.playInterval = null;
      this.isPlaying = false;
      if (playBtn) playBtn.textContent = '▶ PLAY';
    } else {
      if (!this.timeline.length) return;
      this.isPlaying = true;
      if (playBtn) playBtn.textContent = '⏸ PAUSE';
      this.playInterval = setInterval(() => {
        const next = (this.index + 1) % this.timeline.length;
        this.selectTime(next);
      }, 1500);
    }
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

    // 3D View mode buttons (3D, TOP, VERTICAL, HORIZONTAL, RESET)
    document.querySelectorAll('.analysis-view-controls button').forEach(b => {
      b.addEventListener('click', () => {
        if (b.dataset.action === 'reset') {
          this.scene?.fitCamera();
          return;
        }
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

    document.getElementById('selectGlider')?.addEventListener('change', async e => {
      const gliderId = e.target.value;
      if (!gliderId) return;
      let obs = (this.gliderData || []).find(o => String(o.id) === gliderId || String(o.glider_id) === gliderId);
      if (!obs) {
        obs = this.argoData.find(o => String(o.id) === gliderId || String(o.glider_id) === gliderId);
      }
      if (obs) {
        if (!obs.profile || obs.profile.length === 0) {
          try {
            const detailed = await ApiClient.getGliderProfile(gliderId);
            if (detailed && detailed.profile) {
              obs = { ...obs, ...detailed };
            }
          } catch (_) {}
        }
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

    // Time step navigation
    document.getElementById('btnTimePrev')?.addEventListener('click', () => {
      if (this.index > 0) this.selectTime(this.index - 1);
    });
    document.getElementById('btnTimeNext')?.addEventListener('click', () => {
      if (this.index < this.timeline.length - 1) this.selectTime(this.index + 1);
    });
    document.getElementById('btnTimePlay')?.addEventListener('click', () => {
      this.togglePlayback();
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

    if (this.comparisonFieldCache) {
      const prefix = String(this.activeTime || '') + '|' + String(this.activeVar) + '|' + String(this.activeDepth) + '|';
      Object.keys(this.comparisonFieldCache)
        .filter(k => k.startsWith(prefix))
        .forEach(k => { delete this.comparisonFieldCache[k]; });
    }

    if (this.activeTime) {
      this.fetchComparisonField(this.activeTime).then(() => this.updateAnalysisView());
    }

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
    const c = this.getChartThemeColors(this.currentTheme === 'dark');

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
              grid: { color: c.grid },
              ticks: { color: c.ticks },
              title: { display: true, text: 'Value', color: c.title }
            },
            y: {
              reverse: true,
              grid: { color: c.grid },
              ticks: { color: c.ticks },
              title: { display: true, text: 'Depth (m)', color: c.title }
            }
          },
          plugins: {
            legend: { labels: { color: c.legend } },
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
              grid: { color: c.grid },
              ticks: { color: c.ticks },
              title: { display: true, text: 'Difference (Model − Obs)', color: c.title }
            },
            y: {
              reverse: true,
              grid: { color: c.grid },
              ticks: { color: c.ticks },
              title: { display: true, text: 'Depth (m)', color: c.title }
            }
          },
          plugins: {
            legend: { labels: { color: c.legend } },
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
              title: { display: true, text: 'Longitude (°E)', color: c.title },
              grid: { color: c.grid },
              ticks: { color: c.ticks },
              min: this.bbox.min_lon,
              max: this.bbox.max_lon
            },
            y: {
              title: { display: true, text: 'Latitude (°N)', color: c.title },
              grid: { color: c.grid },
              ticks: { color: c.ticks },
              min: this.bbox.min_lat,
              max: this.bbox.max_lat
            }
          },
          plugins: {
            legend: { display: true, labels: { color: c.legend, boxWidth: 10 } },
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
            x: { grid: { color: c.grid }, ticks: { color: c.ticks } },
            y: { grid: { color: c.grid }, ticks: { color: c.ticks } }
          },
          plugins: {
            legend: { labels: { color: c.legend } }
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
      this.scene.setTheme(this.currentTheme);
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
      this.fetchComparisonField(this.activeTime),
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
    const argoSel = document.getElementById('selectArgo');
    if (argoSel) {
      const argos = (this.argoOnlyData || this.argoData.filter(o => o.type !== 'glider' && !/glider/i.test(o.platform || '')));
      if (argos.length === 0) {
        argoSel.innerHTML = '<option value="">No Argo floats in region</option>';
      } else {
        argoSel.innerHTML = `<option value="">Select Argo float (${argos.length} available)…</option>`;
        argos.forEach(o => {
          const opt = document.createElement('option');
          opt.value = String(o.id || o.wmo);
          const soundings = o.profile ? o.profile.length : (o.soundings_count || 0);
          opt.textContent = `Argo #${o.wmo || o.id} (${o.platform || 'Float'}, ${soundings} soundings)`;
          if (this.selectedObservation && (String(this.selectedObservation.id) === String(o.id) || String(this.selectedObservation.wmo) === String(o.wmo))) {
            opt.selected = true;
          }
          argoSel.appendChild(opt);
        });
      }
    }

    const gliderSel = document.getElementById('selectGlider');
    if (gliderSel) {
      const gliders = (this.gliderData || this.argoData.filter(o => o.type === 'glider' || /glider/i.test(o.platform || '')));
      if (gliders.length === 0) {
        gliderSel.innerHTML = '<option value="">No gliders in region</option>';
      } else {
        gliderSel.innerHTML = `<option value="">Select Glider (${gliders.length} available)…</option>`;
        gliders.forEach(o => {
          const opt = document.createElement('option');
          opt.value = String(o.id || o.glider_id);
          const soundings = o.profile ? o.profile.length : (o.soundings_count || 0);
          opt.textContent = `Glider #${o.id || o.glider_id} (${o.institution || 'In-Situ'}, ${soundings} soundings)`;
          if (this.selectedObservation && (String(this.selectedObservation.id) === String(o.id) || String(this.selectedObservation.glider_id) === String(o.glider_id))) {
            opt.selected = true;
          }
          gliderSel.appendChild(opt);
        });
      }
    }
  }

  async fetchBundleData(time) {
    if (this.bundleCache[time]) return;
    try {
      const bundle = await ApiClient.getOceanBundle({
        provider: 'auto',
        bbox: this.bbox,
        time,
        depth: this.activeDepth,
        stride: 1,
        variables: [this.activeVar]
      });
      this.bundleCache[time] = bundle?.variables || {};
    } catch (e) {
      // Fall back to the single-variable endpoint. This keeps the analysis tab
      // functional for variables such as chlorophyll that are not in the legacy bundle.
      try {
        const res = await ApiClient.getOceanVariable({
          provider: 'auto',
          variable: this.getBaseVar(this.activeVar),
          bbox: this.bbox,
          depth: this.activeDepth,
          time
        });
        this.bundleCache[time] = { [this.activeVar]: res };
      } catch (_) {
        this.bundleCache[time] = {};
      }
    }
  }

  async fetchComparisonField(time) {
    if (!time) return;
    const key = `${time}|${this.activeVar}|${this.activeDepth}|${this.analysisMode}`;
    if (!this.comparisonFieldCache) this.comparisonFieldCache = {};
    if (this.comparisonFieldCache[key]) return;

    try {
      const res = await ApiClient.getComparisonField({
        ...this.bbox,
        variable: this.getBaseVar(this.activeVar),
        time,
        depth: this.activeDepth,
        metric: this.analysisMode,
        grid_res_deg: 1.0
      });
      this.comparisonFieldCache[key] = res;
    } catch (e) {
      this.comparisonFieldCache[key] = null;
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
    try {
      const [argoRes, gliderRes] = await Promise.allSettled([
        ApiClient.getArgoObservations(this.bbox),
        ApiClient.getGliderObservations(this.bbox, this.activeTime)
      ]);
      const argoObs = (argoRes.status === 'fulfilled' && argoRes.value?.observations)
        ? argoRes.value.observations.map(o => ({ ...o, type: 'argo' }))
        : [];
      const gliderObs = (gliderRes.status === 'fulfilled' && gliderRes.value?.observations)
        ? gliderRes.value.observations.map(o => ({ ...o, type: 'glider' }))
        : [];
      this.argoOnlyData = argoObs;
      this.gliderData = gliderObs;
      this.argoData = [...argoObs, ...gliderObs];
    } catch (e) {
      this.argoOnlyData = [];
      this.gliderData = [];
      this.argoData = [];
    }
  }

  async fetchSummaryAndCoverage(time) {
    try {
      const [summary, cov, gaps] = await Promise.all([
        ApiClient.getAnalysisSummary({
          variable: this.getBaseVar(this.activeVar),
          time: this.activeTime,
          depth: this.activeDepth,
          ...this.bbox
        }),
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

    // The comparison field is a derived product of the selected variable,
    // depth, time and analysis metric; never silently fall back to raw model
    // values once an analysis mode is selected.
    if (this.activeTime && this.comparisonFieldCache) {
      const comparisonKey = String(this.activeTime || '') + '|' + String(this.activeVar) + '|' + String(this.activeDepth) + '|' + String(this.analysisMode);
      if (!(comparisonKey in this.comparisonFieldCache)) {
        this.fetchComparisonField(this.activeTime).then(() => this.updateAnalysisView());
        return;
      }
    }

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

    // 1. Variable handling in 3D: raw model field vs derived analysis field.
    while (this.currentVectorsGroup.children.length > 0) {
      this.currentVectorsGroup.remove(this.currentVectorsGroup.children[0]);
    }

    const comparisonKey = String(this.activeTime || '') + '|' + String(this.activeVar) + '|' + String(this.activeDepth) + '|' + String(this.analysisMode);
    const derived = this.comparisonFieldCache?.[comparisonKey];


    if (this.activeVar === 'currents' && !derived) {
      const curData = this.resolveVar(vars, 'currents');
      if (curData && (curData.u || curData.values)) {
        const vectors = buildCurrentVectors(curData, this.scene, this.water.bounds, false);
        if (vectors) this.currentVectorsGroup.add(vectors);
      }
      this.scalarViz.updateSliceTexture(this.activeDepth, 'none');
    } else {
      const vizData = derived?.values
        ? {
            values: derived.values,
            units: derived.units || this.getVariableUnit(this.activeVar),
            metadata: { depth_levels: [this.activeDepth] }
          }
        : this.resolveVar(vars, this.activeVar);

      const vizVar = this.analysisMode === 'observation_gap'
        ? 'observation_gap'
        : (this.analysisMode === 'anomaly'
          ? 'temperature_anomaly'
          : (this.analysisMode === 'rmse'
            ? 'analysis_magnitude'
            : (['obs_vs_model', 'error', 'bias'].includes(this.analysisMode)
              ? 'analysis_diverging'
              : this.activeVar)));

      if (derived?.values) {
        vizData.metadata.analysis_metric = this.analysisMode;
        vizData.metadata.analysis_variable = this.activeVar;
      }

      if (this.layerModel && vizData) {
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

    // Update legend per Section 14
    const legendEl = document.getElementById('legendVariable');
    const legendUnitsEl = document.getElementById('legendUnits');
    const legendEyebrowEl = document.getElementById('legendEyebrow');
    if (legendEl) {
      const modeLabels = {
        obs_vs_model: 'MODEL VS IN-SITU',
        error: 'MODEL − OBS ERROR',
        bias: 'MODEL BIAS',
        rmse: 'RMSE',
        anomaly: 'SUBSURFACE ANOMALY',
        observation_gap: 'OBSERVATION GAP'
      };
      const modeLabel = modeLabels[this.analysisMode] || (this.analysisMode ? this.analysisMode.toUpperCase().replace(/_/g, ' ') : 'OBS VS MODEL');
      if (legendEyebrowEl) legendEyebrowEl.textContent = 'ANALYSIS FIELD';
      legendEl.textContent = modeLabel;
      if (legendUnitsEl) {
        legendUnitsEl.textContent = `${this.prettyVar(this.activeVar)} · ${this.getVariableUnit(this.activeVar)}`;
      }
    }
  }

  prettyMode(mode) {
    const map = {
      obs_vs_model: 'Model vs In-Situ',
      error: 'Model Error',
      bias: 'Model Bias',
      rmse: 'RMSE',
      anomaly: 'Subsurface Anomaly',
      observation_gap: 'Observation Gap'
    };
    return map[mode] || (mode ? mode.replace(/_/g, ' ') : '');
  }

  updateViewMode() {
    if (!this.scene) return;
    if (this.activeView === 'top') {
      this.scene.setView('top');
    } else if (this.activeView === 'vertical') {
      this.scene.setView('vertical');
    } else if (this.activeView === 'horizontal' || this.activeView === 'cut') {
      this.scene.setView('horizontal');
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
      const isGlider = obs.type === 'glider' || /glider/i.test(obs.platform || '');
      const x = (obs.latitude - midLat) * 111.32;
      const z = (obs.longitude - midLon) * klon;

      const isSelected = this.selectedObservation && (String(this.selectedObservation.id) === String(obs.id) || String(this.selectedObservation.float_id) === String(obs.float_id));

      let markerColor = isGlider ? 0x22d3ee : 0xf59e0b;

      // Color convention for ERROR analysis mode (Section 8: negative -> blue, neutral -> white, positive -> red)
      if (this.analysisMode === 'error') {
        const floatDiff = obs.metadata?.mean_diff ?? obs.metadata?.bias ?? 0;
        if (floatDiff > 0.5) markerColor = 0xef4444; // Positive error
        else if (floatDiff < -0.5) markerColor = 0x22d3ee; // Negative error
        else markerColor = 0xdceff5; // Neutral
      }

      const maxD = obs.max_depth || (obs.depth_range ? obs.depth_range[1] : 1000);
      const bottomY = this.scene ? this.scene.depthY(maxD) : -20;

      const marker = new THREE.Group();
      marker.position.set(x, 2, z);
      marker.userData = { isArgoFloat: true, isGlider, float: obs };

      if (isGlider) {
        // Autonomous Underwater Glider: Cyan #22d3ee, Torpedo fuselage + Swept Wings
        const bodyGeom = new THREE.CylinderGeometry(0.8, 0.9, 3.6, 12);
        bodyGeom.rotateX(Math.PI / 2);
        const bodyMat = new THREE.MeshStandardMaterial({
          color: markerColor,
          roughness: 0.25,
          metalness: 0.3,
          emissive: isSelected ? 0xffffff : (markerColor === 0x22d3ee ? 0x0891b2 : 0x000000),
          emissiveIntensity: isSelected ? 0.7 : 0.4
        });
        const body = new THREE.Mesh(bodyGeom, bodyMat);
        body.userData = { isArgoFloat: true, float: obs };
        marker.add(body);

        const wingGeom = new THREE.BoxGeometry(4.2, 0.15, 1.2);
        const wingMat = new THREE.MeshStandardMaterial({ color: markerColor });
        const wings = new THREE.Mesh(wingGeom, wingMat);
        wings.userData = { isArgoFloat: true, float: obs };
        marker.add(wings);

        const finGeom = new THREE.BoxGeometry(0.15, 1.2, 0.8);
        const fin = new THREE.Mesh(finGeom, wingMat);
        fin.position.set(0, 0.6, -1.4);
        fin.userData = { isArgoFloat: true, float: obs };
        marker.add(fin);
      } else {
        // Argo Profiling Float: Amber #f59e0b, Cylinder hull + Antenna + Beacon
        const hullGeom = new THREE.CylinderGeometry(1.6, 1.4, 2.2, 16);
        const hullMat = new THREE.MeshStandardMaterial({
          color: markerColor,
          roughness: 0.3,
          metalness: 0.2,
          emissive: isSelected ? 0xffffff : (markerColor === 0xf59e0b ? 0xb45309 : 0x000000),
          emissiveIntensity: isSelected ? 0.7 : 0.3
        });
        const hull = new THREE.Mesh(hullGeom, hullMat);
        hull.userData = { isArgoFloat: true, float: obs };
        marker.add(hull);

        const antGeom = new THREE.CylinderGeometry(0.15, 0.2, 2.4, 8);
        const antMat = new THREE.MeshStandardMaterial({ color: 0x64748b });
        const antenna = new THREE.Mesh(antGeom, antMat);
        antenna.position.set(0, 2.2, 0);
        antenna.userData = { isArgoFloat: true, float: obs };
        marker.add(antenna);

        const beaconGeom = new THREE.SphereGeometry(0.7, 12, 12);
        const beaconMat = new THREE.MeshStandardMaterial({
          color: 0xfbbf24,
          emissive: 0xf59e0b,
          emissiveIntensity: 0.85
        });
        const beacon = new THREE.Mesh(beaconGeom, beaconMat);
        beacon.position.set(0, 3.4, 0);
        beacon.userData = { isArgoFloat: true, float: obs };
        marker.add(beacon);
      }

      // Vertical Sounding Wire down to profiling depth
      const lineGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, bottomY, 0)
      ]);
      const lineMat = new THREE.LineDashedMaterial({
        color: markerColor,
        dashSize: 1.5,
        gapSize: 0.8,
        opacity: 0.45,
        transparent: true
      });
      const soundingWire = new THREE.Line(lineGeom, lineMat);
      soundingWire.computeLineDistances();
      marker.add(soundingWire);

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

    const isGlider = obs.type === 'glider' || /glider/i.test(obs.platform || '');
    SelectionContext.setSelection({
      type: isGlider ? 'glider' : 'argo',
      id: obs.id || obs.wmo || obs.glider_id,
      lat: obs.latitude,
      lon: obs.longitude,
      argoId: isGlider ? null : (obs.id || obs.wmo),
      gliderId: isGlider ? (obs.id || obs.glider_id) : null
    });

    const argoSel = document.getElementById('selectArgo');
    const gliderSel = document.getElementById('selectGlider');
    if (isGlider) {
      if (gliderSel) gliderSel.value = String(obs.id || obs.glider_id);
      if (argoSel) argoSel.value = '';
    } else {
      if (argoSel) argoSel.value = String(obs.id || obs.wmo);
      if (gliderSel) gliderSel.value = '';
    }

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

    // Fetch point ocean data for value readout and vertical profile
    try {
      const ptData = await ApiClient.getOceanPoint(cell.lat, cell.lon, this.activeTime, cell.depthM != null ? cell.depthM : this.activeDepth);
      if (ptData && (ptData.variables || ptData.profile)) {
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
    const acc = this.summaryData?.model_accuracy || {};

    if (this.selectedAnomaly) {
      const a = this.selectedAnomaly;
      const anomUnit = a.unit || unit;
      sb.innerHTML = `
        <div class="sidebar-row"><label>TARGET</label><span class="critical">Physical Anomaly</span></div>
        <div class="sidebar-row"><label>VARIABLE</label><span>${this.prettyVar(a.variable)}</span></div>
        <div class="sidebar-row"><label>COORDINATES</label><span class="mono">${a.latitude.toFixed(2)}°N, ${a.longitude.toFixed(2)}°E</span></div>
        <div class="sidebar-row"><label>DEPTH</label><span>${a.depth} m</span></div>
        <div class="sidebar-divider"></div>
        <div class="sidebar-row"><label>MODEL BASELINE</label><span>${a.baseline.toFixed(2)} ${anomUnit}</span></div>
        <div class="sidebar-row"><label>OBSERVED VALUE</label><span>${a.value.toFixed(2)} ${anomUnit}</span></div>
        <div class="sidebar-row"><label>DIFFERENCE (MODEL − OBS)</label><span class="${a.difference > 0 ? 'critical' : 'negative'}">${a.difference > 0 ? '+' : ''}${a.difference.toFixed(2)} ${anomUnit}</span></div>
        <div class="sidebar-divider"></div>
        <div class="sidebar-row"><label>DETECTION METHOD</label><span>${a.detection_method || 'Z-Score Analysis (σ > 2.0)'}</span></div>
        <div class="sidebar-row"><label>SEVERITY</label><span class="critical">${a.severity}</span></div>
        <div class="sidebar-actions" style="display:flex;gap:8px;margin-top:12px;">
          <button class="action-btn" id="btnFocusItem" style="flex:1;">FOCUS 3D</button>
          <button class="action-btn" id="btnResetItem" style="flex:1;">RESET</button>
        </div>
      `;
      this._wireSidebarButtons();
    } else if (this.selectedObservation) {
      const o = this.selectedObservation;
      const isGlider = o.type === 'glider' || /glider/i.test(o.platform || '');
      const profile = o.profile || [];
      const nearestPt = profile.length > 0
        ? profile.reduce((prev, curr) => Math.abs(curr.depth - this.activeDepth) < Math.abs(prev.depth - this.activeDepth) ? curr : prev)
        : null;

      const obsVal = nearestPt ? (nearestPt.temp ?? nearestPt.sal ?? nearestPt.value) : null;
      const modelVal = nearestPt ? nearestPt.model : null;
      const errorVal = (obsVal != null && modelVal != null) ? (modelVal - obsVal) : null;

      sb.innerHTML = `
        <div class="sidebar-row"><label>TARGET</label><span style="color:${isGlider ? '#22d3ee' : '#f59e0b'};font-weight:700;">${isGlider ? 'Autonomous Glider' : 'Argo Profiling Float'}</span></div>
        <div class="sidebar-row"><label>PLATFORM</label><span>${o.platform || (isGlider ? 'Autonomous Underwater Glider' : 'Apex CTD Float')}</span></div>
        <div class="sidebar-row"><label>${isGlider ? 'GLIDER ID' : 'FLOAT ID'}</label><span class="mono">#${o.wmo || o.id || o.glider_id}</span></div>
        <div class="sidebar-row"><label>INSTITUTION</label><span>${o.institution || 'Copernicus Marine In-Situ'}</span></div>
        <div class="sidebar-row"><label>LOCATION</label><span class="mono">${o.latitude.toFixed(2)}°N, ${o.longitude.toFixed(2)}°E</span></div>
        <div class="sidebar-row"><label>ACTIVE DEPTH</label><span>${this.activeDepth} m</span></div>
        <div class="sidebar-divider"></div>
        <div class="sidebar-row"><label>OBSERVATION</label><span>${obsVal != null ? `${Number(obsVal).toFixed(2)} ${unit}` : 'N/A'}</span></div>
        <div class="sidebar-row"><label>MODEL</label><span>${modelVal != null ? `${Number(modelVal).toFixed(2)} ${unit}` : 'N/A'}</span></div>
        <div class="sidebar-row"><label>ERROR</label><span class="${errorVal != null ? (errorVal > 0 ? 'critical' : 'negative') : ''}">${errorVal != null ? `${errorVal > 0 ? '+' : ''}${errorVal.toFixed(2)} ${unit}` : 'N/A'}</span></div>
        <div class="sidebar-divider"></div>
        <div class="sidebar-row"><label>RMSE</label><span>${acc.overall_rmse != null ? `${acc.overall_rmse.toFixed(2)} ${unit}` : 'N/A'}</span></div>
        <div class="sidebar-row"><label>BIAS</label><span>${acc.overall_bias != null ? `${acc.overall_bias > 0 ? '+' : ''}${acc.overall_bias.toFixed(2)} ${unit}` : 'N/A'}</span></div>
        <div class="sidebar-row"><label>MAE</label><span>${acc.overall_mae != null ? `${acc.overall_mae.toFixed(2)} ${unit}` : 'N/A'}</span></div>
        <div class="sidebar-row"><label>METHOD</label><span style="color:var(--primary);font-size:11px;font-weight:600;">Bilinear spatial + 1D vertical interpolation</span></div>
        <div class="sidebar-actions" style="display:flex;gap:8px;margin-top:12px;">
          <button class="action-btn" id="btnFocusItem" style="flex:1;">FOCUS 3D</button>
          <button class="action-btn" id="btnResetItem" style="flex:1;">RESET</button>
        </div>
      `;
      this._wireSidebarButtons();
    } else if (this.selectedRegion) {
      const r = this.selectedRegion;
      sb.innerHTML = `
        <div class="sidebar-row"><label>TARGET</label><span class="critical">Abnormal Region</span></div>
        <div class="sidebar-row"><label>REGION NAME</label><span>${r.name || r.id}</span></div>
        <div class="sidebar-row"><label>VARIABLE</label><span>${this.prettyVar(r.variable)}</span></div>
        <div class="sidebar-row"><label>DEPTH RANGE</label><span>${r.depth_range_m?.[0] ?? 0}m – ${r.depth_range_m?.[1] ?? 500}m</span></div>
        <div class="sidebar-divider"></div>
        <div class="sidebar-row"><label>ANOMALY COUNT</label><span>${r.anomaly_count || 0}</span></div>
        <div class="sidebar-row"><label>MEAN MAGNITUDE</label><span>${(r.anomaly_magnitude_mean || 0).toFixed(2)}</span></div>
        <div class="sidebar-row"><label>SEVERITY</label><span class="critical">${r.severity}</span></div>
        <div class="sidebar-actions" style="display:flex;gap:8px;margin-top:12px;">
          <button class="action-btn" id="btnFocusItem" style="flex:1;">FOCUS 3D</button>
          <button class="action-btn" id="btnResetItem" style="flex:1;">RESET</button>
        </div>
      `;
      this._wireSidebarButtons();
    } else if (this.selectedCell) {
      const c = this.selectedCell;
      const ptVals = c.pointData?.variables || {};
      const modelVal = ptVals[this.activeVar] ?? ptVals[this.getBaseVar(this.activeVar)];

      sb.innerHTML = `
        <div class="sidebar-row"><label>TARGET</label><span>Ocean Grid Cell</span></div>
        <div class="sidebar-row"><label>COORDINATES</label><span class="mono">${c.lat.toFixed(3)}°N, ${c.lon.toFixed(3)}°E</span></div>
        <div class="sidebar-row"><label>SEABED DEPTH</label><span>${(c.depthM || 0).toFixed(1)} m</span></div>
        <div class="sidebar-row"><label>ACTIVE DEPTH</label><span>${this.activeDepth} m</span></div>
        <div class="sidebar-divider"></div>
        <div class="sidebar-row"><label>VARIABLE</label><span>${this.prettyVar(this.activeVar)}</span></div>
        ${modelVal != null ? `
          <div class="sidebar-row"><label>MODEL VALUE</label><span>${Number(modelVal).toFixed(2)} ${unit}</span></div>
        ` : ''}
        <div class="sidebar-row"><label>INTERPOLATION</label><span style="color:var(--primary);font-size:11px;font-weight:600;">Bilinear horizontal interpolation</span></div>
        <div class="sidebar-actions" style="display:flex;gap:8px;margin-top:12px;">
          <button class="action-btn" id="btnFocusItem" style="flex:1;">FOCUS 3D</button>
          <button class="action-btn" id="btnResetItem" style="flex:1;">RESET</button>
        </div>
      `;
      this._wireSidebarButtons();
    } else {
      sb.innerHTML = `<div class="empty-state">Select an ocean cell, Argo, Glider, anomaly or region to inspect soundings and model metrics.</div>`;
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
        label: 'Positive Discrepancy (Model > Obs)',
        data: pts.filter(p => p.anomaly.difference > 0),
        backgroundColor: '#EF4444',
        borderColor: '#EF4444',
        pointRadius: 5
      },
      {
        label: 'Negative Discrepancy (Model < Obs)',
        data: pts.filter(p => p.anomaly.difference <= 0),
        backgroundColor: '#06B6D4',
        borderColor: '#06B6D4',
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
    const maxDepth = this.depthLevels[this.depthLevels.length - 1] || 750;

    let html = `
      <div class="coverage-stats-row">
        <div class="coverage-stat-item">
          <label>SPATIAL COVERAGE</label>
          <span class="positive">${(cov.spatial_coverage_pct || 0).toFixed(1)} %</span>
        </div>
        <div class="coverage-stat-item">
          <label>TOTAL OBSERVATIONS</label>
          <span>${cov.total_observations || 0}</span>
        </div>
        <div class="coverage-stat-item">
          <label>DEPTH COVERAGE</label>
          <span>0 – ${maxDepth} m</span>
        </div>
        <div class="coverage-stat-item">
          <label>ACTIVE PROFILERS</label>
          <span>${cov.active_floats_count || this.argoData.length || 0}</span>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:24px;">
        <div class="coverage-bars-grid">
          <div class="eyebrow">SPATIAL DENSITY BREAKDOWN</div>
          <div class="coverage-row">
            <div class="coverage-row-meta"><span>High Density (>15 obs/deg²)</span><span class="mono">${density.HIGH || 0} cells</span></div>
            <div class="coverage-bar"><div class="coverage-fill high" style="width:${((density.HIGH || 0) / totalCells) * 100}%"></div></div>
          </div>
          <div class="coverage-row">
            <div class="coverage-row-meta"><span>Moderate (5–15)</span><span class="mono">${density.MEDIUM || 0} cells</span></div>
            <div class="coverage-bar"><div class="coverage-fill moderate" style="width:${((density.MEDIUM || 0) / totalCells) * 100}%"></div></div>
          </div>
          <div class="coverage-row">
            <div class="coverage-row-meta"><span>Sparse (1–4)</span><span class="mono">${density.LOW || 0} cells</span></div>
            <div class="coverage-bar"><div class="coverage-fill sparse" style="width:${((density.LOW || 0) / totalCells) * 100}%"></div></div>
          </div>
          <div class="coverage-row">
            <div class="coverage-row-meta"><span>Unmonitored (0)</span><span class="mono">${density.NONE || 0} cells</span></div>
            <div class="coverage-bar"><div class="coverage-fill none" style="width:${((density.NONE || 0) / totalCells) * 100}%"></div></div>
          </div>
        </div>

        <div>
          <div class="eyebrow" style="margin-bottom:8px;">IDENTIFIED DATA VOID SECTORS</div>
          ${(gaps?.gap_regions || []).slice(0, 3).map(g => `
            <div style="font-size:12px; margin-bottom:8px; background:var(--bg-surface-secondary); padding:10px 14px; border-radius:var(--radius-sm); border:1px solid var(--border); border-left:4px solid var(--danger);">
              <strong style="color:var(--danger);">${g.name}</strong><br>
              <span style="color:var(--text-secondary);">${g.recommendation || 'Unmonitored ocean sector requiring autonomous sensor deployment.'}</span>
            </div>
          `).join('') || '<div class="empty-state">No critical gap sectors identified in active basin.</div>'}
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  async updateCharts() {
    const selectedFloat = this.selectedAnomaly?.float_id || this.selectedObservation?.float_id || this.selectedObservation?.id || this.selectedObservation?.wmo;
    const baseVar = this.getBaseVar(this.activeVar);

    // Keep comparison/error charts useful for BGC variables as well. The backend
    // now accepts chlorophyll observations from Bio-Argo records. Sea level and
    // currents may still legitimately lack collocated in-situ profiles.
    const profileComparableVars = new Set(['temperature', 'salinity', 'chlorophyll']);
    if (!profileComparableVars.has(baseVar)) {
      this.clearProfileChart("Collocated in-situ profile unavailable for this variable.");
      this.clearErrorDepthChart("Model − Observation error requires collocated in-situ data.");
      this.clearTimeSeriesChart("Time series comparison unavailable for this variable.");
      return;
    }

    if (selectedFloat) {
      try {
        const profile = await ApiClient.getFloatComparison(String(selectedFloat), baseVar, this.activeTime);
        this.renderProfileChart(profile);
        this.renderErrorDepthChart(profile);
      } catch (e) {
        this.clearProfileChart("Profile data unavailable for selected platform.");
        this.clearErrorDepthChart("Error profile unavailable.");
      }
    } else if (this.selectedCell?.pointData?.profile && Array.isArray(this.selectedCell.pointData.profile)) {
      this.renderPointSoundingChart(this.selectedCell.pointData.profile, baseVar);
      this.clearErrorDepthChart("Arbitrary grid point sounding (no collocated in-situ profile for error computation).");
    } else {
      this.clearProfileChart("Select an in-situ platform, anomaly, or click any ocean grid cell to view vertical sounding profile.");
      this.clearErrorDepthChart("Select an in-situ platform or anomaly to view model discrepancy profile.");
    }

    await this.updateTimeSeriesChart(selectedFloat);
  }

  renderPointSoundingChart(profileArray, baseVar) {
    if (!this.modelArgoChart) return;
    if (!Array.isArray(profileArray) || !profileArray.length) {
      this.clearProfileChart();
      return;
    }

    const unit = this.getVariableUnit(baseVar);
    const validPoints = profileArray.filter(p => p[baseVar] != null && Number.isFinite(Number(p[baseVar])));
    if (!validPoints.length) {
      this.clearProfileChart(`No vertical sounding data for ${this.prettyVar(baseVar)} at selected grid point.`);
      return;
    }

    const coordStr = this.selectedCell ? ` at (${this.selectedCell.lat.toFixed(2)}°N, ${this.selectedCell.lon.toFixed(2)}°E)` : '';
    this.modelArgoChart.options.scales.x.title.text = `${this.prettyVar(baseVar)} (${unit})${coordStr}`;
    this.modelArgoChart.data.labels = validPoints.map(p => Number(p.depth));
    this.modelArgoChart.data.datasets = [
      {
        label: `Model Sounding (Copernicus NEMO)${coordStr}`,
        data: validPoints.map(p => Number(p[baseVar])),
        borderColor: '#0284C7',
        backgroundColor: 'rgba(2, 132, 199, 0.12)',
        borderWidth: 2,
        pointRadius: 3,
        fill: true
      }
    ];
    this.modelArgoChart.update();
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
        label: 'Model (Copernicus NEMO)',
        data: points.map(p => Number(p.model)),
        borderColor: '#0284C7',
        backgroundColor: 'rgba(2, 132, 199, 0.08)',
        borderWidth: 2,
        pointRadius: 3,
        fill: true
      },
      {
        label: 'In-Situ Observation (Argo)',
        data: points.map(p => Number(p.observed)),
        borderColor: '#F59E0B',
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
        borderColor: '#EF4444',
        backgroundColor: 'rgba(239, 68, 68, 0.08)',
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
    const c = this.getChartThemeColors(this.currentTheme === 'dark');
    this.timeSeriesChart.options.scales.y.title = { display: true, text: `${this.prettyVar(this.activeVar)} (${unit})`, color: c.title };
    this.timeSeriesChart.data.labels = rows.map(r => r.label);
    this.timeSeriesChart.data.datasets = [
      {
        label: 'Model (Depth-averaged)',
        data: rows.map(r => r.model),
        borderColor: '#0284C7',
        backgroundColor: 'rgba(2, 132, 199, 0.08)',
        borderWidth: 2,
        pointRadius: 2,
        fill: false
      },
      {
        label: 'In-Situ Observation (Argo)',
        data: rows.map(r => r.observed),
        borderColor: '#F59E0B',
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 3,
        borderDash: [4, 4]
      }
    ];
    this.timeSeriesChart.update();
  }

  clearTimeSeriesChart(msg = null) {
    if (!this.timeSeriesChart) return;
    this.timeSeriesChart.data.labels = [];
    this.timeSeriesChart.data.datasets = [];
    if (msg) {
      const c = this.getChartThemeColors(this.currentTheme === 'dark');
      this.timeSeriesChart.options.scales.x.title = { display: true, text: msg, color: c.title };
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
    const floatsCount = acc.floats_compared != null ? acc.floats_compared : (this.argoData.length || 0);

    // Dynamic Thermocline & Depth of Discrepancy Calculation (Section 11)
    const maxDepth = acc.depth_of_max_rmse ?? acc.depth_of_max_discrepancy;
    let depthDiscrepancyStr = '';
    if (maxDepth != null) {
      const dMin = Math.max(0, Math.round(maxDepth - 25));
      const dMax = Math.round(maxDepth + 25);
      depthDiscrepancyStr = `The largest discrepancy occurs around the <strong>${dMin}–${dMax} m</strong> depth range (depth of max RMSE: ${maxDepth} m).`;
    } else if (acc.top_discrepancy && acc.top_discrepancy.depth != null) {
      const d = acc.top_discrepancy.depth;
      depthDiscrepancyStr = `The largest discrepancy occurs around <strong>${d} m</strong>.`;
    } else if (acc.overall_rmse > 1.5) {
      depthDiscrepancyStr = 'Elevated model discrepancies observed across the water column.';
    } else {
      depthDiscrepancyStr = 'Model predictions closely track in-situ observations across surface and subsurface layers.';
    }

    // Build Scientific Insight section
    let insightHtml = '';
    if (floatsCount > 0 && acc.overall_rmse != null) {
      insightHtml = `
        <div class="insight-summary-card">
          <div style="margin-bottom:8px;">
            <span class="taxonomy-tag observed">OBSERVED</span>
            <span class="taxonomy-tag computed">COMPUTED</span>
            <span class="taxonomy-tag inferred">INFERRED</span>
          </div>
          The selected basin contains <strong>${floatsCount} matched in-situ profile(s)</strong> (${acc.total_sounding_points || 0} sounding points).
          The model-observation RMSE is <strong>${acc.overall_rmse.toFixed(2)} ${unit}</strong> and mean bias is 
          <strong>${(acc.overall_bias > 0 ? '+' : '')}${(acc.overall_bias || 0).toFixed(2)} ${unit}</strong>.
          ${depthDiscrepancyStr}
          ${floatsCount < 3 ? `<div style="margin-top:8px; font-size:12px; color:#f59e0b; display:flex; align-items:center; gap:5px;"><span>⚠</span> <em>Limited sample count (${floatsCount} platform${floatsCount === 1 ? '' : 's'}). Model agreement estimates carry higher uncertainty.</em></div>` : ''}
        </div>
      `;
    } else {
      insightHtml = `
        <div class="insight-summary-card">
          <div style="margin-bottom:8px;">
            <span class="taxonomy-tag observed">OBSERVED</span>
            <span class="taxonomy-tag computed">COMPUTED</span>
          </div>
          No matched in-situ soundings for active parameters in this regional bounding box. Model predictions cannot be empirically validated without collocated observation profiles.
        </div>
      `;
    }

    const areaName = SelectionContext.getArea()?.name || 'Selected Region';
    const dateStr = this.activeTime ? this.activeTime.slice(0, 10) : 'Current Interval';
    const sampleStr = `${floatsCount} platform(s), ${acc.total_sounding_points || 0} pts`;

    // Flag 1: High model error (RMSE > 1.50)
    if (acc.overall_rmse && acc.overall_rmse > 1.5) {
      const isCritical = acc.overall_rmse > 3.0;
      this.warnings.push({
        id: 'flag-discrepancy',
        severity: isCritical ? 'critical' : 'warning',
        title: 'High Model Error',
        variable: this.prettyVar(this.activeVar),
        area: areaName,
        date: dateStr,
        depth: acc.depth_of_max_rmse != null ? `${acc.depth_of_max_rmse} m (max RMSE)` : 'Water Column',
        metric: 'RMSE',
        actualValue: `${acc.overall_rmse.toFixed(2)} ${unit}`,
        threshold: `1.50 ${unit}`,
        sampleCount: sampleStr,
        evidence: `Root Mean Squared Error of ${acc.overall_rmse.toFixed(2)} ${unit} exceeds acceptance threshold of 1.50 ${unit}.`
      });
    }

    // Flag 2: Systematic bias (|bias| > 0.80)
    if (acc.overall_bias != null && Math.abs(acc.overall_bias) > 0.8) {
      const isCritical = Math.abs(acc.overall_bias) > 1.5;
      this.warnings.push({
        id: 'flag-bias',
        severity: isCritical ? 'critical' : 'warning',
        title: 'Systematic Model Bias',
        variable: this.prettyVar(this.activeVar),
        area: areaName,
        date: dateStr,
        depth: acc.depth_of_max_discrepancy != null ? `${acc.depth_of_max_discrepancy} m` : 'Water Column',
        metric: 'Mean Bias',
        actualValue: `${acc.overall_bias > 0 ? '+' : ''}${acc.overall_bias.toFixed(2)} ${unit}`,
        threshold: `±0.80 ${unit}`,
        sampleCount: sampleStr,
        evidence: `Systematic model ${acc.overall_bias > 0 ? 'under-prediction (observed > model)' : 'over-prediction (model > observed)'} across sounding column.`
      });
    }

    // Flag 3: Observation gap (< 35%)
    if (cov.spatial_coverage_pct != null && cov.spatial_coverage_pct < 35.0) {
      const isCritical = cov.spatial_coverage_pct < 15.0;
      this.warnings.push({
        id: 'flag-coverage-gap',
        severity: isCritical ? 'critical' : 'warning',
        title: 'Observation Coverage Gap',
        variable: this.prettyVar(this.activeVar),
        area: areaName,
        date: dateStr,
        depth: 'All Depth Strata',
        metric: 'Spatial Coverage',
        actualValue: `${(cov.spatial_coverage_pct || 0).toFixed(1)}%`,
        threshold: '35.0%',
        sampleCount: `${cov.total_observations || floatsCount} observation(s)`,
        evidence: `Spatial coverage of ${(cov.spatial_coverage_pct || 0).toFixed(1)}% falls below 35.0% threshold. ${gaps.length} unmonitored quadrant sector(s) detected.`
      });
    }

    // Flag 4: Anomaly cluster (> 2.0σ)
    const criticalAnoms = anomalies.filter(a => a.severity === 'CRITICAL' || a.severity === 'HIGH' || Math.abs(a.z_score || 0) > 2.0);
    if (criticalAnoms.length > 0) {
      const top = criticalAnoms[0];
      this.warnings.push({
        id: 'flag-anomalies',
        severity: 'critical',
        title: 'Subsurface Anomaly Cluster',
        variable: this.prettyVar(this.activeVar),
        area: areaName,
        date: top.time ? top.time.slice(0, 10) : dateStr,
        depth: `${top.depth} m`,
        metric: 'Z-Score / Discrepancy',
        actualValue: `${top.z_score ? top.z_score.toFixed(2) + 'σ' : (top.difference > 0 ? '+' : '') + top.difference.toFixed(2) + ' ' + unit}`,
        threshold: '2.00σ',
        sampleCount: `${criticalAnoms.length} anomalous sounding level(s)`,
        evidence: `${criticalAnoms.length} sounding levels exceed 2.0σ threshold. Peak discrepancy: ${top.difference > 0 ? '+' : ''}${top.difference.toFixed(2)} ${unit} at Float #${top.float_id} (${top.depth} m).`
      });
    }

    // Flag 5: Insufficient data (< 3 platforms)
    if (floatsCount < 3) {
      this.warnings.push({
        id: 'flag-insufficient-data',
        severity: floatsCount === 0 ? 'critical' : 'warning',
        title: 'Insufficient In-Situ Data',
        variable: this.prettyVar(this.activeVar),
        area: areaName,
        date: dateStr,
        depth: 'Full Column',
        metric: 'Platform Count',
        actualValue: `${floatsCount} platform(s)`,
        threshold: '≥ 3 platforms',
        sampleCount: `${floatsCount} platform(s)`,
        evidence: floatsCount === 0
          ? 'Zero collocated in-situ soundings in active bounding box. Model predictions cannot be empirically ground-truthed.'
          : `Only ${floatsCount} in-situ platform(s) available in this region. Low statistical power for bias and RMSE validation.`
      });
    }

    let flagsHtml = '';
    if (this.warnings.length === 0) {
      flagsHtml = `
        <div class="empty-state">
          No critical analytical flags detected for ${this.prettyVar(this.activeVar)}. Model agreement conforms within typical observational thresholds.
        </div>
      `;
    } else {
      flagsHtml = `
        <div class="eyebrow" style="margin: 12px 0 8px 0;">ANALYTICAL FLAGS</div>
        <div class="analytical-flag-list">
          ${this.warnings.map(w => `
            <div class="analytical-flag-card flag-${w.severity}">
              <div class="flag-header" style="display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <span class="flag-indicator-dot"></span>
                  <span class="flag-title">${w.title}</span>
                </div>
                <span class="taxonomy-tag ${w.severity === 'critical' ? 'flag-badge-critical' : 'flag-badge-warning'}" style="text-transform:uppercase; font-size:10px; font-weight:700;">${w.severity}</span>
              </div>
              <div class="flag-evidence" style="margin: 4px 0 8px 0;">${w.evidence}</div>
              <div class="flag-metrics-grid" style="display:grid; grid-template-columns: repeat(2, 1fr); gap: 4px 8px; font-size: 11px; background: rgba(0,0,0,0.03); padding: 8px 10px; border-radius: 4px; border: 1px solid rgba(0,0,0,0.06); line-height: 1.4;">
                <div><span style="color:var(--text-secondary);">Variable:</span> <strong>${w.variable}</strong></div>
                <div><span style="color:var(--text-secondary);">Area:</span> <strong>${w.area}</strong></div>
                <div><span style="color:var(--text-secondary);">Date:</span> <strong>${w.date}</strong></div>
                <div><span style="color:var(--text-secondary);">Depth:</span> <strong>${w.depth}</strong></div>
                <div><span style="color:var(--text-secondary);">Metric:</span> <strong>${w.metric}</strong></div>
                <div><span style="color:var(--text-secondary);">Actual:</span> <strong style="color:${w.severity === 'critical' ? '#ef4444' : '#f59e0b'};">${w.actualValue}</strong></div>
                <div><span style="color:var(--text-secondary);">Threshold:</span> <strong>${w.threshold}</strong></div>
                <div><span style="color:var(--text-secondary);">Sample Count:</span> <strong>${w.sampleCount}</strong></div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    container.innerHTML = insightHtml + flagsHtml;
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
