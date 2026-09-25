// SolvX — Ocean Analysis Dashboard
import * as THREE from 'three';
import { ApiClient } from '../api/apiClient.js';
import { OceanScene } from '../scene/oceanScene.js';
import { buildLand, buildIslands } from '../scene/land.js';
import { buildCoastline, buildEEZ } from '../scene/coastline.js';
import { buildSeabed } from '../scene/seabed.js';
import { DynamicWater } from '../scene/water.js';
import { ScalarVisualizer } from '../visualization/scalar.js';

const BBOXES = {
  arabian: { min_lon: 50.0, max_lon: 75.0, min_lat: 5.0, max_lat: 25.0 },
  bengal: { min_lon: 80.0, max_lon: 95.0, min_lat: 5.0, max_lat: 23.0 }
};

const alias = {
  ocean_temperature:['temperature','thetao','temp','sst'],
  salinity:['salinity','so','salt','vosaline'],
  temperature_anomaly:['temperature_anomaly','sst_anomaly','ssta','temp_anomaly'],
  chlorophyll:['chlorophyll','chl','chlor_a'],
  sea_level:['sea_level','sea_surface_height','ssh','zos','sla'],
  currents:['currents','uo','vo','ocean_currents']
};

const DEPTH_LEVELS = [0, 50, 100, 250, 500, 1000, 2000];

class AnalysisDashboard {
  constructor() {
    this.bbox = { ...BBOXES.bengal };
    this.scene = null;
    this.water = null;
    this.scalarViz = null;
    
    // UI State
    this.activeVar = 'ocean_temperature';
    this.activeDepth = 100;
    this.activeView = '3d';
    this.activeScenario = 'general';
    this.activeSource = 'auto';
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
    this.argoData = [];
    this.coverageData = null;
    this.gapsData = null;
    this.summaryData = null;
    
    // Selection
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
    await this.loadTerrain();
    await this.loadTimeline();
    if (this.timeline.length > 0) {
      await this.selectTime(0);
    }
    this.updateProvenance();
  }

  bindUI() {
    document.getElementById('analysisRegion').addEventListener('change', async e => {
      this.bbox = { ...BBOXES[e.target.value] };
      await this.loadTerrain();
      await this.loadTimeline();
      if (this.timeline.length > 0) await this.selectTime(0);
    });
    
    document.getElementById('analysisVariable').addEventListener('change', async e => {
      this.activeVar = e.target.value;
      await this.loadTimeline();
      if (this.timeline.length > 0) await this.selectTime(0);
    });
    
    const depthSlider = document.getElementById('analysisDepthSlider');
    const depthLabel = document.getElementById('currentDepthLabel');
    depthSlider.addEventListener('input', e => {
      const idx = Number(e.target.value);
      this.activeDepth = DEPTH_LEVELS[idx];
      depthLabel.textContent = this.activeDepth === 2000 ? '2000 m+' : `${this.activeDepth} m`;
      this.updateAnalysisView();
      if (this.selectedAnomaly || this.selectedObservation) this.updateInvestigationSidebar();
    });
    
    document.getElementById('analysisScenario').addEventListener('change', e => {
      this.activeScenario = e.target.value;
      this.applyScenario();
    });

    document.getElementById('analysisSource').addEventListener('change', async e => {
      this.activeSource = e.target.value;
      if (this.activeSource === 'model') {
        this.layerArgo = false;
        this.layerAnomalies = false;
        this.layerAbnormal = false;
      } else if (this.activeSource === 'observations') {
        this.layerArgo = true;
        this.layerAnomalies = false;
        this.layerAbnormal = false;
      } else {
        this.layerArgo = true;
        this.layerAnomalies = true;
        this.layerAbnormal = true;
      }
      document.getElementById('layerArgo').checked = this.layerArgo;
      document.getElementById('layerAnomalies').checked = this.layerAnomalies;
      document.getElementById('layerAbnormal').checked = this.layerAbnormal;
      await this.selectTime(this.index);
    });

    document.getElementById('analysisTimeMode').addEventListener('change', e => {
      const idx = Number(e.target.value);
      if (Number.isFinite(idx)) this.selectTime(idx);
    });
    
    document.getElementById('btnReset').addEventListener('click', () => {
      this.selectedObservation = null;
      this.selectedRegion = null;
      this.selectedAnomaly = null;
      this.updateInvestigationSidebar();
      this.updateCharts();
      this.scene.fitCamera();
    });
    
    document.querySelectorAll('.analysis-view-controls button').forEach(b => {
      b.addEventListener('click', e => {
        document.querySelectorAll('.analysis-view-controls button').forEach(btn => btn.classList.remove('active'));
        b.classList.add('active');
        this.activeView = b.dataset.view;
        this.updateViewMode();
      });
    });
    
    ['layerArgo', 'layerAnomalies', 'layerAbnormal'].forEach(id => {
      document.getElementById(id).addEventListener('change', e => {
        this[id] = e.target.checked;
        this.updateAnalysisView();
      });
    });
    
    document.getElementById('analysisSlider').addEventListener('input', e => this.selectTime(Number(e.target.value)));
    document.getElementById('timelinePrev').addEventListener('click', () => this.selectTime(Math.max(0, this.index - 1)));
    document.getElementById('timelineNext').addEventListener('click', () => this.selectTime(Math.min(this.timeline.length - 1, this.index + 1)));
    document.getElementById('timelinePlay').addEventListener('click', () => this.togglePlay());
    document.getElementById('timelineSpeed').addEventListener('change', e => {
      this.playbackSpeed = parseFloat(e.target.value);
      if (this.playTimer) {
        this.togglePlay();
        this.togglePlay();
      }
    });
  }

