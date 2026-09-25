// SolvX — Ocean Analysis Dashboard
import * as THREE from 'three';
import { ApiClient } from '../api/apiClient.js';
import { OceanScene } from '../scene/oceanScene.js';
import { buildLand, buildIslands } from '../scene/land.js';
import { buildCoastline, buildEEZ } from '../scene/coastline.js';
import { buildSeabed } from '../scene/seabed.js';
import { DynamicWater } from '../scene/water.js';
import { ScalarVisualizer } from '../visualization/scalar.js';

const PRESET_REGIONS = {
  bay_of_bengal: { id: 'bay_of_bengal', name: 'Bay of Bengal', bbox: { min_lon: 84.10, max_lon: 93.00, min_lat: 16.07, max_lat: 23.52 } },
  arabian_sea: { id: 'arabian_sea', name: 'Arabian Sea', bbox: { min_lon: 60.00, max_lon: 74.00, min_lat: 12.00, max_lat: 24.00 } },
  south_china_sea: { id: 'south_china_sea', name: 'South China Sea', bbox: { min_lon: 105.00, max_lon: 120.00, min_lat: 8.00, max_lat: 22.00 } },
  gulf_of_mexico: { id: 'gulf_of_mexico', name: 'Gulf of Mexico', bbox: { min_lon: -97.00, max_lon: -82.00, min_lat: 20.00, max_lat: 30.00 } },
  mediterranean_sea: { id: 'mediterranean_sea', name: 'Mediterranean Sea', bbox: { min_lon: 5.00, max_lon: 25.00, min_lat: 32.00, max_lat: 42.00 } }
};

const alias = {
  ocean_temperature: ['temperature', 'thetao', 'temp', 'sst'],
  salinity: ['salinity', 'so', 'salt', 'vosaline'],
  temperature_anomaly: ['temperature_anomaly', 'sst_anomaly', 'ssta', 'temp_anomaly'],
  chlorophyll: ['chlorophyll', 'chl', 'chlor_a'],
  sea_level: ['sea_level', 'sea_surface_height', 'ssh', 'zos', 'sla'],
  currents: ['currents', 'uo', 'vo', 'ocean_currents']
};

class AnalysisDashboard {
  constructor() {
    this.regions = { ...PRESET_REGIONS };
    this.activeRegionId = 'bay_of_bengal';
    this.bbox = { ...this.regions.bay_of_bengal.bbox };
    
    this.scene = null;
    this.water = null;
    this.scalarViz = null;
    
    // UI State
    this.activeVar = 'ocean_temperature';
    this.activeDepth = 0;
    this.depthLevels = [0];
    this.activeView = '3d';
    this.activeScenario = 'general';
    this.activeSource = 'auto';
    this.depthExaggeration = 70.0;
    
    this.layerModel = true;
    this.layerArgo = true;
    this.layerAnomalies = true;
    this.layerAbnormal = true;
    
    // Time State
    this.timeline = [];
    this.index = 0;
    this.activeTime = null;
    this.playTimer = null;
    this.playbackSpeed = 1;
    
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
    
    // Selections
    this.selectedCell = null;
    this.selectedObservation = null;
    this.selectedRegion = null;
    this.selectedAnomaly = null;
    
    // 3D Groups
    this.markersGroup = new THREE.Group();
    this.regionsGroup = new THREE.Group();
    
    // Charts
    this.modelArgoChart = null;
    this.timeSeriesChart = null;
    this.errorMapChart = null;
  }

  async init() {
    this.bindUI();
    this.initCharts();
    await this.loadPresets();
    await this.loadTerrain();
    await this.loadDepths();
    await this.loadTimeline();
    if (this.timeline.length > 0) {
      await this.selectTime(0);
    }
    this.updateProvenance();
  }

  async loadPresets() {
    try {
      const res = await ApiClient.getPresets();
      if (res && Array.isArray(res.presets) && res.presets.length) {
        const sel = document.getElementById('analysisRegion');
        if (sel) sel.innerHTML = '';
        res.presets.forEach(p => {
          this.regions[p.id] = p;
          if (sel) {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            if (p.id === this.activeRegionId) opt.selected = true;
            sel.appendChild(opt);
          }
        });
      }
    } catch (_) {}
  }

