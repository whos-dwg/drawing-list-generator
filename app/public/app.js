let scanData=null,preset=null,excelFile=null,selectedDwgFiles=[],hasBlockingIssues=false,cadInputDirty=false,isBusy=false;
const attributeLabels={DWG_NUMBER:'圖號 / Drawing number',DRAWING_TITLE_1:'圖名 1 / Title 1',DRAWING_TITLE_2:'圖名 2 / Title 2',DRAWING_TITLE_3:'圖名 3 / Title 3',DRAWING_TITLE_4:'圖名 4 / Title 4'};
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

Promise.all([fetch('/api/preset').then(r=>r.json()),fetch('/api/system').then(r=>r.json())]).then(([p,s])=>{
  preset=p;renderAdmin();
  $('cadStatus').textContent=s.available?`AUTOCAD ${s.selectedVersion} READY`:'NO SUPPORTED AUTOCAD FOUND';
});
setInterval(()=>fetch('/api/heartbeat').catch(()=>{}),30000);

$('adminToggle').onclick=()=>{
  $('admin').classList.toggle('hidden');
  $('adminToggle').textContent=$('admin').classList.contains('hidden')?'ADMIN SETTINGS':'CLOSE ADMIN SETTINGS';
};
$('dwg').onchange=e=>{selectedDwgFiles=[...e.target.files];updateDwgLabel()};
$('dwgAdd').onchange=e=>{selectedDwgFiles=mergeFiles(selectedDwgFiles,[...e.target.files]);updateDwgLabel()};
$('addDwg').onclick=()=>{$('dwgAdd').value='';$('dwgAdd').click()};
$('reimport').onclick=()=>{
  selectedDwgFiles=[];scanData=null;excelFile=null;hasBlockingIssues=false;
  $('dwg').value='';$('dwgAdd').value='';$('xlsx').value='';$('workspace').classList.add('hidden');
  updateDwgLabel();$('xlsxName').textContent='SELECT AN EXCEL TEMPLATE';renderDiscoveredBlocks();busy(false,'READY');
};
$('xlsx').onchange=e=>{excelFile=e.target.files[0];$('xlsxName').textContent=excelFile?.name||'SELECT AN EXCEL TEMPLATE'};

$('scan').onclick=async()=>{
  if(!preset)return alert('The application is still starting. Please wait.');
  if(!selectedDwgFiles.length)return alert('Select at least one DWG file.');
  if(!excelFile)return alert('Select an Excel template.');
  syncPreset();busy(true,`SCANNING 0/${selectedDwgFiles.length}`);
  try{
    if(cadInputDirty)await saveCadInput();
    let done=0;
    const scans=await mapLimit(selectedDwgFiles,1,async file=>{
      const scanId=createScanId();
      const result=await api('/api/scan',{fileName:file.name,dataBase64:await base64(file),scanId,cadInput:preset.cadInput});
      done++;busy(true,`${result.cacheHit?'CACHED':'SCANNED'} ${done}/${selectedDwgFiles.length}`);return result;
    });
    scanData={
      fileName:selectedDwgFiles.length===1?selectedDwgFiles[0].name:`${selectedDwgFiles.length} DWG files`,
      files:scans.map(x=>x.fileName),cacheHits:scans.filter(x=>x.cacheHit).length,
      cadInput:scans[0]?.cadInput??preset.cadInput,blocks:scans.flatMap(scan=>scan.blocks??[]),
      totalScanMs:scans.reduce((sum,x)=>sum+(x.scanDurationMs||0),0),
      layouts:scans.flatMap(scan=>(scan.layouts??[]).map(layout=>({...layout,fileName:scan.fileName,cacheHit:scan.cacheHit})))
    };
    renderDiscoveredBlocks();await buildExcelPreview();$('workspace').classList.remove('hidden');$('workspace').scrollIntoView({behavior:'smooth'});
  }catch(e){alert(friendlyError(e.message,e.diagnosticId))}finally{busy(false,hasBlockingIssues?'REVIEW REQUIRED':'READY')}
};

