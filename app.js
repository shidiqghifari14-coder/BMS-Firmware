import {CSV_HEADER,csvRow,SampleTracker} from './log-format.js';

const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const fmt=(v,d=1)=>Number.isFinite(v)?Number(v).toFixed(d):'—';
const pad=n=>String(n||0).padStart(3,'0');
const tracker=new SampleTracker();
const state={view:'overview',scenario:'drive',source:'demo',connected:false,recording:false,rows:[],seq:0,history:[],frame:null,lastReceived:Date.now(),pollTimer:null,serialPort:null};

const meta={
  overview:['Ringkasan pack','Seluruh kondisi baterai, dalam satu pandangan.'],
  cells:['Sel baterai','Pantau 140 posisi sel seri, deviasi, balancing, dan kualitas data.'],
  trends:['Grafik telemetry','Riwayat tegangan pack, arus, daya, dan temperatur.'],
  energy:['SOC & energi','State of charge, state of health, dan energi tersisa.'],
  thermal:['Temperatur','Kanal temperatur per modul dan status termal pack.'],
  diagnostics:['Diagnostik','Status komunikasi, interlock, isolasi, contactor, dan fault.'],
  logging:['Perekaman','Rekam sampel telemetry ke CSV untuk analisis engineering.'],
  guide:['Panduan','Koneksi, kontrak data, dan batas kewenangan HMI.']
};

function demoFrame(){
  const t=Date.now(),p=t/1000,cells=[],temperatures=[];
  for(let i=0;i<140;i++){
    let v=3.89+0.012*Math.sin(i*.71+p*.08)+0.006*Math.sin(i*.17);
    if(state.scenario==='imbalance'&&i===31)v-=.09;
    if(state.scenario==='balance'&&i%19===0)v+=.025;
    const st=v<3||v>4.2?'fault':(v<3.4||v>4.1?'warning':'ok');
    cells.push({id:i+1,voltageV:v,balancing:state.scenario==='balance'&&i%19===0,status:st});
  }
  for(let i=0;i<240;i++){
    const m=Math.floor(i/24)+1,ch=i%24+1;
    let c=m<=8?29+2.4*Math.sin(i*.19+p*.03):null;
    if(state.scenario==='thermal'&&m===4&&ch===9)c=61.8;
    temperatures.push({moduleId:m,channel:ch,celsius:c,status:c==null?'unknown':(c>=60?'fault':(c>=50?'warning':'ok'))});
  }
  let current=33.5+3*Math.sin(p*.15);
  if(state.scenario==='balance')current=1.8;
  if(state.scenario==='offline')current=0;
  const faults=[];
  if(state.scenario==='imbalance')faults.push({code:'CELL_DELTA',severity:'warning',message:'Cell deviation demo'});
  if(state.scenario==='thermal')faults.push({code:'OT',severity:'fault',message:'Overtemperature demo M04-T09'});
  if(state.scenario==='comms')faults.push({code:'COMMS',severity:'fault',message:'Communication fault demo'});
  if(state.scenario==='offline')faults.push({code:'OFFLINE',severity:'fault',message:'Connection loss demo'});
  return {
    sourceSessionId:'demo',sequence:state.seq++,timestampMs:t,timestampBasis:'host_demo',quality:'simulated',
    cells:cells,localVoltageMv:Array(48).fill(null),temperatures:temperatures,
    modules:Array.from({length:10},(_,i)=>({id:i+1,label:'M'+String(i+1).padStart(2,'0'),installed:i<8})),
    currentA:current,rawCurrentA:current,socPct:78.4,sohPct:98.2,remainingKwh:8.62,capacityAh:24,cycles:42,voltageMapping:'demo_140s',
    system:{contactor:state.scenario==='offline'?'OPEN':'CLOSED',interlock:'OK',isolation:'OK',canErrorCount:state.scenario==='comms'?7:0,pecErrorCount:state.scenario==='comms'?3:0},
    faults:faults
  };
}

