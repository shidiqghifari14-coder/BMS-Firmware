import test from 'node:test';
import assert from 'node:assert/strict';
import {StmLogParser,MODULE_LABELS} from '../dist/stm-log.js';
import {validateFrame,stats,makeDemo} from '../dist/model.js';
import {CSV_HEADER,csvRow,SampleTracker} from '../dist/log-format.js';
import {uartFixture} from './fixtures.mjs';
test('STM fragmented UART: exact 48 local voltages and 8×24 temperatures; reserve 2 modules',()=>{
 const frames=[],p=new StmLogParser({onFrame:f=>frames.push(f)}),text=uartFixture();
 for(let i=0;i<text.length;i+=7)p.push(text.slice(i,i+7));
 assert.equal(frames.length,1);const f=validateFrame(frames[0]);assert.equal(f.currentA,12.34);assert.equal(f.rawCurrentA,-12.34);
 assert.equal(f.temperatures[0].celsius,20);assert.equal(f.temperatures[191].celsius,50);assert.equal(f.temperatures[192].celsius,null);
 assert.equal(f.temperatures[191].moduleId,8);assert.equal(f.temperatures[191].channel,24);assert.equal(f.temperatures.length,240);assert.equal(stats(f).pack,null);
 assert.equal(f.cells[0].voltageV,null);assert.equal(f.localVoltageMv[47],3747);assert.equal(f.timestampBasis,'host_receive');assert.equal(f.socPct,null);
});
test('STM explicit local mapping still never creates a full 140S pack',()=>{let f;new StmLogParser({mapLocalCells:true,onFrame:v=>f=v}).push(uartFixture());assert.equal(f.cells[47].voltageV,3.747);assert.equal(stats(f).valid,48);assert.equal(stats(f).power,null);assert.equal(f.cells[48].voltageV,null);});
test('STM malformed/incomplete cycles rejected; next complete cycle recovers',()=>{const frames=[],rejects=[],p=new StmLogParser({onFrame:f=>frames.push(f),onReject:e=>rejects.push(e)});p.push(uartFixture().replace('20 -21 -','999 -21 -'));p.push(uartFixture().slice(0,-50));p.push(uartFixture());p.push(uartFixture());assert.ok(rejects.length);assert.ok(frames.length>=1);assert.equal(frames.at(-1).temperatures[0].celsius,20);});
test('v2 rejects duplicated module channels and accepts same-ms distinct sequence',()=>{
 const f=makeDemo(1),g=structuredClone(f);g.temperatures[1].channel=1;assert.throws(()=>validateFrame(g));
 const t=new SampleTracker();assert.ok(t.accept(f));assert.equal(t.accept(f),false);assert.ok(t.accept({...f,sequence:f.sequence+1}));assert.equal(t.accept({...f,sequence:f.sequence-1}),false);assert.ok(t.accept({...f,sourceSessionId:'reboot',sequence:0}));assert.equal(t.duplicates,1);assert.equal(t.outOfOrder,1);
});
test('rejected backward timestamps do not inflate missing-sample counters',()=>{
 const t=new SampleTracker();const f={sourceSessionId:'a',sequence:10,timestampMs:1000};
 assert.ok(t.accept(f));assert.equal(t.accept({...f,sequence:14,timestampMs:999}),false);assert.equal(t.sequenceGaps,0);
 assert.ok(t.accept({...f,sequence:14,timestampMs:1001}));assert.equal(t.sequenceGaps,3);assert.equal(t.outOfOrder,1);
});
test('wide logging CSV includes every channel, source timestamp, signed current and neutral missing values',()=>{
 let f;new StmLogParser({onFrame:x=>f=x}).push(uartFixture());const h=CSV_HEADER.trim().split(','),row=csvRow(f,'serial',Date.now());
 assert.ok(h.includes('M10_T24_degC'));assert.ok(h.includes('C140_V'));assert.ok(h.includes('UART_A_local_48_mV'));assert.ok(h.includes('raw_stm_current_A'));assert.match(row,/host_receive/);assert.match(row,/-12.34/);assert.ok(!row.includes('NaN'));assert.equal(h.length,466);
});