  bindUI() {
    // Region selector
    document.getElementById('analysisRegion')?.addEventListener('change', async e => {
      this.activeRegionId = e.target.value;
      const target = this.regions[this.activeRegionId];
      if (target && target.bbox) {
        this.bbox = { ...target.bbox };
      }
      this.clearAllCaches();
      this.clearSelections();
      this.updateInvestigationSidebar();
      
      await this.loadTerrain();
      await this.loadDepths();
      await this.loadTimeline();
      if (this.timeline.length > 0) await this.selectTime(0);
      if (this.scene) this.scene.fitCamera();
    });
    
    // Variable selector
    document.getElementById('analysisVariable')?.addEventListener('change', async e => {
      this.activeVar = e.target.value;
      this.clearAllCaches();
      this.clearSelections();
      this.updateInvestigationSidebar();
      
      await this.loadDepths();
      await this.loadTimeline();
      if (this.timeline.length > 0) await this.selectTime(0);
    });
    
    // Depth slider
    const depthSlider = document.getElementById('analysisDepthSlider');
    const depthLabel = document.getElementById('currentDepthLabel');
    depthSlider?.addEventListener('input', e => {
      const idx = Number(e.target.value);
      this.activeDepth = this.depthLevels[idx] != null ? this.depthLevels[idx] : 0;
      if (depthLabel) depthLabel.textContent = `${this.activeDepth} m`;
      this.updateAnalysisView();
      if (this.selectedAnomaly || this.selectedObservation || this.selectedCell) {
        this.updateInvestigationSidebar();
      }
    });
    
    // Depth Exaggeration control
    document.getElementById('analysisDepthExaggeration')?.addEventListener('change', e => {
      this.depthExaggeration = Number(e.target.value);
      if (this.scene) {
        this.scene.setExaggerationFactor(this.depthExaggeration);
      }
    });

    // Scenario selector
    document.getElementById('analysisScenario')?.addEventListener('change', e => {
      this.activeScenario = e.target.value;
      this.applyScenario();
    });

    // Data Source selector
    document.getElementById('analysisSource')?.addEventListener('change', async e => {
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
      } else if (this.activeSource === 'comparison') {
        this.layerModel = true;
        this.layerArgo = true;
        this.layerAnomalies = true;
        this.layerAbnormal = true;
      } else {
        // Auto
        this.layerModel = true;
        this.layerArgo = true;
        this.layerAnomalies = true;
        this.layerAbnormal = true;
      }
      const chkModel = document.getElementById('layerModel');
      const chkArgo = document.getElementById('layerArgo');
      const chkAnom = document.getElementById('layerAnomalies');
      const chkAbn = document.getElementById('layerAbnormal');
      if (chkModel) chkModel.checked = this.layerModel;
      if (chkArgo) chkArgo.checked = this.layerArgo;
      if (chkAnom) chkAnom.checked = this.layerAnomalies;
      if (chkAbn) chkAbn.checked = this.layerAbnormal;
      
      this.updateAnalysisView();
    });

    // Time Dropdown selector
    document.getElementById('analysisTimeMode')?.addEventListener('change', e => {
      const idx = Number(e.target.value);
      if (Number.isFinite(idx) && idx >= 0 && idx < this.timeline.length) {
        this.selectTime(idx);
      }
    });

    // Reset button
    document.getElementById('btnReset')?.addEventListener('click', () => {
      this.clearSelections();
      this.updateInvestigationSidebar();
      this.clearProfileChart();
      this.clearTimeSeriesChart();
      if (this.scene) this.scene.fitCamera();
    });

    // View mode buttons (3D, TOP, CUT)
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

    // Timeline bottom controls
    document.getElementById('analysisSlider')?.addEventListener('input', e => this.selectTime(Number(e.target.value)));
    document.getElementById('timelinePrev')?.addEventListener('click', () => this.selectTime(Math.max(0, this.index - 1)));
    document.getElementById('timelineNext')?.addEventListener('click', () => this.selectTime(Math.min(this.timeline.length - 1, this.index + 1)));
    document.getElementById('timelinePlay')?.addEventListener('click', () => this.togglePlay());
    document.getElementById('timelineSpeed')?.addEventListener('change', e => {
      this.playbackSpeed = parseFloat(e.target.value);
      if (this.playTimer) {
        this.togglePlay();
        this.togglePlay();
      }
    });
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

