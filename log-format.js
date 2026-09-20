export const CSV_HEADER = [
  'source','source_session','sequence','timestamp_ms','timestamp_utc','received_ms','timestamp_basis','quality',
  'pack_voltage_V','current_A','raw_stm_current_A','soc_pct','soh_pct','remaining_kWh','capacity_Ah','cycles','voltage_mapping',
  ...Array.from({length:140},(_,i)=>`C${String(i+1).padStart(3,'0')}_V`),
  ...Array.from({length:48},(_,i)=>`UART_A_local_${String(i+1).padStart(2,'0')}_mV`),
  ...Array.from({length:240},(_,i)=>`M${String(Math.floor(i/24)+1).padStart(2,'0')}_T${String(i%24+1).padStart(2,'0')}_degC`),
  ...Array.from({length:10},(_,i)=>`M${String(i+1).padStart(2,'0')}_installed`),
  'module_labels_json','unmapped_temperatures_json','balancing_C001_C140','cell_status_C001_C140','temperature_status_M01_M10','contactor','interlock','isolation','can_errors','pec_errors','faults'
].join(',')+'\r\n';
// External strings are protected against CSV formula injection.
function field(v){if(v===null||v===undefined)return '';if(typeof v==='number'||typeof v==='boolean')return String(v);let s=String(v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export function csvRow(frame,source,receivedMs) {
  const byId=new Map(frame.cells.map(c=>[c.id,c]));
  const cells=Array.from({length:140},(_,i)=>byId.get(i+1));
  const complete=cells.every(c=>Number.isFinite(c?.voltageV));
  const temps=new Map(frame.temperatures.filter(t=>t.moduleId&&t.channel).map(t=>[(t.moduleId-1)*24+t.channel,t]));
  const row=[source,frame.sourceSessionId??'',frame.sequence??'',frame.timestampMs,new Date(frame.timestampMs).toISOString(),receivedMs,frame.timestampBasis??'device_utc',frame.quality??'reported',complete?cells.reduce((a,c)=>a+c.voltageV,0):null,frame.currentA,frame.rawCurrentA,frame.socPct,frame.sohPct,frame.remainingKwh,frame.capacityAh,frame.cycles,frame.voltageMapping??'gateway',...cells.map(c=>c?.voltageV),...Array.from({length:48},(_,i)=>frame.localVoltageMv?.[i]??null),...Array.from({length:240},(_,i)=>temps.get(i+1)?.celsius??null),...Array.from({length:10},(_,i)=>frame.modules?.find(m=>m.id===i+1)?.installed??null),JSON.stringify(frame.modules?.map(m=>({id:m.id,label:m.label}))??[]),JSON.stringify(frame.temperatures.filter(t=>!t.moduleId||!t.channel)),cells.map(c=>c?.balancing===null?'?':c?.balancing?'1':'0').join(''),cells.map(c=>c?.status??'unknown').join('|'),Array.from({length:240},(_,i)=>temps.get(i+1)?.status??'unknown').join('|'),frame.system.contactor,frame.system.interlock,frame.system.isolation,frame.system.canErrorCount,frame.system.pecErrorCount,JSON.stringify(frame.faults)];
  return row.map(field).join(',')+'\r\n';
}
export class SampleTracker {
  constructor(){this.last=null;this.accepted=0;this.duplicates=0;this.outOfOrder=0;this.sequenceGaps=0;}
  accept(f){const key=f.sourceSessionId??'default';let gaps=0;if(this.last?.key===key){
    if(f.sequence!=null&&this.last.sequence!=null){if(f.sequence===this.last.sequence){this.duplicates++;return false;}if(f.sequence<this.last.sequence){this.outOfOrder++;return false;}gaps=Math.max(0,f.sequence-this.last.sequence-1);}
    else if(f.timestampMs===this.last.timestampMs){this.duplicates++;return false;}
    if(f.timestampMs<this.last.timestampMs){this.outOfOrder++;return false;}
  }this.sequenceGaps+=gaps;this.last={key,sequence:f.sequence,timestampMs:f.timestampMs};this.accepted++;return true;}
}
