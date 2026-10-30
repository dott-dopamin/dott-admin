// supabase-js CDN 없이 브라우저 기본 fetch로 Supabase Data API/Auth에 직접 연결합니다.
const DOTT_API_CFG=window.DOTT_CONFIG;
if(!DOTT_API_CFG?.supabaseUrl||!DOTT_API_CFG?.supabaseKey)throw new Error('Supabase 연결 정보가 없습니다.');

const API_BASE=String(DOTT_API_CFG.supabaseUrl).replace(/\/$/,'');
const API_KEY=DOTT_API_CFG.supabaseKey;
const SESSION_KEY='dott_supabase_session_v30';
const wait=ms=>new Promise(r=>setTimeout(r,ms));

function readSession(){
  try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch(_e){return null}
}
function saveSession(s){
  if(!s){localStorage.removeItem(SESSION_KEY);return null}
  const expiresIn=Number(s.expires_in||3600);
  const rawExp=Number(s.expires_at||0);
  const normalized={...s,expires_at:rawExp?(rawExp<1e12?rawExp*1000:rawExp):Date.now()+expiresIn*1000};
  localStorage.setItem(SESSION_KEY,JSON.stringify(normalized));
  return normalized;
}
function clearSession(){localStorage.removeItem(SESSION_KEY)}
function transientError(e){
  const msg=String(e?.message||e||'').toLowerCase();
  const status=Number(e?.status||0);
  return !status||status===408||status===425||status===429||status>=500||/failed to fetch|fetch failed|network|timeout|timed out|load failed|connection|offline|gateway|temporar|abort/.test(msg);
}
function apiError(message,status,detail){
  const e=new Error(message||`요청 실패 (${status||'unknown'})`);
  e.status=status||0;e.detail=detail;return e;
}
async function fetchWithTimeout(url,options={},timeout=12000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{return await fetch(url,{...options,signal:controller.signal})}
  finally{clearTimeout(timer)}
}
async function withRetry(label,fn,{retries=2}={}){
  let last;
  for(let attempt=0;attempt<=retries;attempt++){
    try{return await fn()}
    catch(e){
      last=e;
      if(attempt>=retries||!transientError(e))break;
      await wait(500*Math.pow(2,attempt));
    }
  }
  if(last?.name==='AbortError')throw apiError(`${label} 요청 시간이 초과되었습니다.`,408);
  throw last;
}
async function parseResponse(res){
  const text=await res.text();
  let body=null;
  if(text){try{body=JSON.parse(text)}catch(_e){body=text}}
  if(!res.ok){
    const message=body?.msg||body?.message||body?.error_description||body?.error||`요청 실패 (${res.status})`;
    throw apiError(message,res.status,body);
  }
  return body;
}
async function refreshSession(session){
  if(!session?.refresh_token)return null;
  try{
    const res=await fetchWithTimeout(`${API_BASE}/auth/v1/token?grant_type=refresh_token`,{
      method:'POST',headers:{apikey:API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({refresh_token:session.refresh_token})
    },10000);
    const body=await parseResponse(res);
    return saveSession(body);
  }catch(e){
    if(e.status===400||e.status===401){clearSession();return null}
    throw e;
  }
}
async function currentSession({refresh=true}={}){
  let s=readSession();
  if(!s)return null;
  const exp=Number(s.expires_at||0);
  if(refresh&&(!exp||Date.now()>exp-120000))s=await refreshSession(s);
  return s;
}
async function headersFor({auth=false,json=false,prefer=''}={}){
  const h={apikey:API_KEY};
  if(json)h['Content-Type']='application/json';
  if(prefer)h.Prefer=prefer;
  if(auth){
    const s=await currentSession();
    if(!s?.access_token)throw apiError('관리자 로그인이 필요합니다.',401);
    h.Authorization=`Bearer ${s.access_token}`;
  }
  return h;
}
function enc(v){return encodeURIComponent(String(v))}
async function restSelect(table,query='',label='데이터',requireAuth=false){
  return withRetry(label,async()=>{
    const res=await fetchWithTimeout(`${API_BASE}/rest/v1/${table}?${query}`,{headers:await headersFor({auth:requireAuth})});
    return (await parseResponse(res))||[];
  });
}
function sanitizeWriteRow(table,row){
  if(row===null||typeof row!=='object')return row;
  if(table==='catalog_items'){
    // catalog_items는 실제 운영 중인 기존 컬럼만 명시적으로 허용합니다.
    // 운영에 사용하는 컬럼만 명시적으로 허용합니다. is_expansion은 보드게임 확장 여부에 사용합니다.
    const allowed=['kind','name','min_players','max_players','playtime','difficulty','genre','status','location','note','image_url','is_expansion','current_borrower','current_rented_at'];
    const clean={};
    for(const key of allowed){if(Object.prototype.hasOwnProperty.call(row,key))clean[key]=row[key]}
    return clean;
  }
  return {...row};
}
async function restWrite(method,table,{id=null,row=null,ids=null,query='',prefer='return=representation'}={}){
  row=sanitizeWriteRow(table,row);
  let q=query;
  if(id)q+=(q?'&':'')+`id=eq.${enc(id)}`;
  if(ids?.length)q+=(q?'&':'')+`id=in.(${ids.map(enc).join(',')})`;
  const res=await fetchWithTimeout(`${API_BASE}/rest/v1/${table}${q?'?'+q:''}`,{
    method,headers:await headersFor({auth:true,json:row!==null,prefer}),
    ...(row!==null?{body:JSON.stringify(row)}:{})
  });
  return parseResponse(res);
}

window.DOTT_DB={
  async schedules(){return restSelect('schedules','select=*&order=event_date.asc,event_time.asc','일정')},
  async notices(){return restSelect('notices','select=*&order=created_at.asc','공지')},
  async attendance(){
    try{const rows=await restSelect('attendance_members','select=*&order=name.asc','출석',true);window.DOTT_ATTENDANCE_ERROR=null;return rows}
    catch(error){window.DOTT_ATTENDANCE_ERROR=error;console.warn('attendance_members를 불러오지 못했습니다.',error);return []}
  },
  async catalog(kind){
    const filter=kind?`&kind=eq.${enc(kind)}`:'';
    return restSelect('catalog_items',`select=*${filter}&order=name.asc`,'게임 목록');
  },
  async rentalLoans(){return restSelect('rental_loans','select=*&order=rented_at.desc,created_at.desc','대여 관리대장',true)},
  async settings(){
    try{const rows=await restSelect('site_settings','select=*&id=eq.main&limit=1','사이트 설정');return rows[0]||null}
    catch(error){console.warn('site_settings를 불러오지 못했습니다.',error);return null}
  },
  async saveSettings(row){
    const payload={id:'main',...row,updated_at:new Date().toISOString()};
    const body=await restWrite('POST','site_settings',{row:payload,query:'on_conflict=id',prefer:'resolution=merge-duplicates,return=representation'});
    return Array.isArray(body)?body[0]:body;
  },
  async insert(table,row){const body=await restWrite('POST',table,{row});return Array.isArray(body)?body[0]:body},
  async update(table,id,row){const body=await restWrite('PATCH',table,{id,row});return Array.isArray(body)?body[0]:body},
  async remove(table,id){await restWrite('DELETE',table,{id,prefer:'return=minimal'})},
  async removeMany(table,ids){if(ids?.length)await restWrite('DELETE',table,{ids,prefer:'return=minimal'})},
  async myRole(){
    const res=await fetchWithTimeout(`${API_BASE}/rest/v1/rpc/dott_my_role`,{
      method:'POST',headers:await headersFor({auth:true,json:true}),body:'{}'
    },10000);
    return parseResponse(res);
  },
  async listAdminMembers(){
    const res=await fetchWithTimeout(`${API_BASE}/rest/v1/rpc/dott_list_admins`,{
      method:'POST',headers:await headersFor({auth:true,json:true}),body:'{}'
    },12000);
    return (await parseResponse(res))||[];
  },
  async setAdminMember(email,action){
    const res=await fetchWithTimeout(`${API_BASE}/rest/v1/rpc/dott_set_admin_member`,{
      method:'POST',headers:await headersFor({auth:true,json:true}),
      body:JSON.stringify({p_email:email,p_action:action})
    },12000);
    return parseResponse(res);
  },
  async session(){return currentSession()},
  async signIn(email,password){
    const res=await fetchWithTimeout(`${API_BASE}/auth/v1/token?grant_type=password`,{
      method:'POST',headers:{apikey:API_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password})
    },12000);
    return saveSession(await parseResponse(res));
  },
  async signOut(){
    const s=readSession();
    if(s?.access_token){
      try{await fetchWithTimeout(`${API_BASE}/auth/v1/logout`,{method:'POST',headers:{apikey:API_KEY,Authorization:`Bearer ${s.access_token}`}},8000)}catch(_e){}
    }
    clearSession();
  },
  async changePassword(password){
    const s=await currentSession();
    if(!s?.access_token)throw apiError('관리자 로그인이 필요합니다.',401);
    const res=await fetchWithTimeout(`${API_BASE}/auth/v1/user`,{
      method:'PUT',headers:{apikey:API_KEY,Authorization:`Bearer ${s.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({password})
    },12000);
    return parseResponse(res);
  },
  async uploadImage(file){
    const s=await currentSession();
    if(!s?.access_token)throw apiError('관리자 로그인이 필요합니다.',401);
    const ext=(file.name.split('.').pop()||'jpg').toLowerCase();
    const path=`${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.${ext}`;
    const res=await fetchWithTimeout(`${API_BASE}/storage/v1/object/catalog-images/${path}`,{
      method:'POST',headers:{apikey:API_KEY,Authorization:`Bearer ${s.access_token}`,'Content-Type':file.type||'application/octet-stream','x-upsert':'false'},body:file
    },20000);
    await parseResponse(res);
    return `${API_BASE}/storage/v1/object/public/catalog-images/${path}`;
  }
};

// DOTT 회비 · 회계
Object.assign(window.DOTT_DB,{
  async feeRecords(){try{return await restSelect('fee_records','select=*&order=fee_month.desc,paid_at.asc','회비',true)}catch(e){console.warn('fee_records',e);return []}},
  async accountingEntries(){try{return await restSelect('accounting_entries','select=*&order=entry_date.asc,created_at.asc','회계장부',true)}catch(e){console.warn('accounting_entries',e);return []}},
  async accountingReceipts(){try{return await restSelect('accounting_receipts','select=*&order=entry_id.asc,sort_order.asc,created_at.asc','회계 영수증',true)}catch(e){console.warn('accounting_receipts',e);return []}},
  async accountingClosures(){try{return await restSelect('accounting_month_closures','select=*&order=month.desc','월 마감',true)}catch(e){console.warn('accounting_month_closures',e);return []}},
  async upsertFee(row){
    const res=await fetchWithTimeout(`${API_BASE}/rest/v1/rpc/dott_save_fee`,{
      method:'POST',
      headers:await headersFor({auth:true,json:true}),
      body:JSON.stringify({
        p_member_id:row.member_id,
        p_member_name:row.member_name,
        p_fee_month:row.fee_month,
        p_status:row.status,
        p_amount:Number(row.amount??5000),
        p_paid_at:row.status==='paid'?(row.paid_at||null):null,
        p_note:row.note||''
      })
    },15000);
    return parseResponse(res);
  },
  async closeAccountingMonth(month){return this.insert('accounting_month_closures',{month,closed_at:new Date().toISOString()})},
  async reopenAccountingMonth(id){return this.remove('accounting_month_closures',id)},
  async uploadReceipt(file){
    const s=await currentSession(); if(!s?.access_token)throw apiError('관리자 로그인이 필요합니다.',401);
    const ext=(file.name.split('.').pop()||'bin').toLowerCase(); const path=`${new Date().toISOString().slice(0,7)}/${crypto.randomUUID()}.${ext}`;
    const res=await fetchWithTimeout(`${API_BASE}/storage/v1/object/accounting-receipts/${path}`,{method:'POST',headers:{apikey:API_KEY,Authorization:`Bearer ${s.access_token}`,'Content-Type':file.type||'application/octet-stream','x-upsert':'false'},body:file},20000);
    await parseResponse(res); return {path,name:file.name,type:file.type||'application/octet-stream'};
  },
  async receiptBlob(path){
    const s=await currentSession(); if(!s?.access_token)throw apiError('관리자 로그인이 필요합니다.',401);
    const res=await fetchWithTimeout(`${API_BASE}/storage/v1/object/authenticated/accounting-receipts/${path}`,{headers:{apikey:API_KEY,Authorization:`Bearer ${s.access_token}`}},20000);
    if(!res.ok)throw apiError('영수증을 불러오지 못했습니다.',res.status); return res.blob();
  },
  async deleteReceipt(path){
    const s=await currentSession(); if(!s?.access_token||!path)return;
    const res=await fetchWithTimeout(`${API_BASE}/storage/v1/object/accounting-receipts/${path}`,{method:'DELETE',headers:{apikey:API_KEY,Authorization:`Bearer ${s.access_token}`}},12000); if(!res.ok)throw apiError('영수증 삭제 실패',res.status);
  },
  async addAccountingReceipt(entryId,receipt,sortOrder){
    return this.insert('accounting_receipts',{
      entry_id:entryId,
      receipt_path:receipt.path,
      receipt_name:receipt.name||'receipt',
      receipt_type:receipt.type||'application/octet-stream',
      sort_order:Number(sortOrder)||1
    });
  }
});


// DOTT 전체 데이터 백업 · 복원
async function backupTable(table,label){
  // Page through results so a growing game collection is not silently cut at 1000 rows.
  const pageSize=500, rows=[];
  for(let page=0;page<200;page++){
    const batch=await restSelect(table,`select=*&order=id.asc&limit=${pageSize}&offset=${page*pageSize}`,label,true);
    rows.push(...batch);
    if(batch.length<pageSize)return rows;
  }
  throw new Error(`${label} 데이터가 너무 많아 안전하게 백업하지 못했습니다.`);
}
Object.assign(window.DOTT_DB,{
  async createFullBackup(){
    const [schedules,notices,attendance,catalog_items,site_settings,fee_records,accounting_entries,accounting_receipts,accounting_month_closures,rental_loans]=await Promise.all([
      backupTable('schedules','일정 백업'),
      backupTable('notices','공지 백업'),
      backupTable('attendance_members','출석 백업'),
      backupTable('catalog_items','게임 목록 백업'),
      backupTable('site_settings','사이트 설정 백업'),
      backupTable('fee_records','회비 백업'),
      backupTable('accounting_entries','회계장부 백업'),
      backupTable('accounting_receipts','회계 영수증 백업'),
      backupTable('accounting_month_closures','월 마감 백업'),
      backupTable('rental_loans','대여 관리대장 백업')
    ]);
    return {
      format:'DOTT_FULL_BACKUP',
      version:2,
      created_at:new Date().toISOString(),
      tables:{schedules,notices,attendance_members:attendance,catalog_items,site_settings,fee_records,accounting_entries,accounting_receipts,accounting_month_closures,rental_loans}
    };
  }
});