    const slider = document.getElementById('analysisDepthSlider');
    const label = document.getElementById('currentDepthLabel');
    if (slider) {
      slider.min = "0";
      slider.max = String(Math.max(0, this.depthLevels.length - 1));
      slider.step = "1";
      
      let closestIdx = 0;
      let minDiff = Infinity;
      this.depthLevels.forEach((dl, i) => {
        const diff = Math.abs(dl - this.activeDepth);
        if (diff < minDiff) { minDiff = diff; closestIdx = i; }
      });
      slider.value = String(closestIdx);
      this.activeDepth = this.depthLevels[closestIdx];
      if (label) label.textContent = `${this.activeDepth} m`;
    }
  }

  initCharts() {
    // 1. Model vs Argo Vertical Profile
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
                let closestIdx = 0;
                let minDiff = Infinity;
                this.depthLevels.forEach((dl, i) => {
                  const diff = Math.abs(dl - depth);
                  if (diff < minDiff) { minDiff = diff; closestIdx = i; }
                });
                const slider = document.getElementById('analysisDepthSlider');
                if (slider) {
                  slider.value = String(closestIdx);
                  slider.dispatchEvent(new Event('input'));
                }
              }
            }
          }
        }
      });
    }

    // 2. Model Error / Anomaly Map (Scatter plot with real geographic axes)
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

    // 3. Selected Region Time Series
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

  applyScenario() {
    if (this.activeScenario === 'cyclone') {
      this.layerAnomalies = true;
      this.layerAbnormal = true;
    } else if (this.activeScenario === 'oilspill' || this.activeScenario === 'sar') {
      this.layerAnomalies = false;
      this.layerAbnormal = false;
      const slider = document.getElementById('analysisDepthSlider');
      if (slider) {
        slider.value = "0";
        slider.dispatchEvent(new Event('input'));
      }
    } else {
      this.layerAnomalies = true;
      this.layerAbnormal = true;
    }
    
    const chkAnom = document.getElementById('layerAnomalies');
    const chkAbn = document.getElementById('layerAbnormal');
    if (chkAnom) chkAnom.checked = this.layerAnomalies;
    if (chkAbn) chkAbn.checked = this.layerAbnormal;
    this.updateAnalysisView();
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
          this.selectedCell = cell;
          this.selectedObservation = null;
          this.selectedAnomaly = null;
          this.selectedRegion = null;
          this.updateInvestigationSidebar();
          this.updateCharts();
        },
        onFloatClick: obs => {
          this.selectedObservation = obs;
          this.selectedAnomaly = null;
          this.selectedRegion = null;
          this.selectedCell = null;
          this.updateInvestigationSidebar();
          this.updateCharts();
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
    
    this.scalarViz = new ScalarVisualizer(this.water);
    this.scene.setExaggerationFactor(this.depthExaggeration);
    this.scene.fitCamera();
  }

  async loadTimeline() {
    const res = await ApiClient.getDataTimeline({ variable: this.activeVar, bbox: this.bbox }).catch(() => ({ available_timestamps: [] }));
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
    
    const slider = document.getElementById('analysisSlider');
    if (slider) {
      slider.max = String(Math.max(0, this.timeline.length - 1));
      slider.value = "0";
    }
    if (this.timeline.length) {
      const sEl = document.getElementById('timelineStart');
      const eEl = document.getElementById('timelineEnd');
      if (sEl) sEl.textContent = this.timeline[0].slice(0, 10);
      if (eEl) eEl.textContent = this.timeline[this.timeline.length - 1].slice(0, 10);
    }
  }

  async selectTime(idx) {
    if (!this.timeline.length) return;
    this.index = Math.max(0, Math.min(idx, this.timeline.length - 1));
    this.activeTime = this.timeline[this.index];
    
    const slider = document.getElementById('analysisSlider');
    if (slider) slider.value = String(this.index);
    
    const timeSelect = document.getElementById('analysisTimeMode');
    if (timeSelect) timeSelect.value = String(this.index);
    
    const d = new Date(this.activeTime);
    const dateText = Number.isNaN(d.getTime())
      ? this.activeTime
      : `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ${d.toISOString().slice(11, 16)} UTC`;
    const label = document.getElementById('timelineLabel');
    if (label) label.textContent = dateText;
    
    // Concurrently fetch all real data
    await Promise.all([
      this.fetchBundleData(this.activeTime),
      this.fetchAnomalyData(this.activeTime),
      this.fetchAbnormalRegions(this.activeTime),
      this.fetchArgoData(),
      this.fetchSummaryAndCoverage(this.activeTime)
    ]);
    
    this.updateAnalysisView();
    this.updateKPIStrip();
    this.updateErrorMap();
    this.updateCoveragePanel();
    this.updateCharts();
    this.updateInvestigationSidebar();
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
      temperature_anomaly: 'Temperature anomaly',
      chlorophyll: 'Chlorophyll',
      sea_level: 'Sea level',
      currents: 'Currents'
    };
    return map[v] || v.replaceAll('_', ' ');
  }

  updateAnalysisView() {
    if (!this.water || !this.scalarViz) return;
    
    const vars = this.bundleCache[this.activeTime] || {};
    const anomalies = this.anomaliesCache[this.activeTime] || [];
    const regions = this.abnormalCache[this.activeTime] || [];
    const argo = this.argoData || [];
    
    let vizData = this.resolveVar(vars, this.activeVar);
    let vizVar = this.activeVar;
    
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
    
    if (this.layerModel) {
      this.scalarViz.apply(vizVar, vizData, this.activeDepth, sliceMode);
    } else {
      this.scalarViz.updateSliceTexture(this.activeDepth, 'none');
    }
    
    this.clearMarkers();
    
    if (this.layerArgo) this.renderArgoMarkers(argo);
    if (this.layerAnomalies) this.renderAnomalyMarkers(anomalies);
    if (this.layerAbnormal) this.renderAbnormalRegions(regions);
    
    this.updateViewMode();
    const legendEl = document.getElementById('legendVariable');
    if (legendEl) legendEl.textContent = this.prettyVar(this.activeVar).toUpperCase();
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
      
      const isSelected = this.selectedObservation && (this.selectedObservation.id === obs.id || this.selectedObservation.float_id === obs.float_id);
      
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(isSelected ? 2.5 : 1.5, 16, 16),
        new THREE.MeshStandardMaterial({
          color: glider ? 0x22d3ee : 0xf59e0b,
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
      // Show anomaly markers within sensible depth window
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
        let closestIdx = 0;
        let minDiff = Infinity;
        this.depthLevels.forEach((dl, i) => {
          const diff = Math.abs(dl - depth);
          if (diff < minDiff) { minDiff = diff; closestIdx = i; }
        });
        const slider = document.getElementById('analysisDepthSlider');
        if (slider) {
          slider.value = String(closestIdx);
          slider.dispatchEvent(new Event('input'));
        }
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

  updateInvestigationSidebar() {
    const sb = document.getElementById('investigationContent');
    const ins = document.getElementById('scientificInsightContent');
    if (!sb || !ins) return;
    
    if (this.selectedAnomaly) {
      const a = this.selectedAnomaly;
      const unit = a.unit || this.getVariableUnit(a.variable);
      sb.innerHTML = `
        <div class="sidebar-row"><label>Target</label><span class="critical">Anomaly Detected</span></div>
        <div class="sidebar-row"><label>Variable</label><span>${this.prettyVar(a.variable)}</span></div>
        <div class="sidebar-row"><label>Coordinates</label><span>${a.latitude.toFixed(2)}°N, ${a.longitude.toFixed(2)}°E</span></div>
        <div class="sidebar-row"><label>Depth</label><span>${a.depth} m</span></div>
        <div class="sidebar-row"><label>Model Value</label><span>${a.baseline.toFixed(2)} ${unit}</span></div>
        <div class="sidebar-row"><label>Observed Value</label><span>${a.value.toFixed(2)} ${unit}</span></div>
        <div class="sidebar-row"><label>Discrepancy</label><span class="${a.difference > 0 ? 'critical' : 'negative'}">${a.difference > 0 ? '+' : ''}${a.difference.toFixed(2)} ${unit}</span></div>
        <div class="sidebar-row"><label>Severity</label><span class="critical">${a.severity}</span></div>
        <div class="sidebar-row"><label>Method</label><span>${a.detection_method || 'Z-Score'}</span></div>
        <div class="sidebar-actions">
          <button class="action-btn" id="btnFocusItem">FOCUS 3D</button>
          <button class="action-btn" id="btnResetItem">RESET</button>
        </div>
      `;
      document.getElementById('btnFocusItem')?.addEventListener('click', () => this.focus3D());
      document.getElementById('btnResetItem')?.addEventListener('click', () => {
        this.clearSelections();
        this.updateInvestigationSidebar();
        this.updateCharts();
      });
      ins.innerHTML = `Flagged discrepancy at ${a.depth}m depth (${a.latitude.toFixed(2)}°N, ${a.longitude.toFixed(2)}°E). Numerical model deviates from in-situ observation by ${a.difference > 0 ? '+' : ''}${a.difference.toFixed(2)} ${unit}. Inspect profile comparison for full thermocline structure.`;
    } else if (this.selectedObservation) {
      const o = this.selectedObservation;
      sb.innerHTML = `
        <div class="sidebar-row"><label>Target</label><span class="positive">${o.platform || 'Argo Profiling Float'}</span></div>
        <div class="sidebar-row"><label>Float ID</label><span>${o.wmo || o.id}</span></div>
        <div class="sidebar-row"><label>Coordinates</label><span>${o.latitude.toFixed(2)}°N, ${o.longitude.toFixed(2)}°E</span></div>
        <div class="sidebar-row"><label>Status</label><span class="positive">ACTIVE PROFILER</span></div>
        <div class="sidebar-actions">
          <button class="action-btn" id="btnLoadProfile">RELOAD PROFILE</button>
          <button class="action-btn" id="btnFocusItem">FOCUS 3D</button>
          <button class="action-btn" id="btnResetItem">RESET</button>
        </div>
      `;
      document.getElementById('btnFocusItem')?.addEventListener('click', () => this.focus3D());
      document.getElementById('btnResetItem')?.addEventListener('click', () => {
        this.clearSelections();
        this.updateInvestigationSidebar();
        this.updateCharts();
      });
      document.getElementById('btnLoadProfile')?.addEventListener('click', () => this.updateCharts());
      ins.innerHTML = `Selected in-situ float ${o.wmo || o.id} located at ${o.latitude.toFixed(2)}°N, ${o.longitude.toFixed(2)}°E. Comparing multi-level vertical soundings with numerical model.`;
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
      document.getElementById('btnFocusItem')?.addEventListener('click', () => this.focus3D());
      document.getElementById('btnResetItem')?.addEventListener('click', () => {
        this.clearSelections();
        this.updateInvestigationSidebar();
        this.updateCharts();
      });
      ins.innerHTML = `Abnormal bounding volume '${r.name || r.id}' exhibits systemic model discrepancies across depth strata ${r.depth_range_m?.[0] ?? 0}m–${r.depth_range_m?.[1] ?? 500}m.`;
    } else if (this.selectedCell) {
      const c = this.selectedCell;
      const unit = this.getVariableUnit(this.activeVar);
      sb.innerHTML = `
        <div class="sidebar-row"><label>Target</label><span>Ocean Grid Cell</span></div>
        <div class="sidebar-row"><label>Coordinates</label><span>${c.lat.toFixed(3)}°N, ${c.lon.toFixed(3)}°E</span></div>
        <div class="sidebar-row"><label>Seabed Depth</label><span>${c.depthM.toFixed(1)} m</span></div>
        <div class="sidebar-row"><label>Selected Depth</label><span>${this.activeDepth} m</span></div>
        <div class="sidebar-row"><label>Variable</label><span>${this.prettyVar(this.activeVar)}</span></div>
        <div class="sidebar-row"><label>Coverage</label><span class="positive">MONITORED</span></div>
        <div class="sidebar-actions">
          <button class="action-btn" id="btnFocusItem">FOCUS 3D</button>
          <button class="action-btn" id="btnResetItem">RESET</button>
        </div>
      `;
      document.getElementById('btnFocusItem')?.addEventListener('click', () => this.focus3D());
      document.getElementById('btnResetItem')?.addEventListener('click', () => {
        this.clearSelections();
        this.updateInvestigationSidebar();
        this.updateCharts();
      });
      ins.innerHTML = `Grid cell at ${c.lat.toFixed(2)}°N, ${c.lon.toFixed(2)}°E. Seabed bathymetry reaches ${c.depthM.toFixed(0)}m. Active depth slice: ${this.activeDepth}m.`;
    } else {
      sb.innerHTML = `<div class="empty-state">Select an ocean cell, observation, anomaly or region.</div>`;
      ins.innerHTML = `<div class="empty-state">Select an observation or anomaly to view scientific interpretation.</div>`;
    }
  }

  updateErrorMap() {
    const anomalies = this.anomaliesCache[this.activeTime] || [];
    if (!this.errorMapChart) return;

    // Adapt axes directly to selected region bounding box
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
        label: 'Positive Error (Obs > Model)',
        data: pts.filter(p => p.anomaly.difference > 0),
        backgroundColor: '#ef4444',
        borderColor: '#ef4444',
        pointRadius: 5
      },
      {
        label: 'Negative Error (Obs < Model)',
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
      container.innerHTML = `<div class="empty-state">Coverage data unavailable.</div>`;
      return;
    }
    
    const density = cov.density_summary || {};
    const totalCells = cov.grid_cells?.length || 1;
    
    let html = `
      <div class="sidebar-row"><label>Spatial Coverage</label><span>${(cov.spatial_coverage_pct || 0).toFixed(1)} %</span></div>
      <div class="sidebar-row"><label>Total In-Situ Soundings</label><span>${cov.total_observations || 0}</span></div>
      <div style="margin-top:10px;" class="eyebrow">DENSITY CLASSIFICATION</div>
      <div class="coverage-row">
        <div style="display:flex;justify-content:space-between;font-size:10px;"><span>High Density (>15)</span><span>${density.HIGH || 0} cells</span></div>
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
    `;
    
    const gapRegions = gaps?.gap_regions || [];
    if (gapRegions.length > 0) {
      html += `<div style="margin-top:14px;" class="eyebrow">OBSERVATION GAPS</div>`;
      gapRegions.slice(0, 3).forEach(g => {
        html += `<div style="font-size:11px; margin-bottom:6px;"><strong style="color:#ef4444;">${g.name}</strong><br><span style="color:#84a6b8;">${g.recommendation || 'Coverage gap detected.'}</span></div>`;
      });
    }
    
    container.innerHTML = html;
  }

  async updateCharts() {
    const selectedFloat = this.selectedAnomaly?.float_id || this.selectedObservation?.float_id || this.selectedObservation?.id;
    const baseVar = this.getBaseVar(this.activeVar);
    
    // Only temperature and salinity have Argo profiles
    if (baseVar !== 'temperature' && baseVar !== 'salinity') {
      this.clearProfileChart("Argo in-situ vertical profiles only available for Temperature and Salinity.");
      this.clearTimeSeriesChart("Time series comparison unavailable for non-Argo variable.");
      return;
    }

    if (selectedFloat) {
      try {
        const profile = await ApiClient.getFloatComparison(String(selectedFloat), baseVar, this.activeTime);
        this.renderProfileChart(profile);
      } catch (e) {
        this.clearProfileChart("Profile data unavailable for selected float.");
      }
    } else {
      this.clearProfileChart("Select an Argo float or anomaly to view vertical profile comparison.");
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
  
  clearProfileChart(msg = null) {
    if (!this.modelArgoChart) return;
    this.modelArgoChart.data.labels = [];
    this.modelArgoChart.data.datasets = [];
    if (msg) {
      this.modelArgoChart.options.scales.x.title.text = msg;
    }
    this.modelArgoChart.update();
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
    if (el) el.textContent = `DATA: Copernicus NEMO + INCOIS | Obs: Argo Profiling Floats | Updated: ${d}`;
  }

  togglePlay() {
    const b = document.getElementById('timelinePlay');
    if (this.playTimer) {
      clearInterval(this.playTimer);
      this.playTimer = null;
      if (b) b.textContent = 'PLAY';
    } else {
      if (!this.timeline.length) return;
      if (b) b.textContent = 'PAUSE';
      const interval = 1200 / this.playbackSpeed;
      this.playTimer = setInterval(() => {
        this.selectTime((this.index + 1) % this.timeline.length);
      }, interval);
    }
  }
}

const dashboard = new AnalysisDashboard();
window.dashboard = dashboard;
dashboard.init().catch(e => {
  console.error("Dashboard initialization failed", e);
});
