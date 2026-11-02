// Run against a local test server after building tests/support/CadInputFixture.cs.
// node integration-cad-input.mjs URL fixture.dwg template.xls output.xls
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {normalizeCadInput} from '../cad-input.mjs';

const [url, fixture, template, output]=process.argv.slice(2);
if(!url||!fixture||!template||!output)throw new Error('Pass server URL, fixture DWG, template XLS, and output XLS.');
const request=async(route,body,expected=200)=>{
  const response=await fetch(new URL(route,url),body===undefined?{signal:AbortSignal.timeout(90000)}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
  const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;
};
const original=await request('/api/preset');
const config=normalizeCadInput({blockNames:['CONSULTANT_FRAME'],attributeMap:{DWG_NUMBER:'SHEET_ID',DRAWING_TITLE_1:'PROJECT',DRAWING_TITLE_2:'',DRAWING_TITLE_3:'TITLE_EN',DRAWING_TITLE_4:'TITLE_CN'}});
const dataBase64=(await fs.readFile(fixture)).toString('base64');
try{
  console.log('Saving custom settings');
  await request('/api/cad-input',{cadInput:config});
  assert.deepEqual((await request('/api/preset')).cadInput,config);
  await request('/api/cad-input',{cadInput:{blockNames:[]}},400);
  assert.deepEqual((await request('/api/preset')).cadInput,config);

  console.log('Scanning custom frame and checking cache');
  const scan=await request('/api/scan',{fileName:'custom-input-fixture.dwg',dataBase64,cadInput:config});
  assert.deepEqual(scan.layouts.map(layout=>layout.attributes.DWG_NUMBER),['L2-LF-203','L2-LF-203-1']);
  assert.ok(scan.layouts.every(layout=>layout.titleBlock==='CONSULTANT_FRAME'&&layout.attributes.CONST_NOTE==='CONSTANT ATTRIBUTE'));
  assert.ok(scan.blocks.find(block=>block.name==='CONSULTANT_FRAME').tags.includes('SHEET_ID'));
  assert.equal((await request('/api/scan',{fileName:'custom-input-fixture.dwg',dataBase64,cadInput:config})).cacheHit,true);

  console.log('Switching selected block and checking cache isolation');
  const hba=await request('/api/scan',{fileName:'custom-input-fixture.dwg',dataBase64,cadInput:normalizeCadInput()});
  assert.deepEqual(hba.layouts.map(layout=>layout.attributes.DWG_NUMBER),['HBA-LF-203','HBA-LF-203-1']);
  const missing=await request('/api/scan',{fileName:'custom-input-fixture.dwg',dataBase64,cadInput:{...config,blockNames:['DOES_NOT_EXIST']}});
  assert.ok(missing.layouts.every(layout=>!layout.included));
  assert.ok(missing.blocks.some(block=>block.name==='CONSULTANT_FRAME'));

  console.log('Validating preview and stale-block export protection');
  const preset={...original,cadInput:config};
  const preview=await request('/api/preview',{scan,preset});
  assert.ok(!preview.issues.some(issue=>issue.severity==='error'),JSON.stringify(preview.issues));
  assert.equal(preview.rows[1].cells.A10,'L2-LF-203');
  assert.equal(preview.rows[2].cells.A11,'L2-LF-203-1');
  assert.equal(preview.rows[1].cells.B10,'CUSTOM RESTAURANT LOOSE FURNITURE DETAILS FURNITURE DETAIL');
  const stale=await request('/api/generate',{scan,preset:{...preset,cadInput:normalizeCadInput()},templateFileName:'template.xls'},422);
  assert.ok(stale.issues.some(issue=>issue.code==='SCAN_BLOCK_CONFIG_CHANGED'));

  console.log('Generating XLS from custom attributes');
  const generated=await request('/api/generate',{scan,preset,templateFileName:'template.xls',templateBase64:(await fs.readFile(template)).toString('base64')});
  const bytes=Buffer.from(generated.dataBase64,'base64');
  assert.equal(bytes.subarray(0,8).toString('hex'),'d0cf11e0a1b11ae1');
  await fs.writeFile(output,bytes);
  console.log(JSON.stringify({status:'passed',layouts:2,numberOrder:scan.layouts.map(layout=>layout.attributes.DWG_NUMBER),outputBytes:bytes.length,output},null,2));
}finally{
  await request('/api/cad-input',{cadInput:original.cadInput});
}