function renderScan(){
  const layouts=scanData.layouts??[],categoryOptions=(preset.classificationOrder??[]).map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('');
  $('metrics').innerHTML=`<span>${scanData.files?.length??1} FILES</span><span>${layouts.length} LAYOUTS</span><span>${scanData.cacheHits??0} CACHED</span><span>${layouts.filter(x=>x.warnings?.length).length} WARNINGS</span>`;
  $('cadRows').innerHTML=layouts.map((x,i)=>{
    const warnings=x.warnings??[];
    return `<tr id="drawing-row-${i}" data-drawing-number="${esc(attr(x,'DWG_NUMBER').trim().toUpperCase())}">
      <td><input type="checkbox" data-include="${i}" ${x.included?'checked':''}></td>
      <td>${x.layoutIndex}</td>
      <td><b>${esc(x.layout)}</b><small class="file-tag">${esc(x.fileName||'')} · ${x.cacheHit?'CACHE':'CAD'}</small></td>
      <td>${esc(attr(x,'DWG_NUMBER'))}</td>
      <td class="title">${esc(['DRAWING_TITLE_1','DRAWING_TITLE_3','DRAWING_TITLE_2','DRAWING_TITLE_4'].map(k=>attr(x,k)).filter(Boolean).join(' / '))}</td>
      <td id="category-cell-${i}" class="classification-cell pending"><select data-category-index="${i}" aria-label="Classification for ${esc(x.layout)}" disabled>${categoryOptions}</select><div class="classification-actions"><button type="button" data-confirm-category="${i}" class="category-confirm hidden">CONFIRM OTHER</button><button type="button" data-auto-category="${i}" class="category-auto hidden">↺ AUTO</button></div><small id="category-note-${i}">ANALYZING…</small></td>
      <td id="status-${i}" class="status ${warnings.length?'warn':''}">${warnings.length?esc(warnings.join(', ')):'READY'}</td>
    </tr><tr data-detail-for="${i}"><td></td><td colspan="6"><details><summary>VIEW TITLE BLOCK DATA</summary><small class="cad-block-source">BLOCK: ${esc(x.titleBlock||'')}</small><pre>${esc(JSON.stringify(x.rawAttributes??x.attributes,null,2))}</pre></details></td></tr>`;
  }).join('');
  document.querySelectorAll('[data-include]').forEach(el=>el.onchange=async()=>{scanData.layouts[+el.dataset.include].included=el.checked;await buildExcelPreview()});
  document.querySelectorAll('[data-category-index]').forEach(el=>el.onchange=async()=>{
    const row=scanData.layouts[+el.dataset.categoryIndex];row.categoryOverride=el.value;row.categoryConfirmed=true;await buildExcelPreview();
  });
  document.querySelectorAll('[data-confirm-category]').forEach(button=>button.onclick=async()=>{
    const row=scanData.layouts[+button.dataset.confirmCategory];row.categoryOverride=preset.defaultCategory||'OTHER DRAWINGS';row.categoryConfirmed=true;await buildExcelPreview();
  });
  document.querySelectorAll('[data-auto-category]').forEach(button=>button.onclick=async()=>{
    const row=scanData.layouts[+button.dataset.autoCategory];delete row.categoryOverride;delete row.categoryConfirmed;await buildExcelPreview();
  });
}

function renderAdmin(){
  if(!preset)return;
  $('worksheet').value=preset.targetWorksheet;$('sheetSize').value=preset.sheetSize||'A1';$('batch').checked=preset.issuedThisBatch!==false;
  $('fields').innerHTML=preset.outputFields.map((f,i)=>`<div class="field"><span>${esc(f.name)}</span><input aria-label="Start cell" data-cell="${i}" value="${esc(f.startCell)}"><input aria-label="Formula" data-formula="${i}" value="${esc(f.formula)}"></div>`).join('');
  $('classification').textContent=JSON.stringify({titleRules:preset.classificationRules,numberCodeRules:preset.numberClassificationRules},null,2);
  renderCadInput();
}

function renderCadInput(){
  const config=preset.cadInput;
  $('blockNames').value=config.blockNames.join(', ');
  $('attributeMapping').innerHTML=Object.entries(attributeLabels).map(([tag,label])=>`<label class="cad-attribute-field"><span>${esc(label)}<code>{${tag}}</code></span><input data-attribute-tag="${tag}" aria-label="${esc(label)}" list="attributeSuggestions" value="${esc(config.attributeMap[tag]??'')}" placeholder="${tag==='DWG_NUMBER'?'必填：來源屬性標籤':'可留空'}" autocomplete="off"></label>`).join('');
  document.querySelectorAll('[data-attribute-tag]').forEach(input=>{input.oninput=markCadInputDirty;input.disabled=isBusy});
  $('blockNames').oninput=()=>{markCadInputDirty();renderAttributeSuggestions()};
  renderAttributeSuggestions();
}

