// SolvX — Standalone Ocean Analysis Page
import * as THREE from 'three';
import { ApiClient } from '../api/apiClient.js';
import { OceanScene } from '../scene/oceanScene.js';
import { buildLand, buildIslands } from '../scene/land.js';
import { buildCoastline, buildEEZ } from '../scene/coastline.js';
import { buildSeabed } from '../scene/seabed.js';
import { DynamicWater } from '../scene/water.js';
import { ScalarVisualizer } from '../visualization/scalar.js';

const DEFAULT_BBOX = { min_lon: 84.10, max_lon: 93.00, min_lat: 16.07, max_lat: 23.52 };
const alias = {
  ocean_temperature:['temperature','thetao','temp','sst'],
  salinity:['salinity','so','salt','vosaline'],
  temperature_anomaly:['temperature_anomaly','sst_anomaly','ssta','temp_anomaly'],
  chlorophyll:['chlorophyll','chl','chlor_a'],
  sea_level:['sea_level','sea_surface_height','ssh','zos','sla'],
  currents:['currents','uo','vo','ocean_currents']
};
const gliderRegex = /glider/i;

class AnalysisPage {
  constructor() {
    this.bbox = { ...DEFAULT_BBOX };
    this.scene = null;
    this.water = null;
    this.scalarViz = null;
    this.activeMode = 'anomaly'; // anomaly, warning, abnormal, model_argo, argo_glider
    this.activeVar = 'ocean_temperature';
    this.activeDepth = 100;
    this.activeView = '3d'; // 3d, top, cut
    this.timeline = [];
    this.index = 0;
    this.activeTime = null;
    this.playTimer = null;
    
    this.bundleCache = {};
    this.anomaliesCache = {};
    this.abnormalCache = {};
    this.modelVsArgoCache = {};
    this.argoData = [];
    
    this.selectedObservation = null;
    this.selectedRegion = null;
    
    this.markersGroup = new THREE.Group();
    this.regionsGroup = new THREE.Group();
  }

  async init() {
    this.renderShell();
    this.bindUI();
    await this.loadTerrain();
    await this.loadTimeline();
    if (this.timeline.length > 0) {
      await this.selectTime(0);
    }
  }

  renderShell() {
    document.body.innerHTML = `
    <div class="analysis-page">
      <header class="analysis-topbar">
        <div class="analysis-brand">SOLVX / ANALYSIS</div>
        <nav class="top-nav">
          <a href="/">VIEWER</a>
          <a href="#">2D MAP</a>
          <a href="/analysis.html" class="active">ANALYSIS</a>
          <a href="/download.html">DOWNLOADER</a>
        </nav>
      </header>
      
      <section class="analysis-toolbar">
        <label>MODE 
          <select id="analysisMode">
            <option value="anomaly">Anomaly</option>
            <option value="warning">Warning</option>
            <option value="abnormal">Abnormal Regions</option>
            <option value="model_argo">Model vs Argo</option>
            <option value="argo_glider">Argo / Glider</option>
          </select>
        </label>
        <label>VARIABLE 
          <select id="analysisVariable">
            <option value="ocean_temperature">Temperature</option>
            <option value="salinity">Salinity</option>
            <option value="chlorophyll">Chlorophyll</option>
            <option value="sea_level">Sea level</option>
            <option value="currents">Currents</option>
          </select>
        </label>
        <label>DEPTH 
          <select id="analysisDepth">
            <option value="0">Surface</option>
            <option value="50">50 m</option>
            <option value="100" selected>100 m</option>
            <option value="250">250 m</option>
            <option value="500">500 m</option>
            <option value="1000">1000 m</option>
          </select>
        </label>
        <div class="analysis-actions">
          <button data-view="3d" class="active">3D</button>
          <button data-view="top">TOP</button>
          <button data-view="cut">CUT</button>
        </div>
      </section>
      
      <main class="analysis-main">
        <section class="analysis-stage">
          <canvas id="analysisCanvas"></canvas>
          <div class="analysis-overlay analysis-field">
            <div class="eyebrow">ACTIVE FIELD</div>
            <strong id="legendVariable">Analysis</strong>
            <div id="legendUnits">—</div>
            <div id="legendRange">—</div>
            <div id="legendBar" class="analysis-gradient"></div>
          </div>
          <div class="analysis-overlay analysis-obs-key">
            <div><span class="legend-dot argo"></span>ARGO</div>
            <div><span class="legend-dot glider"></span>GLIDER</div>
          </div>
        </section>
        
        <aside class="analysis-sidebar" id="sidebarContent">
          <!-- Populated dynamically based on mode -->
        </aside>
      </main>
      
      <footer class="analysis-timeline">
        <div class="timeline-head">
          <div>
            <div class="eyebrow">TIME</div>
            <strong id="timelineLabel" style="font-family:'JetBrains Mono',monospace;">—</strong>
          </div>
          <div class="timeline-controls">
            <button id="timelinePrev">PREV</button>
            <button id="timelinePlay">PLAY</button>
            <button id="timelineNext">NEXT</button>
          </div>
        </div>
        <input id="analysisSlider" type="range" min="0" max="0" value="0">
        <div class="timeline-scale">
          <span id="timelineStart">—</span>
          <span id="timelineEnd">—</span>
        </div>
      </footer>
    </div>`;
  }

