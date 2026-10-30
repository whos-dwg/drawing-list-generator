const CELL_RE = /^([A-Z]+)([1-9][0-9]*)$/i;
const TOKEN_RE = /\{([^{}]+)\}/g;

export function parseCell(cell) {
  const match = CELL_RE.exec(String(cell ?? '').trim());
  if (!match) throw new Error(`Invalid Excel start cell: ${cell}`);
  return { column: match[1].toUpperCase(), row: Number(match[2]) };
}

export function resolveToken(name, drawing) {
  const key = name.toUpperCase();
  if (key === 'LAYOUT_NAME') return drawing.layout ?? '';
  if (key === 'FILE_NAME') return drawing.fileName ?? '';
  if (key === 'SHEET_SIZE') return drawing.sheetSize ?? 'A1';
  if (key === 'ISSUED_THIS_BATCH') return drawing.issuedThisBatch ?? 'v';
  const attrs = drawing.attributes ?? {};
  const found = Object.keys(attrs).find(k => k.toUpperCase() === key);
  return found ? String(attrs[found] ?? '') : '';
}

export function normalizeScanResult(scan) {
  const layouts=scan?.layouts??[],layoutNames=layouts.map(x=>String(x.layout??'')).filter(Boolean);
  const rawNumbers=layouts.map(layout=>{const attrs=layout.attributes??{},key=Object.keys(attrs).find(name=>name.toUpperCase()==='DWG_NUMBER');return key?String(attrs[key]??''):''});
  const counts=new Map();for(const value of rawNumbers){const key=value.toUpperCase();if(key)counts.set(key,(counts.get(key)??0)+1)}
  for(const layout of layouts){
    const attributes=layout.attributes??{};
    const key=Object.keys(attributes).find(name=>name.toUpperCase()==='DWG_NUMBER');
    if(!key)continue;
    const raw=String(attributes[key]??''),layoutName=String(layout.layout??'');
    const repeated=(counts.get(raw.toUpperCase())??0)>1;
    if((!/\bMODEL\b/i.test(raw)&&!repeated)||!/^[A-Z].*[-_.]\d/i.test(layoutName))continue;
    const candidate=[...new Set([...layoutNames,'Model'])].sort((a,b)=>b.length-a.length).find(name=>raw.toUpperCase().endsWith(name.toUpperCase()));
    if(!candidate)continue;
    const resolved=raw.slice(0,raw.length-candidate.length)+layoutName;
    if(resolved===raw)continue;
    attributes[key]=resolved;
  }
  return scan;
}

export function applyTransforms(value, transforms = []) {
  let result = String(value ?? '');
  for (const transform of transforms) {
    switch (transform.type) {
      case 'trim': result = result.trim(); break;
      case 'dedupeSpaces': result = result.replace(/\s+/g, ' '); break;
      case 'uppercaseEnglish': result = result.replace(/[a-z]+/g, s => s.toUpperCase()); break;
      case 'prefix': result = String(transform.value ?? '') + result; break;
      case 'suffix': result += String(transform.value ?? ''); break;
      case 'replace': result = result.split(String(transform.find ?? '')).join(String(transform.replace ?? '')); break;
      default: throw new Error(`Unknown transform: ${transform.type}`);
    }
  }
  return result;
}

export function renderFormula(formula, drawing, transforms = []) {
  const value = String(formula ?? '').replace(TOKEN_RE, (_, token) => resolveToken(token.trim(), drawing));
  return applyTransforms(value, transforms);
}

