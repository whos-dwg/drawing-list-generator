import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPreview, defaultPreset, normalizeScanResult } from './core.mjs';
import { normalizeCadInput } from './cad-input.mjs';

const root=path.dirname(fileURLToPath(import.meta.url)),publicDir=path.join(root,'public'),workerDir=path.join(root,'workers');
const runner=path.join(workerDir,'run-cad-scan.ps1'),excelWriter=path.join(workerDir,'write-excel-template.ps1'),xlsWriter=path.join(workerDir,'write-excel-xls.ps1');
const cacheDir=path.join(root,'scan-cache'),logDir=path.resolve(root,'..','logs','cad-diagnostics');
const settingsFile=path.join(root,'local-settings.json');
const applicationVersion='2026.11.02-v8.13',scannerVersion='drawing-scanner-2026-11-02-configurable-input-5',port=Number(process.env.PORT||4310);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json'};
let lastHeartbeat=Date.now();
let savedCadInput=normalizeCadInput();
try { savedCadInput=normalizeCadInput(JSON.parse(await fs.readFile(settingsFile,'utf8')).cadInput); } catch {}

await fs.mkdir(logDir,{recursive:true});
await cleanupResidualSuccessLogs();

const server=http.createServer(async(req,res)=>{
  try{
    lastHeartbeat=Date.now();
    if(req.method==='GET'&&req.url==='/api/heartbeat')return json(res,200,{ok:true});
    if(req.method==='GET'&&req.url==='/api/preset')return json(res,200,{...defaultPreset,cadInput:savedCadInput});
    if(req.method==='POST'&&req.url==='/api/cad-input'){
      const body=await readJson(req);let config;
      try{config=normalizeCadInput(body.cadInput)}catch(error){return json(res,400,{error:'INVALID_CAD_INPUT',message:error.message})}
      await fs.writeFile(settingsFile+'.tmp',JSON.stringify({cadInput:config},null,2),'utf8');
      await fs.rename(settingsFile+'.tmp',settingsFile);savedCadInput=config;
      return json(res,200,{cadInput:config});
    }
    if(req.method==='GET'&&req.url==='/api/system'){try{return json(res,200,JSON.parse(await runPowerShell(runner,['-DetectOnly'])))}catch(error){return json(res,200,{available:false,installations:[],message:error.message})}}
    if(req.method==='POST'&&req.url==='/api/open-diagnostics'){await openFolder(logDir);return json(res,200,{ok:true,path:logDir})}
    if(req.method==='POST'&&req.url==='/api/preview'){const body=await readJson(req);return json(res,200,buildPreview(body.scan,body.preset))}
    if(req.method==='POST'&&req.url==='/api/scan')return handleScan(req,res);
    if(req.method==='POST'&&req.url==='/api/generate'){
      const body=await readJson(req,50*1024*1024),preview=buildPreview(body.scan,body.preset);
      if(preview.issues.some(x=>x.severity==='error'))return json(res,422,{error:'VALIDATION_FAILED',issues:preview.issues});
      const isXls=String(body.templateFileName??'').toLowerCase().endsWith('.xls'),extension=isXls?'.xls':'.xlsx',dir=await fs.mkdtemp(path.join(os.tmpdir(),'drawing-list-xlsx-'));
      const input=path.join(dir,`template${extension}`),output=path.join(dir,`drawing-list${extension}`),plan=path.join(dir,'plan.json');
      await fs.writeFile(input,Buffer.from(body.templateBase64,'base64'));await fs.writeFile(plan,JSON.stringify({preset:body.preset,preview}),'utf8');
      await runPowerShell(isXls?xlsWriter:excelWriter,['-Template',input,'-Plan',plan,'-Output',output]);const data=await fs.readFile(output);await fs.rm(dir,{recursive:true,force:true});
      return json(res,200,{fileName:`Drawing List${extension}`,mimeType:isXls?'application/vnd.ms-excel':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',dataBase64:data.toString('base64')});
    }
    if(req.method==='GET')return serve(req,res);json(res,404,{error:'NOT_FOUND'});
  }catch(error){json(res,500,{error:'REQUEST_FAILED',message:error.message})}
});

async function handleScan(req,res){
  const started=Date.now(),requestedId=String(req.headers['x-scan-id']||''),scanId=/^\d{8}-\d{6}-[A-Z0-9]{4}$/.test(requestedId)?requestedId:createScanId();
  let stage='REQUEST_RECEIVED',diagnosticLog=path.join(logDir,`scan_${scanId}_unknown.log`),workDir='';
  await appendDiagnostic(diagnosticLog,scanId,'API','REQUEST_RECEIVED',`applicationVersion=${applicationVersion} windows=${os.type()} ${os.release()} ${os.arch()}`);
  try{
    const body=await readJson(req,40*1024*1024),fileName=safeName(body.fileName,'.dwg'),desiredLog=path.join(logDir,`scan_${scanId}_${safeLogName(fileName)}.log`);
    await fs.rename(diagnosticLog,desiredLog);diagnosticLog=desiredLog;
    const config=normalizeCadInput(body.cadInput??savedCadInput);
    const bytes=Buffer.from(body.dataBase64,'base64');stage='FILE_ACCEPTED';await appendDiagnostic(diagnosticLog,scanId,'API',stage,`fileName=${fileName} size=${bytes.length} blockNames=${config.blockNames.join(',')}`);
    const key=crypto.createHash('sha256').update(scannerVersion).update(JSON.stringify(config)).update(bytes).digest('hex'),cachePath=path.join(cacheDir,`${key}.json`);await fs.mkdir(cacheDir,{recursive:true});
    try{await appendDiagnostic(diagnosticLog,scanId,'SCAN','BACKEND_PARSE_BEGIN','source=scan-cache');const cached=normalizeScanResult(JSON.parse(await fs.readFile(cachePath,'utf8')),config);cached.fileName=fileName;cached.cadInput=config;cached.cacheHit=true;cached.scanDurationMs=Date.now()-started;cached.diagnosticId=scanId;await appendDiagnostic(diagnosticLog,scanId,'API','RESULT_PARSE_OK','cacheHit=true JSONValid=true');await appendDiagnostic(diagnosticLog,scanId,'SCAN','BACKEND_PARSE_OK','cacheHit=true JSONValid=true');return sendSuccessfulScan(res,cached,diagnosticLog,scanId,started)}catch{}
    workDir=await fs.mkdtemp(path.join(os.tmpdir(),'drawing-list-'));const dwg=path.join(workDir,fileName),out=path.join(workDir,'scan.json');await fs.writeFile(dwg,bytes);
    stage='SCANNER_START';await appendDiagnostic(diagnosticLog,scanId,'API',stage,`temporaryWorkingPath=${workDir} inputFullPath=${dwg}`);
    const configPath=path.join(workDir,'cad-input.json');await fs.writeFile(configPath,JSON.stringify(config),'utf8');
    await runPowerShell(runner,['-Dwg',dwg,'-Output',out,'-DiagnosticLog',diagnosticLog,'-ScanId',scanId,'-ApplicationVersion',applicationVersion,'-ScanConfig',configPath]);
    stage='SCANNER_COMPLETE';await appendDiagnostic(diagnosticLog,scanId,'API',stage,'workerExitCode=0');
    stage='RESULT_PARSE_BEGIN';await appendDiagnostic(diagnosticLog,scanId,'API',stage,`output=${out}`);await appendDiagnostic(diagnosticLog,scanId,'SCAN','BACKEND_PARSE_BEGIN',`output=${out}`);const outputStat=await fs.stat(out),result=normalizeScanResult(JSON.parse(await fs.readFile(out,'utf8')),config);result.cadInput=config;
    await appendDiagnostic(diagnosticLog,scanId,'OUTPUT','PARSE_OK',`JSONValid=true outputSize=${outputStat.size} scannerStatus=${result.status||'missing'}`);
    if(result.status!=='ok')throw new Error(`Scanner returned ${result.status}: ${result.error?.code||''} ${result.error?.message||''}`.trim());
    stage='RESULT_PARSE_OK';await appendDiagnostic(diagnosticLog,scanId,'API',stage,`JSONValid=true outputSize=${outputStat.size}`);await appendDiagnostic(diagnosticLog,scanId,'SCAN','BACKEND_PARSE_OK',`JSONValid=true outputSize=${outputStat.size}`);await fs.writeFile(cachePath,JSON.stringify(result),'utf8');
    result.cacheHit=false;result.scanDurationMs=Date.now()-started;result.diagnosticId=scanId;return sendSuccessfulScan(res,result,diagnosticLog,scanId,started);
  }catch(error){
    await appendDiagnostic(diagnosticLog,scanId,'API ERROR',stage,`type=${error.name} message=${singleLine(error.message)} stack=${singleLine(error.stack)}`);
    await appendDiagnostic(diagnosticLog,scanId,'SCAN RESULT','FAILED',`stage=${stage} durationMs=${Date.now()-started}`);
    return sendFailedScan(res,{error:'DWG_SCAN_FAILED',message:'Unable to analyze this DWG.',diagnosticId:scanId},diagnosticLog,scanId,stage,started);
  }finally{if(workDir)await fs.rm(workDir,{recursive:true,force:true}).catch(()=>{})}
}

async function sendSuccessfulScan(res,result,diagnosticLog,scanId,started){
  await appendDiagnostic(diagnosticLog,scanId,'API','API_RESPONSE_READY',`httpStatus=200 durationMs=${Date.now()-started}`);await appendDiagnostic(diagnosticLog,scanId,'SCAN','API_RESPONSE_READY','httpStatus=200');const payload=JSON.stringify(result);
  res.writeHead(200,{'content-type':'application/json; charset=utf-8'});res.end(payload,async()=>{await appendDiagnostic(diagnosticLog,scanId,'API','RESPONSE_SENT','httpStatus=200');await appendDiagnostic(diagnosticLog,scanId,'SCAN','COMPLETE','outputValid=true backendParse=true responseSent=true');await appendDiagnostic(diagnosticLog,scanId,'SCAN RESULT','SUCCESS',`durationMs=${Date.now()-started}`);await fs.rm(diagnosticLog,{force:true}).catch(()=>{})});
}

async function sendFailedScan(res,result,diagnosticLog,scanId,stage,started){
  await appendDiagnostic(diagnosticLog,scanId,'API','API_RESPONSE_READY',`httpStatus=500 failureStage=${stage} durationMs=${Date.now()-started}`);await appendDiagnostic(diagnosticLog,scanId,'SCAN','API_RESPONSE_READY',`httpStatus=500 failureStage=${stage}`);const payload=JSON.stringify(result);
  res.writeHead(500,{'content-type':'application/json; charset=utf-8'});res.end(payload,async()=>{await appendDiagnostic(diagnosticLog,scanId,'API','RESPONSE_SENT',`httpStatus=500 failureStage=${stage}`)});
}

server.listen(port,'127.0.0.1',()=>console.log(`Drawing List Workbench: http://127.0.0.1:${port}`));
const idleTimer=setInterval(()=>{if(Date.now()-lastHeartbeat>120000){clearInterval(idleTimer);server.close(()=>process.exit(0))}},30000);
async function cleanupResidualSuccessLogs(){for(const name of await fs.readdir(logDir).catch(()=>[])){if(!name.endsWith('.log'))continue;const file=path.join(logDir,name),text=await fs.readFile(file,'utf8').catch(()=>'');if(text.includes('[SCAN RESULT] SUCCESS'))await fs.rm(file,{force:true}).catch(()=>{})}}
function createScanId(){const d=new Date(),p=n=>String(n).padStart(2,'0'),stamp=`${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;return `${stamp}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`}
function safeLogName(name){return path.basename(name,'.dwg').replace(/[^A-Za-z0-9._-]/g,'-').slice(0,60)||'drawing'}
function singleLine(value){return String(value??'').replace(/\s+/g,' ').slice(0,4000)}
async function appendDiagnostic(file,scanId,area,stage,detail=''){await fs.appendFile(file,`${new Date().toISOString()} [${scanId}] [${area}] ${stage}${detail?` | ${detail}`:''}\n`,'utf8')}
async function serve(req,res){const rel=req.url==='/'?'index.html':decodeURIComponent(req.url.slice(1)),file=path.resolve(publicDir,rel);if(!file.startsWith(publicDir))return json(res,403,{error:'FORBIDDEN'});try{const data=await fs.readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store, no-cache, must-revalidate','pragma':'no-cache','expires':'0'});res.end(data)}catch{return json(res,404,{error:'NOT_FOUND'})}}
function json(res,status,value){res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(value))}
function safeName(name,ext){const value=path.basename(String(name||`upload${ext}`)).replace(/[^\w.() -]/g,'_');if(path.extname(value).toLowerCase()!==ext)throw new Error(`Expected ${ext} file.`);return value}
function readJson(req,limit=2*1024*1024){return new Promise((resolve,reject)=>{let size=0,chunks=[];req.on('data',c=>{size+=c.length;if(size>limit){reject(new Error('Upload is too large.'));req.destroy()}else chunks.push(c)});req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch(e){reject(e)}});req.on('error',reject)})}
function openFolder(folder){return new Promise((resolve,reject)=>{const child=spawn('C:\\Windows\\explorer.exe',['/n,','/e,',folder],{detached:true,windowsHide:false,stdio:'ignore'});let settled=false;child.once('error',error=>{if(!settled){settled=true;reject(new Error(`Unable to open the diagnostic folder: ${error.message}`))}});child.once('spawn',()=>{if(!settled){settled=true;child.unref();resolve()}})})}
function runPowerShell(script,args){return new Promise((resolve,reject)=>{const child=spawn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,...args],{windowsHide:true});let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.on('error',reject);child.on('exit',code=>code===0?resolve(out.trim()):reject(Object.assign(new Error(err.trim()||`Local worker exited with ${code}`),{exitCode:code,stdout:out,stderr:err})))})}