  bindUI() {
    document.getElementById('analysisMode').addEventListener('change', e => {
      this.activeMode = e.target.value;
      this.selectedObservation = null;
      this.selectedRegion = null;
      this.updateAnalysisView();
    });
    
    document.getElementById('analysisVariable').addEventListener('change', e => {
      this.activeVar = e.target.value;
      this.loadTimeline().then(() => this.selectTime(0));
    });
    
    document.getElementById('analysisDepth').addEventListener('change', e => {
      this.activeDepth = Number(e.target.value);
      this.updateAnalysisView();
    });
    
    document.querySelectorAll('.analysis-actions button').forEach(b => {
      b.addEventListener('click', e => {
        document.querySelectorAll('.analysis-actions button').forEach(btn => btn.classList.remove('active'));
        b.classList.add('active');
        this.activeView = b.dataset.view;
        this.updateViewMode();
      });
    });
    
    document.getElementById('analysisSlider').addEventListener('input', e => this.selectTime(Number(e.target.value)));
    document.getElementById('timelinePrev').addEventListener('click', () => this.selectTime(Math.max(0, this.index - 1)));
    document.getElementById('timelineNext').addEventListener('click', () => this.selectTime(Math.min(this.timeline.length - 1, this.index + 1)));
    document.getElementById('timelinePlay').addEventListener('click', () => this.togglePlay());
  }