  initCharts() {
    const ctxModel = document.getElementById('chartModelVsArgo').getContext('2d');
    this.modelArgoChart = new Chart(ctxModel, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y', // Depth on Y axis
        scales: {
          x: { 
            position: 'top', 
            grid: { color: '#17343f' }, 
            ticks: { color: '#6d99a7' },
            title: { display: true, text: 'Value', color: '#6d99a7' }
          },
          y: { 
            reverse: true, // Depth goes down
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
             // Auto-snap depth slider
             let closestIdx = 0;
             let minDiff = Infinity;
             DEPTH_LEVELS.forEach((dl, i) => {
               const diff = Math.abs(dl - depth);
               if (diff < minDiff) { minDiff = diff; closestIdx = i; }
             });
             const slider = document.getElementById('analysisDepthSlider');
             slider.value = closestIdx;
             slider.dispatchEvent(new Event('input')); // trigger update
          }
        }
      }
    });

    const ctxError = document.getElementById('chartErrorMap').getContext('2d');
    this.errorMapChart = new Chart(ctxError, {
      type: 'scatter',
      data: { datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { 
            title: { display: true, text: 'Longitude', color: '#6d99a7' },
            grid: { color: '#17343f' }, 
            ticks: { color: '#6d99a7' }
          },
          y: { 
            title: { display: true, text: 'Latitude', color: '#6d99a7' },
            grid: { color: '#17343f' }, 
            ticks: { color: '#6d99a7' }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
             callbacks: {
                label: (ctx) => {
                   const raw = ctx.raw;
                   return `[${raw.y.toFixed(2)}N, ${raw.x.toFixed(2)}E] Err: ${raw.anomaly.difference>0?'+':''}${raw.anomaly.difference.toFixed(2)}`;
                }
             }
          }
        },
        onClick: (e, elements) => {
           if (elements.length > 0) {
              const el = elements[0];
              const dsIndex = el.datasetIndex;
              const idx = el.index;
              const dataPoint = this.errorMapChart.data.datasets[dsIndex].data[idx];
              if (dataPoint && dataPoint.anomaly) {
                 this.selectedAnomaly = dataPoint.anomaly;
                 this.selectedObservation = null;
                 this.selectedRegion = null;
                 this.focus3D();
                 this.updateInvestigationSidebar();
                 this.updateCharts();
              }
           }
        }
      }
    });

    const ctxTime = document.getElementById('chartTimeSeries').getContext('2d');
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

  applyScenario() {
    // Reset layers based on scenario
    if (this.activeScenario === 'cyclone') {
      this.layerAnomalies = true;
      this.layerAbnormal = true;
    } else if (this.activeScenario === 'oilspill' || this.activeScenario === 'sar') {
      this.layerAnomalies = false;
      this.layerAbnormal = false;
      document.getElementById('analysisDepthSlider').value = 0; // surface
      document.getElementById('analysisDepthSlider').dispatchEvent(new Event('input'));
    } else {
      this.layerAnomalies = true;
      this.layerAbnormal = true;
    }
    
    document.getElementById('layerAnomalies').checked = this.layerAnomalies;
    document.getElementById('layerAbnormal').checked = this.layerAbnormal;
    this.updateAnalysisView();
  }

  async loadTerrain() {
    const [geo, bathy, eez] = await Promise.all([
      ApiClient.getDataGeometry(this.bbox),
      ApiClient.getDataBathymetry(this.bbox, 'medium'),
      ApiClient.getDataEEZ(this.bbox).catch(() => ({features:[],lines3d:[]}))
    ]);
    
    if (!this.scene) {
      this.scene = new OceanScene(document.getElementById('analysisCanvas'), {
        onOceanClick: cell => {
          if (!cell) return;
          this.selectedRegion = {
            id: `cell_${Number(cell.lat).toFixed(3)}_${Number(cell.lon).toFixed(3)}`,
            name: 'Selected ocean cell',
            bbox: { min_lat: Number(cell.lat) - 0.5, max_lat: Number(cell.lat) + 0.5, min_lon: Number(cell.lon) - 0.5, max_lon: Number(cell.lon) + 0.5 },
            depth_range_m: [Number(cell.depthM || 0), Number(cell.depthM || 0)],
            anomaly_count: 0, anomaly_magnitude_mean: 0, anomaly_magnitude_max: 0,
            variable: this.getBaseVar(this.activeVar),
            unit: this.activeVar === 'salinity' ? 'PSU' : '°C', severity: 'INFO',
            center_lat: Number(cell.lat), center_lon: Number(cell.lon), cell
          };
          this.selectedObservation = null;
          this.selectedAnomaly = null;
          this.focus3D();
          this.updateInvestigationSidebar();
          this.updateCharts();
        },
        onFloatClick: obs => {
          this.selectedObservation = obs;
          this.selectedAnomaly = null;
          this.selectedRegion = null;
          this.updateInvestigationSidebar();
          this.updateCharts();
        },
        onAnomalyClick: data => {
          if (data.isAnomaly) {
             this.selectedAnomaly = data.item;
             this.selectedObservation = null;
             this.selectedRegion = null;
          } else if (data.isRegion) {
             this.selectedRegion = data.item;
             this.selectedAnomaly = null;
             this.selectedObservation = null;
          }
          this.focus3D();
          this.updateInvestigationSidebar();
          this.updateCharts();
        }
      });
    }
    
    this.scene.setLayer('land', buildLand(geo, this.scene));
    this.scene.setLayer('coastline', buildCoastline(geo));
    this.scene.setLayer('islands', buildIslands(geo, this.scene));
    this.scene.setLayer('eez', buildEEZ(geo, eez));
    
    const seabed = buildSeabed(bathy, this.scene);
    if (seabed) this.scene.setLayer('seabed', seabed);
    
    this.water = new DynamicWater(bathy, this.scene);
    this.scene.setLayer('water', this.water.group);
    
    this.scene.root.add(this.markersGroup);
    this.scene.root.add(this.regionsGroup);
    
    this.scalarViz = new ScalarVisualizer(this.water);
    this.scene.fitCamera();
  }

  async loadTimeline() {
    const res = await ApiClient.getDataTimeline({ variable: this.activeVar, bbox: this.bbox }).catch(() => ({available_timestamps:[]}));
    this.timeline = res.available_timestamps || [];
    const timeSelect = document.getElementById('analysisTimeMode');
    if (timeSelect) {
      timeSelect.innerHTML = '';
      this.timeline.forEach((ts, i) => {
        const option = document.createElement('option');
        option.value = String(i);
        const d = new Date(ts);
        option.textContent = Number.isNaN(d.getTime()) ? ts : d.toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'UTC' }) + ' UTC';
        timeSelect.appendChild(option);
      });
    }
    const slider = document.getElementById('analysisSlider');
    slider.max = String(Math.max(0, this.timeline.length - 1));
    if(this.timeline.length) {
      document.getElementById('timelineStart').textContent = this.timeline[0].slice(0,10);
      document.getElementById('timelineEnd').textContent = this.timeline[this.timeline.length-1].slice(0,10);
    }
  }

  async selectTime(idx) {
    if (!this.timeline.length) return;
    this.index = Math.max(0, Math.min(idx, this.timeline.length - 1));
    this.activeTime = this.timeline[this.index];
    document.getElementById('analysisSlider').value = String(this.index);
    const timeSelect = document.getElementById('analysisTimeMode');
    if (timeSelect) timeSelect.value = String(this.index);
    
    const d = new Date(this.activeTime);
    const dateText = `${d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})} ${d.toISOString().slice(11,16)} UTC`;
    document.getElementById('timelineLabel').textContent = dateText;
    
    // Load all data
    await Promise.all([
      this.fetchBundleData(this.activeTime),
      this.fetchAnomalyData(this.activeTime),
      this.fetchAbnormalRegions(this.activeTime),
      this.fetchArgoData(),
      this.fetchSummaryAndCoverage(this.activeTime)
    ]);

    // Select the highest-discrepancy real Argo float on first load so the
    // analytical panels contain real data instead of empty placeholders.
    if (!this.selectedObservation && !this.selectedAnomaly && !this.selectedRegion) {
      const top = this.summaryData?.model_accuracy?.top_discrepancy;
      const targetId = top?.float_id != null ? String(top.float_id) : null;
      const target = targetId
        ? this.argoData.find(o => String(o.float_id ?? o.id) === targetId)
        : this.argoData[0];
      if (target) this.selectedObservation = target;
    }
    
    this.updateAnalysisView();
    this.updateKPIStrip();
    this.updateErrorMap();
    this.updateCoveragePanel();
    this.updateInvestigationSidebar();
    this.updateCharts();
  }

  async fetchBundleData(time) {
    if (this.bundleCache[time]) return;
    try {
      const bundle = await ApiClient.getOceanBundle({ provider: 'auto', bbox: this.bbox, time, depth: null, stride: 1 });
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
    } catch (e) {}
  }
  
  async fetchSummaryAndCoverage(time) {
     try {
        const [summary, cov, gaps] = await Promise.all([
           ApiClient.getAnalysisSummary({ variable: this.getBaseVar(this.activeVar), ...this.bbox }),
           ApiClient.getObservationCoverage({ ...this.bbox, grid_res_deg: 1.0 }),
           ApiClient.getDataGaps({ ...this.bbox })
        ]);
        // Normalize the current backend response shape for the UI.
        // Backend fields are model_accuracy and observation_coverage.
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
        console.error("Failed to load summary", e);
     }
  }

  getBaseVar(v) {
    return v === 'ocean_temperature' ? 'temperature' : v;
  }

  updateAnalysisView() {
    const vars = this.bundleCache[this.activeTime] || {};
    const anomalies = this.anomaliesCache[this.activeTime] || [];
    const regions = this.abnormalCache[this.activeTime] || [];
    const argo = this.argoData || [];
    
    let vizData = this.resolveVar(vars, this.activeVar);
    let vizVar = this.activeVar;
    
    let sliceMode = 'horizontal';
    if (this.activeView === 'cut') sliceMode = 'vertical';
    else if (this.activeDepth === 0) sliceMode = 'volume';
    
    this.scalarViz.apply(vizVar, vizData, this.activeDepth, sliceMode);
    if (this.activeSource === 'observations') {
      this.water?.setOpacity(0);
    }
    
    this.clearMarkers();
    
    if (this.layerArgo) this.renderArgoMarkers(argo);
    if (this.layerAnomalies) this.renderAnomalyMarkers(anomalies);
    if (this.layerAbnormal) this.renderAbnormalRegions(regions);
    
    this.updateViewMode();
    document.getElementById('legendVariable').textContent = this.prettyVar(this.activeVar).toUpperCase();
  }
  
  updateViewMode() {
    if (!this.scene) return;
    if (this.activeView === 'top') {
        this.scene.setView('top');
    } else {
        this.scene.setView('3d');
    }
  }
  
  clearMarkers() {
    while(this.markersGroup.children.length > 0) this.markersGroup.remove(this.markersGroup.children[0]);
    while(this.regionsGroup.children.length > 0) this.regionsGroup.remove(this.regionsGroup.children[0]);
  }
  
  renderArgoMarkers(observations) {
    if (!this.water) return;
    const bounds = this.water.bounds;
    const midLat = (bounds[2]+bounds[3])/2;
    const midLon = (bounds[0]+bounds[1])/2;
    const klon = 111.32 * Math.cos(midLat*Math.PI/180);
    
    observations.forEach(obs => {
      const glider = /glider/i.test(obs.platform||'');
      const x = (obs.latitude-midLat)*111.32;
      const z = (obs.longitude-midLon)*klon;
      
      const isSelected = this.selectedObservation && this.selectedObservation.id === obs.id;
      
      const marker = new THREE.Mesh(
          new THREE.SphereGeometry(isSelected ? 2.5 : 1.5, 16, 16),
          new THREE.MeshStandardMaterial({
              color: glider ? 0x22d3ee : 0xf59e0b,
              emissive: isSelected ? 0xffffff : 0x000000,
              emissiveIntensity: isSelected ? 0.5 : 0
          })
      );
      marker.position.set(x, 2, z);
      marker.userData = { isArgoFloat: true, float: obs };
      this.markersGroup.add(marker);
    });
    this.scene.layers.observations = { group: this.markersGroup };
  }
  
  renderAnomalyMarkers(anomalies) {
    if (!this.water) return;
    const bounds = this.water.bounds;
    const midLat = (bounds[2]+bounds[3])/2;
    const midLon = (bounds[0]+bounds[1])/2;
    const klon = 111.32 * Math.cos(midLat*Math.PI/180);
    
    anomalies.forEach(an => {
      if (Math.abs(an.depth - this.activeDepth) > 50) return;
      
      const x = (an.latitude-midLat)*111.32;
      const z = (an.longitude-midLon)*klon;
      const isSelected = this.selectedAnomaly && this.selectedAnomaly.id === an.id;
      
      const marker = new THREE.Mesh(
          new THREE.SphereGeometry(isSelected ? 3.0 : 2.0, 16, 16),
          new THREE.MeshBasicMaterial({color: an.difference > 0 ? 0xef4444 : 0x22d3ee})
      );
      marker.position.set(x, this.scene.sceneManager.depthY(an.depth) + 1, z);
      
      marker.userData = { isAnomaly: true, customData: { isAnomaly: true, item: an } };
      this.markersGroup.add(marker);
    });
  }
  
  renderAbnormalRegions(regions) {
    if (!this.water) return;
    const bounds = this.water.bounds;
    const midLat = (bounds[2]+bounds[3])/2;
    const midLon = (bounds[0]+bounds[1])/2;
    const klon = 111.32 * Math.cos(midLat*Math.PI/180);
    
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
              opacity: 0.3,
              wireframe: true
          })
      );
      box.position.set(cx, 0, cz);
      box.userData = { isRegion: true, customData: { isRegion: true, item: reg } };
      this.regionsGroup.add(box);
    this.scene.layers.regions = { group: this.regionsGroup };
    });
  }

  focus3D() {
    let lat, lon, depth;
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
       depth = this.selectedRegion.depth_range_m[0];
    }
    
    if (lat && lon && this.scene) {
        const bounds = this.water.bounds;
        const midLat = (bounds[2]+bounds[3])/2;
        const midLon = (bounds[0]+bounds[1])/2;
        const klon = 111.32 * Math.cos(midLat*Math.PI/180);
        
        const tx = (lat - midLat) * 111.32;
        const tz = (lon - midLon) * klon;
        
        this.scene.controls.target.set(tx, 0, tz);
        this.scene.controls.update();
        
        if (depth != null) {
           let closestIdx = 0;
           let minDiff = Infinity;
           DEPTH_LEVELS.forEach((dl, i) => {
             const diff = Math.abs(dl - depth);
             if (diff < minDiff) { minDiff = diff; closestIdx = i; }
           });
           const slider = document.getElementById('analysisDepthSlider');
           slider.value = closestIdx;
           slider.dispatchEvent(new Event('input'));
        }
    }
  }

  updateKPIStrip() {
    if (!this.summaryData) return;
    
    const setVal = (id, val, format, colorClass) => {
      const el = document.getElementById(id);
      if (val == null) { el.textContent = '—'; el.className = 'kpi-value'; return; }
      el.textContent = format ? format(val) : val;
      el.className = 'kpi-value ' + (colorClass || '');
    };

    const acc = this.summaryData.model_accuracy || this.summaryData.accuracy || {};
    const cov = this.summaryData.observation_coverage || this.summaryData.density || {};
    const anomalyCount = this.anomaliesCache[this.activeTime]?.length ?? this.summaryData.anomalies_detected ?? 0;

    setVal('kpi-rmse', acc.overall_rmse, v => v.toFixed(2) + ' °C');
    setVal('kpi-bias', acc.overall_bias, v => (v > 0 ? '+' : '') + v.toFixed(2) + ' °C', Math.abs(v) > 0.5 ? 'critical' : '');
    setVal('kpi-mae', acc.overall_mae, v => v.toFixed(2) + ' °C');
    setVal('kpi-observations', cov.total_observations);
    setVal('kpi-coverage', cov.spatial_coverage_pct, v => v.toFixed(1) + ' %', cov.spatial_coverage_pct < 50 ? 'critical' : 'positive');
    setVal('kpi-anomalies', anomalyCount, null, anomalyCount > 0 ? 'critical' : 'positive');
  }

  updateInvestigationSidebar() {
    const sb = document.getElementById('investigationContent');
    const ins = document.getElementById('scientificInsightContent');
    
    if (this.selectedAnomaly) {
      const a = this.selectedAnomaly;
      sb.innerHTML = `
        <div class="sidebar-row"><label>Variable</label><span>${this.prettyVar(a.variable)}</span></div>
        <div class="sidebar-row"><label>Location</label><span>${a.latitude.toFixed(2)}°N, ${a.longitude.toFixed(2)}°E</span></div>
        <div class="sidebar-row"><label>Depth</label><span>${a.depth} m</span></div>
        <div class="sidebar-row"><label>Model</label><span>${a.baseline.toFixed(2)}</span></div>
        <div class="sidebar-row"><label>Observation</label><span>${a.value.toFixed(2)}</span></div>
        <div class="sidebar-row"><label>Difference</label><span class="${a.difference > 0 ? 'critical' : 'negative'}">${(a.difference > 0 ? '+' : '')}${a.difference.toFixed(2)}</span></div>
        <div class="sidebar-row"><label>Severity</label><span class="critical">${a.severity}</span></div>
        <div class="sidebar-row"><label>Data Quality</label><span class="positive">GOOD</span></div>
      `;
      ins.innerHTML = `
        Anomaly detected in ${this.prettyVar(a.variable)}. 
        The numerical model predicted ${a.baseline.toFixed(2)}, but observations show ${a.value.toFixed(2)}.
        This results in a significant deviation of ${a.difference.toFixed(2)} at ${a.depth}m depth.
        Investigate neighboring floats or timeline to identify transient eddy or mixing event.
      `;
    } else if (this.selectedRegion) {
      const r = this.selectedRegion;
      sb.innerHTML = `
        <div class="sidebar-row"><label>Region</label><span>${r.name || r.id}</span></div>
        <div class="sidebar-row"><label>Variable</label><span>${this.prettyVar(r.variable)}</span></div>
        <div class="sidebar-row"><label>Depth Range</label><span>${r.depth_range_m[0]}m - ${r.depth_range_m[1]}m</span></div>
        <div class="sidebar-row"><label>Severity</label><span class="critical">${r.severity}</span></div>
      `;
      ins.innerHTML = `
        Abnormal region spans depths from ${r.depth_range_m[0]}m to ${r.depth_range_m[1]}m. 
        Model shows systemic discrepancies within this bounding volume.
      `;
    } else if (this.selectedObservation) {
      const o = this.selectedObservation;
      sb.innerHTML = `
        <div class="sidebar-row"><label>Platform</label><span>${o.wmo || o.id}</span></div>
        <div class="sidebar-row"><label>Type</label><span>${o.platform || 'Argo Float'}</span></div>
        <div class="sidebar-row"><label>Location</label><span>${o.latitude.toFixed(2)}°N, ${o.longitude.toFixed(2)}°E</span></div>
        <button class="action-btn" onclick="window.fetchFloatProfile('${o.id}')">LOAD PROFILE</button>
      `;
      window.fetchFloatProfile = async (id) => {
         const btn = document.querySelector('.action-btn');
         btn.textContent = "LOADING...";
         try {
           const profile = await ApiClient.getFloatComparison(id, this.getBaseVar(this.activeVar), this.activeTime);
           this.renderProfileChart(profile);
           btn.textContent = "LOADED";
         } catch(e) {
           btn.textContent = "ERROR";
         }
      };
      ins.innerHTML = `Selected observation platform ${o.wmo}. Click LOAD PROFILE to compare full depth column with numerical model.`;
    } else {
      sb.innerHTML = `<div class="empty-state">Select an anomaly, observation, or region to investigate.</div>`;
      ins.innerHTML = `<div class="empty-state">Select a region or observation to view insights.</div>`;
    }
  }

  updateErrorMap() {
     const anomalies = this.anomaliesCache[this.activeTime] || [];
     if (!this.errorMapChart) return;
     
     const pts = anomalies.map(a => ({
         x: a.longitude,
         y: a.latitude,
         anomaly: a
     }));
     
     this.errorMapChart.data.datasets = [
        {
           label: 'Positive Error',
           data: pts.filter(p => p.anomaly.difference > 0),
           backgroundColor: '#ef4444',
           pointRadius: 4
        },
        {
           label: 'Negative Error',
           data: pts.filter(p => p.anomaly.difference <= 0),
           backgroundColor: '#22d3ee',
           pointRadius: 4
        }
     ];
     this.errorMapChart.update();
  }

  updateCoveragePanel() {
     const cov = this.coverageData;
     const gaps = this.gapsData;
     const container = document.getElementById('coverageContent');
     if (!cov) {
        container.innerHTML = `<div class="empty-state">Coverage data unavailable.</div>`;
        return;
     }
     
     let html = `
       <div class="sidebar-row"><label>Spatial Coverage</label><span>${(cov.spatial_coverage_pct || 0).toFixed(1)} %</span></div>
       <div class="sidebar-row"><label>Total Observations</label><span>${cov.total_observations || 0}</span></div>
       <div style="margin-top:10px;" class="eyebrow">DENSITY CLASSIFICATION</div>
       <div class="coverage-row">
         <div style="display:flex;justify-content:space-between;font-size:10px;"><span>High Density (>15)</span><span>${cov.density_summary?.HIGH || 0} cells</span></div>
         <div class="coverage-bar"><div class="coverage-fill" style="width:${((cov.density_summary?.HIGH || 0)/(cov.grid_cells?.length || 1))*100}%"></div></div>
       </div>
       <div class="coverage-row">
         <div style="display:flex;justify-content:space-between;font-size:10px;"><span>Moderate (5-15)</span><span>${cov.density_summary?.MEDIUM || 0} cells</span></div>
         <div class="coverage-bar"><div class="coverage-fill" style="width:${((cov.density_summary?.MEDIUM || 0)/(cov.grid_cells?.length || 1))*100}%; background:#f59e0b;"></div></div>
       </div>
       <div class="coverage-row">
         <div style="display:flex;justify-content:space-between;font-size:10px;"><span>Sparse (1-4)</span><span>${cov.density_summary?.LOW || 0} cells</span></div>
         <div class="coverage-bar"><div class="coverage-fill" style="width:${((cov.density_summary?.LOW || 0)/(cov.grid_cells?.length || 1))*100}%; background:#22d3ee;"></div></div>
       </div>
       <div class="coverage-row">
         <div style="display:flex;justify-content:space-between;font-size:10px;"><span>No Data</span><span>${cov.density_summary?.NONE || 0} cells</span></div>
         <div class="coverage-bar"><div class="coverage-fill" style="width:${((cov.density_summary?.NONE || 0)/(cov.grid_cells?.length || 1))*100}%; background:#ef4444;"></div></div>
       </div>
     `;
     
     if (gaps && gaps.critical_gaps && gaps.critical_gaps.length > 0) {
        html += `<div style="margin-top:15px;" class="eyebrow">CRITICAL GAPS</div>`;
        gaps.critical_gaps.slice(0, 3).forEach(g => {
           html += `<div style="font-size:11px; margin-bottom:4px; color:#ef4444;">${g.description}</div>`;
        });
     }
     
     container.innerHTML = html;
  }

  async updateCharts() {
     const selectedFloat = this.selectedAnomaly?.float_id || this.selectedObservation?.float_id || this.selectedObservation?.id;
     if (selectedFloat) {
       try {
         const profile = await ApiClient.getFloatComparison(String(selectedFloat), this.getBaseVar(this.activeVar), this.activeTime);
         this.renderProfileChart(profile);
       } catch (e) {
         console.error('Profile load failed', e);
         this.clearProfileChart();
       }
     } else {
       this.clearProfileChart();
     }

     await this.updateTimeSeriesChart(selectedFloat);
  }

  renderProfileChart(profileData) {
     if (!this.modelArgoChart || !profileData || !Array.isArray(profileData.comparison)) return;

     const points = profileData.comparison;
     this.modelArgoChart.data.labels = points.map(p => Number(p.depth));
     this.modelArgoChart.data.datasets = [
        {
           label: 'Model',
           data: points.map(p => Number(p.model)),
           borderColor: '#62d5ee',
           backgroundColor: 'transparent',
           borderWidth: 2,
           pointRadius: 3
        },
        {
           label: 'Argo Observation',
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
  async updateTimeSeriesChart(floatId = null) {
     if (!this.timeSeriesChart || !this.timeline.length) return;

     // Never fabricate a time series. Only show values returned by the API.
     if (!floatId) {
       this.timeSeriesChart.data.labels = [];
       this.timeSeriesChart.data.datasets = [];
       this.timeSeriesChart.update();
       return;
     }

     const key = `${floatId}:${this.getBaseVar(this.activeVar)}`;
     if (!this.timeSeriesCache) this.timeSeriesCache = {};
     if (!this.timeSeriesCache[key]) {
       const maxPoints = 24;
       const indices = this.timeline.length <= maxPoints
         ? this.timeline.map((_, i) => i)
         : Array.from({length: maxPoints}, (_, i) => Math.round(i * (this.timeline.length - 1) / (maxPoints - 1)));
       const responses = await Promise.all(indices.map(i =>
         ApiClient.getFloatComparison(String(floatId), this.getBaseVar(this.activeVar), this.timeline[i]).catch(() => null)
       ));
       this.timeSeriesCache[key] = responses.map((r, k) => {
         if (!r || !Array.isArray(r.comparison) || !r.comparison.length) return null;
         const obs = r.comparison.map(p => Number(p.observed)).filter(Number.isFinite);
         const model = r.comparison.map(p => Number(p.model)).filter(Number.isFinite);
         return {
           label: this.timeline[indices[k]].slice(5, 10),
           observed: obs.length ? obs.reduce((a,b) => a+b, 0) / obs.length : null,
           model: model.length ? model.reduce((a,b) => a+b, 0) / model.length : null
         };
       }).filter(Boolean);
     }

     const rows = this.timeSeriesCache[key];
     this.timeSeriesChart.data.labels = rows.map(r => r.label);
     this.timeSeriesChart.data.datasets = [
       { label: 'Model', data: rows.map(r => r.model), borderColor: '#62d5ee', borderWidth: 2, pointRadius: 2, fill: false },
       { label: 'Argo Observation', data: rows.map(r => r.observed), borderColor: '#f59e0b', borderWidth: 2, pointRadius: 2, fill: false }
     ];
     this.timeSeriesChart.update();
  }
  resolveVar(vars, id) {
    if (vars[id] && !vars[id].error) return vars[id];
    for (const k of (alias[id] || [])) {
      if (vars[k] && !vars[k].error) return vars[k];
    }
    return null;
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

  updateProvenance() {
     const d = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
     document.getElementById('provenanceData').textContent = `DATA SOURCES: Model (Copernicus), Obs (Argo) | Updated: ${d}`;
  }

  togglePlay() {
    const b = document.getElementById('timelinePlay');
    if (this.playTimer) {
      clearInterval(this.playTimer);
      this.playTimer = null;
      b.textContent = 'PLAY';
    } else {
      if (!this.timeline.length) return;
      b.textContent = 'PAUSE';
      const interval = 1200 / this.playbackSpeed;
      this.playTimer = setInterval(() => {
        this.selectTime((this.index + 1) % this.timeline.length);
      }, interval);
    }
  }
}

new AnalysisDashboard().init().catch(e => {
  console.error(e);
});