function normalize(x){
  const now=Date.now(),cells=[];
  for(let i=0;i<140;i++){
    const r=Array.isArray(x.cells)?x.cells[i]:null;
    const v=typeof r==='number'?r:Number(r&&((r.voltageV!==undefined)?r.voltageV:r.voltage));
    cells.push({id:i+1,voltageV:Number.isFinite(v)?v:null,balancing:r&&r.balancing!==undefined?r.balancing:null,status:r&&r.status?r.status:(Number.isFinite(v)?'ok':'unknown')});
  }
  let temps=Array.isArray(x.temperatures)?x.temperatures:[];
  temps=temps.map((v,i)=>typeof v==='number'?{moduleId:Math.floor(i/24)+1,channel:i%24+1,celsius:v,status:'ok'}:v);
  return {
    sourceSessionId:x.sourceSessionId||'external',sequence:x.sequence!==undefined?x.sequence:state.seq++,timestampMs:Number(x.timestampMs)||now,timestampBasis:x.timestampBasis||'device_or_host',quality:x.quality||'reported',
    cells:cells,localVoltageMv:Array.isArray(x.localVoltageMv)?x.localVoltageMv:Array(48).fill(null),temperatures:temps,
    modules:x.modules||Array.from({length:10},(_,i)=>({id:i+1,label:'M'+String(i+1).padStart(2,'0'),installed:true})),
    currentA:Number.isFinite(Number(x.currentA))?Number(x.currentA):null,rawCurrentA:Number.isFinite(Number(x.rawCurrentA))?Number(x.rawCurrentA):null,
    socPct:Number.isFinite(Number(x.socPct))?Number(x.socPct):null,sohPct:Number.isFinite(Number(x.sohPct))?Number(x.sohPct):null,remainingKwh:Number.isFinite(Number(x.remainingKwh))?Number(x.remainingKwh):null,
    capacityAh:Number.isFinite(Number(x.capacityAh))?Number(x.capacityAh):null,cycles:Number.isFinite(Number(x.cycles))?Number(x.cycles):null,voltageMapping:x.voltageMapping||'external',
    system:{contactor:x.system&&x.system.contactor||'UNKNOWN',interlock:x.system&&x.system.interlock||'UNKNOWN',isolation:x.system&&x.system.isolation||'UNKNOWN',canErrorCount:Number(x.system&&x.system.canErrorCount||0),pecErrorCount:Number(x.system&&x.system.pecErrorCount||0)},
    faults:Array.isArray(x.faults)?x.faults:[]
  };
}

function stats(f){
  const vals=f.cells.map(c=>c.voltageV).filter(Number.isFinite);
  const ts=f.temperatures.map(t=>t&&t.celsius).filter(Number.isFinite);
  const pack=vals.length===140?vals.reduce((a,b)=>a+b,0):null;
  const min=vals.length?Math.min.apply(null,vals):null,max=vals.length?Math.max.apply(null,vals):null,avg=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
  const minCell=min==null?null:f.cells.find(c=>c.voltageV===min).id,maxCell=max==null?null:f.cells.find(c=>c.voltageV===max).id;
  const maxT=ts.length?Math.max.apply(null,ts):null,minT=ts.length?Math.min.apply(null,ts):null;
  return {valid:vals.length,pack:pack,min:min,max:max,avg:avg,minCell:minCell,maxCell:maxCell,delta:min!=null&&max!=null?(max-min)*1000:null,tempValid:ts.length,maxT:maxT,minT:minT,tempSpread:maxT!=null&&minT!=null?maxT-minT:null,power:pack!=null&&Number.isFinite(f.currentA)?pack*f.currentA/1000:null};
}

function applyFrame(f){
  if(!tracker.accept(f))return;
  state.frame=f;state.lastReceived=Date.now();
  const s=stats(f);
  state.history.push({t:f.timestampMs,v:s.pack,i:f.currentA,p:s.power,temp:s.maxT});
  if(state.history.length>240)state.history.shift();
  if(state.recording)state.rows.push(csvRow(f,state.source,Date.now()));
  updateChrome();render();
}