export function buildPreview(scan, preset) {
  const allLayouts = (scan.layouts ?? []).map((x, scanIndex) => ({ ...x, scanIndex, fileName: x.fileName ?? scan.fileName, sheetSize:preset.sheetSize||'A1', issuedThisBatch:preset.issuedThisBatch===false?'':'v' }));
  const source = allLayouts.filter(x => x.included);
  const organized = organizeDrawings(source, preset);
  const rows = [];
  let outputIndex = 0;
  const emptyCells = index => Object.fromEntries((preset.outputFields ?? []).map(field => { const start=parseCell(field.startCell); return [`${start.column}${start.row+index}`,'']; }));
  for (const item of organized) {
    if (item.kind === 'category') {
      const cells=emptyCells(outputIndex), titleField=(preset.outputFields??[]).find(x=>/title/i.test(x.name))??preset.outputFields?.[1]??preset.outputFields?.[0];
      if(titleField){const start=parseCell(titleField.startCell);cells[`${start.column}${start.row+outputIndex}`]=item.label;}
      rows.push({row:outputIndex+1,kind:'category',category:item.label,layout:'',cells});outputIndex++;continue;
    }
    if (item.kind === 'blank') { rows.push({row:outputIndex+1,kind:'blank',category:item.category,layout:'',cells:emptyCells(outputIndex)});outputIndex++;continue; }
    const drawing=item.drawing, index=outputIndex;
    const cells = {};
    for (const field of preset.outputFields ?? []) {
      const start = parseCell(field.startCell);
      cells[`${start.column}${start.row + index}`] = renderFormula(field.formula, drawing, field.transforms);
    }
    rows.push({ row:index+1,kind:'drawing',category:item.category,prefix:item.prefix,layout:drawing.layout,cells,drawing });outputIndex++;
  }
  return {
    rows,
    issues: validate(scan, preset, rows),
    classifications: allLayouts.map(drawing => ({ scanIndex:drawing.scanIndex, ...classifyDrawingDetailed(drawing, preset) }))
  };
}

export function drawingPrefix(drawing) {
  // Group rows by their actual drawing number. Layout names are only a
  // fallback because some consultants use unrelated layout labels.
  const value=String(resolveToken('DWG_NUMBER',drawing)||drawing.layout||'').trim().toUpperCase();
  return value.replace(/(?:[-_. ]\d+[A-Z]?)+$/i,'').replace(/[-_. ]+$/,'')||value;
}

export function classifyDrawing(drawing, preset) {
  return classifyDrawingDetailed(drawing, preset).category;
}

export function classifyDrawingDetailed(drawing, preset) {
  const fallback=preset.defaultCategory||'OTHER DRAWINGS';
  const allowed=new Set([...(preset.classificationOrder??[]),fallback]);
  const manual=String(drawing.categoryOverride??'').trim();
  if(manual&&allowed.has(manual))return {category:manual,confidence:'manual',needsConfirmation:false,manual:true,titleCategory:'',numberCategory:'',numberToken:'',reason:`Manually assigned to ${manual}.`};

  const title=['DRAWING_TITLE_1','DRAWING_TITLE_2','DRAWING_TITLE_3','DRAWING_TITLE_4'].map(k=>resolveToken(k,drawing)).join(' ').replace(/\s+/g,' ').trim().toUpperCase();
  const titleRule=(preset.classificationRules??[]).find(rule=>(rule.keywords??[]).some(keyword=>title.includes(String(keyword).toUpperCase())));
  const titleCategory=titleRule?.name??'';
  const number=String(resolveToken('DWG_NUMBER',drawing)||drawing.layout||'').trim().toUpperCase();
  const numberEvidence=classifyDrawingNumber(number,preset);
  const numberCategory=numberEvidence.category;

  if(titleCategory&&numberCategory&&titleCategory===numberCategory)return {category:titleCategory,confidence:'high',needsConfirmation:false,manual:false,titleCategory,numberCategory,numberToken:numberEvidence.token,reason:`Title and drawing-number code ${numberEvidence.token} agree.`};
  if(titleCategory&&numberCategory&&titleCategory!==numberCategory)return {category:fallback,confidence:'low',needsConfirmation:true,manual:false,titleCategory,numberCategory,numberToken:numberEvidence.token,reason:`Title suggests ${titleCategory}, but code ${numberEvidence.token} suggests ${numberCategory}.`};
  if(titleCategory)return {category:titleCategory,confidence:'medium',needsConfirmation:false,manual:false,titleCategory,numberCategory:'',numberToken:'',reason:`Classified from drawing title (${titleRule.keywords.find(keyword=>title.includes(String(keyword).toUpperCase()))}).`};
  if(numberCategory)return {category:numberCategory,confidence:'medium',needsConfirmation:false,manual:false,titleCategory:'',numberCategory,numberToken:numberEvidence.token,reason:`Classified from drawing-number code ${numberEvidence.token}.`};
  return {category:fallback,confidence:'low',needsConfirmation:drawing.categoryConfirmed!==true,manual:false,titleCategory:'',numberCategory:'',numberToken:'',reason:'No recognized drawing-type code or title keyword was found.'};
}