  async loadTerrain() {
    const [geo, bathy, eez] = await Promise.all([
      ApiClient.getDataGeometry(this.bbox),
      ApiClient.getDataBathymetry(this.bbox, 'medium'),
      ApiClient.getDataEEZ(this.bbox).catch(() => ({features:[],lines3d:[]}))
    ]);
    
    this.scene = new OceanScene(document.getElementById('analysisCanvas'), {
      onOceanClick: cell => {},
      onFloatClick: obs => {
        this.selectedObservation = obs;
        this.updateSidebar();
      },
      onAnomalyClick: id => {
        // Find the region or anomaly by id if we need to, but the easiest is to just find it from cache
        // Actually, we can get the object directly if we intercept it, but OceanScene only gives us the ID.
        const allRegions = this.abnormalCache[this.activeTime] || [];
        const reg = allRegions.find(r => r.id === id);
        if (reg) {
            this.selectedRegion = reg;
            this.updateSidebar();
        }
      }
    });
    
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
    
    const d = new Date(this.activeTime);
    const dateText = `${d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})} ${d.toISOString().slice(11,16)} UTC`;
    document.getElementById('timelineLabel').textContent = dateText;
    
    // Load necessary data for the current time
    await Promise.all([
      this.fetchBundleData(this.activeTime),
      this.fetchAnomalyData(this.activeTime),
      this.fetchAbnormalRegions(this.activeTime),
      this.fetchModelVsArgo(this.activeTime),
      this.fetchArgoData()
    ]);
    
    this.updateAnalysisView();
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
      const res = await ApiClient.getAnomalies({ variable: this.activeVar === 'ocean_temperature' ? 'temperature' : this.activeVar, method: 'zscore', time });
      this.anomaliesCache[time] = res.anomalies || [];
    } catch (e) {
      this.anomaliesCache[time] = [];
    }
  }
  
  async fetchAbnormalRegions(time) {
    if (this.abnormalCache[time]) return;
    try {
      const res = await ApiClient.getAbnormalRegions({ variable: this.activeVar === 'ocean_temperature' ? 'temperature' : this.activeVar, method: 'zscore', time });
      this.abnormalCache[time] = res.regions || [];
    } catch (e) {
      this.abnormalCache[time] = [];
    }
  }
  
  async fetchModelVsArgo(time) {
    if (this.modelVsArgoCache[time]) return;
    try {
      const res = await ApiClient.getModelVsArgo({ variable: this.activeVar === 'ocean_temperature' ? 'temperature' : this.activeVar, time, min_lat: this.bbox.min_lat, max_lat: this.bbox.max_lat, min_lon: this.bbox.min_lon, max_lon: this.bbox.max_lon });
      this.modelVsArgoCache[time] = res;
    } catch (e) {
      this.modelVsArgoCache[time] = null;
    }
  }
  
  async fetchArgoData() {
    if (this.argoData.length) return;
    try {
      const res = await ApiClient.getArgoObservations(this.bbox);
      this.argoData = res.observations || [];
    } catch (e) {}
  }

  updateAnalysisView() {
    const vars = this.bundleCache[this.activeTime] || {};
    const anomalies = this.anomaliesCache[this.activeTime] || [];
    const regions = this.abnormalCache[this.activeTime] || [];
    const argo = this.argoData || [];
    
    // Determine the color scale and data based on mode
    let vizData = null;
    let vizVar = this.activeVar;
    
    if (this.activeMode === 'anomaly' || this.activeMode === 'warning') {
        // Use anomaly colors
        if (this.activeVar === 'ocean_temperature' || this.activeVar === 'temperature') {
            vizVar = 'temperature_anomaly';
            vizData = this.resolveVar(vars, 'temperature_anomaly');
        } else {
            vizData = this.resolveVar(vars, this.activeVar);
        }
    } else {
        vizData = this.resolveVar(vars, this.activeVar);
    }
    
    // Apply visualization (handles horizontal/vertical/volume slice)
    let sliceMode = 'horizontal';
    if (this.activeView === 'cut') {
        sliceMode = 'vertical';
    } else if (this.activeDepth === 0) {
        sliceMode = 'volume';
    }
    
    this.scalarViz.apply(vizVar, vizData, this.activeDepth, sliceMode);
    
    // Render markers
    this.clearMarkers();
    
    if (this.activeMode === 'argo_glider' || this.activeMode === 'model_argo') {
        this.renderArgoMarkers(argo);
    } else if (this.activeMode === 'anomaly' || this.activeMode === 'warning') {
        this.renderAnomalyMarkers(anomalies);
    }
    
    if (this.activeMode === 'abnormal' || this.activeMode === 'warning') {
        this.renderAbnormalRegions(regions);
    }
    
    this.updateViewMode();
    this.updateSidebar();
    
    // Update legend UI manually
    document.getElementById('legendVariable').textContent = this.activeMode.toUpperCase() + ' (' + this.prettyVar(this.activeVar) + ')';
    if (vizVar === 'temperature_anomaly') {
      document.getElementById('legendBar').style.background = 'linear-gradient(90deg, #06349e, #4b9fe8, #ffffff, #ffa060, #b60018)';
    }
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
    while(this.markersGroup.children.length > 0) {
        this.markersGroup.remove(this.markersGroup.children[0]);
    }
    while(this.regionsGroup.children.length > 0) {
        this.regionsGroup.remove(this.regionsGroup.children[0]);
    }
  }
  
  renderArgoMarkers(observations) {
    if (!this.water) return;
    const bounds = this.water.bounds;
    const midLat = (bounds[2]+bounds[3])/2;
    const midLon = (bounds[0]+bounds[1])/2;
    const klon = 111.32 * Math.cos(midLat*Math.PI/180);
    
    observations.forEach(obs => {
      const glider = gliderRegex.test(obs.platform||'');
      const x = (obs.latitude-midLat)*111.32;
      const z = (obs.longitude-midLon)*klon;
      
      const marker = new THREE.Mesh(
          new THREE.SphereGeometry(1.5, 16, 16),
          new THREE.MeshStandardMaterial({color: glider ? 0x22d3ee : 0xf59e0b})
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
      // only show anomalies close to active depth (within 50m)
      if (Math.abs(an.depth - this.activeDepth) > 50) return;
      
      const x = (an.latitude-midLat)*111.32;
      const z = (an.longitude-midLon)*klon;
      const marker = new THREE.Mesh(
          new THREE.SphereGeometry(2.0, 16, 16),
          new THREE.MeshBasicMaterial({color: an.severity === 'HIGH' ? 0xff0000 : 0xffa500})
      );
      marker.position.set(x, this.scene.sceneManager.depthY(an.depth) + 1, z);
      marker.userData = { isArgoFloat: true, float: an };
      this.markersGroup.add(marker);
    });
    this.scene.layers.observations = { group: this.markersGroup };
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
              color: reg.severity === 'CRITICAL' ? 0xff0000 : 0xffa500,
              transparent: true,
              opacity: 0.4,
              wireframe: true
          })
      );
      box.position.set(cx, 0, cz);
      box.userData = { isAnomalyHighlight: true, anomalyRegionId: reg.id, region: reg };
      this.markersGroup.add(box);
    });
    this.scene.layers.observations = { group: this.markersGroup };
  }

  updateSidebar() {
    const sb = document.getElementById('sidebarContent');
    if (this.activeMode === 'anomaly') {
      let html = `<div class="sidebar-title">ANOMALY MODE</div>`;
      if (this.selectedObservation) {
        const o = this.selectedObservation;
        html += `
          <div class="sidebar-row"><label>Variable</label><span>${this.prettyVar(o.variable||this.activeVar)}</span></div>
          <div class="sidebar-row"><label>Depth</label><span>${o.depth} m</span></div>
          <div class="sidebar-row"><label>Severity</label><span>${o.severity}</span></div>
          <div class="sidebar-row"><label>Difference</label><span>${(o.difference||0).toFixed(2)}</span></div>
        `;
      } else {
        html += `<div class="sidebar-content">Select an anomaly marker in the 3D view to inspect details. Time evolution is active.</div>`;
      }
      sb.innerHTML = html;
    } else if (this.activeMode === 'abnormal') {
      let html = `<div class="sidebar-title">ABNORMAL REGION</div>`;
      if (this.selectedRegion) {
        const r = this.selectedRegion;
        html += `
          <div class="sidebar-row"><label>Region ID</label><span>${r.name || r.id}</span></div>
          <div class="sidebar-row"><label>Variable</label><span>${this.prettyVar(r.variable)}</span></div>
          <div class="sidebar-row"><label>Severity</label><span>${r.severity}</span></div>
          <div class="sidebar-row"><label>Depth Range</label><span>${r.depth_range_m[0]}m - ${r.depth_range_m[1]}m</span></div>
        `;
      } else {
        html += `<div class="sidebar-content">Select a region bounding box to view details.</div>`;
      }
      sb.innerHTML = html;
    } else if (this.activeMode === 'model_argo') {
      let html = `<div class="sidebar-title">MODEL VS ARGO</div>`;
      const modelStats = this.modelVsArgoCache[this.activeTime];
      if (modelStats && modelStats.overall_rmse != null) {
        html += `
          <div class="sidebar-row"><label>RMSE</label><span>${modelStats.overall_rmse.toFixed(3)}</span></div>
          <div class="sidebar-row"><label>Bias</label><span>${modelStats.overall_bias.toFixed(3)}</span></div>
          <div class="sidebar-row"><label>MAE</label><span>${modelStats.overall_mae.toFixed(3)}</span></div>
          <div class="sidebar-row"><label>Soundings</label><span>${modelStats.total_sounding_points}</span></div>
        `;
      } else {
        html += `<div class="sidebar-content">Loading or unavailable for this timestamp/variable.</div>`;
      }
      if (this.selectedObservation) {
         html += `<div class="sidebar-row" style="margin-top:20px"><label>Selected Observation</label><span>${this.selectedObservation.wmo || this.selectedObservation.id}</span></div>`;
      }
      sb.innerHTML = html;
    } else {
      sb.innerHTML = `<div class="sidebar-title">${this.activeMode.toUpperCase()}</div><div class="sidebar-content">Select parameters or points to analyze.</div>`;
    }
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

  togglePlay() {
    const b = document.getElementById('timelinePlay');
    if (this.playTimer) {
      clearInterval(this.playTimer);
      this.playTimer = null;
      b.textContent = 'PLAY';
    } else {
      if (!this.timeline.length) return;
      b.textContent = 'PAUSE';
      this.playTimer = setInterval(() => {
        this.selectTime((this.index + 1) % this.timeline.length);
      }, 1200);
    }
  }
}

new AnalysisPage().init().catch(e => {
  console.error(e);
});