function updateChrome(){
  const f=state.frame;if(!f)return;const s=stats(f);
  $('#packVoltage').innerHTML=fmt(s.pack,1)+'<small> V</small>';
  $('#validCount').textContent=s.valid+' / 140 cells';
  $('#packCurrent').innerHTML=fmt(f.currentA,1)+'<small> A</small>';
  $('#currentDirection').textContent=!Number.isFinite(f.currentA)?'No data':f.currentA>0?'Discharging':f.currentA<0?'Charging':'Idle';
  $('#packPower').textContent=fmt(s.power,2)+' kW';
  $('#cellDelta').innerHTML=fmt(s.delta,0)+'<small> mV</small>';
  $('#cellExtrema').textContent=s.minCell&&s.maxCell?'C'+pad(s.minCell)+' → C'+pad(s.maxCell):'C000 → C000';
  $('#maxTemperature').innerHTML=fmt(s.maxT,1)+'<small> °C</small>';
  $('#temperatureCount').textContent=s.tempValid+' / 240 kanal';
  $('#temperatureRange').textContent=fmt(s.tempSpread,1)+' °C spread';
  const hard=f.faults.some(x=>x.severity==='fault'),warn=f.faults.length&&!hard,r=$('#statusRibbon');
  r.classList.toggle('fault',hard);r.classList.toggle('warning',!!warn);
  $('#statusIcon').textContent=hard?'!':warn?'△':'✓';
  $('#packStatus').textContent=hard?'Fault aktif':warn?'Peringatan aktif':state.source==='demo'?'Demo berjalan normal':'Telemetry diterima';
  $('#statusDetail').textContent=f.faults.length?f.faults.map(x=>x.message||x.code).join(' · '):(state.source==='demo'?'Menampilkan data simulasi · belum terhubung ke BMS':'Sumber data terhubung');
  $('#sampleAge').textContent=state.source==='demo'?'DEMO':Math.max(0,Date.now()-state.lastReceived)+' ms';
  $('#faultBadge').textContent=f.faults.length;
  $('#connectionLabel').innerHTML='<i class="dot '+(hard?'red':state.connected?'green':'amber')+'"></i>'+(state.source==='demo'?'DEMO':state.connected?'LIVE':'OFFLINE');
  $('#sideSource').textContent=state.source==='demo'?'Demo telemetry':state.source==='serial'?'USB serial STM':state.source==='stream'?'HTTP stream':'HTTP polling';
  $('#sourceDescription').textContent=state.source==='demo'?'Eksplorasi tanpa hardware':'Telemetry aktif';
  $('#sourceProfile').textContent=state.source==='demo'?'SIMULATED TELEMETRY · 140S demo model · bukan pembacaan hardware':'LIVE SOURCE · '+state.source.toUpperCase()+' · '+f.timestampBasis;
}