function classifyDrawingNumber(number,preset){
  // A drawing number such as L2-A-P1-001 is intentionally read segment by
  // segment. This makes the middle "drawing type" useful without assuming
  // that every company uses the same floor or discipline prefix.
  const tokens=String(number??'').toUpperCase().split(/[-_.\s/\\]+/).map(x=>x.trim()).filter(Boolean);
  const rules=preset.numberClassificationRules??defaultNumberClassificationRules;
  const matches=[];
  for(const token of tokens){
    for(const rule of rules){
      if((rule.codes??[]).some(code=>codeMatches(token,String(code).toUpperCase())))matches.push({category:rule.name,token});
    }
  }
  const categories=[...new Set(matches.map(x=>x.category))];
  if(categories.length!==1)return {category:'',token:matches.map(x=>x.token).filter((x,i,a)=>a.indexOf(x)===i).join('/')};
  return matches.find(x=>x.category===categories[0])??{category:'',token:''};
}

function codeMatches(token,code){
  if(code==='P#')return /^P\d+[A-Z]?$/.test(token);
  return token===code;
}

function organizeDrawings(drawings,preset){
  if(!preset.autoClassify) return drawings.map(drawing=>({kind:'drawing',drawing,category:'',prefix:drawingPrefix(drawing)}));
  const order=preset.classificationOrder??(preset.classificationRules??[]).map(x=>x.name), groups=new Map(), collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
  for(const drawing of drawings){const category=classifyDrawingDetailed(drawing,preset).category;if(!groups.has(category))groups.set(category,[]);groups.get(category).push(drawing);}
  const names=[...order.filter(x=>groups.has(x)),...groups.keys()].filter((x,i,a)=>a.indexOf(x)===i),result=[];
  for(const [categoryIndex,category] of names.entries()){
    if(categoryIndex)result.push({kind:'blank',category:names[categoryIndex-1]});
    result.push({kind:'category',label:category});
    const subgroups=new Map();
    for(const drawing of groups.get(category)){const rawPrefix=category==='MILLWORK DETAIL'?'MILLWORK':drawingPrefix(drawing),prefix=category==='DETAILS'?normalizeDetailPrefix(rawPrefix):rawPrefix;if(!subgroups.has(prefix))subgroups.set(prefix,[]);subgroups.get(prefix).push(drawing);}
    const subgroupEntries=[...subgroups.entries()];
    if(category==='PLANS & ELEVATIONS')subgroupEntries.sort((a,b)=>planElevationRank(a[1])-planElevationRank(b[1])||collator.compare(planFloorPrefix(a[0]),planFloorPrefix(b[0]))||collator.compare(a[0],b[0]));
    const detailsSpaceFirst=category==='DETAILS'&&detailUsesSpaceFirst(subgroupEntries);
    if(category==='DETAILS')subgroupEntries.sort((a,b)=>detailsSpaceFirst?(collator.compare(detailSpacePrefix(a[0]),detailSpacePrefix(b[0]))||detailPrefixRank(a[0])-detailPrefixRank(b[0])||collator.compare(a[0],b[0])):(detailPrefixRank(a[0])-detailPrefixRank(b[0])||collator.compare(detailSpacePrefix(a[0]),detailSpacePrefix(b[0]))||collator.compare(a[0],b[0])));
    let subgroupIndex=0,previousSection=null;
    for(const [prefix,items] of subgroupEntries){
      const section=subgroupSection(category,prefix,items,detailsSpaceFirst);
      if(subgroupIndex++&&preset.blankRowOnPrefixChange!==false&&section!==previousSection)result.push({kind:'blank',category});
      previousSection=section;
      items.sort((a,b)=>collator.compare(category==='DETAILS'?normalizeDetailPrefix(resolveToken('DWG_NUMBER',a)||a.layout):(resolveToken('DWG_NUMBER',a)||a.layout),category==='DETAILS'?normalizeDetailPrefix(resolveToken('DWG_NUMBER',b)||b.layout):(resolveToken('DWG_NUMBER',b)||b.layout)));
      for(const drawing of items)result.push({kind:'drawing',drawing,category,prefix:drawingPrefix(drawing)});
    }
  }
  return result;
}