function markCadInputDirty(){
  cadInputDirty=true;$('generate').disabled=true;
  setCadInputStatus('設定已變更；請儲存，或直接按 SCAN DRAWINGS 套用。');
}

function readCadInput(){
  return {blockNames:$('blockNames').value,attributeMap:Object.fromEntries([...document.querySelectorAll('[data-attribute-tag]')].map(input=>[input.dataset.attributeTag,input.value]))};
}

function setCadInputStatus(text,state=''){$('cadInputStatus').textContent=text;$('cadInputStatus').className=state}

async function saveCadInput(config=readCadInput()){
  const result=await api('/api/cad-input',{cadInput:config});preset.cadInput=result.cadInput;cadInputDirty=false;renderCadInput();
  setCadInputStatus('已儲存。更換圖塊名稱後，請重新掃描；只更換屬性會立即更新預覽。','saved');
}

$('saveCadInput').onclick=async()=>{
  busy(true,'SAVING INPUT');
  try{await saveCadInput();if(scanData)await buildExcelPreview()}catch(error){setCadInputStatus(error.message,'error')}finally{busy(false,hasBlockingIssues?'REVIEW REQUIRED':'READY')}
};
$('resetCadInput').onclick=async()=>{
  busy(true,'RESETTING INPUT');
  try{await saveCadInput({});if(scanData)await buildExcelPreview()}catch(error){setCadInputStatus(error.message,'error')}finally{busy(false,hasBlockingIssues?'REVIEW REQUIRED':'READY')}
};

function renderDiscoveredBlocks(){
  const blocks=new Map();
  for(const block of scanData?.blocks??[]){
    const key=block.name.toUpperCase(),existing=blocks.get(key)??{name:block.name,count:0,tags:new Set()};
    existing.count+=block.count??0;for(const tag of block.tags??[])existing.tags.add(tag);blocks.set(key,existing);
  }
  const available=[...blocks.values()].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  $('blockSuggestions').innerHTML=available.map(block=>`<option value="${esc(block.name)}"></option>`).join('');
  $('discoveredHint').textContent=available.length?'點選圖塊名稱可套入設定；儲存後重新掃描。下列為配置空間中的圖塊。':'尚未找到圖塊；請先掃描 DWG。';
  $('discoveredBlocks').innerHTML=available.map(block=>`<div class="discovered-block"><button type="button" data-use-block="${esc(block.name)}">${esc(block.name)} (${block.count})</button><small>${esc([...block.tags].sort().join(' · ')||'無屬性標籤')}</small></div>`).join('');
  document.querySelectorAll('[data-use-block]').forEach(button=>button.onclick=()=>{$('blockNames').value=button.dataset.useBlock;markCadInputDirty();renderAttributeSuggestions();$('blockNames').focus()});
  renderAttributeSuggestions();
}

function renderAttributeSuggestions(){
  const names=$('blockNames').value.split(/[,;，；\r\n]+/).map(value=>value.trim().toUpperCase());
  const tags=new Set((scanData?.blocks??[]).filter(block=>names.includes(block.name.toUpperCase())).flatMap(block=>block.tags??[]));
  for(const layout of scanData?.layouts??[])for(const tag of Object.keys(layout.rawAttributes??layout.attributes??{}))tags.add(tag);
  $('attributeSuggestions').innerHTML=[...tags].sort().map(tag=>`<option value="${esc(tag)}"></option>`).join('');
}

async function buildExcelPreview(){
  syncPreset();const result=await api('/api/preview',{scan:scanData,preset});
  if(result.layouts)scanData.layouts=result.layouts;
  renderScan();
  hasBlockingIssues=result.issues.some(x=>x.severity==='error');
  renderIssues(result.issues);applyClassifications(result.classifications??[]);applyIssueStatuses(result.issues);
  $('previewRows').innerHTML=result.rows.map(r=>`<tr class="${r.kind}"><td>${r.row}</td><td>${esc(r.kind==='category'?r.category:r.layout)}</td><td class="cells">${r.kind==='blank'?'— BLANK ROW —':esc(Object.entries(r.cells).map(([c,v])=>`${c}  ${v}`).join('\n'))}</td></tr>`).join('');
  $('generate').disabled=isBusy||hasBlockingIssues||cadInputDirty;
}

