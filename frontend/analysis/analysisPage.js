// SolvX — Standalone Ocean Analysis Page
import * as THREE from 'three';
import { ApiClient } from '../api/apiClient.js';
import { OceanScene } from '../scene/oceanScene.js';
import { buildLand, buildIslands } from '../scene/land.js';
import { buildCoastline, buildEEZ } from '../scene/coastline.js';
import { buildSeabed } from '../scene/seabed.js';
import { buildVegetation } from '../scene/vegetation.js';
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
  constructor(){
    this.bbox={...DEFAULT_BBOX}; this.scene=null; this.water=null; this.scalarViz=null;
    this.observations=[]; this.activeVar='ocean_temperature'; this.activeTime=null;
    this.activeDepth=0; this.activeMode='volume'; this.timeline=[]; this.index=0;
    this.bundleCache={}; this.reqSeq=0; this.playTimer=null;
  }
  async init(){
    this.renderShell(); this.bindUI(); this.setStatus('Loading analysis dataset…');
    await Promise.all([this.loadTerrain(),this.loadObservations(),this.loadTimeline()]);
    if (this.water && this.observations.length) {
      this.buildObservationMarkers(this.observations, this.water.bounds);
    }
    await this.selectTime(this.index,false);
    this.setStatus('Analysis ready');
  }
  renderShell(){
    document.body.innerHTML=`
    <div class="analysis-page">
      <header class="analysis-topbar"><a href="/" class="analysis-back">← SOLVX VIEWER</a><div><div class="analysis-brand">SOLVX / OCEAN ANALYSIS</div><div class="analysis-context">Bay of Bengal · standalone scientific workspace</div></div><div id="analysisStatus" class="analysis-status">Initializing…</div></header>
      <section class="analysis-toolbar">
        <label>VARIABLE <select id="analysisVariable"><option value="ocean_temperature">Temperature</option><option value="salinity">Salinity</option><option value="temperature_anomaly">Temperature anomaly</option><option value="chlorophyll">Chlorophyll</option><option value="sea_level">Sea level</option><option value="currents">Currents</option></select></label>
        <label>DEPTH <input id="analysisDepth" type="number" min="0" value="0" step="1"><span>m</span></label>
        <div class="analysis-actions"><button data-view="top">TOP</button><button data-view="3d" class="active">3D</button><button data-view="under">UNDER</button></div>
        <div id="analysisDate" class="analysis-date">—</div>
      </section>
      <main class="analysis-main">
        <section class="analysis-stage"><canvas id="analysisCanvas"></canvas><div class="analysis-overlay analysis-field"><div class="eyebrow">ACTIVE FIELD</div><strong id="legendVariable">Temperature</strong><div id="legendUnits">—</div><div id="legendRange">—</div><div class="analysis-gradient"></div></div><div class="analysis-overlay analysis-obs-key"><div><span class="legend-dot argo"></span>ARGO</div><div><span class="legend-dot glider"></span>GLIDER</div></div></section>
        <aside class="analysis-sidebar">
          <section class="analysis-card"><div class="card-title">TIME-SYNCED OCEAN STATE</div><div class="metric-grid"><div><small>DATE</small><strong id="metricDate">—</strong></div><div><small>VARIABLE</small><strong id="metricVar">—</strong></div><div><small>MIN</small><strong id="metricMin">—</strong></div><div><small>MAX</small><strong id="metricMax">—</strong></div><div><small>MEAN</small><strong id="metricMean">—</strong></div><div><small>UNITS</small><strong id="metricUnits">—</strong></div></div></section>
          <section class="analysis-card"><div class="card-title">OBSERVATION LOCATIONS</div><div class="metric-grid"><div><small>ARGO</small><strong id="argoCount">0</strong></div><div><small>GLIDERS</small><strong id="gliderCount">0</strong></div></div><div id="obsList" class="obs-list"></div></section>
          <section class="analysis-card"><div class="card-title">MODEL vs ARGO · SELECTED DATE</div><div class="metric-grid"><div><small>RMSE</small><strong id="rmse">—</strong></div><div><small>BIAS</small><strong id="bias">—</strong></div><div><small>MAE</small><strong id="mae">—</strong></div><div><small>SOUNDINGS</small><strong id="soundings">—</strong></div></div></section>
          <section class="analysis-card"><div class="card-title">ANOMALIES · SELECTED DATE</div><div id="anomalyText">Loading…</div></section>
        </aside>
      </main>
      <footer class="analysis-timeline"><div class="timeline-head"><div><div class="eyebrow">TIMELINE</div><strong id="timelineLabel">—</strong></div><div class="timeline-controls"><button id="timelinePrev">PREV</button><button id="timelinePlay">PLAY</button><button id="timelineNext">NEXT</button></div></div><input id="analysisSlider" type="range" min="0" max="0" value="0"><div class="timeline-scale"><span id="timelineStart">—</span><span id="timelineEnd">—</span></div></footer>
    </div>`;
  }
  bindUI(){
    document.getElementById('analysisVariable').addEventListener('change',async e=>{this.activeVar=e.target.value;this.index=0;await this.loadTimeline();await this.selectTime(0);});
    document.getElementById('analysisDepth').addEventListener('change',async e=>{this.activeDepth=Math.max(0,Number(e.target.value)||0);await this.selectTime(this.index);});
    document.querySelectorAll('.analysis-actions button').forEach(b=>b.addEventListener('click',()=>this.setView(b.dataset.view)));
    document.getElementById('analysisSlider').addEventListener('input',e=>this.selectTime(Number(e.target.value)));
    document.getElementById('timelinePrev').addEventListener('click',()=>this.selectTime(Math.max(0,this.index-1)));
    document.getElementById('timelineNext').addEventListener('click',()=>this.selectTime(Math.min(this.timeline.length-1,this.index+1)));
    document.getElementById('timelinePlay').addEventListener('click',()=>this.togglePlay());
  }
  async loadTerrain(){
    const [geo,bathy,eez]=await Promise.all([ApiClient.getDataGeometry(this.bbox),ApiClient.getDataBathymetry(this.bbox,'medium'),ApiClient.getDataEEZ(this.bbox).catch(()=>({features:[],lines3d:[]}))]);
    this.scene=new OceanScene(document.getElementById('analysisCanvas'),{onOceanClick:cell=>this.setStatus(`Point ${Number(cell.lat).toFixed(3)}°, ${Number(cell.lon).toFixed(3)}°`),onFloatClick:obs=>this.setStatus(`${gliderRegex.test(obs?.platform||'')?'Glider':'Argo'} ${obs?.wmo||obs?.id} selected`)});
    this.scene.onUpdate(() => this.updateObservationScale());
    this.scene.setLayer('land',buildLand(geo,this.scene));this.scene.setLayer('coastline',buildCoastline(geo));this.scene.setLayer('islands',buildIslands(geo,this.scene));this.scene.setLayer('eez',buildEEZ(geo,eez));
    const seabed=buildSeabed(bathy,this.scene);if(seabed)this.scene.setLayer('seabed',seabed);
    const veg=buildVegetation(bathy,this.scene);if(veg)this.scene.root.add(veg);
    this.water=new DynamicWater(bathy,this.scene);this.scene.setLayer('water',this.water.group);this.scalarViz=new ScalarVisualizer(this.water);
    this.scene.fitCamera();
  }
  updateObservationScale(){
    const group=this.scene?.layers?.observations?.group;
    const camera=this.scene?.camera;
    if(!group || !camera)return;
    const distance=Math.max(120,camera.position.distanceTo(this.scene.controls?.target || new THREE.Vector3()));
    const scale=THREE.MathUtils.clamp(distance/900,0.85,2.8);
    group.children.forEach(marker=>marker.scale.setScalar(scale));
  }
  async loadObservations(){
    const res=await ApiClient.getArgoObservations(this.bbox).catch(()=>({observations:[]}));
    this.observations=res.observations||[];
    this.renderObservationCounts();
  }
  renderObservationCounts(){
    const argo=this.observations.filter(o=>!gliderRegex.test(o.platform||'')), gl=this.observations.filter(o=>gliderRegex.test(o.platform||''));
    document.getElementById('argoCount').textContent=argo.length;document.getElementById('gliderCount').textContent=gl.length;
    document.getElementById('obsList').innerHTML=this.observations.map(o=>`<div class="obs-row"><span>${gliderRegex.test(o.platform||'')?'GLIDER':'ARGO'} · ${o.wmo||o.id}</span><span>${Number(o.latitude).toFixed(2)}°, ${Number(o.longitude).toFixed(2)}°</span></div>`).join('');
  }
  buildObservationMarkers(observations,bounds){
    const group=new THREE.Group(),midLat=(bounds[2]+bounds[3])/2,midLon=(bounds[0]+bounds[1])/2,klon=111.32*Math.cos(midLat*Math.PI/180);
    observations.forEach(obs=>{
      const glider=gliderRegex.test(obs.platform||''),x=(obs.latitude-midLat)*111.32,z=(obs.longitude-midLon)*klon;
      const marker=new THREE.Group();marker.position.set(x,5,z);marker.userData={isArgoFloat:true,float:obs};
      const shaft=new THREE.Mesh(new THREE.CylinderGeometry(glider?1.0:1.5,glider?1.0:1.5,glider?7:5,20),new THREE.MeshStandardMaterial({color:glider?0x22d3ee:0xf59e0b,emissive:glider?0x0891b2:0xb45309,emissiveIntensity:0.8}));shaft.userData={isArgoFloat:true,float:obs};marker.add(shaft);
      const beacon=new THREE.Mesh(new THREE.SphereGeometry(glider?1.2:1.0,16,16),new THREE.MeshStandardMaterial({color:glider?0x67e8f9:0xfcd34d,emissive:glider?0x0891b2:0xb45309,emissiveIntensity:1.0}));beacon.position.y=glider?4:3;beacon.userData={isArgoFloat:true,float:obs};marker.add(beacon);
      const halo=new THREE.Mesh(new THREE.RingGeometry(glider?2.8:2.4,glider?3.5:3.1,28),new THREE.MeshBasicMaterial({color:glider?0x67e8f9:0xfcd34d,transparent:true,opacity:0.95,side:THREE.DoubleSide}));halo.rotation.x=Math.PI/2;halo.userData={isArgoFloat:true,float:obs};marker.add(halo);
      group.add(marker);
    });
    this.scene.layers.observations={group};this.scene.root.add(group);
  }
  async loadTimeline(){const res=await ApiClient.getDataTimeline({variable:this.activeVar,bbox:this.bbox}).catch(()=>({available_timestamps:[]}));this.timeline=res.available_timestamps||[];const s=document.getElementById('analysisSlider');s.max=String(Math.max(0,this.timeline.length-1));document.getElementById('timelineStart').textContent=this.timeline[0]?.slice(0,10)||'—';document.getElementById('timelineEnd').textContent=this.timeline.at(-1)?.slice(0,10)||'—';}
  async selectTime(i,fetchAnalysis=true){
    if(!this.timeline.length)return;this.index=Math.max(0,Math.min(i,this.timeline.length-1));const time=this.timeline[this.index];this.activeTime=time;document.getElementById('analysisSlider').value=String(this.index);
    const d=new Date(time);const dateText=`${d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})} ${d.toISOString().slice(11,16)} UTC`;document.getElementById('analysisDate').textContent=dateText;document.getElementById('timelineLabel').textContent=dateText;document.getElementById('metricDate').textContent=dateText;this.setStatus(`Loading ${dateText}…`);
    const id=++this.reqSeq;let vars=this.bundleCache[time];if(!vars){const bundle=await ApiClient.getOceanBundle({provider:'auto',bbox:this.bbox,time,stride:1});vars=bundle?.variables||{};this.bundleCache[time]=vars;}if(id!==this.reqSeq)return;
    if(this.activeVar==='currents'){this.setStatus('Current-vector field selected');}
    const data=this.resolveVar(vars,this.activeVar);this.updateDataMetrics(data);
    if(data)this.scalarViz.apply(this.activeVar,data,this.activeDepth,this.activeMode);else this.scalarViz.apply(this.activeVar,null,this.activeDepth,this.activeMode);
    await this.updateAnalysis(time);this.setStatus(`Analysis synchronized · ${dateText}`);
  }
  resolveVar(vars,id){if(vars[id]&&!vars[id].error)return vars[id];for(const k of(alias[id]||[])){if(vars[k]&&!vars[k].error)return vars[k];}return null;}
  updateDataMetrics(data){
    const values=this.flattenFinite(data?.values),fmt=v=>v==null?'—':Number(v).toFixed(3),min=values.length?Math.min(...values):null,max=values.length?Math.max(...values):null,mean=values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
    document.getElementById('metricVar').textContent=this.prettyVar(this.activeVar);document.getElementById('metricMin').textContent=fmt(min);document.getElementById('metricMax').textContent=fmt(max);document.getElementById('metricMean').textContent=fmt(mean);document.getElementById('metricUnits').textContent=data?.units||'—';document.getElementById('legendVariable').textContent=this.prettyVar(this.activeVar);document.getElementById('legendUnits').textContent=data?.units||'—';document.getElementById('legendRange').textContent=`${fmt(min)} → ${fmt(max)}`;
  }
  flattenFinite(v){const out=[];const walk=x=>Array.isArray(x)?x.forEach(walk):Number.isFinite(Number(x))?out.push(Number(x)):null;walk(v);return out;}
  async updateAnalysis(time){
    const supported = new Set(['ocean_temperature','temperature','salinity']);
    if (!supported.has(this.activeVar)) {
      document.getElementById('rmse').textContent='—';
      document.getElementById('bias').textContent='—';
      document.getElementById('mae').textContent='—';
      document.getElementById('soundings').textContent='—';
      document.getElementById('anomalyText').textContent='Date-synced model/Argo analysis is available for temperature and salinity.';
      return;
    }
    const variable=this.activeVar==='ocean_temperature'?'temperature':this.activeVar;
    const params={min_lat:this.bbox.min_lat,max_lat:this.bbox.max_lat,min_lon:this.bbox.min_lon,max_lon:this.bbox.max_lon,time};
    const [summary,an]=await Promise.allSettled([
      ApiClient.getModelVsArgo({...params,variable}),
      ApiClient.getAnomalies({...params,variable})
    ]);
    const ma=summary.value?.model_accuracy||{};
    document.getElementById('rmse').textContent=ma.overall_rmse!=null?Number(ma.overall_rmse).toFixed(3):'—';
    document.getElementById('bias').textContent=ma.overall_bias!=null?Number(ma.overall_bias).toFixed(3):'—';
    document.getElementById('mae').textContent=ma.overall_mae!=null?Number(ma.overall_mae).toFixed(3):'—';
    document.getElementById('soundings').textContent=ma.total_sounding_points??'—';
    document.getElementById('anomalyText').textContent=an.value?.count?(`${an.value.count} anomalous depth observations detected for this timestamp.`):'No anomalous depth observations reported for this timestamp.';
  }
  prettyVar(v){return ({ocean_temperature:'Temperature',temperature:'Temperature',salinity:'Salinity',temperature_anomaly:'Temperature anomaly',chlorophyll:'Chlorophyll',sea_level:'Sea level',currents:'Currents'})[v]||v.replaceAll('_',' ');}
  setView(v){document.querySelectorAll('.analysis-actions button').forEach(b=>b.classList.toggle('active',b.dataset.view===v));this.scene?.setView(v);}
  setStatus(t){const e=document.getElementById('analysisStatus');if(e)e.textContent=t;}
  togglePlay(){
    const b=document.getElementById('timelinePlay');
    if(this.playTimer){clearInterval(this.playTimer);this.playTimer=null;b.textContent='PLAY';return;}
    if(!this.timeline.length)return;
    b.textContent='PAUSE';
    this.playTimer=setInterval(()=>this.selectTime((this.index+1)%this.timeline.length),1200);
  }
}
new AnalysisPage().init().catch(e=>{console.error(e);document.body.innerHTML=`<pre style="padding:24px;color:#ffb4b4;background:#061018">Analysis page failed: ${e.message}</pre>`;});