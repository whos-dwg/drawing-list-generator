import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPreview,classifyDrawingDetailed,defaultPreset,normalizeScanResult} from '../core.mjs';

const drawing=(number,title,extra={})=>({
  layout:number,layoutIndex:1,included:true,warnings:[],fileName:'sample.dwg',
  attributes:{DWG_NUMBER:number,DRAWING_TITLE_1:title},...extra
});

test('reads a drawing-type code from the middle of a floor-type-number name',()=>{
  const result=classifyDrawingDetailed(drawing('L2-A-P1-001','GENERAL ARRANGEMENT'),defaultPreset);
  assert.equal(result.category,'PLANS & ELEVATIONS');
  assert.equal(result.numberToken,'P1');
  assert.equal(result.needsConfirmation,false);
});

test('uses title and number as agreeing evidence',()=>{
  const result=classifyDrawingDetailed(drawing('L2-A-DW-003','WALL FINISH DETAIL'),defaultPreset);
  assert.equal(result.category,'DETAILS');
  assert.equal(result.confidence,'high');
  assert.match(result.reason,/agree/);
});

test('requires confirmation when title and drawing-number code conflict',()=>{
  const result=classifyDrawingDetailed(drawing('L2-A-DD-001','MILLWORK DETAIL'),defaultPreset);
  assert.equal(result.category,'OTHER DRAWINGS');
  assert.equal(result.needsConfirmation,true);
  assert.match(result.reason,/DOOR DETAIL/);
  assert.match(result.reason,/MILLWORK DETAIL/);
});

test('requires confirmation when no evidence can be recognized',()=>{
  const scan={fileName:'sample.dwg',layouts:[drawing('L2-A-ZZ-001','GENERAL NOTES')]};
  const preview=buildPreview(scan,structuredClone(defaultPreset));
  assert.ok(preview.issues.some(x=>x.code==='UNCONFIRMED_CLASSIFICATION'));
  assert.equal(preview.classifications[0].category,'OTHER DRAWINGS');
});

test('manual classification clears the confirmation blocker',()=>{
  const row=drawing('L2-A-ZZ-001','GENERAL NOTES',{categoryOverride:'DETAILS',categoryConfirmed:true});
  const preview=buildPreview({fileName:'sample.dwg',layouts:[row]},structuredClone(defaultPreset));
  assert.equal(preview.classifications[0].category,'DETAILS');
  assert.equal(preview.classifications[0].manual,true);
  assert.ok(!preview.issues.some(x=>x.code==='UNCONFIRMED_CLASSIFICATION'));
});

test('all supported middle codes map to their categories',()=>{
  const cases=[
    ['L1-X-EL-01','PLANS & ELEVATIONS'],
    ['L1-X-DC-01','DETAILS'],
    ['L1-X-DS-01','DOOR SCHEDULE'],
    ['L1-X-DD-01','DOOR DETAIL'],
    ['L1-X-DM-01','MILLWORK DETAIL']
  ];
  for(const [number,category] of cases)assert.equal(classifyDrawingDetailed(drawing(number,'UNTITLED'),defaultPreset).category,category);
});

test('keeps drawings in the same nonstandard detail family consecutive',()=>{
  const layouts=[
    drawing('L1.B-DL-201','DECORATIVE LIGHTING DETAILS',{layout:'Sheet A'}),
    drawing('L1.B-DL-203','DECORATIVE LIGHTING DETAILS',{layout:'Sheet B'}),
    drawing('L1.B-DL-203-1','DECORATIVE LIGHTING DETAILS',{layout:'Sheet B1'}),
    drawing('L1.B-DL-204','DECORATIVE LIGHTING DETAILS',{layout:'Sheet C'})
  ];
  const preview=buildPreview({fileName:'lighting.dwg',layouts},structuredClone(defaultPreset));
  const first=preview.rows.findIndex(row=>row.kind==='drawing');
  assert.deepEqual(preview.rows.slice(first,first+4).map(row=>row.kind),['drawing','drawing','drawing','drawing']);
  assert.deepEqual(preview.rows.slice(first,first+4).map(row=>row.drawing.attributes.DWG_NUMBER),['L1.B-DL-201','L1.B-DL-203','L1.B-DL-203-1','L1.B-DL-204']);
});

test('rebuilds a CTAB-backed drawing number from the scanned layout name',()=>{
  const scan={layouts:[{layout:'LF-326',warnings:[],attributes:{DWG_NUMBER:'L2-Model'}}]};
  normalizeScanResult(scan);
  assert.equal(scan.layouts[0].attributes.DWG_NUMBER,'L2-LF-326');
  assert.deepEqual(scan.layouts[0].warnings,[]);
});

test('resolves each layout when a multi-layout DWG repeats the last CTAB result',()=>{
  const scan={layouts:[
    {layout:'LF-203',warnings:[],attributes:{DWG_NUMBER:'L1.B-LF-203-1'}},
    {layout:'LF-203-1',warnings:[],attributes:{DWG_NUMBER:'L1.B-LF-203-1'}}
  ]};
  normalizeScanResult(scan);
  assert.deepEqual(scan.layouts.map(x=>x.attributes.DWG_NUMBER),['L1.B-LF-203','L1.B-LF-203-1']);
});