function applyClassifications(items){
  for(const item of items){
    const cell=$(`category-cell-${item.scanIndex}`),select=document.querySelector(`[data-category-index="${item.scanIndex}"]`),note=$(`category-note-${item.scanIndex}`),confirm=document.querySelector(`[data-confirm-category="${item.scanIndex}"]`),auto=document.querySelector(`[data-auto-category="${item.scanIndex}"]`);
    if(!cell||!select)continue;
    select.disabled=false;select.value=item.category;select.title=item.reason||'';
    cell.className=`classification-cell ${item.needsConfirmation?'needs-review':item.manual?'manual':'verified'}`;
    note.textContent=item.needsConfirmation?`REVIEW · ${item.reason}`:item.manual?`MANUAL · ${item.reason}`:`AUTO ${String(item.confidence||'').toUpperCase()} · ${item.reason}`;
    confirm.classList.toggle('hidden',!item.needsConfirmation);auto.classList.toggle('hidden',!item.manual);
  }
}

$('generate').onclick=async()=>{
  syncPreset();busy(true,'GENERATING');
  try{
    const out=await api('/api/generate',{scan:scanData,preset,templateFileName:excelFile.name,templateBase64:await base64(excelFile)});
    const a=document.createElement('a');a.href=`data:${out.mimeType};base64,${out.dataBase64}`;a.download=out.fileName;a.click();
  }catch(e){alert(`Unable to generate the drawing list.\n\n${e.message}`)}finally{busy(false,hasBlockingIssues?'REVIEW REQUIRED':'READY')}
};

function syncPreset(){
  if(!preset)return;
  preset.targetWorksheet=$('worksheet').value;preset.sheetSize=$('sheetSize').value.trim()||'A1';preset.issuedThisBatch=$('batch').checked;
  document.querySelectorAll('[data-cell]').forEach(x=>preset.outputFields[+x.dataset.cell].startCell=x.value);
  document.querySelectorAll('[data-formula]').forEach(x=>preset.outputFields[+x.dataset.formula].formula=x.value);
}

function renderIssues(items){
  $('issues').innerHTML=items.map(x=>{
    if(x.code==='DUPLICATE_DWG_NUMBER')return `<button type="button" class="issue issue-jump ${x.severity}" data-jump-number="${esc(x.context)}" title="${esc(`FOUND IN:\n${(x.sources??[]).join('\n')}`)}"><b>ACTION REQUIRED:</b> ${esc(x.message)}<span>VIEW ROWS ↓</span></button>`;
    if(x.code==='UNCONFIRMED_CLASSIFICATION')return `<button type="button" class="issue issue-jump ${x.severity}" data-jump-index="${x.scanIndex}"><b>CLASSIFICATION REQUIRED:</b> ${esc(x.message)}<span>CHOOSE CATEGORY ↓</span></button>`;
    return `<div class="issue ${x.severity}"><b>${x.severity==='error'?'ACTION REQUIRED':'NOTICE'}:</b> ${esc(x.message)}</div>`;
  }).join('')||'<div class="issue">✓ No issues found. The drawing list is ready to generate.</div>';
  document.querySelectorAll('[data-jump-number]').forEach(button=>button.onclick=()=>jumpToDrawingNumber(button.dataset.jumpNumber));
  document.querySelectorAll('[data-jump-index]').forEach(button=>button.onclick=()=>jumpToRow(+button.dataset.jumpIndex));
}

function applyIssueStatuses(items){
  const duplicates=new Set(items.filter(x=>x.code==='DUPLICATE_DWG_NUMBER').map(x=>String(x.context).toUpperCase()));
  const unconfirmed=new Set(items.filter(x=>x.code==='UNCONFIRMED_CLASSIFICATION').map(x=>Number(x.scanIndex)));
  for(const [i,row] of (scanData?.layouts??[]).entries()){
    const cell=$(`status-${i}`);if(!cell)continue;
    const duplicate=row.included&&duplicates.has(attr(row,'DWG_NUMBER').trim().toUpperCase()),review=row.included&&unconfirmed.has(i);
    const messages=[...(review?['CONFIRM CATEGORY']:[]),...(duplicate?['DUPLICATE DRAWING NUMBER']:[]),...(row.warnings??[])];
    cell.textContent=messages.length?messages.join(' · '):'READY';cell.className=`status${duplicate||review?' error':messages.length?' warn':''}`;
  }
}