function subgroupSection(category,prefix,items,detailsSpaceFirst=false){
  if(category==='PLANS & ELEVATIONS')return `${planElevationRank(items)}|${planFloorPrefix(prefix)}`;
  if(category==='DETAILS')return detailsSpaceFirst?`${detailSpacePrefix(prefix)}|${detailPrefixRank(prefix)}`:`${detailPrefixRank(prefix)}|${detailSpacePrefix(prefix)}`;
  if(category==='MILLWORK DETAIL')return 'MILLWORK';
  return prefix;
}

function planElevationRank(drawings){
  const title=drawings.map(drawing=>['DRAWING_TITLE_1','DRAWING_TITLE_2','DRAWING_TITLE_3','DRAWING_TITLE_4'].map(key=>resolveToken(key,drawing)).join(' ')).join(' ').toUpperCase();
  if(title.includes('PLAN'))return 0;
  if(title.includes('ELEVATION'))return 1;
  return 2;
}

function planFloorPrefix(prefix){
  const value=String(prefix??'').toUpperCase();
  const match=/^(.*?)-(?:P\d+|EL)(?:-|$)/.exec(`${value}-`);
  return match?.[1]??value;
}

function detailPrefixRank(prefix){
  const value=String(prefix??'').toUpperCase();
  if(value==='DC'||value.endsWith('-DC'))return 0;
  if(value==='DW'||value.endsWith('-DW'))return 1;
  if(value==='DF'||value.endsWith('-DF'))return 2;
  return 3;
}

function detailSpacePrefix(prefix){
  const value=String(prefix??'').toUpperCase();
  const space=value.replace(/-(?:DC|DW|DF)$/,'').replace(/^(?:DC|DW|DF)$/,'');
  return space==='TPY'?'TYP':space;
}

function detailUsesSpaceFirst(entries){
  const types=new Set(entries.map(([prefix])=>detailPrefixRank(prefix)).filter(rank=>rank<3));
  return types.size===3&&entries.every(([prefix])=>detailSpacePrefix(prefix)!=='');
}

function normalizeDetailPrefix(value){return String(value??'').toUpperCase().replace(/^TPY-/,'TYP-')}

export function validate(scan, preset, rows = []) {
  const issues = [];
  if (!preset.targetWorksheet?.trim()) issues.push(issue('error', 'MISSING_WORKSHEET', 'Target worksheet is required.'));
  for (const f of preset.outputFields ?? []) {
    try { parseCell(f.startCell); } catch (e) { issues.push(issue('error', 'INVALID_START_CELL', e.message, f.name)); }
  }
  const numbers = new Map();
  for (const layout of scan.layouts ?? []) {
    for (const warning of layout.warnings ?? []) {
      // Empty optional title-block attributes remain visible in the row STATUS,
      // but do not flood the actionable review list one attribute at a time.
      if (warning.startsWith('EMPTY_ATTRIBUTE:')) continue;
      issues.push(issue(layout.included&&warning.startsWith('MISSING_') ? 'error' : 'warning', warning, `${layout.fileName?layout.fileName+' / ':''}${layout.layout}: ${warning}`, layout.layout));
    }
    if (!layout.included) continue;
    const classification=classifyDrawingDetailed(layout,preset);
    if(classification.needsConfirmation)issues.push(issue('error','UNCONFIRMED_CLASSIFICATION',`${layout.fileName?layout.fileName+' / ':''}${layout.layout}: confirm a category before generating. ${classification.reason}`,layout.layout,{scanIndex:(scan.layouts??[]).indexOf(layout)}));
    const no = resolveToken('DWG_NUMBER', layout).trim();
    if (!no) issues.push(issue('error', 'MISSING_DWG_NUMBER', `${layout.layout}: missing DWG_NUMBER`, layout.layout));
    else {
      const key=no.toUpperCase(), source=`${layout.fileName??scan.fileName??'Unknown DWG'} / ${layout.layout}`;
      numbers.set(key, [...(numbers.get(key) ?? []), source]);
    }
    const title = ['DRAWING_TITLE_1','DRAWING_TITLE_2','DRAWING_TITLE_3','DRAWING_TITLE_4'].map(k => resolveToken(k, layout)).join('').trim();
    if (!title) issues.push(issue('warning', 'MISSING_DRAWING_TITLE', `${layout.layout}: drawing title is empty`, layout.layout));
  }
  for (const [number, sources] of numbers) if (sources.length > 1) issues.push(issue('error', 'DUPLICATE_DWG_NUMBER', `Duplicate drawing number ${number} — ${sources.length} selected entries.`, number, {sources}));
  return issues;
}

