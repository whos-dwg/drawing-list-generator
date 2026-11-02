import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCadInput} from '../cad-input.mjs';
import {buildPreview, defaultPreset, normalizeScanResult} from '../core.mjs';

const config = normalizeCadInput({blockNames:'consultant_frame， 圖框-A1', attributeMap:{DWG_NUMBER:'sheet_id',DRAWING_TITLE_1:'project',DRAWING_TITLE_2:'',DRAWING_TITLE_3:'title_en',DRAWING_TITLE_4:'title_cn'}});
const raw = {sheet_id:'L2-LF-203', project:'Restaurant', title_en:'LOOSE FURNITURE DETAILS', title_cn:'家具詳圖', DWG_NUMBER:'STALE-999', DRAWING_TITLE_2:'UNUSED', REV:'B'};
const scan = () => ({fileName:'consultant.dwg',cadInput:config,layouts:[{layout:'LF-203',included:true,warnings:[],attributes:{...raw}}]});

test('normalizes multiple exact block names and case-insensitive attribute tags',()=>{
  assert.deepEqual(config.blockNames,['CONSULTANT_FRAME','圖框-A1']);
  assert.equal(config.attributeMap.DWG_NUMBER,'SHEET_ID');
  assert.throws(()=>normalizeCadInput({blockNames:[]}),/block names/);
  assert.throws(()=>normalizeCadInput({attributeMap:{DWG_NUMBER:''}}),/required/);
});

test('custom tags drive classification, validation, and Excel cells while raw tags stay intact',()=>{
  const preview=buildPreview(scan(),{...structuredClone(defaultPreset),cadInput:config});
  const row=preview.rows.find(row=>row.kind==='drawing');
  assert.equal(row.category,'DETAILS');
  assert.equal(row.cells.A10,'L2-LF-203');
  assert.equal(row.cells.B10,'RESTAURANT LOOSE FURNITURE DETAILS 家具詳圖');
  assert.equal(row.drawing.attributes.DRAWING_TITLE_2,'');
  assert.equal(row.drawing.rawAttributes.DWG_NUMBER,'STALE-999');
  assert.equal(row.drawing.attributes.REV,'B');
  assert.ok(!preview.issues.some(issue=>issue.severity==='error'));
});

test('missing mapped drawing-number tags remain visible instead of using the old standard tag',()=>{
  const input=normalizeCadInput({...config,attributeMap:{...config.attributeMap,DWG_NUMBER:'DOES_NOT_EXIST'}});
  const preview=buildPreview(scan(),{...structuredClone(defaultPreset),cadInput:input});
  assert.ok(preview.issues.some(issue=>issue.code==='MISSING_DWG_NUMBER'));
});

test('changing source attributes can remap a previous scan without rescanning CAD',()=>{
  const value=normalizeScanResult(scan(),config);
  const remapped=normalizeCadInput({...config,attributeMap:{...config.attributeMap,DWG_NUMBER:'DWG_NUMBER'}});
  normalizeScanResult(value,remapped);
  assert.equal(value.layouts[0].attributes.DWG_NUMBER,'STALE-999');
  assert.equal(value.layouts[0].rawAttributes.sheet_id,'L2-LF-203');
});

test('a changed block selection blocks export until the drawings are scanned again',()=>{
  const preset={...structuredClone(defaultPreset),cadInput:{...config,blockNames:['DIFFERENT_FRAME']}};
  assert.deepEqual(buildPreview(scan(),preset).issues.map(issue=>issue.code),['SCAN_BLOCK_CONFIG_CHANGED']);
});

test('custom number tags retain silent multi-layout correction and supplement ordering',()=>{
  const value={cadInput:config,layouts:['LF-203-1','LF-203'].map(layout=>({layout,included:true,warnings:[],attributes:{...raw,sheet_id:'L2-LF-203-1'}}))};
  const preview=buildPreview(value,{...structuredClone(defaultPreset),cadInput:config});
  assert.deepEqual(preview.rows.filter(row=>row.kind==='drawing').map(row=>row.cells[Object.keys(row.cells).find(address=>address.startsWith('A'))]),['L2-LF-203','L2-LF-203-1']);
  assert.ok(!preview.issues.some(issue=>issue.code==='DUPLICATE_DWG_NUMBER'||issue.code.startsWith('LAYOUT_FIELD_RESOLVED')));
  assert.equal(preview.rows.filter(row=>row.kind==='blank').length,0);
});