function jumpToDrawingNumber(number){
  const key=String(number).toUpperCase(),rows=[...document.querySelectorAll('[data-drawing-number]')].filter(row=>row.dataset.drawingNumber===key);if(!rows.length)return;
  rows[0].scrollIntoView({behavior:'smooth',block:'center'});for(const row of rows)focusRow(row);
}
function jumpToRow(index){const row=$(`drawing-row-${index}`);if(!row)return;row.scrollIntoView({behavior:'smooth',block:'center'});focusRow(row);setTimeout(()=>row.querySelector('[data-category-index]')?.focus(),550)}
function focusRow(row){row.classList.remove('row-focus');void row.offsetWidth;row.classList.add('row-focus');setTimeout(()=>row.classList.remove('row-focus'),2400)}
function friendlyError(message,diagnosticId){return `Unable to analyze this DWG.\n\n${message}${diagnosticId?`\n\nDiagnostic ID:\n${diagnosticId}`:''}\n\nPlease send the Diagnostic ID to the administrator.`}
function attr(row,key){const found=Object.keys(row.attributes??{}).find(x=>x.toUpperCase()===key);return found?row.attributes[found]:''}
function busy(on,text){isBusy=on;$('scan').disabled=on;$('generate').disabled=on||hasBlockingIssues||cadInputDirty;for(const id of ['saveCadInput','resetCadInput','blockNames','addDwg','reimport'])$(id).disabled=on;document.querySelectorAll('[data-attribute-tag]').forEach(input=>input.disabled=on);$('systemStatus').textContent=`● ${text}`}
async function api(url,body){
  const diagnosticId=body?.scanId;
  try{
    const headers={'content-type':'application/json'};if(diagnosticId)headers['x-scan-id']=diagnosticId;
    const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(body)}),data=await r.json();
    if(!r.ok){const details=(data.issues??[]).map(x=>`${x.code}: ${x.message}`).join('\n');const error=new Error(details||data.message||data.error);error.diagnosticId=data.diagnosticId||diagnosticId;throw error}return data;
  }catch(error){if(!error.diagnosticId)error.diagnosticId=diagnosticId;throw error}
}
function base64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(file)})}
async function mapLimit(items,limit,worker){const results=new Array(items.length);let next=0;async function run(){while(next<items.length){const index=next++;results[index]=await worker(items[index],index)}}await Promise.all(Array.from({length:Math.min(limit,items.length)},run));return results}
function mergeFiles(current,added){const files=[...current],keys=new Set(current.map(file=>`${file.name}|${file.size}|${file.lastModified}`));for(const file of added){const key=`${file.name}|${file.size}|${file.lastModified}`;if(!keys.has(key)){keys.add(key);files.push(file)}}return files}
function updateDwgLabel(){$('dwgName').textContent=selectedDwgFiles.length?`${selectedDwgFiles.length} DWG FILES SELECTED`:'SELECT ONE OR MORE DRAWINGS'}
function createScanId(){const d=new Date(),p=n=>String(n).padStart(2,'0'),stamp=`${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`,suffix=crypto.getRandomValues(new Uint16Array(1))[0].toString(16).padStart(4,'0').toUpperCase();return `${stamp}-${suffix}`}

$('openDiagnostics').onclick=async()=>{
  const button=$('openDiagnostics'),label=button.textContent;button.disabled=true;button.textContent='OPENING FOLDER…';
  try{const result=await api('/api/open-diagnostics',{});button.textContent='FOLDER OPENED ✓';button.title=result.path||''}catch(e){button.textContent='COULD NOT OPEN';alert(`Unable to open the diagnostic folder.\n\n${e.message}`)}finally{setTimeout(()=>{button.disabled=false;button.textContent=label},1800)}
};
const backToTop=$('backToTop');let scrollFrame=0;
function updateBackToTop(){scrollFrame=0;backToTop.classList.toggle('visible',window.scrollY>420)}
window.addEventListener('scroll',()=>{if(!scrollFrame)scrollFrame=requestAnimationFrame(updateBackToTop)},{passive:true});
backToTop.onclick=()=>window.scrollTo({top:0,behavior:'smooth'});updateBackToTop();