function cellGrid(f){return '<div class="cell-grid">'+f.cells.map(c=>'<button class="cell '+(c.status||'unknown')+'" data-cell="'+c.id+'"><span>'+pad(c.id)+'</span><strong>'+(Number.isFinite(c.voltageV)?c.voltageV.toFixed(3):'—')+'</strong></button>').join('')+'</div>'}
function energyCard(f){return '<section class="panel soc-panel"><div class="panel-title">State of charge</div><div class="soc-main"><strong>'+fmt(f.socPct,1)+'</strong><small> %</small><p>'+(state.source==='demo'?'Simulasi':'Reported/estimated')+'</p><div class="soc-bar"><span style="width:'+Math.max(0,Math.min(100,f.socPct||0))+'%"></span></div></div><div class="detail-row"><span>Energi tersisa</span><b>'+fmt(f.remainingKwh,2)+' kWh</b></div><div class="detail-row"><span>State of health</span><b>'+fmt(f.sohPct,1)+' %</b></div><div class="detail-row"><span>Cycle count</span><b>'+(f.cycles==null?'—':f.cycles)+'</b></div></section>'}
function systemCard(f){return '<section class="panel"><div class="panel-head"><div><div class="panel-title">Status sistem</div><div class="panel-subtitle">'+state.source.toUpperCase()+'</div></div></div><div class="panel-body"><div class="check-row"><span>HV contactor</span><b>'+f.system.contactor+'</b></div><div class="check-row"><span>HV interlock</span><b>'+f.system.interlock+'</b></div><div class="check-row"><span>Isolation</span><b>'+f.system.isolation+'</b></div><div class="check-row"><span>CAN errors</span><b>'+f.system.canErrorCount+'</b></div><div class="check-row"><span>isoSPI / PEC errors</span><b>'+f.system.pecErrorCount+'</b></div></div></section>'}
function overview(f,s){return '<div class="overview-grid"><section class="panel"><div class="panel-head"><div><div class="panel-title">Tegangan seluruh sel</div><div class="panel-subtitle">140 sel seri · pilih sel untuk detail</div></div><span class="tag">'+(s.valid===140?'140S':'PARTIAL')+'</span></div><div class="cell-summary"><span>MINIMUM<b>'+fmt(s.min,3)+' V</b></span><span>AVERAGE<b>'+fmt(s.avg,3)+' V</b></span><span>MAXIMUM<b>'+fmt(s.max,3)+' V</b></span><span>BALANCING<b>'+f.cells.filter(c=>c.balancing).length+' sel</b></span></div>'+cellGrid(f)+'</section><div class="stack">'+energyCard(f)+systemCard(f)+'</div></div>'}
function cellsView(f,s){return '<section class="panel"><div class="panel-head"><div><div class="panel-title">Cell map 140S</div><div class="panel-subtitle">Urutan visual C001–C140 · bukan pemetaan modul mekanis.</div></div><span class="tag">Δ '+fmt(s.delta,0)+' mV</span></div><div class="cell-summary"><span>VALID<b>'+s.valid+'/140</b></span><span>MIN<b>C'+pad(s.minCell)+' · '+fmt(s.min,3)+' V</b></span><span>MAX<b>C'+pad(s.maxCell)+' · '+fmt(s.max,3)+' V</b></span><span>AVG<b>'+fmt(s.avg,3)+' V</b></span></div>'+cellGrid(f)+'</section>'}
function pathFor(key){const d=state.history.slice(-120).filter(x=>Number.isFinite(x[key]));if(d.length<2)return '';const vals=d.map(x=>x[key]),mn=Math.min.apply(null,vals),mx=Math.max.apply(null,vals),sp=mx-mn||1;return d.map((x,i)=>(i?'L':'M')+' '+((i/(d.length-1))*720)+' '+(190-((x[key]-mn)/sp)*190)).join(' ')}
function trendsView(f,s){return '<section class="panel"><div class="panel-head"><div><div class="panel-title">Telemetry history</div><div class="panel-subtitle">Buffer lokal · '+state.history.length+' sampel</div></div></div><div class="trend-grid"><div><div class="trend-stat">'+fmt(s.pack,1)+' <small>V pack</small></div><div class="chart-wrap"><svg viewBox="0 0 720 200" class="chart"><path class="trace-a" d="'+pathFor('v')+'"/></svg></div></div><div><div class="trend-stat">'+fmt(f.currentA,1)+' <small>A current</small></div><div class="chart-wrap"><svg viewBox="0 0 720 200" class="chart"><path class="trace-b" d="'+pathFor('i')+'"/></svg></div></div><div><div class="trend-stat">'+fmt(s.power,2)+' <small>kW power</small></div><div class="chart-wrap"><svg viewBox="0 0 720 200" class="chart"><path class="trace-a" d="'+pathFor('p')+'"/></svg></div></div><div><div class="trend-stat">'+fmt(s.maxT,1)+' <small>°C Tmax</small></div><div class="chart-wrap"><svg viewBox="0 0 720 200" class="chart"><path class="trace-b" d="'+pathFor('temp')+'"/></svg></div></div></div></section>'}
function energyView(f,s){return '<div class="bottom-grid">'+energyCard(f)+'<section class="panel"><div class="panel-head"><div><div class="panel-title">Power & energy context</div></div></div><div class="panel-body"><div class="detail-row"><span>Pack voltage</span><b>'+fmt(s.pack,1)+' V</b></div><div class="detail-row"><span>Pack current</span><b>'+fmt(f.currentA,1)+' A</b></div><div class="detail-row"><span>Pack power</span><b>'+fmt(s.power,2)+' kW</b></div><div class="detail-row"><span>Capacity</span><b>'+fmt(f.capacityAh,1)+' Ah</b></div></div></section></div>'}
function thermalView(f,s){let cards='';for(let m=1;m<=10;m++){const a=f.temperatures.filter(t=>t.moduleId===m),v=a.filter(t=>Number.isFinite(t.celsius)),mx=v.length?Math.max.apply(null,v.map(t=>t.celsius)):null,mn=v.length?Math.min.apply(null,v.map(t=>t.celsius)):null;let ch='';for(let c=1;c<=24;c++){const t=a.find(x=>x.channel===c);ch+='<div class="temp-card '+(t&&t.status||'unknown')+'"><small>T'+String(c).padStart(2,'0')+'</small><strong>'+fmt(t&&t.celsius,1)+'</strong></div>'}cards+='<article class="module-card"><div class="panel-head"><div><div class="panel-title">M'+String(m).padStart(2,'0')+'</div><div class="panel-subtitle">'+v.length+'/24 kanal</div></div><span class="tag">'+fmt(mx,1)+' °C</span></div><div class="module-range"><span>MIN<b>'+fmt(mn,1)+' °C</b></span><span>MAX<b>'+fmt(mx,1)+' °C</b></span></div><div class="thermal-channels">'+ch+'</div></article>'}return '<section class="panel"><div class="panel-head"><div><div class="panel-title">Thermal map</div><div class="panel-subtitle">'+s.tempValid+'/240 kanal valid · Tmax '+fmt(s.maxT,1)+' °C</div></div></div><div class="thermal-modules">'+cards+'</div></section>'}
function diagnosticsView(f,s){const faultHtml=f.faults.length?f.faults.map(x=>'<article class="fault-tile"><h3>'+(x.code||'FAULT')+'</h3><p>'+(x.message||'Fault reported')+'</p></article>').join(''):'<article class="fault-tile"><h3>NO ACTIVE FAULT</h3><p>Tidak ada fault yang dilaporkan.</p></article>';return '<section class="panel"><div class="panel-head"><div><div class="panel-title">System diagnostics</div></div></div><div class="fault-catalog">'+faultHtml+'</div></section>'+systemCard(f)+'<section class="panel"><div class="panel-head"><div><div class="panel-title">Data quality</div></div></div><div class="panel-body"><div class="detail-row"><span>Cell data valid</span><b>'+s.valid+'/140</b></div><div class="detail-row"><span>Temperature valid</span><b>'+s.tempValid+'/240</b></div><div class="detail-row"><span>Accepted samples</span><b>'+tracker.accepted+'</b></div><div class="detail-row"><span>Duplicates rejected</span><b>'+tracker.duplicates+'</b></div><div class="detail-row"><span>Out-of-order rejected</span><b>'+tracker.outOfOrder+'</b></div></div></section>'}
function loggingView(){return '<div class="logging-grid"><section class="panel"><div class="panel-head"><div><div class="panel-title">CSV recorder</div><div class="panel-subtitle">Setiap sampel baru disimpan sebagai satu baris.</div></div></div><div class="panel-body"><div class="record-actions"><button class="button primary" id="recordToggle">'+(state.recording?'Stop recording':'Start recording')+'</button><button class="button" id="downloadLog" '+(state.rows.length?'':'disabled')+'>Download CSV</button><button class="button danger" id="clearLog" '+(state.rows.length?'':'disabled')+'>Clear</button></div><div class="logger-stats"><div><span>STATUS</span><strong>'+(state.recording?'REC':'IDLE')+'</strong></div><div><span>SAMPLES</span><strong>'+state.rows.length+'</strong></div></div></div></section><section class="panel"><div class="panel-head"><div><div class="panel-title">Format</div></div></div><div class="panel-body"><p class="hint">CSV memuat 140 cell, 48 local UART voltage, 240 temperatur, timestamp, system status, dan fault.</p></div></section></div>'}
function guideView(){return '<section class="panel guide"><div class="panel-head"><div><div class="panel-title">Panduan penggunaan</div></div></div><div class="panel-body"><h3>Demo</h3><p>Mode demo adalah data sintetis untuk mengecek HMI, bukan pembacaan kendaraan.</p><h3>USB serial</h3><p>Gunakan Chrome/Edge desktop yang mendukung Web Serial. Versi ini menerima satu frame JSON per baris. Parser log STM khusus tetap dapat ditambahkan sebagai modul terpisah.</p><h3>HTTP</h3><p>HTTP stream memakai NDJSON. HTTP polling mengambil satu objek JSON setiap request.</p><h3>140S</h3><p>Pack voltage hanya dihitung jika seluruh 140 cell mempunyai data valid.</p><h3>Safety</h3><p>Web hanya HMI monitoring/diagnostics. Proteksi dan kendali akhir tetap di firmware BMS/vehicle.</p></div></section>'}

