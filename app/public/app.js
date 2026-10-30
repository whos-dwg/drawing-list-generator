let scanData=null,preset=null,excelFile=null,selectedDwgFiles=[],hasBlockingIssues=false;
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
  updateDwgLabel();$('xlsxName').textContent='SELECT AN EXCEL TEMPLATE';busy(false,'READY');
};
$('xlsx').onchange=e=>{excelFile=e.target.files[0];$('xlsxName').textContent=excelFile?.name||'SELECT AN EXCEL TEMPLATE'};

$('scan').onclick=async()=>{
  if(!preset)return alert('The application is still starting. Please wait.');
  if(!selectedDwgFiles.length)return alert('Select at least one DWG file.');
  if(!excelFile)return alert('Select an Excel template.');
  syncPreset();busy(true,`SCANNING 0/${selectedDwgFiles.length}`);
  try{
    let done=0;
    const scans=await mapLimit(selectedDwgFiles,1,async file=>{
      const scanId=createScanId();
      const result=await api('/api/scan',{fileName:file.name,dataBase64:await base64(file),scanId});
      done++;busy(true,`${result.cacheHit?'CACHED':'SCANNED'} ${done}/${selectedDwgFiles.length}`);return result;
    });
    scanData={
      fileName:selectedDwgFiles.length===1?selectedDwgFiles[0].name:`${selectedDwgFiles.length} DWG files`,
      files:scans.map(x=>x.fileName),cacheHits:scans.filter(x=>x.cacheHit).length,
      totalScanMs:scans.reduce((sum,x)=>sum+(x.scanDurationMs||0),0),
      layouts:scans.flatMap(scan=>(scan.layouts??[]).map(layout=>({...layout,fileName:scan.fileName,cacheHit:scan.cacheHit})))
    };
    renderScan();await buildExcelPreview();$('workspace').classList.remove('hidden');$('workspace').scrollIntoView({behavior:'smooth'});
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
    </tr><tr data-detail-for="${i}"><td></td><td colspan="6"><details><summary>VIEW TITLE BLOCK DATA</summary><pre>${esc(JSON.stringify(x.attributes,null,2))}</pre></details></td></tr>`;
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
}

async function buildExcelPreview(){
  syncPreset();const result=await api('/api/preview',{scan:scanData,preset});
  hasBlockingIssues=result.issues.some(x=>x.severity==='error');
  renderIssues(result.issues);applyClassifications(result.classifications??[]);applyIssueStatuses(result.issues);
  $('previewRows').innerHTML=result.rows.map(r=>`<tr class="${r.kind}"><td>${r.row}</td><td>${esc(r.kind==='category'?r.category:r.layout)}</td><td class="cells">${r.kind==='blank'?'— BLANK ROW —':esc(Object.entries(r.cells).map(([c,v])=>`${c}  ${v}`).join('\n'))}</td></tr>`).join('');
  $('generate').disabled=hasBlockingIssues;
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
function busy(on,text){$('scan').disabled=on;$('generate').disabled=on||hasBlockingIssues;$('systemStatus').textContent=`● ${text}`}
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