const issue = (severity, code, message, context = '', details = {}) => ({ severity, code, message, context, ...details });

export const defaultPreset = {
  name: 'HBA Drawing List', titleBlockName: 'A1_TITLE_EN', targetWorksheet: 'Drawing List', sheetSize:'A1', sortMethod: 'layoutOrder', autoClassify:true, blankRowOnPrefixChange:true, defaultCategory:'OTHER DRAWINGS', classificationOrder:['PLANS & ELEVATIONS','DETAILS','DOOR SCHEDULE','DOOR DETAIL','MILLWORK DETAIL','OTHER DRAWINGS'],
  classificationRules:[
    {name:'DOOR SCHEDULE',keywords:['DOOR SCHEDULE']},
    {name:'DOOR DETAIL',keywords:['DOOR DETAIL']},
    {name:'MILLWORK DETAIL',keywords:['MILLWORK','JOINERY']},
    {name:'PLANS & ELEVATIONS',keywords:['PLAN','ELEVATION']},
    {name:'DETAILS',keywords:['DETAIL','SECTION']}
  ],
  numberClassificationRules:[
    {name:'PLANS & ELEVATIONS',codes:['P#','EL','ELE','ELEV','EV']},
    {name:'DETAILS',codes:['DC','DW','DF']},
    {name:'DOOR SCHEDULE',codes:['DS']},
    {name:'DOOR DETAIL',codes:['DD']},
    {name:'MILLWORK DETAIL',codes:['DM','MW','JN']}
  ],
  outputFields: [
    { name: 'Drawing Number', startCell: 'A9', formula: '{DWG_NUMBER}', transforms: [{ type: 'trim' }] },
    { name: 'Drawing Title', startCell: 'B9', formula: '{DRAWING_TITLE_1} {DRAWING_TITLE_3} {DRAWING_TITLE_2} {DRAWING_TITLE_4}', transforms: [{ type: 'trim' }, { type: 'dedupeSpaces' }, { type: 'uppercaseEnglish' }, { type: 'replace', find: 'ELEVATIONS', replace: 'ELEVATION' }] },
    { name: 'Size', startCell: 'C9', formula: '{SHEET_SIZE}', transforms: [{ type: 'trim' }, { type: 'uppercaseEnglish' }] },
    { name: 'Current Batch', startCell: 'D9', formula: '{ISSUED_THIS_BATCH}', transforms: [{ type: 'trim' }] }
  ]
};

const defaultNumberClassificationRules=[
  {name:'PLANS & ELEVATIONS',codes:['P#','EL','ELE','ELEV','EV']},
  {name:'DETAILS',codes:['DC','DW','DF']},
  {name:'DOOR SCHEDULE',codes:['DS']},
  {name:'DOOR DETAIL',codes:['DD']},
  {name:'MILLWORK DETAIL',codes:['DM','MW','JN']}
];