function render(){if(!state.frame)return;const f=state.frame,s=stats(f),m=meta[state.view];$('#pageTitle').textContent=m[0];$('#pageSubtitle').textContent=m[1];$$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));let h='';if(state.view==='overview')h=overview(f,s);if(state.view==='cells')h=cellsView(f,s);if(state.view==='trends')h=trendsView(f,s);if(state.view==='energy')h=energyView(f,s);if(state.view==='thermal')h=thermalView(f,s);if(state.view==='diagnostics')h=diagnosticsView(f,s);if(state.view==='logging')h=loggingView();if(state.view==='guide')h=guideView();$('#viewContent').innerHTML=h;bindDynamic()}

function bindDynamic(){
  $$('[data-cell]').forEach(b=>b.onclick=()=>openCell(Number(b.dataset.cell)));
  const rt=$('#recordToggle');if(rt)rt.onclick=()=>{state.recording=!state.recording;$('#recordRibbon').hidden=!state.recording;$('#recordRibbon').textContent=state.recording?'● RECORDING · sampel telemetry disimpan lokal':'';render()};
  const dl=$('#downloadLog');if(dl)dl.onclick=downloadLog;
  const cl=$('#clearLog');if(cl)cl.onclick=()=>{state.rows=[];render()};
}
function openCell(id){const c=state.frame.cells[id-1];$('#cellDialogContent').innerHTML='<div class="dialog-title"><h2>Cell C'+pad(id)+'</h2><button class="icon-button" id="closeCell">×</button></div><div class="cell-detail-grid"><div><span>Voltage</span><b>'+fmt(c.voltageV,3)+' V</b></div><div><span>Status</span><b>'+(c.status||'unknown')+'</b></div><div><span>Balancing</span><b>'+(c.balancing===true?'ON':c.balancing===false?'OFF':'—')+'</b></div><div><span>Mapping</span><b>'+state.frame.voltageMapping+'</b></div></div>';$('#cellDialog').showModal();$('#closeCell').onclick=()=>$('#cellDialog').close()}
function download(name,content,type){const blob=new Blob([content],{type:type||'text/csv'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
function downloadLog(){download('arjuna-bms-'+new Date().toISOString().replaceAll(':','-')+'.csv',CSV_HEADER+state.rows.join(''))}
function snapshot(){download('arjuna-bms-cell-snapshot.csv',['cell,voltage_V,status,balancing'].concat(state.frame.cells.map(c=>'C'+pad(c.id)+','+(c.voltageV??'')+','+(c.status||'')+','+(c.balancing??''))).join('\r\n'))}
function toast(msg){const t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,3000)}
function setSource(src,connected){state.source=src;state.connected=connected;updateChrome()}
function switchTransport(){const t=$('#transport').value;$('#networkFields').hidden=t==='serial';$('#serialFields').hidden=t!=='serial';$('#pollField').hidden=t!=='poll'}
function headers(){const h={'Accept':'application/json, application/x-ndjson'},tok=$('#token').value.trim();if(tok)h.Authorization='Bearer '+tok;return h}
async function connectSerial(){if(!('serial' in navigator))throw new Error('Web Serial tidak tersedia. Gunakan Chrome/Edge desktop.');const baud=$('#serialProfile').value==='g474'?1000000:115200,port=await navigator.serial.requestPort();await port.open({baudRate:baud,dataBits:8,stopBits:1,parity:'none',flowControl:'none'});state.serialPort=port;setSource('serial',true);$('#connectionDialog').close();toast('Serial connected · '+baud+' baud');const dec=new TextDecoderStream();port.readable.pipeTo(dec.writable).catch(()=>{});const reader=dec.readable.getReader();let buf='';(async()=>{try{while(true){const r=await reader.read();if(r.done)break;buf+=r.value;let p;while((p=buf.indexOf('\n'))>=0){const line=buf.slice(0,p).trim();buf=buf.slice(p+1);if(!line)continue;try{applyFrame(normalize(JSON.parse(line)))}catch(e){}}}}finally{reader.releaseLock();state.connected=false;updateChrome()}})()}
async function connectPoll(){const url=$('#endpoint').value.trim();if(!url)throw new Error('URL telemetry wajib diisi.');const once=async()=>{const r=await fetch(url,{headers:headers()});if(!r.ok)throw new Error('HTTP '+r.status);applyFrame(normalize(await r.json()))};await once();setSource('poll',true);$('#connectionDialog').close();state.pollTimer=setInterval(()=>once().catch(e=>toast(e.message)),Number($('#pollInterval').value)||1000)}
async function connectStream(){const url=$('#endpoint').value.trim();if(!url)throw new Error('URL telemetry wajib diisi.');const r=await fetch(url,{headers:headers()});if(!r.ok)throw new Error('HTTP '+r.status);setSource('stream',true);$('#connectionDialog').close();const reader=r.body.pipeThrough(new TextDecoderStream()).getReader();let buf='';(async()=>{while(true){const z=await reader.read();if(z.done)break;buf+=z.value;let p;while((p=buf.indexOf('\n'))>=0){const line=buf.slice(0,p).trim();buf=buf.slice(p+1);if(line)applyFrame(normalize(JSON.parse(line)))}}})().catch(e=>toast(e.message))}
async function submitConnection(e){e.preventDefault();$('#connectionError').textContent='';if(state.pollTimer)clearInterval(state.pollTimer);try{const t=$('#transport').value;if(t==='serial')await connectSerial();else if(t==='stream')await connectStream();else await connectPoll()}catch(err){$('#connectionError').textContent=err.message||String(err)}}

$$('.nav-item').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;render()});
$('#scenario').onchange=e=>{state.scenario=e.target.value;state.history=[];state.seq++;applyFrame(demoFrame())};
$('#exportButton').onclick=snapshot;
$('#connectButton').onclick=()=>$('#connectionDialog').showModal();
$('#sourceButton').onclick=()=>$('#connectionDialog').showModal();
$('#transport').onchange=switchTransport;
$('#connectionForm').onsubmit=submitConnection;
$('#demoButton').onclick=()=>{if(state.pollTimer)clearInterval(state.pollTimer);setSource('demo',false);$('#connectionDialog').close();applyFrame(demoFrame());toast('Demo mode aktif')};
$$('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close).close());
setInterval(()=>$('#clock').textContent=new Date().toLocaleTimeString('id-ID',{hour12:false}),500);
setInterval(()=>{if(state.source==='demo')applyFrame(demoFrame());else updateChrome()},250);
switchTransport();applyFrame(demoFrame());render();
