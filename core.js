/* Local archive storage. No network access and no dynamic code execution. */
const RELEASE = '1.2.0';
const MIB = 1024 * 1024, MAX_FILE = 100 * MIB, MAX_BACKUP = 512 * MIB;
const ROOTS = [{id:'admin',name:'الإدارة',parent:null},{id:'technical',name:'الفنية',parent:null}];
const MIME = {pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',tif:'image/tiff',tiff:'image/tiff',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',dwg:'application/octet-stream',dxf:'application/octet-stream'};
const fail = message => { throw new Error(message); };
const req = request => new Promise((resolve,reject) => {request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
const done = tx => new Promise((resolve,reject) => {tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error || new Error('أُلغيت العملية، لم تُحفظ التغييرات.'));tx.onerror=()=>{};});
let database;
async function openArchive() {
  if (!globalThis.indexedDB || !globalThis.crypto?.subtle) fail('هذا المتصفح لا يدعم التخزين المطلوب. افتح الملف في إصدار حديث من Edge أو Chrome.');
  const opening=indexedDB.open('document-archive-web:'+location.pathname.replace(/[^/]*$/,'')+'v1',1);
  opening.onupgradeneeded=()=>{
    const db=opening.result;
    const docs=db.createObjectStore('documents',{keyPath:'id'});docs.createIndex('sha256','sha256',{unique:true});
    db.createObjectStore('files',{keyPath:'id'});
    const cats=db.createObjectStore('categories',{keyPath:'id'});ROOTS.forEach(c=>cats.add(c));
  };
  opening.onblocked=()=>notice('أغلق نوافذ أرشيف الأخرى ثم أعد فتح الملف.',true);
  database=await req(opening);
  database.onversionchange=()=>{database.close();notice('أُغلق الاتصال للتحديث. أعد فتح التطبيق.',true);};
}
async function all(store) {return req(database.transaction(store).objectStore(store).getAll());}
async function get(store,id) {return req(database.transaction(store).objectStore(store).get(id));}
function cleanText(value,max,required=false) {
  if(typeof value!=='string' || value.length>max || (required&&!value.trim())) fail('بيانات نصية غير صالحة أو أطول من المسموح.');
  return value.trim();
}
function metadata(input) {
  const d={};
  for(const [key,max] of Object.entries({title:250,reference:150,issuer:250,notes:5000,text:100000})) d[key]=cleanText(input[key]??'',max,key==='title');
  d.category=cleanText(input.category,100,true);
  d.date=cleanText(input.date??'',10);
  if(d.date && (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||!Number.isFinite(Date.parse(d.date))||new Date(d.date).toISOString().slice(0,10)!==d.date)) fail('تاريخ المستند غير صالح.');
  return d;
}
const normalize = s => s.toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي');
const hash = async blob => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
async function validateFile(blob,name) {
  cleanText(name,255,true);
  const ext=name.split('.').pop().toLowerCase();
  if(!MIME[ext]||!blob.size||blob.size>MAX_FILE) fail('نوع غير مدعوم، ملف فارغ، أو حجم أكبر من 100 MiB.');
  const head=new Uint8Array(await blob.slice(0,1024).arrayBuffer());
  const starts=bytes=>bytes.every((b,i)=>head[i]===b), ascii=new TextDecoder().decode(head);
  const sig={pdf:ascii.startsWith('%PDF-'),png:starts([137,80,78,71,13,10,26,10]),jpg:starts([255,216,255]),jpeg:starts([255,216,255]),tif:starts([73,73,42,0])||starts([77,77,0,42]),tiff:starts([73,73,42,0])||starts([77,77,0,42]),doc:starts([208,207,17,224,161,177,26,225]),xls:starts([208,207,17,224,161,177,26,225]),docx:starts([80,75,3,4]),xlsx:starts([80,75,3,4]),dwg:ascii.startsWith('AC10'),dxf:ascii.startsWith('AutoCAD Binary DXF')||ascii.includes('SECTION')};
  if(!sig[ext]) fail('توقيع الملف لا يطابق الامتداد.');
  return ext;
}
async function addDocument(file,input) {
  const ext=await validateFile(file,file.name), info=metadata(input), sha256=await hash(file);
  const tx=database.transaction(['documents','files','categories'],'readwrite'), completion=done(tx);
  const docs=tx.objectStore('documents');let result;
  const cat=tx.objectStore('categories').get(info.category);
  cat.onsuccess=()=>{
    if(!cat.result){tx.abort();return;}
    const check=docs.index('sha256').get(sha256);
    check.onsuccess=()=>{
      if(check.result){result={duplicate:check.result};return;}
      const id=crypto.randomUUID(), now=new Date().toISOString();
      const doc={...info,id,name:file.name,ext,size:file.size,sha256,created:now,updated:now,trashed:false};
      docs.add(doc);tx.objectStore('files').add({id,blob:file.slice(0,file.size,MIME[ext])});result={document:doc};
    };
  };
  await completion;return result;
}
async function editDocument(id,input,trash) {
  const info=input?metadata(input):null;
  const tx=database.transaction(['documents','categories'],'readwrite'), completion=done(tx), store=tx.objectStore('documents');
  const read=store.get(id);read.onsuccess=()=>{
    if(!read.result){tx.abort();return;}
    const write=()=>store.put({...read.result,...info,...(trash===undefined?{}:{trashed:trash}),updated:new Date().toISOString()});
    if(info){const cat=tx.objectStore('categories').get(info.category);cat.onsuccess=()=>{if(cat.result)write();else tx.abort();};}else write();
  };await completion;
}
async function addCategory(name,parent) {
  name=cleanText(name,150,true);
  const tx=database.transaction('categories','readwrite'), completion=done(tx), store=tx.objectStore('categories');let error;
  const read=store.getAll();read.onsuccess=()=>{
    if(!read.result.some(c=>c.id===parent)||read.result.some(c=>c.parent===parent&&normalize(c.name)===normalize(name))) {error='التصنيف موجود أو التصنيف الأب غير صالح.';tx.abort();return;}
    store.add({id:crypto.randomUUID(),name,parent});
  };try{await completion;}catch(e){throw new Error(error||e.message);}
}
async function deleteCategory(id) {
  if(ROOTS.some(c=>c.id===id)) fail('لا يمكن حذف التصنيفات الرئيسية.');
  const tx=database.transaction(['categories','documents'],'readwrite'), completion=done(tx);let error;
  const cats=tx.objectStore('categories').getAll();cats.onsuccess=()=>{
    const docs=tx.objectStore('documents').getAll();docs.onsuccess=()=>{
      if(cats.result.some(c=>c.parent===id)||docs.result.some(d=>d.category===id)){error='التصنيف يحتوي مستندات أو تصنيفات فرعية، بما فيها السلة.';tx.abort();return;}
      tx.objectStore('categories').delete(id);
    };
  };try{await completion;}catch(e){throw new Error(error||e.message);}
}
function categoryPath(id,cats) {const parts=[];let c=cats.find(c=>c.id===id),seen=new Set();while(c&&!seen.has(c.id)){seen.add(c.id);parts.unshift(c.name);c=cats.find(x=>x.id===c.parent);}return parts.join(' / ');}
function categoryContains(id,parent,cats) {let c=cats.find(c=>c.id===id),seen=new Set();while(c&&!seen.has(c.id)){if(c.id===parent)return true;seen.add(c.id);c=cats.find(x=>x.id===c.parent);}return false;}
async function snapshot() {
  const tx=database.transaction(['documents','files','categories']);
  const [documents,files,categories]=await Promise.all(['documents','files','categories'].map(s=>req(tx.objectStore(s).getAll())));
  return {documents,files,categories};
}
async function exportArchive() {
  const {documents,files,categories}=await snapshot(), map=new Map(files.map(f=>[f.id,f.blob])),parts=[];
  if(documents.reduce((n,d)=>n+d.size,0)>MAX_BACKUP-8*MIB) fail('الأرشيف يتجاوز حد التصدير لهذه النسخة (512 MiB).');
  for(const d of documents){const blob=map.get(d.id);if(!blob||blob.size!==d.size||await hash(blob)!==d.sha256)fail('تعذّر فحص أحد الأصول. لم تُنشأ نسخة ناقصة.');parts.push(blob);}
  const header=new TextEncoder().encode(JSON.stringify({format:'document-archive',schema:1,version:RELEASE,categories,documents}));
  if(header.length>8*MIB)fail('بيانات النسخة الوصفية أكبر من الحد المسموح.');
  const prefix=new Uint8Array(12);prefix.set(new TextEncoder().encode('ARCHIVE1'));new DataView(prefix.buffer).setUint32(8,header.length,true);
  const result=new Blob([prefix,header,...parts],{type:'application/octet-stream'});
  if(result.size>MAX_BACKUP)fail('النسخة أكبر من 512 MiB.');return result;
}
async function parseBackup(file) {
  if(file.size<12||file.size>MAX_BACKUP)fail('حجم النسخة غير صالح؛ الحد 512 MiB.');
  const prefix=await file.slice(0,12).arrayBuffer();
  if(new TextDecoder().decode(prefix.slice(0,8))!=='ARCHIVE1')fail('اختر نسخة .archive من نسخة HTML. نسخ Windows ZIP ليست متوافقة معها.');
  const length=new DataView(prefix).getUint32(8,true);if(length>8*MIB||length+12>file.size)fail('رأس النسخة غير صالح.');
  let data;try{data=JSON.parse(await file.slice(12,12+length).text());}catch{fail('بيانات النسخة غير قابلة للقراءة.');}
  if(data?.format!=='document-archive'||data.schema!==1||!Array.isArray(data.documents)||!Array.isArray(data.categories)||data.documents.length>10000||data.categories.length>2000)fail('صيغة النسخة غير مدعومة.');
  const ids=new Set(), hashes=new Set(),cats=[];
  for(const c of data.categories){if(!c||typeof c!=='object')fail('تصنيف غير صالح.');const clean={id:cleanText(c.id,100,true),name:cleanText(c.name,150,true),parent:c.parent===null?null:cleanText(c.parent,100,true)};if(ids.has(clean.id))fail('تصنيف مكرر.');ids.add(clean.id);cats.push(clean);}
  for(const root of ROOTS)if(!cats.some(c=>c.id===root.id&&c.name===root.name&&c.parent===null))fail('التصنيفات الرئيسية غير صالحة.');
  for(const c of cats){if(c.parent===null&&!ROOTS.some(r=>r.id===c.id))fail('جذر تصنيف غير صالح.');const seen=new Set();let node=c;while(node){if(seen.has(node.id))fail('حلقة في التصنيفات.');seen.add(node.id);if(node.parent&&!ids.has(node.parent))fail('تصنيف أب مفقود.');node=cats.find(x=>x.id===node.parent);}}
  const docs=[],files=[];let offset=12+length;ids.clear();
  for(const d of data.documents){
    if(!d||typeof d!=='object')fail('مستند غير صالح.');
    const info=metadata(d),id=cleanText(d.id,100,true),name=cleanText(d.name,255,true);
    if(ids.has(id)||typeof d.sha256!=='string'||!/^[a-f0-9]{64}$/.test(d.sha256)||hashes.has(d.sha256)||!Number.isSafeInteger(d.size)||d.size<1||d.size>MAX_FILE||offset+d.size>file.size||typeof d.trashed!=='boolean'||!cats.some(c=>c.id===info.category))fail('فهرس الملفات غير صالح.');
    for(const time of [d.created,d.updated])if(typeof time!=='string'||time.length>30||!Number.isFinite(Date.parse(time)))fail('وقت مستند غير صالح.');
    const blob=file.slice(offset,offset+d.size);offset+=d.size;
    const ext=await validateFile(blob,name);if(await hash(blob)!==d.sha256)fail('فشل فحص البصمة؛ النسخة تالفة أو عُدلت. لم تُستعد أي ملفات.');
    ids.add(id);hashes.add(d.sha256);docs.push({...info,id,name,ext,size:d.size,sha256:d.sha256,created:d.created,updated:d.updated,trashed:d.trashed});files.push({id,blob:blob.slice(0,blob.size,MIME[ext])});
  }
  if(offset!==file.size)fail('بيانات زائدة في النسخة.');return {documents:docs,files,categories:cats};
}
async function restoreArchive(data) {
  // All validation occurs before entering this single, atomic merge transaction.
  const tx=database.transaction(['documents','files','categories'],'readwrite'), completion=done(tx);let added=0,skipped=0;
  const categoryRead=tx.objectStore('categories').getAll();categoryRead.onsuccess=()=>{
    const cats=categoryRead.result, mapping=new Map(ROOTS.map(c=>[c.id,c.id]));
    const pending=data.categories.filter(c=>!mapping.has(c.id));
    while(pending.length){let progress=false;for(let i=pending.length-1;i>=0;i--){const c=pending[i];if(!mapping.has(c.parent))continue;const parent=mapping.get(c.parent);let target=cats.find(x=>x.parent===parent&&normalize(x.name)===normalize(c.name));if(!target){target={id:crypto.randomUUID(),name:c.name,parent};cats.push(target);tx.objectStore('categories').add(target);}mapping.set(c.id,target.id);pending.splice(i,1);progress=true;}if(!progress){tx.abort();return;}}
    const read=tx.objectStore('documents').getAll();read.onsuccess=()=>{
      const hashes=new Set(read.result.map(d=>d.sha256)),files=new Map(data.files.map(f=>[f.id,f.blob]));
      for(const d of data.documents){if(hashes.has(d.sha256)){skipped++;continue;}const id=crypto.randomUUID();tx.objectStore('documents').add({...d,id,category:mapping.get(d.category)});tx.objectStore('files').add({id,blob:files.get(d.id)});hashes.add(d.sha256);added++;}
    };
  };await completion;return {added,skipped};
}
