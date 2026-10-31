const app=document.getElementById('app');
let tab='dashboard';
let statsMonth=todayYmd().slice(0,7);
let attendanceFilter='all';
let attendanceSearch='';
let attendanceMode='check'; // check | manage
let attendanceCheckFilter='pending'; // pending | done
let attendanceWorkDate=todayYmd();
let attendanceAutoDate=attendanceWorkDate;
let attendanceDateManual=false;
let attendanceWriting=false;
let attendanceSyncing=false;
let scheduleView='month';
let scheduleCursor=new Date(); scheduleCursor.setDate(1);
let selectedScheduleIds=new Set();
let accountingSubtab='fees';
let accountingMonth=new Date(); accountingMonth.setDate(1);
let accountingFilter='all';
let accountingSearch='';
let data={schedules:[],notices:[],attendance:[],boardgame:[],murder:[],deduction:[],settings:null,fees:[],ledger:[],receipts:[],closures:[],rentals:[]};
let adminLoadWarnings=[];
let startupCycle=0;
let startupDataPending=false;
let startupPendingKeys=new Set();
let startupWaitingTab=null;
let dottAdminRole=null;
let dottAdminEmail='';

(async()=>{
  try{
    const s=await DOTT_DB.session();
    if(!s)return renderLogin();
    await ensureAdminRole();
    await loadStartupDashboard();
  }catch(e){
    console.warn('관리자 접근 권한 확인 실패',e);
    renderAccessError(e);
  }
})();

async function ensureAdminRole(){
  const role=await DOTT_DB.myRole();
  if(role!=='owner'&&role!=='admin')throw new Error('승인된 운영진 계정이 아닙니다. 최고관리자에게 문의해 주세요.');
  dottAdminRole=role;
  const session=await DOTT_DB.session();
  dottAdminEmail=String(session?.user?.email||'');
  return role;
}
function renderAccessError(e){
  const message=esc(e?.message||String(e)||'권한 확인 실패');
  app.innerHTML=`${nav('admin')}<div class="login-box"><span class="eyebrow">접근 권한 확인</span><h1>관리실에 연결하지 못했어요</h1><p class="settings-access-error">${message}</p><p class="settings-access-help">운영진 역할을 확인할 수 없으면 데이터는 불러오지 않습니다. Supabase에 <code>dott_my_role()</code> 함수가 있는지 확인해 주세요.</p><button class="btn primary" id="retryAdmin">다시 확인</button> <button class="btn" id="backLogin">로그인 화면</button></div>${footer()}`;
  document.getElementById('retryAdmin').onclick=()=>location.reload();
  document.getElementById('backLogin').onclick=async()=>{await DOTT_DB.signOut();dottAdminRole=null;renderLogin()};
}

function renderLogin(){
  app.innerHTML=`${nav('admin')}<div class="login-box"><span class="eyebrow">🔒 관리자</span><h1>관리자 로그인</h1><p style="color:var(--muted);font-size:13px;line-height:1.6">실제 운영용 관리자 로그인입니다. Supabase Authentication에 만든 관리자 이메일/비밀번호를 사용하세요.</p><label class="label">이메일</label><input id="email" class="field" type="email" placeholder="admin@example.com"><label class="label" style="margin-top:12px">비밀번호</label><input id="password" class="field" type="password" placeholder="비밀번호"><button id="login" class="btn primary" style="width:100%;margin-top:14px">로그인</button><div class="error" id="err"></div></div>${footer()}`;
  document.getElementById('login').onclick=async()=>{
    const btn=document.getElementById('login');
    btn.disabled=true;
    try{
      await DOTT_DB.signIn(document.getElementById('email').value,document.getElementById('password').value);
      await ensureAdminRole();
      await loadStartupDashboard();
    }catch(e){const label=document.getElementById('err');if(label)label.textContent=e.message||String(e);else renderAccessError(e)}
    finally{btn.disabled=false}
  };
}

async function loadAll(){
  const jobs=getAdminLoadJobs();
  const results=await Promise.allSettled(jobs.map(x=>x[2]));
  adminLoadWarnings=[];
  results.forEach((r,i)=>{
    const [key,label]=jobs[i];
    if(r.status==='fulfilled')data[key]=r.value;
    else{adminLoadWarnings.push(label);console.warn(`${label} 불러오기 실패`,r.reason)}
  });
  if(window.DOTT_ATTENDANCE_ERROR&&!adminLoadWarnings.includes('출석'))adminLoadWarnings.push('출석');
  if(window.DOTT_FEES_ERROR&&!adminLoadWarnings.includes('회비'))adminLoadWarnings.push('회비');
}


function getAdminLoadJobs(){
  return [
    ['schedules','일정',DOTT_DB.schedules()],
    ['notices','공지',DOTT_DB.notices()],
    ['attendance','출석',DOTT_DB.attendance()],
    ['boardgame','보드게임',DOTT_DB.catalog('boardgame')],
    ['murder','머더미스터리',DOTT_DB.catalog('murder')],
    ['deduction','추리게임',DOTT_DB.catalog('deduction')],
    ['settings','사이트 설정',DOTT_DB.settings()],
    ['fees','회비',DOTT_DB.feeRecords()],
    ['ledger','회계장부',DOTT_DB.accountingEntries()],
    ['receipts','회계 영수증',DOTT_DB.accountingReceipts()],
    ['closures','월 마감',DOTT_DB.accountingClosures()],
    ['rentals','대여 관리대장',DOTT_DB.rentalLoans()]
  ];
}
function syncStartupWarnings(){
  if(window.DOTT_ATTENDANCE_ERROR&&!adminLoadWarnings.includes('출석'))adminLoadWarnings.push('출석');
  if(window.DOTT_FEES_ERROR&&!adminLoadWarnings.includes('회비'))adminLoadWarnings.push('회비');
}
async function loadStartupDashboard(){
  const cycle=++startupCycle;
  startupDataPending=true;
  adminLoadWarnings=[];
  const jobs=getAdminLoadJobs();
  startupPendingKeys=new Set(jobs.map(x=>x[0]));
  app.innerHTML=nav('admin')+'<main class="loading">운영진 인증 완료 · 대시보드 데이터를 불러오는 중…</main>';
  const tasks=jobs.map(async ([key,label,promise])=>{
    try{
      const value=await promise;
      if(cycle===startupCycle)data[key]=value;
    }catch(error){
      if(cycle===startupCycle){
        adminLoadWarnings.push(label);
        console.warn(label+' 불러오기 실패',error);
      }
    }finally{
      if(cycle===startupCycle)startupPendingKeys.delete(key);
    }
  });
  const dashboardKeys=new Set(['schedules','attendance','boardgame','murder','deduction','fees']);
  await Promise.all(tasks.filter((_,index)=>dashboardKeys.has(jobs[index][0])));
  if(cycle!==startupCycle)return;
  syncStartupWarnings();
  renderAdmin();
  await Promise.all(tasks);
  if(cycle!==startupCycle)return;
  startupDataPending=false;
  syncStartupWarnings();
  // 사용자가 이미 편집 중이라면 팝업을 건드리지 않고 새로고침 버튼만 활성화합니다.
  if(document.getElementById('modal')?.classList.contains('open')||(tab!=='dashboard'&&startupWaitingTab!==tab)){
    const refresh=document.getElementById('refreshData');
    if(refresh){refresh.disabled=false;refresh.textContent='↻ 새로고침';}
    return;
  }
  renderAdmin();
}

function renderAdmin(){
  const tabs=[['dashboard','대시보드'],['stats','운영 통계'],['schedules','일정 관리'],['attendance','출석 관리'],['notices','공지 관리'],['boardgame','보드게임'],['murder','머더미스터리'],['deduction','추리게임'],['rentals','대여 관리'],['accounting','회비 · 회계'],['settings','관리자 설정']];
  const loadWarning=adminLoadWarnings.length?`<div class="info-box admin-load-warning">⚠ ${adminLoadWarnings.join(' · ')} 데이터를 최신 상태로 불러오지 못했습니다. 네트워크가 안정되면 새로고침해 주세요.</div>`:'';
  const navGroups=[['운영 관리',['dashboard','stats','schedules','attendance']],['콘텐츠 관리',['notices','boardgame','murder','deduction','rentals']],['재무 · 설정',['accounting','settings']]];
  const titles={dashboard:['통합 대시보드','도트의 운영 현황을 한눈에 확인하세요.'],stats:['운영 통계','월별 벙 현황 · 회비 납부 · 최근 출석을 확인합니다.'],schedules:['일정 관리','예약 일정과 이용 현황을 관리합니다.'],attendance:['출석 관리','회원 활동 내역을 관리합니다.'],notices:['공지 관리','회원에게 표시할 공지사항을 관리합니다.'],boardgame:['보드게임','보유 게임과 소유주를 관리합니다.'],murder:['머더미스터리','시나리오 목록을 관리합니다.'],deduction:['추리게임','추리게임 목록을 관리합니다.'],rentals:['대여 관리','대여 현황과 반납을 관리합니다.'],accounting:['회비 · 회계','납부·지출·월 마감 내역을 관리합니다.'],settings:['관리자 설정','내 계정 · 홈페이지 문구 · 백업 · 운영진 권한을 관리합니다.']};
  const [pageTitle,pageDesc]=titles[tab]||titles.dashboard;
  app.innerHTML=`${nav('admin')}<div class="admin-layout"><aside class="admin-sidebar"><div class="sidebar-label">DOTT WORKSPACE</div><div class="sidebar-nav">${navGroups.map(([group,ids])=>`<div class="nav-group"><div class="nav-group-title">${group}</div>${ids.map(id=>{const item=tabs.find(x=>x[0]===id);return `<button class="tab ${tab===id?'active':''}" data-tab="${id}">${item?.[1]||id}</button>`}).join('')}</div>`).join('')}</div><div class="sidebar-bottom"><span class="status-dot"></span> 공통 Supabase 연결</div></aside><main class="admin-wrap"><section class="admin-hero"><div><span class="eyebrow">DOTT / OPERATIONS</span><h1>${pageTitle}</h1><p>${pageDesc}</p></div><div class="toolbar"><a class="btn" href="${esc(CFG.publicSiteUrl)}" target="_blank" rel="noopener noreferrer">↗ 회원 사이트</a><button class="btn" id="refreshData" type="button">↻ 새로고침</button><button class="btn" id="logout" type="button">로그아웃</button></div></section>${loadWarning}<div id="panel"></div></main></div>${footer()}`;
  if(startupDataPending){const ref=document.getElementById('refreshData');ref.disabled=true;ref.textContent='동기화 중…';}
  document.getElementById('refreshData').onclick=async()=>{if(startupDataPending)return;const btn=document.getElementById('refreshData');btn.disabled=true;btn.textContent='불러오는 중…';try{await loadAll();renderAdmin();toast('최신 데이터로 새로고침했습니다.')}catch(e){alert(e.message||e);btn.disabled=false}};
  document.getElementById('logout').onclick=async()=>{startupCycle++;startupDataPending=false;startupPendingKeys.clear();await DOTT_DB.signOut();dottAdminRole=null;dottAdminEmail='';renderLogin()};
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;renderAdmin()});
  renderPanel();
}

function renderPanel(){
  const p=document.getElementById('panel');
  const dependencies={"dashboard":["schedules","attendance","boardgame","murder","deduction","fees"],"stats":["schedules","attendance","fees"],"schedules":["schedules"],"attendance":["attendance"],"notices":["notices"],"boardgame":["boardgame"],"murder":["murder"],"deduction":["deduction"],"rentals":["rentals"],"accounting":["fees","attendance","ledger","receipts","closures"],"settings":["settings"]};
  if(startupDataPending&&(dependencies[tab]||[]).some(key=>startupPendingKeys.has(key))){
    startupWaitingTab=tab;
    p.innerHTML='<div class="info-box" role="status">필요한 데이터를 불러오는 중입니다. 준비되면 자동으로 표시됩니다.</div>';
    return;
  }
  startupWaitingTab=null;
  if(tab==='dashboard')return dashboardPanel(p);
  if(tab==='stats')return statsPanel(p);
  if(tab==='settings')return settingsPanel(p);
  if(tab==='accounting')return accountingPanel(p);
  if(tab==='rentals')return rentalPanel(p);
  if(tab==='schedules')return schedulePanel(p);
  if(tab==='attendance')return attendancePanel(p);
  if(tab==='notices')return noticePanel(p);
  return catalogPanel(p,tab);
}


function statsPanel(panel){
  if(!window.DOTT_STATS){
    panel.innerHTML='<div class="info-box">운영 통계 파일을 불러오지 못했습니다. 페이지를 새로고침해 주세요.</div>';
    return;
  }
  window.DOTT_STATS.render(panel,{
    data, month:statsMonth, today:todayYmd(), warnings:adminLoadWarnings,
    changeMonth:next=>{statsMonth=next;statsPanel(document.getElementById('panel'));},
    navigate:next=>{tab=next;renderAdmin();}
  });
}

function dashboardAttendanceAlerts(){
  if(adminLoadWarnings.includes('출석')){
    return `<section class="dash-attention"><div class="dash-attention-heading"><div><span>ATTENDANCE ALERTS</span><h3>출석 경과 알림</h3><p>출석 정보를 불러오지 못했습니다. 새로고침해 주세요.</p></div><button type="button" class="dash-link" data-open-tab="attendance">출석 관리 →</button></div></section>`;
  }
  const at=todayYmd();
  const toUtc=value=>{const [y,m,d]=String(value).split('-').map(Number);return Date.UTC(y,m-1,d);};
  const list=(data.attendance||[]).map(member=>{
    const state=attendanceState(member);
    const due=attendanceDueDate(member);
    const dueSoon=attendanceDueSoon(due);
    return {member,state,due,dueSoon,overDays:due?Math.max(0,Math.round((toUtc(at)-toUtc(due))/86400000)):0};
  });
  const soon=list.filter(x=>x.state.key==='keep'&&x.dueSoon.active)
    .sort((a,b)=>a.due.localeCompare(b.due)||String(a.member.name||'').localeCompare(String(b.member.name||''),'ko'));
  const overdue=list.filter(x=>x.state.key==='overdue'&&x.due)
    .sort((a,b)=>a.due.localeCompare(b.due)||String(a.member.name||'').localeCompare(String(b.member.name||''),'ko'));
  const person=(x,kind)=>`<div class="dash-attention-person">
    <div class="dash-attention-person-main"><strong>${esc(x.member.name||'이름 없음')}</strong><small>${kind==='soon'?'경과 예정':'경과 기준일'} ${esc(shortDate(x.due))}</small></div>
    <span class="dash-attention-day ${kind}">${kind==='soon'?`D-${x.dueSoon.days}`:(x.overDays===0?'경과 당일':`D+${x.overDays}`)}</span>
  </div>`;
  const section=(kind,title,subtitle,people)=>`<section class="dash-attention-card ${kind}">
    <div class="dash-attention-card-heading"><h4><span class="dash-attention-dot ${kind}"></span>${title}</h4><strong>${people.length}<small>명</small></strong></div>
    <p>${subtitle}</p>
    <div class="dash-attention-list">${people.length?people.map(x=>person(x,kind)).join(''):'<div class="dash-attention-empty">해당 회원이 없습니다.</div>'}</div>
    <button type="button" class="dash-attention-view" data-attention-filter="${kind==='soon'?'dueSoon':'overdue'}">출석관리에서 확인하기 →</button>
  </section>`;
  return `<section class="dash-attention">
    <div class="dash-attention-heading"><div><span>ATTENDANCE ALERTS</span><h3>출석 경과 알림</h3><p>유예·탈퇴 회원 제외 · 최근 참석일이 없으면 가입일을 기준으로 계산</p></div><button type="button" class="dash-link" data-open-tab="attendance">전체 출석관리 →</button></div>
    <div class="dash-attention-grid">
      ${section('soon','경과 임박','2개월 경과일 14일 전부터 D-1까지',soon)}
      ${section('overdue','2개월 경과','2개월 경과일 당일 및 이후',overdue)}
    </div>
  </section>`;
}

function dashboardPanel(p){
  const today=todayYmd();
  const upcoming=[...(data.schedules||[])].filter(x=>String(x.event_date||'')>=today&&!isCancelledStatus(x.status)).sort((a,b)=>String(a.event_date||'').localeCompare(String(b.event_date||''))||String(a.event_time||'').localeCompare(String(b.event_time||'')));
  const members=(data.attendance||[]).filter(x=>x.member_status!=='left');
  const monthKey=today.slice(0,7);
  const feeRows=(data.fees||[]).filter(x=>String(x.fee_month||'').slice(0,7)===monthKey);
  const paidCount=feeRows.filter(x=>x.status==='paid').length;
  const pending=Math.max(0,members.length-paidCount-feeRows.filter(x=>x.status==='exempt').length);
  const games=(data.boardgame||[]).length+(data.murder||[]).length+(data.deduction||[]).length;
  const num=(key,n)=>adminLoadWarnings.includes(key)?'확인 필요':n.toLocaleString('ko-KR');
  const stat=(label,value,foot)=>`<div class="dash-stat"><div class="dash-stat-label">${label}</div><strong>${value}</strong><small>${foot}</small></div>`;
  const go=(id,label,sub)=>`<button class="dash-shortcut" data-open-tab="${id}"><strong>${label}</strong><span>${sub}</span><b>↗</b></button>`;
  const upcomingHtml=upcoming.slice(0,6).map(x=>`<div class="dash-schedule"><div class="dash-date">${esc(String(x.event_date||'').slice(5).replace('-',' / '))}</div><div class="dash-event"><b>${esc(x.title||x.name||x.event_name||x.event_title||x.bung_name||x.group_name||'예약 일정')}</b><small>${esc(String(x.event_time||'').slice(0,5))}${x.organizer?' · '+esc(x.organizer):''}</small></div><span class="dash-dot"></span></div>`).join('')||'<div class="dash-empty">예정된 예약 일정이 없습니다.</div>';
  p.innerHTML=`<section class="dash-welcome"><div><span class="dash-overline">OVERVIEW</span><h2>오늘의 운영 현황</h2><p>${esc(fmtDate(today))} 기준 · 기존 DOTT 데이터와 연결</p></div><span class="dash-live"><i></i> LIVE DATA</span></section>
    <div class="dash-stats">${stat('활동 회원',num('출석',members.length),'탈퇴 회원 제외')}${stat('예정된 예약',num('일정',upcoming.length),'오늘 이후 · 취소 제외')}${stat('게임 보유목록',adminLoadWarnings.some(x=>['보드게임','머더미스터리','추리게임'].includes(x))?'확인 필요':games.toLocaleString('ko-KR'),'보드게임 · 머미 · 추리')}${stat('이번 달 회비 미납',adminLoadWarnings.some(x=>['출석','회비'].includes(x))?'확인 필요':pending.toLocaleString('ko-KR'),'회비 기록 기준 · 확인용 추정')}</div>
    ${dashboardAttendanceAlerts()}
    <div class="dash-cols"><section class="dash-card"><div class="dash-card-head"><div><h3>예정된 일정</h3><p>가까운 일정 6건</p></div><button class="dash-link" data-open-tab="schedules">전체 보기 →</button></div>${adminLoadWarnings.includes('일정')?'<div class="dash-empty">일정 데이터를 불러오지 못했습니다. 새로고침해 주세요.</div>':upcomingHtml}</section>
    <section class="dash-card"><div class="dash-card-head"><div><h3>빠른 관리</h3><p>자주 사용하는 운영 메뉴</p></div></div><div class="dash-shortcuts">${go('schedules','예약 관리','일정 등록 · 수정')}${go('attendance','회원 · 출석','활동 현황 확인')}${go('accounting','회비 · 회계','월별 납부 · 장부')}${go('stats','운영 통계','월별 벙 · 회비 통계')}${go('boardgame','게임 관리','목록 · 소유주')}</div></section></div>
    <div class="dash-footnote">※ 회비 미납 수는 현재 활동 회원과 해당 월 납부·면제 기록을 기준으로 계산한 참고값입니다. 실시간 변경사항은 새로고침 후 반영됩니다.</div>`;
  p.querySelectorAll('[data-open-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.openTab;renderAdmin()});
  p.querySelectorAll('[data-attention-filter]').forEach(b=>b.onclick=()=>{attendanceFilter=b.dataset.attentionFilter;attendanceMode='manage';tab='attendance';renderAdmin()});
}

function scheduleMonthLabel(){return `${scheduleCursor.getFullYear()}년 ${scheduleCursor.getMonth()+1}월`}
function compactScheduleDate(dateStr){
  if(!dateStr)return '-';
  const [y,m,d]=String(dateStr).split('-');
  return `${String(y).slice(-2)}/${m}/${d}`;
}
function inScheduleMonth(dateStr){
  if(!dateStr)return false;
  const d=new Date(dateStr+'T00:00:00');
  return d.getFullYear()===scheduleCursor.getFullYear()&&d.getMonth()===scheduleCursor.getMonth();
}
function scheduleRowsForView(){
  const today=todayYmd();
  let rows=[...data.schedules];
  if(scheduleView==='month')rows=rows.filter(x=>inScheduleMonth(x.event_date));
  else if(scheduleView==='upcoming')rows=rows.filter(x=>x.event_date>=today);
  else if(scheduleView==='past')rows=rows.filter(x=>x.event_date<today);
  rows.sort((a,b)=>{
    const dateCmp=String(a.event_date||'').localeCompare(String(b.event_date||''));
    const timeCmp=String(a.event_time||'').localeCompare(String(b.event_time||''));
    return scheduleView==='past'?-(dateCmp||timeCmp):(dateCmp||timeCmp);
  });
  return rows;
}

function schedulePanel(p){
  const rows=scheduleRowsForView();
  const visibleIds=new Set(rows.map(x=>x.id));
  selectedScheduleIds=new Set([...selectedScheduleIds].filter(id=>visibleIds.has(id)));
  const allSelected=rows.length>0&&rows.every(x=>selectedScheduleIds.has(x.id));
  const tabs=[['month','월별 보기'],['upcoming','예정 일정'],['past','지난 일정']];
  p.innerHTML=`
    <div class="schedule-control-panel">
      <div class="schedule-manage-head">
        <div class="schedule-view-tabs">${tabs.map(([v,l])=>`<button class="schedule-view-btn ${scheduleView===v?'active':''}" data-schedule-view="${v}">${l}</button>`).join('')}</div>
        <button class="btn primary schedule-add-btn" id="add">+ 일정 추가</button>
      </div>
      ${scheduleView==='month'?`<div class="schedule-monthbar">
        <div class="schedule-month-nav">
          <button class="btn schedule-month-arrow" id="monthPrev" aria-label="이전 달">‹</button>
          <strong>${scheduleMonthLabel()}</strong>
          <button class="btn schedule-month-arrow" id="monthNext" aria-label="다음 달">›</button>
        </div>
        <button class="btn schedule-month-today" id="monthToday">이번 달</button>
        <span class="schedule-count">${rows.length}건</span>
      </div>`:''}
      <div class="schedule-bulkbar">
        <label class="schedule-select-all"><input type="checkbox" id="scheduleSelectAll" ${allSelected?'checked':''}> <span>현재 목록 전체 선택</span></label>
        <div class="schedule-bulk-actions"><span id="scheduleSelectedCount">${selectedScheduleIds.size}개 선택</span><button class="btn danger" id="deleteSelected" ${selectedScheduleIds.size?'':'disabled'}>선택 삭제</button></div>
      </div>
    </div>
    <div class="table-wrap schedule-table-wrap"><table class="table schedule-table"><thead><tr><th class="check-col"></th><th>날짜</th><th>시간</th><th>카테고리</th><th>일정명</th><th>인원</th><th>벙주</th><th>상태</th><th>관리</th></tr></thead><tbody>${rows.map(x=>{
      const cancelled=isCancelledStatus(x.status);
      return `<tr class="${cancelled?'cancelled-row':''}"><td class="check-col"><input class="schedule-check" type="checkbox" data-schedule-check="${x.id}" ${selectedScheduleIds.has(x.id)?'checked':''}></td><td><span class="schedule-date-desktop">${fmtDate(x.event_date)}</span><span class="schedule-date-mobile">${compactScheduleDate(x.event_date)}</span></td><td>${(x.event_time||'').slice(0,5)}</td><td>${tag(x.category)}</td><td><b>${esc(x.title)}</b></td><td>${x.people||'-'}명</td><td>${esc(x.manager||'')}${x.venue_flexible?' <span class="venue-flex-mark" title="장소 이동 가능">✓</span>':''}</td><td><span class="schedule-status ${cancelled?'cancelled':''}">${scheduleStatusLabel(x.status)}</span></td><td><div class="actions"><button class="icon-btn" data-edit="${x.id}">✎</button><button class="icon-btn" data-del="${x.id}">♲</button></div></td></tr>`
    }).join('')||'<tr><td colspan="9">해당 일정이 없습니다.</td></tr>'}</tbody></table></div>`;

  document.getElementById('add').onclick=()=>scheduleModal();
  document.querySelectorAll('[data-schedule-view]').forEach(btn=>btn.onclick=()=>{scheduleView=btn.dataset.scheduleView;selectedScheduleIds.clear();schedulePanel(p)});
  if(scheduleView==='month'){
    document.getElementById('monthPrev').onclick=()=>{scheduleCursor.setMonth(scheduleCursor.getMonth()-1);selectedScheduleIds.clear();schedulePanel(p)};
    document.getElementById('monthNext').onclick=()=>{scheduleCursor.setMonth(scheduleCursor.getMonth()+1);selectedScheduleIds.clear();schedulePanel(p)};
    document.getElementById('monthToday').onclick=()=>{scheduleCursor=new Date();scheduleCursor.setDate(1);selectedScheduleIds.clear();schedulePanel(p)};
  }
  const refreshBulk=()=>{
    const count=document.getElementById('scheduleSelectedCount');
    const del=document.getElementById('deleteSelected');
    const all=document.getElementById('scheduleSelectAll');
    if(count)count.textContent=`${selectedScheduleIds.size}개 선택`;
    if(del)del.disabled=!selectedScheduleIds.size;
    if(all)all.checked=rows.length>0&&rows.every(x=>selectedScheduleIds.has(x.id));
  };
  document.getElementById('scheduleSelectAll').onchange=e=>{
    if(e.target.checked)rows.forEach(x=>selectedScheduleIds.add(x.id));
    else rows.forEach(x=>selectedScheduleIds.delete(x.id));
    document.querySelectorAll('[data-schedule-check]').forEach(cb=>cb.checked=e.target.checked);
    refreshBulk();
  };
  document.querySelectorAll('[data-schedule-check]').forEach(cb=>cb.onchange=()=>{cb.checked?selectedScheduleIds.add(cb.dataset.scheduleCheck):selectedScheduleIds.delete(cb.dataset.scheduleCheck);refreshBulk()});
  document.getElementById('deleteSelected').onclick=async()=>{
    const ids=[...selectedScheduleIds];
    if(!ids.length)return;
    if(!confirm(`선택한 ${ids.length}개 일정을 삭제할까요?\n삭제 후에는 복구할 수 없습니다.`))return;
    await DOTT_DB.removeMany('schedules',ids);
    selectedScheduleIds.clear();
    await loadAll();schedulePanel(p);toast('선택한 일정을 삭제했습니다.');
  };
  wireRows('schedules',scheduleModal);
}

function normalizeManualTime(v=''){
  let raw=String(v||'').trim().replace(/[.]/g,':').replace(/\s+/g,'');
  if(/^\d{3,4}$/.test(raw)) raw=raw.length===3?`0${raw[0]}:${raw.slice(1)}`:`${raw.slice(0,2)}:${raw.slice(2)}`;
  const m=raw.match(/^(\d{1,2}):(\d{1,2})$/);
  if(!m)throw new Error('시간을 19:30 형식으로 입력해 주세요.');
  const h=Number(m[1]), min=Number(m[2]);
  if(h<0||h>23||min<0||min>59)throw new Error('올바른 시간을 입력해 주세요. 예: 19:30');
  return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
}

function scheduleModal(x={}){
  const currentStatus=isCancelledStatus(x.status)?'취소':'예약';
  showModal(x.id?'일정 수정':'일정 추가',`<div class="form-grid schedule-form"><div><label class="label">날짜</label><input id="f_date" class="field" type="date" value="${x.event_date||todayYmd()}"></div><div><label class="label">시간</label><input id="f_time" class="field" type="text" inputmode="numeric" maxlength="5" placeholder="예: 19:30" value="${esc((x.event_time||'18:00').slice(0,5))}"></div><div><label class="label">카테고리</label><select id="f_cat" class="field">${CFG.categories.map(c=>`<option value="${c.value}" ${x.category===c.value?'selected':''}>${c.label}</option>`).join('')}</select></div><div><label class="label">인원</label><input id="f_people" class="field" type="number" min="1" value="${x.people||4}"></div><div class="full"><label class="label">일정명</label><input id="f_title" class="field" value="${esc(x.title||'')}"></div><div><div class="label-row"><label class="label">벙주</label><label class="venue-flex-check"><input id="f_venue_flexible" type="checkbox" ${x.venue_flexible?'checked':''}> 장소 이동 가능</label></div><input id="f_manager" class="field" value="${esc(x.manager||'')}"></div><div><label class="label">상태</label><select id="f_status" class="field"><option value="예약" ${currentStatus==='예약'?'selected':''}>예약</option><option value="취소" ${currentStatus==='취소'?'selected':''}>취소</option></select></div><div class="full"><label class="label">메모</label><textarea id="f_note" class="field" rows="2">${esc(x.note||'')}</textarea></div></div>`,async m=>{
    const row={
      event_date:m.querySelector('#f_date').value,
      event_time:normalizeManualTime(m.querySelector('#f_time').value),
      category:m.querySelector('#f_cat').value,
      title:m.querySelector('#f_title').value.trim(),
      people:+m.querySelector('#f_people').value||null,
      manager:m.querySelector('#f_manager').value.trim(),
      venue_flexible:m.querySelector('#f_venue_flexible').checked,
      status:m.querySelector('#f_status').value,
      note:m.querySelector('#f_note').value.trim()
    };
    if(!row.title)throw new Error('일정명을 입력해 주세요.');
    x.id?await DOTT_DB.update('schedules',x.id,row):await DOTT_DB.insert('schedules',row);
    const savedDate=new Date(row.event_date+'T00:00:00');
    if(!Number.isNaN(savedDate.getTime())){scheduleCursor=new Date(savedDate.getFullYear(),savedDate.getMonth(),1);scheduleView='month';selectedScheduleIds.clear()}
    await loadAll();renderAdmin();toast('저장했습니다.');
  });
  const scheduleModalEl=document.querySelector('#modal .modal');
  if(scheduleModalEl)scheduleModalEl.classList.add('schedule-modal');
  const timeInput=document.getElementById('f_time');
  if(timeInput){
    timeInput.addEventListener('blur',()=>{
      if(!timeInput.value.trim())return;
      try{timeInput.value=normalizeManualTime(timeInput.value)}catch(_e){}
    });
  }
}


function attendanceDueDate(member){
  const base=member.last_attended_at||member.joined_at;
  return base?addCalendarMonths(base,2):'';
}

function addCalendarMonths(dateStr,months){
  const parts=String(dateStr||'').split('-').map(Number);
  if(parts.length!==3||parts.some(Number.isNaN))return '';
  const [y,m,d]=parts;
  const target=new Date(y,m-1+months,1);
  const lastDay=new Date(target.getFullYear(),target.getMonth()+1,0).getDate();
  target.setDate(Math.min(d,lastDay));
  return ymd(target);
}

function shortDate(dateStr){
  if(!dateStr)return '-';
  const [y,m,d]=String(dateStr).split('-').map(Number);
  return `${y}. ${m}. ${d}`;
}
function compactAttendanceDate(dateStr){
  if(!dateStr)return '-';
  const [y,m,d]=String(dateStr).split('-').map(Number);
  return `${String(y).slice(-2)}.${String(m).padStart(2,'0')}.${String(d).padStart(2,'0')}`;
}

function attendanceState(member){
  if(member.member_status==='left')return {key:'left',label:'탈퇴'};
  if(member.grace)return {key:'grace',label:'유예'};
  const due=attendanceDueDate(member);
  if(due&&todayYmd()>=due)return {key:'overdue',label:'경과'};
  return {key:'keep',label:'유지'};
}

function attendanceDueSoon(due){
  if(!due)return {active:false,days:0};
  const today=String(todayYmd()||'').split('-').map(Number);
  const target=String(due||'').split('-').map(Number);
  if(today.length!==3||target.length!==3||today.some(Number.isNaN)||target.some(Number.isNaN))return {active:false,days:0};
  const a=Date.UTC(today[0],today[1]-1,today[2]);
  const b=Date.UTC(target[0],target[1]-1,target[2]);
  const days=Math.round((b-a)/86400000);
  return {active:days>=1&&days<=14,days};
}


function attendanceActionHtml(member){
  if(member.member_status==='left')return '';
  const date=attendanceMode==='check'?attendanceWorkDate:todayYmd();
  if(attendanceMode==='check'&&member.last_attended_at===date){
    return '<span class="attendance-checked-label" title="선택 날짜 출석 완료"><span class="att-action-desktop">✓ 완료</span><span class="att-action-mobile">✓</span></span>';
  }
  if(member.last_attended_at&&member.last_attended_at>date){
    return '<span class="attendance-date-protected" title="선택한 날짜보다 최근 참석일이 더 최신입니다. 수정이 필요하면 연필 버튼을 이용하세요."><span class="att-action-desktop">최신일 유지</span><span class="att-action-mobile">↗</span></span>';
  }
  if(date>todayYmd()){
    return '<span class="attendance-date-protected" title="미래 날짜는 출석 처리할 수 없습니다."><span class="att-action-desktop">미래 날짜</span><span class="att-action-mobile">—</span></span>';
  }
  const label=attendanceMode==='check'?'참석 처리':'오늘 참석';
  return `<button class="btn attendance-today" type="button" data-attend="${esc(member.id)}" title="${esc(shortDate(date))} 참석 처리"><span class="att-action-desktop">${label}</span><span class="att-action-mobile">✓</span></button>`;
}
async function refreshAttendanceMembers({silent=false}={}){
  if(attendanceSyncing||attendanceWriting)return;
  attendanceSyncing=true;
  const button=document.getElementById('attendanceSync');
  if(button){button.disabled=true;button.textContent='동기화 중…';}
  try{
    const latest=await DOTT_DB.attendance();
    if(window.DOTT_ATTENDANCE_ERROR)throw window.DOTT_ATTENDANCE_ERROR;
    if(attendanceWriting)return;
    const changed=JSON.stringify(latest)!==JSON.stringify(data.attendance);
    data.attendance=latest;
    if(tab==='attendance'&&!document.getElementById('modal')?.classList.contains('open')){
      const panel=document.getElementById('panel');
      if(panel&&(changed||(!attendanceDateManual&&attendanceAutoDate!==todayYmd())))attendancePanel(panel);
    }
    if(!silent)toast('출석 명단을 최신 상태로 동기화했습니다.');
  }catch(error){
    console.warn('출석 명단 동기화 실패',error);
    if(!silent)alert('출석 명단을 갱신하지 못했습니다.\n'+(error.message||error));
  }finally{
    attendanceSyncing=false;
    if(button?.isConnected){button.disabled=false;button.textContent='↻ 명단 동기화';}
  }
}
// 여러 운영진이 따로 체크한 내역도 안전하게 반영합니다.
// 검색 입력/회원 수정 중에는 새로 그리지 않아 입력이 사라지지 않도록 합니다.
setInterval(()=>{
  if(tab!=='attendance'||attendanceMode!=='check'||startupDataPending||attendanceWriting||attendanceSyncing||document.visibilityState==='hidden')return;
  if(document.getElementById('modal')?.classList.contains('open'))return;
  if(['attendanceSearch','attendanceWorkDate'].includes(document.activeElement?.id))return;
  refreshAttendanceMembers({silent:true});
},30000);

function attendancePanel(p){
  const currentDate=todayYmd();
  // 날짜를 직접 선택하지 않은 경우에는 자정이 지나도 자동으로 새로운 오늘을 사용합니다.
  if(!attendanceDateManual&&attendanceAutoDate!==currentDate){
    attendanceWorkDate=currentDate;
    attendanceAutoDate=currentDate;
    attendanceCheckFilter='pending';
  }
  if(window.DOTT_ATTENDANCE_ERROR){
    p.innerHTML=`<div class="info-box attendance-setup"><b>출석관리 DB를 아직 만들지 않았습니다.</b><br>Supabase SQL Editor에서 <code>add-attendance.sql</code>을 한 번 실행하면 이 메뉴가 활성화됩니다.</div>`;
    return;
  }
  const states=data.attendance.map(x=>{const due=attendanceDueDate(x);return {member:x,state:attendanceState(x),due,dueSoon:attendanceDueSoon(due)}});
  const counts={all:states.length,keep:0,overdue:0,grace:0,left:0};
  states.forEach(x=>counts[x.state.key]=(counts[x.state.key]||0)+1);
  const checkMode=attendanceMode==='check';
  const checkable=states.filter(({member})=>member.member_status!=='left');
  const completeCount=checkable.filter(({member})=>member.last_attended_at===attendanceWorkDate).length;
  const pendingCount=checkable.length-completeCount;
  let rows=checkMode
    ?checkable.filter(({member})=>(member.last_attended_at===attendanceWorkDate)===(attendanceCheckFilter==='done'))
    :states.filter(({state,dueSoon})=>{
      if(attendanceFilter==='dueSoon')return state.key==='keep'&&dueSoon.active;
      if(attendanceFilter!=='all'&&state.key!==attendanceFilter)return false;
      return true;
    });
  // 운영진은 항상 최상단에 고정하고, 운영진/일반회원 각각 이름 가나다순으로 정렬합니다.
  rows.sort((a,b)=>Number(Boolean(b.member.is_staff))-Number(Boolean(a.member.is_staff))||String(a.member.name||'').localeCompare(String(b.member.name||''),'ko'));
  const filters=[['all','전체'],['keep','유지'],['dueSoon','경과 임박'],['overdue','경과'],['grace','유예'],['left','탈퇴']];
  const checkToolbar=checkMode?`
    <section class="attendance-checkdesk" aria-label="출석 체크 모드">
      <div class="attendance-checkdesk-top">
        <div class="attendance-work-date">
          <label class="label" for="attendanceWorkDate">출석 기준 날짜</label>
          <div class="attendance-work-date-inputs"><input class="field" type="date" id="attendanceWorkDate" value="${esc(attendanceWorkDate)}"><button type="button" class="btn attendance-date-reset" id="attendanceResetDate">오늘로</button></div>
        </div>
        <div class="attendance-checkdesk-description"><strong>${esc(shortDate(attendanceWorkDate))} 출석 체크</strong><small>선택한 날짜를 최근 참석일로 기록해요. 전날 벙도 날짜만 바꿔서 처리하면 돼요.</small></div>
        <div class="attendance-checkdesk-tools"><button type="button" class="btn attendance-sync" id="attendanceSync">↻ 명단 동기화</button><button type="button" class="btn attendance-manage-toggle" id="attendanceManage">⚙ 상태별 관리</button></div>
      </div>
      <div class="attendance-checkdesk-tabs" role="group" aria-label="선택 날짜 출석 상태">
        <button type="button" class="attendance-checkdesk-tab ${attendanceCheckFilter==='pending'?'active':''}" data-check-filter="pending" aria-pressed="${attendanceCheckFilter==='pending'}">미체크 <b>${pendingCount}</b><small>명</small></button>
        <button type="button" class="attendance-checkdesk-tab ${attendanceCheckFilter==='done'?'active':''}" data-check-filter="done" aria-pressed="${attendanceCheckFilter==='done'}">출석 완료 <b>${completeCount}</b><small>명</small></button>
      </div>
      <p class="attendance-checkdesk-note">활동 회원 ${checkable.length}명 기준 · 출석 완료는 <b>최근 참석일이 선택 날짜와 일치</b>하는 경우예요. 출석 기록은 날짜별로 따로 저장하지 않아요. 다른 운영진의 체크 내역은 약 30초마다 반영돼요. <span class="attendance-safety-text">더 최근 참석일이 있는 회원은 과거 날짜로 덮어쓰지 않아요.</span></p>
    </section>`:`
    <section class="attendance-manage-bar"><div><strong>회원 상태별 관리</strong><p>기존 유지 · 경과 임박 · 경과 · 유예 · 탈퇴 필터를 그대로 사용할 수 있어요.</p></div><button class="btn" type="button" id="attendanceBackToCheck">← 출석 체크로</button></section>`;
  p.innerHTML=`
    <div class="attendance-head">
      <div>
        <div class="attendance-summary">
          <span>전체 <b>${counts.all}</b></span><span class="keep">유지 <b>${counts.keep}</b></span><span class="overdue">경과 <b>${counts.overdue}</b></span><span class="grace">유예 <b>${counts.grace}</b></span><span>탈퇴 <b>${counts.left}</b></span>
        </div>
        <p class="attendance-help">최근 참석일이 없으면 가입일 기준으로 계산하고, 최근 참석일 + 2개월이 되면 자동으로 ‘경과’ 표시됩니다. <b class="attendance-warning-guide">경과일 14일 전부터 노란색으로 표시됩니다.</b></p>
      </div>
      <button class="btn primary" id="addMember">+ 회원 추가</button>
    </div>
    ${checkToolbar}
    <div class="attendance-controls ${checkMode?'attendance-check-controls':''}">
      ${checkMode?'':`<div class="attendance-filters">${filters.map(([v,l])=>`<button class="attendance-filter ${attendanceFilter===v?'active':''}" data-att-filter="${v}">${l}</button>`).join('')}</div>`}
      <input id="attendanceSearch" class="field attendance-search" placeholder="이름 검색" aria-label="회원 이름 검색" value="${esc(attendanceSearch)}">
    </div>
    <div class="attendance-table-wrap">
      <table class="attendance-table">
        <thead><tr><th>이름</th><th>가입일</th><th><span class="att-head-desktop">최근 참석일</span><span class="att-head-mobile">최근</span></th><th><span class="att-head-desktop">2개월 경과일</span><span class="att-head-mobile">경과일</span></th><th>상태</th><th><span class="att-head-desktop">메모</span><span class="att-head-mobile">메모</span></th><th>관리</th></tr></thead>
        <tbody>${rows.map(({member:x,state,due,dueSoon})=>`<tr class="attendance-row ${state.key} ${dueSoon.active&&state.key==='keep'?'due-soon':''} ${x.is_staff?'staff':''} ${checkMode&&x.last_attended_at===attendanceWorkDate?'attendance-checked-row':''}>
          <td data-label="이름"><span class="attendance-name-wrap"><b>${esc(x.name)}</b>${x.is_staff?'<span class="attendance-staff-badge">운영진</span>':''}</span></td>
          <td data-label="가입일"><span class="att-date-desktop">${shortDate(x.joined_at)}</span><span class="att-date-mobile">${compactAttendanceDate(x.joined_at)}</span></td>
          <td data-label="최근 참석일"><span class="att-date-desktop">${shortDate(x.last_attended_at)}</span><span class="att-date-mobile">${compactAttendanceDate(x.last_attended_at)}</span></td>
          <td data-label="2개월 경과일" class="${dueSoon.active&&state.key==='keep'?'attendance-due-cell due-soon':''}"><span class="att-date-desktop">${shortDate(due)}${dueSoon.active&&state.key==='keep'?` <span class="attendance-due-badge">D-${dueSoon.days}</span>`:''}</span><span class="att-date-mobile">${compactAttendanceDate(due)}${dueSoon.active&&state.key==='keep'?` <span class="attendance-due-badge">D-${dueSoon.days}</span>`:''}</span></td>
          <td data-label="상태"><span class="attendance-status ${state.key}">${state.label}</span></td>
          <td data-label="메모" class="attendance-reason" title="${esc(x.grace_reason||'-')}">${esc(x.grace_reason||'-')}</td>
          <td data-label="관리"><div class="attendance-actions">${attendanceActionHtml(x)}<button class="icon-btn" data-att-edit="${esc(x.id)}" title="수정">✎</button><button class="icon-btn" data-att-del="${esc(x.id)}" title="완전 삭제">♲</button></div></td>
        </tr>`).join('')||`<tr><td colspan="7" class="attendance-empty">해당하는 회원이 없습니다.</td></tr>`}</tbody>
      </table>
    </div>`;
  document.getElementById('addMember').onclick=()=>attendanceModal();
  document.getElementById('attendanceManage')?.addEventListener('click',()=>{attendanceMode='manage';attendancePanel(p)});
  document.getElementById('attendanceBackToCheck')?.addEventListener('click',()=>{attendanceMode='check';attendanceCheckFilter='pending';attendancePanel(p)});
  document.querySelectorAll('[data-check-filter]').forEach(btn=>btn.onclick=()=>{attendanceCheckFilter=btn.dataset.checkFilter;attendancePanel(p)});
  const dateInput=document.getElementById('attendanceWorkDate');
  if(dateInput)dateInput.onchange=()=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(dateInput.value)){dateInput.value=attendanceWorkDate;return;}
    attendanceWorkDate=dateInput.value;
    attendanceDateManual=true;
    attendanceCheckFilter='pending';
    attendancePanel(p);
  };
  document.getElementById('attendanceResetDate')?.addEventListener('click',()=>{attendanceWorkDate=todayYmd();attendanceAutoDate=attendanceWorkDate;attendanceDateManual=false;attendanceCheckFilter='pending';attendancePanel(p)});
  document.getElementById('attendanceSync')?.addEventListener('click',()=>refreshAttendanceMembers());
  document.querySelectorAll('[data-att-filter]').forEach(btn=>btn.onclick=()=>{attendanceFilter=btn.dataset.attFilter;attendancePanel(p)});
  const search=document.getElementById('attendanceSearch');
  // 검색 중에는 input DOM을 절대 다시 만들지 않습니다.
  // 한글 IME의 compositionend 직후 input 자체를 교체하면 마지막 음절이 사라질 수 있습니다.
  const applyAttendanceSearch=()=>{
    attendanceSearch=search.value;
    const q=attendanceSearch.trim().toLowerCase();
    let visible=0;
    document.querySelectorAll('.attendance-table tbody .attendance-row').forEach(row=>{
      const name=String(row.querySelector('[data-label=\"이름\"] b')?.textContent||'').toLowerCase();
      const show=!q||name.includes(q);
      row.style.display=show?'':'none';
      if(show)visible++;
    });
    let empty=document.querySelector('.attendance-table tbody .attendance-search-empty');
    if(!visible){
      if(!empty){
        empty=document.createElement('tr');
        empty.className='attendance-search-empty';
        empty.innerHTML='<td colspan=\"7\" class=\"attendance-empty\">해당하는 회원이 없습니다.</td>';
        document.querySelector('.attendance-table tbody')?.appendChild(empty);
      }
      empty.style.display='';
    }else if(empty){empty.style.display='none'}
  };
  search.addEventListener('input',applyAttendanceSearch);
  applyAttendanceSearch();
  document.querySelectorAll('[data-attend]').forEach(btn=>btn.onclick=async()=>{
    if(attendanceWriting)return;
    const date=attendanceMode==='check'?attendanceWorkDate:todayYmd();
    const member=data.attendance.find(x=>String(x.id)===btn.dataset.attend);
    if(!member||member.member_status==='left')return alert('활동 회원을 찾지 못했습니다. 명단을 갱신해 주세요.');
    if(date>todayYmd())return alert('미래 날짜로는 출석을 기록할 수 없어요.');
    if(member.last_attended_at&&member.last_attended_at>date)return alert('이미 더 최근 날짜로 기록된 회원입니다. 기존 날짜를 유지할게요.');
    attendanceWriting=true;
    btn.disabled=true;
    try{
      const saved=await DOTT_DB.markAttendance(btn.dataset.attend,date);
      data.attendance=data.attendance.map(x=>String(x.id)===btn.dataset.attend?{...x,...saved}:x);
      attendancePanel(p);
      toast(shortDate(date)+' 참석으로 처리했습니다.');
    }catch(e){
      if(e.status===409){
        const latest=await DOTT_DB.attendance();
        if(!window.DOTT_ATTENDANCE_ERROR){data.attendance=latest;attendancePanel(p);}
      }
      alert(e.message||e);
    }finally{attendanceWriting=false;btn.disabled=false}
  });
  document.querySelectorAll('[data-att-edit]').forEach(btn=>btn.onclick=()=>attendanceModal(data.attendance.find(x=>x.id===btn.dataset.attEdit)));
  document.querySelectorAll('[data-att-del]').forEach(btn=>btn.onclick=async()=>{
    const member=data.attendance.find(x=>x.id===btn.dataset.attDel);
    if(!confirm(`${member?.name||'이 회원'}을(를) 완전히 삭제할까요?\n기록도 함께 사라집니다.`))return;
    await DOTT_DB.remove('attendance_members',btn.dataset.attDel);
    await loadAll();attendancePanel(p);toast('삭제했습니다.');
  });
}

function attendanceModal(x={}){
  const status=x.member_status||'active';
  showModal(x.id?'회원 수정':'회원 추가',`<div class="form-grid attendance-form">
    <div class="full"><label class="label">이름</label><input id="m_name" class="field" value="${esc(x.name||'')}"></div>
    <div><label class="label">가입일</label><input id="m_joined" class="field" type="date" value="${x.joined_at||todayYmd()}"></div>
    <div><label class="label">최근 참석일</label><input id="m_last" class="field" type="date" value="${x.last_attended_at||''}"></div>
    <div><label class="label">회원 상태</label><select id="m_status" class="field"><option value="active" ${status==='active'?'selected':''}>활동중</option><option value="left" ${status==='left'?'selected':''}>탈퇴</option></select></div>
    <div class="attendance-grace-box attendance-check-group"><label class="attendance-check"><input id="m_staff" type="checkbox" ${x.is_staff?'checked':''}> 운영진 상단 고정</label><label class="attendance-check"><input id="m_grace" type="checkbox" ${x.grace?'checked':''}> 유예 적용</label></div>
    <div class="full"><label class="label">메모</label><textarea id="m_reason" class="field" rows="2" placeholder="회원 관련 메모를 자유롭게 입력">${esc(x.grace_reason||'')}</textarea></div>
  </div>`,async m=>{
    const memberStatus=m.querySelector('#m_status').value;
    const grace=memberStatus==='active'&&m.querySelector('#m_grace').checked;
    const row={
      name:m.querySelector('#m_name').value.trim(),
      joined_at:m.querySelector('#m_joined').value,
      last_attended_at:m.querySelector('#m_last').value||null,
      member_status:memberStatus,
      is_staff:m.querySelector('#m_staff').checked,
      grace,
      grace_reason:m.querySelector('#m_reason').value.trim(),
      left_at:memberStatus==='left'?(x.left_at||todayYmd()):null,
      updated_at:new Date().toISOString()
    };
    if(!row.name)throw new Error('이름을 입력해 주세요.');
    if(!row.joined_at)throw new Error('가입일을 입력해 주세요.');
    x.id?await DOTT_DB.update('attendance_members',x.id,row):await DOTT_DB.insert('attendance_members',row);
    await loadAll();renderAdmin();toast('저장했습니다.');
  });
  const attendanceModalEl=document.querySelector('#modal .modal');
  if(attendanceModalEl)attendanceModalEl.classList.add('attendance-modal');
}

function noticePanel(p){
  p.innerHTML=`<div class="admin-tools"><div></div><button class="btn primary" id="add">+ 공지 추가</button></div><div class="table-wrap"><table class="table admin-notice-table"><thead><tr><th>구분</th><th>제목</th><th>내용</th><th>작성일</th><th>관리</th></tr></thead><tbody>${data.notices.map(x=>`<tr><td>${x.pinned?'📌 필독':'안내'}</td><td><b>${esc(x.title)}</b></td><td><span class="admin-notice-preview">${esc(noticePlainText(x.content))}</span></td><td>${new Date(x.created_at).toLocaleDateString('ko-KR')}</td><td><div class="actions"><button class="icon-btn" data-edit="${x.id}">✎</button><button class="icon-btn" data-del="${x.id}">♲</button></div></td></tr>`).join('')||'<tr><td colspan="5">등록된 공지가 없습니다.</td></tr>'}</tbody></table></div>`;
  document.getElementById('add').onclick=()=>noticeModal();
  wireRows('notices',noticeModal);
}

function noticeModal(x={}){
  const editorHtml=noticeEditorHtml(x.content||'');
  showModal(x.id?'공지 수정':'공지 추가',`<div><label class="label">제목</label><input id="f_title" class="field" value="${esc(x.title||'')}"></div><div style="margin-top:12px"><label class="label">내용</label><div class="rich-toolbar"><button type="button" class="rich-tool" id="fmtBold"><b>B</b> 굵게</button><label class="rich-color">글자색 <input type="color" id="fmtColor" value="#e95420"></label><button type="button" class="rich-tool" id="fmtClear">서식 지우기</button><span class="rich-help">강조할 글자를 드래그한 뒤 적용하세요.</span></div><div id="f_content" class="rich-editor" contenteditable="true" data-placeholder="공지 내용을 입력하세요.">${editorHtml}</div></div><label style="display:flex;gap:8px;align-items:center;margin-top:12px;font-size:13px"><input id="f_pin" type="checkbox" ${x.pinned?'checked':''}> 상단 고정</label>`,async m=>{
    const editor=m.querySelector('#f_content');
    const cleaned=sanitizeNoticeRichHtml(editor.innerHTML).trim();
    const row={title:m.querySelector('#f_title').value.trim(),content:NOTICE_RICH_PREFIX+cleaned,pinned:m.querySelector('#f_pin').checked};
    if(!row.title)throw new Error('제목을 입력해 주세요.');
    x.id?await DOTT_DB.update('notices',x.id,row):await DOTT_DB.insert('notices',row);
    await loadAll();renderAdmin();toast('저장했습니다.');
  });
  const modal=document.getElementById('modal');
  const editor=modal.querySelector('#f_content');
  const colorInput=modal.querySelector('#fmtColor');
  let savedRange=null;
  const remember=()=>{
    const sel=window.getSelection();
    if(sel&&sel.rangeCount&&editor.contains(sel.anchorNode))savedRange=sel.getRangeAt(0).cloneRange();
  };
  const restore=()=>{
    if(!savedRange)return false;
    const sel=window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange.cloneRange());
    return true;
  };
  const applyTextColor=color=>{
    if(!savedRange||savedRange.collapsed)return;
    const range=savedRange.cloneRange();
    // 선택한 내용이 공지 편집기 안에 있을 때만 색상을 적용합니다.
    if(!editor.contains(range.commonAncestorContainer))return;
    const span=document.createElement('span');
    span.style.color=color;
    const frag=range.extractContents();
    span.appendChild(frag);
    range.insertNode(span);
    // 색상 적용 뒤 커서는 강조 영역 뒤로 보내되, 저장한 선택 범위는 덮어쓰지 않습니다.
    const after=document.createRange();
    after.setStartAfter(span);after.collapse(true);
    const sel=window.getSelection();sel.removeAllRanges();sel.addRange(after);
    editor.normalize();
    editor.focus();
  };
  ['keyup','mouseup','touchend'].forEach(ev=>editor.addEventListener(ev,remember));
  editor.addEventListener('focusout',()=>{const sel=window.getSelection();if(sel&&sel.rangeCount&&editor.contains(sel.anchorNode))remember()});
  modal.querySelector('#fmtBold').addEventListener('mousedown',e=>{e.preventDefault();restore();document.execCommand('bold',false,null);editor.focus()});
  // color input은 팔레트를 여는 순간 브라우저 선택 영역이 사라질 수 있어 change 시 저장해 둔 Range에 직접 span을 씌웁니다.
  colorInput.addEventListener('mousedown',()=>remember());
  colorInput.addEventListener('change',e=>applyTextColor(e.target.value));
  modal.querySelector('#fmtClear').addEventListener('mousedown',e=>{e.preventDefault();restore();document.execCommand('removeFormat',false,null);editor.focus()});
}

const ONLINE_MURDER_MARKER='__DOTT_ONLINE_MURDER__';


function catalogPlaytimeLabel(v){
  const s=String(v??'').trim();
  if(!s)return '-';
  let m=s.match(/^\s*(\d+)\s*(?:분)?\s*$/);
  if(m)return `${m[1]}분`;
  m=s.match(/^\s*(\d+)\s*[~～\-–—]\s*(\d+)\s*(?:분)?\s*$/);
  if(m)return `${m[1]}~${m[2]}분`;
  return s;
}
function catalogPlaytimeInputValue(v){
  const s=String(v??'').trim();
  let m=s.match(/^\s*(\d+)\s*(?:분)?\s*$/);
  if(m)return m[1];
  m=s.match(/^\s*(\d+)\s*[~～\-–—]\s*(\d+)\s*(?:분)?\s*$/);
  if(m)return `${m[1]}~${m[2]}`;
  return s.replace(/분/g,'').trim();
}
function normalizeCatalogPlaytimeInput(v,{allowRange=false}={}){
  const s=String(v??'').trim();
  if(!s)return '';
  let m=s.match(/^\s*(\d+)\s*$/);
  if(m)return m[1];
  if(allowRange){
    m=s.match(/^\s*(\d+)\s*[~～\-–—]\s*(\d+)\s*$/);
    if(m){
      const a=Number(m[1]),b=Number(m[2]);
      if(a<=0||b<=0)throw new Error('플레이시간은 1 이상의 숫자로 입력해 주세요.');
      if(a>b)throw new Error('플레이시간 범위는 작은 숫자~큰 숫자 순서로 입력해 주세요. 예: 60~90');
      return `${a}~${b}`;
    }
  }
  throw new Error(allowRange?'플레이시간은 60 또는 60~90 형식으로 입력해 주세요.':'플레이시간은 숫자만 입력해 주세요. 예: 180');
}

function catalogDifficultyInputValue(v){
  const s=String(v??'').trim();
  if(!s)return '';
  const n=Number(s);
  return Number.isFinite(n)&&n>=1&&n<=5?String(Math.round(n*100)/100):'';
}
function catalogDifficultyMeterHtml(v){
  const raw=String(v??'').trim();
  const score=parseFloat(raw);
  if(!Number.isFinite(score)||score<1||score>5)return esc(raw||'-');
  const safe=Math.max(1,Math.min(5,score));
  const boxes=Array.from({length:5},(_,i)=>{
    const fill=Math.max(0,Math.min(100,(safe-i)*100));
    return `<span style="display:inline-block;width:10px;height:10px;border:1px solid #d8c9bc;border-radius:2px;margin-right:2px;background:linear-gradient(90deg,#e46f3a 0 var(--fill),#fff 0 100%);--fill:${fill}%"></span>`;
  }).join('');
  const label=(Math.round(safe*100)/100).toString();
  return `<span title="난이도 ${esc(label)} / 5" style="display:inline-flex;align-items:center;white-space:nowrap">${boxes}</span>`;
}

function rentalPanel(p){
  const allGames=[...data.boardgame,...data.murder,...data.deduction];
  const gameById=new Map(allGames.map(x=>[String(x.id),x]));
  const active=data.rentals.filter(x=>!x.returned_at);
  const history=data.rentals.filter(x=>!!x.returned_at);
  const rowHtml=(x,activeRow)=>{
    const game=gameById.get(String(x.catalog_item_id));
    const gameName=x.game_name||game?.name||'삭제된 게임';
    return `<tr><td><b>${esc(gameName)}</b></td><td>${esc(x.borrower||'-')}</td><td>${esc(x.rented_at||'-')}</td>${activeRow?`<td><span class="rental-status rental-active">대여중</span></td><td><button class="btn rental-return-btn" data-rental-return="${x.id}">반납완료</button></td>`:`<td>${esc(x.returned_at||'-')}</td><td><span class="rental-status rental-done">반납완료</span></td>`}</tr>`;
  };
  p.innerHTML=`<div class="catalog-admin-desc rental-guide"><b>🧳 게임 대여 관리대장</b><p>게임 수정 화면에서 상태를 <b>대여중</b>으로 변경하면 대여자와 대여일을 입력할 수 있습니다. 반납 시 아래 <b>반납완료</b> 버튼만 누르면 됩니다.</p></div>
  <div class="rental-section"><div class="rental-section-head"><b>현재 대여중</b><span>${active.length}건</span></div><div class="table-wrap"><table class="table rental-table"><thead><tr><th>게임명</th><th>대여자</th><th>대여일</th><th>상태</th><th>관리</th></tr></thead><tbody>${active.map(x=>rowHtml(x,true)).join('')||'<tr><td colspan="5">현재 대여중인 게임이 없습니다.</td></tr>'}</tbody></table></div></div>
  <div class="rental-section"><div class="rental-section-head"><b>대여 이력</b><span>${history.length}건</span></div><div class="table-wrap"><table class="table rental-table"><thead><tr><th>게임명</th><th>대여자</th><th>대여일</th><th>반납일</th><th>상태</th></tr></thead><tbody>${history.map(x=>rowHtml(x,false)).join('')||'<tr><td colspan="5">반납 완료된 대여 이력이 없습니다.</td></tr>'}</tbody></table></div></div>`;
  p.querySelectorAll('[data-rental-return]').forEach(btn=>btn.onclick=async()=>{
    const loan=data.rentals.find(x=>String(x.id)===String(btn.dataset.rentalReturn));
    if(!loan||loan.returned_at)return;
    const game=gameById.get(String(loan.catalog_item_id));
    if(!confirm(`${loan.game_name||game?.name||'게임'}을(를) 반납완료 처리할까요?`))return;
    btn.disabled=true;
    try{
      await DOTT_DB.update('rental_loans',loan.id,{returned_at:todayYmd()});
      if(game)await DOTT_DB.update('catalog_items',game.id,{status:loan.previous_status||'도트',current_borrower:null,current_rented_at:null});
      await loadAll();renderAdmin();toast('반납완료 처리했습니다.');
    }catch(e){alert(e.message||e);btn.disabled=false}
  });
}

function catalogPanel(p,kind){
  const title={boardgame:'보드게임',murder:'머더미스터리',deduction:'추리게임'}[kind];
  const descKey={boardgame:'boardgame_description',murder:'murder_description',deduction:'deduction_description'}[kind];
  const defaultDesc={boardgame:'도트에 있는 보드게임을 검색하고 인원·난이도·장르별로 골라보세요.',murder:'보유 중인 머더미스터리 시나리오를 한눈에 확인하세요.',deduction:'추리·사건 해결형 게임 보유 목록을 확인하세요.'}[kind];
  const currentDesc=(data.settings&&data.settings[descKey])||defaultDesc;
  const rows=data[kind];
  const head=kind==='murder'
    ? '<th style="text-align:center">게임명</th><th style="text-align:center">인원</th><th style="text-align:center">시간</th><th style="text-align:center">난이도</th><th style="text-align:center">상태 및 위치</th><th style="text-align:center">소유주</th><th style="text-align:center">비고</th><th style="text-align:center">관리</th>'
    : '<th style="text-align:center">게임명</th><th style="text-align:center">인원</th><th style="text-align:center">시간</th><th style="text-align:center">난이도</th><th style="text-align:center">장르</th><th style="text-align:center">상태 및 위치</th><th style="text-align:center">소유주</th><th style="text-align:center">관리</th>';
  const body=rows.map(x=>{
    if(kind==='murder'){
      const isOnline=x.genre===ONLINE_MURDER_MARKER;
      const onlineBadge=isOnline?'<span class="online-murder-badge">온라인</span>':'';
      return `<tr><td style="text-align:left"><b>${esc(x.name)}</b>${onlineBadge}</td><td style="text-align:center">${x.min_players||'?'}~${x.max_players||'?'}인</td><td style="text-align:center">${esc(catalogPlaytimeLabel(x.playtime))}</td><td style="text-align:center">${esc(x.difficulty||'-')}</td><td style="text-align:center">${esc(x.status||'보유')}</td><td style="text-align:center">${esc(x.location||'-')}</td><td style="text-align:center">${esc(x.note||'-')}</td><td style="text-align:center"><div class="actions" style="justify-content:center"><button class="icon-btn" data-edit="${x.id}">✎</button><button class="icon-btn" data-del="${x.id}">♲</button></div></td></tr>`;
    }
    const expansionBadge=kind==='boardgame'&&x.is_expansion?'<span class="boardgame-expansion-badge">확장</span>':'';
    return `<tr><td style="text-align:left"><b>${esc(x.name)}</b>${expansionBadge}</td><td style="text-align:center">${x.min_players||'?'}~${x.max_players||'?'}인</td><td style="text-align:center">${esc(catalogPlaytimeLabel(x.playtime))}</td><td style="text-align:center">${catalogDifficultyMeterHtml(x.difficulty)}</td><td style="text-align:center">${esc(x.genre||'')}</td><td style="text-align:center">${esc(x.status||'-')}</td><td style="text-align:center">${esc(x.note||'-')}</td><td style="text-align:center"><div class="actions" style="justify-content:center"><button class="icon-btn" data-edit="${x.id}">✎</button><button class="icon-btn" data-del="${x.id}">♲</button></div></td></tr>`;
  }).join('')||`<tr><td colspan="8">등록된 ${title}이 없습니다.</td></tr>`;
  const murderNoticeEditor=kind==='murder'?`<div class="catalog-admin-desc"><div class="catalog-admin-card-head"><label class="label">머더미스터리 이용수칙 · 공지 팝업</label><button class="btn" id="saveMurderNotice">버튼·공지 저장</button></div><p style="font-size:11px;color:var(--muted);line-height:1.55;margin:0 0 9px">공개 머더미스터리 페이지의 공지 버튼을 눌렀을 때 뜨는 별도 팝업입니다. 버튼 이름과 공지 내용을 각각 수정할 수 있습니다.</p><div style="margin-bottom:10px"><label class="label" style="font-size:11px">공지 버튼 이름</label><input id="murderNoticeButtonLabel" class="field" maxlength="30" placeholder="예: 이용수칙 · 공지 보기" value="${esc((data.settings&&data.settings.murder_notice_button_label)||'이용수칙 · 공지 보기')}"></div><div class="catalog-admin-desc-row"><textarea id="murderNotice" class="field" rows="7" placeholder="이용수칙, 플레이 안내, 주의사항 등을 입력하세요.">${esc((data.settings&&data.settings.murder_notice)||'')}</textarea></div><div class="error" id="murderNoticeErr"></div></div>`:'';
  p.innerHTML=`<div class="${kind==='murder'?'murder-admin-editors':''}"><div class="catalog-admin-desc"><div class="catalog-admin-card-head"><label class="label">${title} 리스트 제목 아래 설명 문구</label><button class="btn" id="saveCatalogDesc">설명 저장</button></div><div class="catalog-admin-desc-row"><textarea id="catalogDesc" class="field" rows="2">${esc(currentDesc)}</textarea></div><div class="error" id="catalogDescErr"></div></div>${murderNoticeEditor}</div><div class="admin-tools"><div>${rows.length}개 등록됨</div><button class="btn primary" id="add">+ ${title} 추가</button></div><div class="table-wrap admin-catalog-table-wrap"><table class="table admin-catalog-table admin-catalog-${kind}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  document.getElementById('saveCatalogDesc').onclick=async()=>{
    const btn=document.getElementById('saveCatalogDesc'),err=document.getElementById('catalogDescErr');
    btn.disabled=true;err.textContent='';
    try{
      data.settings=await DOTT_DB.saveSettings({[descKey]:document.getElementById('catalogDesc').value.trim()});
      toast(`${title} 설명을 저장했습니다.`);
    }catch(e){err.textContent=(e.message||e)+' — add-catalog-descriptions.sql을 먼저 실행해 주세요.'}
    finally{btn.disabled=false}
  };
  if(kind==='murder')document.getElementById('saveMurderNotice').onclick=async()=>{
    const btn=document.getElementById('saveMurderNotice'),err=document.getElementById('murderNoticeErr');
    btn.disabled=true;err.textContent='';
    try{
      const label=document.getElementById('murderNoticeButtonLabel').value.trim()||'이용수칙 · 공지 보기';
      data.settings=await DOTT_DB.saveSettings({murder_notice_button_label:label,murder_notice:document.getElementById('murderNotice').value.trim()});
      toast('공지 버튼 이름과 내용을 저장했습니다.');
    }catch(e){err.textContent=(e.message||e)+' — add-murder-notice-button-label.sql을 Supabase에서 한 번 실행해 주세요.'}
    finally{btn.disabled=false}
  };
  document.getElementById('add').onclick=()=>catalogModal({},kind);
  wireRows('catalog_items',x=>catalogModal(x,kind),kind);
}

function catalogModal(x={},kind){
  const boardgameGenres=['전략','파티/패밀리','협력','디덕션','마피아','레거시'];
  const murderDifficulties=['입문','쉬움','중간','어려움','매우어려움'];
  const murderStatuses=['보유','대여중','분실','도트','공방'];
  const murderOnline=x.genre===ONLINE_MURDER_MARKER;
  const boardgameExpansion=!!x.is_expansion;
  const nameField=kind==='murder'
    ? `<div class="full murder-name-row"><div><label class="label">게임명</label><input id="f_name" class="field" value="${esc(x.name||'')}"></div><label class="murder-online-check murder-online-check-name"><input id="f_online_murder" type="checkbox" ${murderOnline?'checked':''}> 온라인</label></div>`
    : kind==='boardgame'
      ? `<div class="full murder-name-row"><div><label class="label">이름</label><input id="f_name" class="field" value="${esc(x.name||'')}"></div><label class="catalog-flag-check murder-online-check-name"><input id="f_boardgame_expansion" type="checkbox" ${boardgameExpansion?'checked':''}> 확장</label></div>`
      : `<div class="full"><label class="label">이름</label><input id="f_name" class="field" value="${esc(x.name||'')}"></div>`;
  const timeField=kind==='murder'
    ? `<div><label class="label">플레이시간</label><div style="display:flex;align-items:center;gap:7px"><input id="f_time" class="field" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="예: 180" value="${esc(catalogPlaytimeInputValue(x.playtime))}" oninput="this.value=this.value.replace(/\D/g,'')"><span style="flex:0 0 auto;color:var(--muted);font-size:13px;font-weight:700">분</span></div></div>`
    : `<div><label class="label">플레이시간</label><div style="display:flex;align-items:center;gap:7px"><input id="f_time" class="field" type="text" inputmode="text" maxlength="9" placeholder="예: 60 또는 60~90" value="${esc(catalogPlaytimeInputValue(x.playtime))}" oninput="this.value=this.value.replace(/[^0-9~～\-–—]/g,'')"><span style="flex:0 0 auto;color:var(--muted);font-size:13px;font-weight:700">분</span></div><div style="margin-top:5px;font-size:11px;color:var(--muted)">숫자 또는 범위 입력 · 예: 60 / 60~90</div></div>`;
  const commonTop=`<div class="form-grid">${nameField}<div><label class="label">최소 인원</label><input id="f_min" class="field" type="number" min="1" value="${x.min_players||2}"></div><div><label class="label">최대 인원</label><input id="f_max" class="field" type="number" min="1" value="${x.max_players||4}"></div>${timeField}`;
  let middle='';
  let bottom='';
  if(kind==='murder'){
    middle=`<div><label class="label">난이도</label><select id="f_diff" class="field"><option value="">선택 안함</option>${murderDifficulties.map(v=>`<option value="${v}" ${x.difficulty===v?'selected':''}>${v}</option>`).join('')}</select></div>`;
    bottom=`<div><label class="label">상태 및 위치</label><select id="f_status" class="field" onchange="const r=document.getElementById('rentalFields');if(r)r.style.display=this.value==='대여중'?'grid':'none'">${murderStatuses.map(v=>`<option value="${v}" ${x.status===v?'selected':''}>${v}</option>`).join('')}</select></div><div><label class="label">소유주</label><input id="f_owner" class="field" placeholder="소유주 입력" value="${esc(x.location||'')}"></div><div class="full"><label class="label">비고</label><textarea id="f_note" class="field" rows="3" placeholder="자유롭게 입력">${esc(x.note||'')}</textarea></div></div>`;
  }else{
    const genreField=kind==='boardgame'
      ? `<select id="f_genre" class="field"><option value="">선택 안함</option>${boardgameGenres.map(v=>`<option value="${esc(v)}" ${x.genre===v?'selected':''}>${esc(v)}</option>`).join('')}</select>`
      : `<input id="f_genre" class="field" placeholder="장르 입력" value="${esc(x.genre||'')}">`;
    middle=`<div><label class="label">난이도</label><input id="f_diff" class="field" type="number" min="1" max="5" step="0.01" inputmode="decimal" placeholder="예: 1.78" value="${esc(catalogDifficultyInputValue(x.difficulty))}"><div style="margin-top:5px;font-size:11px;color:var(--muted)">1~5 사이 소수점 입력 · 예: 1.78</div></div><div><label class="label">장르</label>${genreField}</div>`;
    bottom=`<div><label class="label">상태 및 위치</label><select id="f_status" class="field" onchange="const r=document.getElementById('rentalFields');if(r)r.style.display=this.value==='대여중'?'grid':'none'">${['보유','도트','공방','대여중','분실'].map(v=>`<option value="${v}" ${x.status===v?'selected':''}>${v}</option>`).join('')}</select></div><div><label class="label">소유주</label><input id="f_note" class="field" placeholder="소유주 입력" value="${esc(x.note||'')}"></div></div>`;
  }
  const activeLoan=x.id?data.rentals.find(r=>String(r.catalog_item_id)===String(x.id)&&!r.returned_at):null;
  const rentalFields=`<div id="rentalFields" class="full rental-fields" style="display:${x.status==='대여중'?'grid':'none'}"><div><label class="label">대여자</label><input id="f_borrower" class="field" placeholder="대여자 이름" value="${esc(activeLoan?.borrower||'')}"></div><div><label class="label">대여일</label><input id="f_rented_at" class="field" type="date" value="${esc(activeLoan?.rented_at||todayYmd())}"></div></div>`;
  showModal(x.id?'항목 수정':'항목 추가',commonTop+middle+bottom.replace(/<\/div>\s*$/,rentalFields+'</div>'),async m=>{
    const row={
      kind,
      name:m.querySelector('#f_name').value.trim(),
      min_players:+m.querySelector('#f_min').value||null,
      max_players:+m.querySelector('#f_max').value||null,
      playtime:(()=>{
        const raw=m.querySelector('#f_time').value.trim();
        if(kind==='murder')return normalizeCatalogPlaytimeInput(raw,{allowRange:false});
        return normalizeCatalogPlaytimeInput(raw,{allowRange:true});
      })(),
      status:m.querySelector('#f_status').value,
      note:m.querySelector('#f_note').value.trim()
    };
    if(kind==='murder'){
      row.difficulty=m.querySelector('#f_diff').value;
      // online_murder 컬럼은 PostgREST 스키마 캐시 문제를 피하기 위해 사용하지 않습니다.
      // 머더미스터리에서는 사용하지 않는 genre 필드에 온라인머미 여부를 저장합니다.
      row.genre=m.querySelector('#f_online_murder')?.checked?ONLINE_MURDER_MARKER:null;
      row.location=m.querySelector('#f_owner').value.trim();
    }else{
      const diffInput=m.querySelector('#f_diff').value.trim();
      const originalDifficulty=String(x.difficulty||'').trim();
      const originalNumeric=originalDifficulty!==''&&Number.isFinite(Number(originalDifficulty))&&Number(originalDifficulty)>=1&&Number(originalDifficulty)<=5;
      if(diffInput){
        const score=Number(diffInput);
        if(!Number.isFinite(score)||score<1||score>5)throw new Error('난이도는 1~5 사이 숫자로 입력해 주세요. 예: 1.78');
        row.difficulty=String(Math.round(score*100)/100);
      }else{
        row.difficulty=(x.id&&!originalNumeric&&originalDifficulty)?originalDifficulty:'';
      }
      row.genre=m.querySelector('#f_genre').value.trim();
      if(kind==='boardgame')row.is_expansion=!!m.querySelector('#f_boardgame_expansion')?.checked;
    }
    if(!row.name)throw new Error('이름을 입력해 주세요.');
    const wantsRental=row.status==='대여중';
    if(activeLoan&&!wantsRental)throw new Error('대여중인 게임은 대여 관리 탭의 반납완료 버튼으로 처리해 주세요.');
    const borrower=m.querySelector('#f_borrower')?.value.trim()||'';
    const rentedAt=m.querySelector('#f_rented_at')?.value||'';
    if(wantsRental&&!activeLoan&&(!borrower||!rentedAt))throw new Error('대여중으로 변경할 때는 대여자와 대여일을 입력해 주세요.');
    if(wantsRental){
      row.current_borrower=borrower||(activeLoan?.borrower||'');
      row.current_rented_at=rentedAt||(activeLoan?.rented_at||'');
    }else{
      row.current_borrower=null;
      row.current_rented_at=null;
    }
    const saved=x.id?await DOTT_DB.update('catalog_items',x.id,row):await DOTT_DB.insert('catalog_items',row);
    const itemId=x.id||saved?.id;
    if(wantsRental&&!activeLoan&&itemId){
      await DOTT_DB.insert('rental_loans',{catalog_item_id:String(itemId),game_name:row.name,borrower,rented_at:rentedAt,previous_status:(x.status&&x.status!=='대여중')?x.status:'도트'});
    }else if(wantsRental&&activeLoan){
      await DOTT_DB.update('rental_loans',activeLoan.id,{game_name:row.name,borrower:borrower||activeLoan.borrower,rented_at:rentedAt||activeLoan.rented_at});
    }
    await loadAll();renderAdmin();toast('저장했습니다.');
  });
}

function wireRows(table,editFn,kind){
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{
    const list=table==='schedules'?data.schedules:table==='notices'?data.notices:data[kind];
    editFn(list.find(x=>x.id===b.dataset.edit));
  });
  document.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{
    if(!confirm('정말 삭제할까요?'))return;
    await DOTT_DB.remove(table,b.dataset.del);
    await loadAll();renderAdmin();toast('삭제했습니다.');
  });
}

function settingsPanel(p){
  const isOwner=dottAdminRole==='owner';
  const roleLabel=isOwner?'최고관리자 · OWNER':'일반 운영진 · ADMIN';
  const s={
    hero_badge:'◎ 전체 공개 일정',
    hero_title:'우리의 모든 일정을\n한눈에 확인하세요',
    hero_description:'월별 캘린더에서 예약 일정을 확인하고, 보드게임·머더미스터리·추리게임 보유 목록도 함께 살펴볼 수 있습니다.',
    boardgame_description:'도트에 있는 보드게임을 검색하고 인원·난이도·장르별로 골라보세요.',
    murder_description:'보유 중인 머더미스터리 시나리오를 한눈에 확인하세요.',
    murder_notice:'',
    deduction_description:'추리·사건 해결형 게임 보유 목록을 확인하세요.',
    ...(data.settings||{})
  };
  const ownerNav=isOwner?'<a href="#setting-team" class="settings-index-link"><span class="settings-index-icon">04</span><span><b>운영진 권한</b><small>최고관리자 전용</small></span></a>':'';
  const ownerSection=isOwner?`<section id="setting-team" class="settings-section">
    <div class="settings-section-head"><div><span class="settings-kicker">04 / STAFF ACCESS</span><h2>운영진 권한 관리</h2><p>최고관리자만 승인된 운영진 명단을 확인하고 권한을 부여·해제할 수 있습니다.</p></div><span class="settings-section-mark">OWNER ONLY</span></div>
    <div class="settings-team-body">
      <div class="settings-team-intro"><span class="settings-team-lock">🔒</span><span>현재 최고관리자는 1명으로 고정됩니다. 운영진 추가는 이미 Supabase Auth에 만들어진 계정에만 가능합니다.</span></div>
      <div id="teamList" aria-live="polite"><p class="settings-help">운영진 명단을 불러오는 중입니다…</p></div>
      <form id="teamAddForm" class="settings-team-add" autocomplete="off">
        <div class="settings-field"><label class="label" for="teamAddEmail">일반 운영진 등록</label><input id="teamAddEmail" class="field" type="email" autocomplete="off" placeholder="등록된 운영진 이메일 입력" required></div>
        <button class="btn primary" type="submit" id="teamAddButton">운영진 권한 부여</button>
      </form>
      <p class="settings-help">계정을 새로 만드는 기능은 아닙니다. Supabase Authentication에 기존 계정이 있어야 하며, Owner 역할은 이 화면에서 변경하지 않습니다.</p>
      <div class="error" id="teamErr" role="alert"></div>
    </div>
  </section>`:'';
  p.innerHTML=`<div class="settings-layout">
    <aside class="settings-index" aria-label="설정 항목">
      <div class="settings-index-title">SETTINGS <span>01 — ${isOwner?'04':'03'}</span></div>
      <div class="settings-index-profile"><span class="settings-user-avatar">${isOwner?'O':'A'}</span><div><b>${esc(roleLabel)}</b><small title="${esc(dottAdminEmail)}">${esc(dottAdminEmail||'운영진 로그인')}</small></div></div>
      <a href="#setting-account" class="settings-index-link"><span class="settings-index-icon">01</span><span><b>내 계정</b><small>계정 · 비밀번호</small></span></a>
      <a href="#setting-content" class="settings-index-link"><span class="settings-index-icon">02</span><span><b>홈페이지 문구</b><small>운영진 모두 수정 가능</small></span></a>
      <a href="#setting-backup" class="settings-index-link"><span class="settings-index-icon">03</span><span><b>데이터 백업·복원</b><small>백업 다운로드 · 복원 안내</small></span></a>
      ${ownerNav}
      <div class="settings-index-note"><strong>설정 안내</strong><br>문구 변경은 회원용 도트 홈페이지에 반영됩니다. 권한 변경은 별도의 서버 검사로 보호됩니다.</div>
    </aside>
    <div class="settings-main">
      <section id="setting-account" class="settings-section">
        <div class="settings-section-head"><div><span class="settings-kicker">01 / MY ACCOUNT</span><h2>내 계정 관리</h2><p>로그인한 내 계정의 역할을 확인하고 비밀번호를 변경합니다.</p></div><span class="settings-section-mark">${isOwner?'OWNER':'ADMIN'}</span></div>
        <div class="settings-account-overview"><div class="settings-account-avatar">${isOwner?'O':'A'}</div><div class="settings-account-details"><small>현재 로그인 계정</small><strong>${esc(dottAdminEmail||'이메일 정보 없음')}</strong><span class="settings-role-badge">${esc(roleLabel)}</span></div></div>
        <div class="settings-password-form"><div class="settings-security-note"><b>내 비밀번호 변경</b><span>다른 운영진 계정의 비밀번호는 변경되지 않습니다. 안전한 새 비밀번호를 설정해 주세요.</span></div>
          <div class="settings-password-grid"><div class="settings-field"><label class="label" for="pw1">새 비밀번호</label><input id="pw1" class="field" type="password" autocomplete="new-password" placeholder="8자 이상"></div><div class="settings-field"><label class="label" for="pw2">새 비밀번호 확인</label><input id="pw2" class="field" type="password" autocomplete="new-password" placeholder="새 비밀번호 다시 입력"></div></div>
          <div class="settings-action-row"><span class="settings-save-hint">현재 계정에만 적용됩니다.</span><button class="btn primary" id="changePw" type="button">비밀번호 변경</button></div><div class="error" id="pwErr" role="alert"></div>
        </div>
      </section>
      <section id="setting-content" class="settings-section">
        <div class="settings-section-head"><div><span class="settings-kicker">02 / SITE CONTENT</span><h2>홈페이지 문구</h2><p>회원용 도트 홈페이지의 예약 캘린더 상단에 표시되는 문구를 편집합니다.</p></div><span class="settings-section-mark">운영진 공통</span></div>
        <div class="settings-section-body"><div class="settings-fields">
          <div class="settings-field"><label class="label" for="heroBadge">작은 안내 문구</label><input id="heroBadge" class="field" value="${esc(s.hero_badge)}" placeholder="예: 전체 공개 일정"></div>
          <div class="settings-field"><label class="label" for="heroTitle">메인 제목</label><textarea id="heroTitle" class="field" rows="3" placeholder="예약 페이지의 큰 제목">${esc(s.hero_title)}</textarea><small class="settings-help">줄을 바꾸고 싶은 위치에서 Enter를 누르면 됩니다.</small></div>
          <div class="settings-field"><label class="label" for="heroDescription">소개 문구</label><textarea id="heroDescription" class="field" rows="3" placeholder="회원에게 보여줄 안내 문구">${esc(s.hero_description)}</textarea></div>
          <div class="settings-action-row"><span class="settings-save-hint">Owner와 Admin 모두 수정할 수 있습니다.</span><button class="btn primary" id="saveHero" type="button">문구 저장하기</button></div>
          <div class="error" id="settingsErr" role="alert"></div>
        </div><div class="settings-preview-col"><div class="settings-preview-head">실시간 미리보기 <span>회원 사이트 · 상단 문구</span></div><div class="settings-preview"><span class="settings-preview-badge" id="heroPreviewBadge"></span><h3 id="heroPreviewTitle"></h3><p id="heroPreviewDescription"></p></div><p class="settings-help">미리보기는 입력 중인 문구를 보여줍니다. 실제 디자인과 차이가 있을 수 있습니다.</p></div></div>
      </section>
      <section id="setting-backup" class="settings-section">
        <div class="settings-section-head"><div><span class="settings-kicker">03 / DATA MANAGEMENT</span><h2>데이터 백업 · 복원</h2><p>운영 데이터는 정기적으로 보관하되, 위험한 일괄 복원은 별도 절차로 관리합니다.</p></div><span class="settings-section-mark">안전 관리</span></div>
        <div class="settings-section-body settings-backup-body">
          <div class="settings-backup-option"><span class="settings-option-symbol">↓</span><div><h3>전체 데이터 JSON 백업</h3><p>예약 · 출석 · 게임 · 회비 · 회계 · 공지 데이터를 다운로드합니다. 운영진 모두 사용 가능합니다.</p><button class="btn primary" id="downloadBackup" type="button">JSON 백업 다운로드</button></div></div>
          <div class="settings-backup-option settings-restore-option"><span class="settings-option-symbol">🔒</span><div><h3>전체 데이터 복원 <small>OWNER 전용</small></h3><p>${isOwner?'현재 복원은 안전한 서버 측 전용 절차를 준비하기 전까지 비활성화되어 있습니다. 기존 자동 복원은 데이터 손상 위험이 있어 제거했습니다.':'전체 복원은 최고관리자 전용 작업입니다. 일반 운영진에게 복원 기능은 제공되지 않습니다.'}</p><span class="settings-restore-disabled">${isOwner?'복원 기능 비활성화 · 안전한 복원 방식 준비 필요':'Owner만 복원 요청 가능'}</span></div></div>
          <div class="settings-backup-footnote">JSON 백업에는 Supabase Auth 계정, RLS 정책, 함수 정의, 게임 이미지와 영수증 원본 파일이 포함되지 않습니다. 저장한 JSON은 공개 GitHub에 올리지 마세요.</div>
          <div class="error" id="backupErr" role="alert"></div>
        </div>
      </section>
      ${ownerSection}
    </div>
  </div>`;
  const updateSettingsPreview=()=>{
    document.getElementById('heroPreviewBadge').textContent=document.getElementById('heroBadge').value||'안내 문구';
    document.getElementById('heroPreviewTitle').textContent=document.getElementById('heroTitle').value||'메인 제목';
    document.getElementById('heroPreviewDescription').textContent=document.getElementById('heroDescription').value||'소개 문구';
  };
  ['heroBadge','heroTitle','heroDescription'].forEach(id=>document.getElementById(id).addEventListener('input',updateSettingsPreview));
  updateSettingsPreview();
  document.getElementById('saveHero').onclick=async()=>{
    const btn=document.getElementById('saveHero'),err=document.getElementById('settingsErr');btn.disabled=true;err.textContent='';
    try{
      const row={hero_badge:document.getElementById('heroBadge').value.trim(),hero_title:document.getElementById('heroTitle').value.trim(),hero_description:document.getElementById('heroDescription').value.trim()};
      if(!row.hero_title)throw new Error('큰 제목을 입력해 주세요.');
      data.settings=await DOTT_DB.saveSettings(row);toast('메인 화면 문구를 저장했습니다.');
    }catch(e){err.textContent=e.message||String(e)}
    finally{btn.disabled=false}
  };
  document.getElementById('downloadBackup').onclick=async()=>{
    const btn=document.getElementById('downloadBackup'),err=document.getElementById('backupErr');btn.disabled=true;err.textContent='';
    try{
      const backup=await DOTT_DB.createFullBackup();
      const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json;charset=utf-8'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      const stamp=new Date().toLocaleDateString('sv-SE');
      link.href=url;link.download=`DOTT_backup_${stamp}.json`;document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);toast('JSON 백업 파일을 저장했습니다.');
    }catch(e){err.textContent=e.message||String(e)}
    finally{btn.disabled=false}
  };
  document.getElementById('changePw').onclick=async()=>{
    const btn=document.getElementById('changePw'),err=document.getElementById('pwErr');
    const a=document.getElementById('pw1').value,b=document.getElementById('pw2').value;
    err.textContent='';
    if(a.length<8){err.textContent='비밀번호는 8자 이상으로 입력해 주세요.';return}
    if(a!==b){err.textContent='입력한 비밀번호가 서로 다릅니다.';return}
    btn.disabled=true;
    try{await DOTT_DB.changePassword(a);document.getElementById('pw1').value='';document.getElementById('pw2').value='';toast('비밀번호를 변경했습니다.');}
    catch(ex){err.textContent=ex.message||String(ex)}
    finally{btn.disabled=false}
  };
  if(isOwner)initTeamManagement();
}

async function initTeamManagement(){
  const el=document.getElementById('teamList'),err=document.getElementById('teamErr');
  if(!el||dottAdminRole!=='owner')return;
  const refresh=async()=>{
    el.innerHTML='<p class="settings-help">운영진 명단을 불러오는 중입니다…</p>';
    try{
      const rows=await DOTT_DB.listAdminMembers();
      if(!document.getElementById('teamList'))return;
      el.innerHTML=`<div class="settings-team-list-head"><strong>현재 운영진</strong><span>${rows.length}명</span></div><div class="settings-team-list">${rows.map(x=>`<div class="settings-team-person"><span class="settings-team-person-avatar ${x.role==='owner'?'is-owner':''}">${x.role==='owner'?'O':'A'}</span><div class="settings-team-person-detail"><b>${esc(x.email)}</b><small>${x.role==='owner'?'최고관리자 · OWNER':'일반 운영진 · ADMIN'}</small></div><span class="settings-role-badge">${x.role==='owner'?'OWNER':'ADMIN'}</span>${x.role==='admin'?`<button class="btn settings-revoke" type="button" data-revoke-email="${esc(x.email)}">권한 해제</button>`:'<span class="settings-owner-lock">보호됨</span>'}</div>`).join('')}</div>`;
      el.querySelectorAll('[data-revoke-email]').forEach(btn=>btn.onclick=async()=>{
        const email=btn.dataset.revokeEmail;
        if(!confirm(`${email} 계정의 DOTT ADMIN 접근 권한을 해제할까요?\nSupabase 계정 자체는 삭제하지 않습니다.`))return;
        btn.disabled=true;err.textContent='';
        try{await DOTT_DB.setAdminMember(email,'remove');toast('운영진 권한을 해제했습니다.');await refresh()}
        catch(e){err.textContent=e.message||String(e);btn.disabled=false}
      });
    }catch(e){
      const needsSetup=e?.status===404||/Could not find the function|schema cache|PGRST202|PGRST205/i.test(String(e?.message||''));
      el.innerHTML=`<div class="settings-team-notice"><b>${needsSetup?'운영진 권한 관리 SQL 설치가 필요합니다.':'운영진 명단을 불러오지 못했습니다.'}</b><p>${needsSetup?'별도로 제공한 DOTT_ADMIN_v4_운영진권한_SQL.sql 파일을 Supabase SQL Editor에서 실행하면 명단과 추가·해제 기능이 활성화됩니다.':esc(e?.message||'다시 시도해 주세요.')}</p><button type="button" class="btn" id="retryTeam">다시 불러오기</button></div>`;
      document.getElementById('retryTeam')?.addEventListener('click',refresh);
    }
  };
  document.getElementById('teamAddForm').onsubmit=async e=>{
    e.preventDefault();const input=document.getElementById('teamAddEmail'),btn=document.getElementById('teamAddButton');
    const email=input.value.trim();if(!email)return;
    err.textContent='';btn.disabled=true;
    try{await DOTT_DB.setAdminMember(email,'add');input.value='';toast('운영진 권한을 부여했습니다.');await refresh()}
    catch(ex){err.textContent=ex.message||String(ex)}
    finally{btn.disabled=false}
  };
  await refresh();
}

// ===== 회비 · 회계 =====
function acctMonthKey(d=accountingMonth){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`}
function acctMonthLabel(d=accountingMonth){return `${d.getFullYear()}년 ${d.getMonth()+1}월`}
function acctYmd(v){return v?String(v).slice(0,10):'-'}
function acctMoney(v){return `${Number(v||0).toLocaleString('ko-KR')}원`}
function acctClosed(month=acctMonthKey()){return data.closures.find(x=>String(x.month).slice(0,10)===month)}
function acctRows(){const ym=acctMonthKey().slice(0,7);return data.ledger.filter(x=>String(x.entry_date||'').slice(0,7)===ym)}
function acctFees(){const ym=acctMonthKey().slice(0,7);return data.fees.filter(x=>String(x.fee_month||'').slice(0,7)===ym)}
function acctBalanceBefore(){const first=acctMonthKey();return data.ledger.filter(x=>String(x.entry_date)<first).reduce((a,x)=>a+acctCashDelta(x),0)}
function acctCashDelta(x){if(x.category==='미지급금'&&x.entry_type==='발생')return 0;return Number(x.amount||0)*(x.entry_type==='수입'?1:-1)}
function accountingPanel(p){
  const subs=[['fees','회비 현황'],['ledger','회계장부'],['report','월별 보고서']];
  p.innerHTML=`<div class="accounting-subtabs">${subs.map(([v,l])=>`<button class="accounting-subtab ${accountingSubtab===v?'active':''}" data-acct-sub="${v}">${l}</button>`).join('')}</div><div id="accountingBody"></div>`;
  p.querySelectorAll('[data-acct-sub]').forEach(b=>b.onclick=()=>{accountingSubtab=b.dataset.acctSub;accountingPanel(p)});
  const body=document.getElementById('accountingBody'); if(accountingSubtab==='fees')feeStatusPanel(body); else if(accountingSubtab==='ledger')ledgerPanel(body); else reportPanel(body);
}
function acctMonthBar(extra=''){
  return `<div class="accounting-monthbar"><div class="accounting-monthnav"><button class="btn" data-acct-month="-1">‹</button><div class="accounting-monthtitle">${acctMonthLabel()}</div><button class="btn" data-acct-month="1">›</button></div>${extra}</div>`
}
function wireAcctMonth(p){p.querySelectorAll('[data-acct-month]').forEach(b=>b.onclick=()=>{accountingMonth.setMonth(accountingMonth.getMonth()+Number(b.dataset.acctMonth));accountingPanel(document.getElementById('panel'))})}
function feeForMember(id){return acctFees().find(x=>x.member_id===id)}
function feeStatusPanel(p){
  const members=data.attendance.filter(x=>x.member_status!=='left'); const closed=acctClosed();
  const counts={paid:0,unpaid:0,exempt:0}; members.forEach(m=>{const f=feeForMember(m.id);counts[f?.status==='exempt'?'exempt':f?.status==='paid'?'paid':'unpaid']++});
  const visible=members.filter(m=>{const f=feeForMember(m.id),st=f?.status==='exempt'?'exempt':f?.status==='paid'?'paid':'unpaid';return (accountingFilter==='all'||accountingFilter===st)&&(!accountingSearch||m.name.toLowerCase().includes(accountingSearch.toLowerCase()))});
  p.innerHTML=`${acctMonthBar()}${closed?`<div class="accounting-lockbar"><b>🔒 ${acctMonthLabel()} 마감 완료</b><span class="accounting-lock">수정 잠금</span></div>`:''}<div class="accounting-summary"><div class="accounting-stat"><small>전체 회원</small><b>${members.length}명</b></div><div class="accounting-stat green"><small>납부 완료</small><b>${counts.paid}명</b></div><div class="accounting-stat red"><small>미납</small><b>${counts.unpaid}명</b></div><div class="accounting-stat yellow"><small>면제</small><b>${counts.exempt}명</b></div></div>
  <div class="accounting-controls"><div class="accounting-filters">${[['all','전체'],['paid','납부'],['unpaid','미납'],['exempt','면제']].map(([v,l])=>`<button class="accounting-chip ${accountingFilter===v?'active':''}" data-fee-filter="${v}">${l}</button>`).join('')}</div><div style="display:flex;gap:8px;align-items:center"><button class="btn primary" id="bulkFeePay" style="white-space:nowrap;width:auto;min-width:118px;flex:0 0 auto" disabled ${closed?'style="display:none"':''}>일괄 납부처리</button><input id="feeSearch" class="field accounting-search" placeholder="이름 검색" value="${esc(accountingSearch)}"></div></div>
  <div class="table-wrap fee-table-wrap"><table class="table fee-table"><thead><tr><th style="width:44px;text-align:center"><input type="checkbox" id="feeCheckAll" aria-label="전체 선택" ${closed?'disabled':''}></th><th>이름</th><th>가입일</th><th>회비 상태</th><th>납부일</th><th>금액</th><th>비고</th><th>관리</th></tr></thead><tbody>${visible.map(m=>{const f=feeForMember(m.id),st=f?.status==='exempt'?'exempt':f?.status==='paid'?'paid':'unpaid',label=st==='paid'?'납부완료':st==='exempt'?'면제':'납부전',joinDate=acctYmd(m.joined_at),paidDate=f?.paid_at?acctYmd(f.paid_at):'-';return `<tr><td style="text-align:center"><input type="checkbox" class="fee-bulk-check" value="${m.id}" ${st!=='unpaid'||closed?'disabled':''} aria-label="${esc(m.name)} 선택"></td><td><b>${esc(m.name)}</b></td><td><span class="acct-date-desktop">${joinDate}</span><span class="acct-date-mobile">${joinDate==='-'?'-':joinDate.slice(2)}</span></td><td><span class="fee-manage fee-${st}">${label}</span></td><td><span class="acct-date-desktop">${paidDate}</span><span class="acct-date-mobile">${paidDate==='-'?'-':paidDate.slice(2)}</span></td><td>${acctMoney(f?.amount??5000)}</td><td>${esc(f?.note||'-')}</td><td><button class="fee-manage fee-${st}" data-fee-member="${m.id}" ${closed?'disabled':''}>${label}</button></td></tr>`}).join('')||'<tr><td colspan="8">해당 회원이 없습니다.</td></tr>'}</tbody></table></div><div class="accounting-note">※ 체크박스 일괄 납부처리도 회계장부에는 합산하지 않고 <b>회원별 회비가 각각 1건씩</b> 자동등록됩니다.</div>`;
  wireAcctMonth(p);
  p.querySelectorAll('[data-fee-filter]').forEach(b=>b.onclick=()=>{accountingFilter=b.dataset.feeFilter;feeStatusPanel(p)});
  const q=p.querySelector('#feeSearch');q.oninput=()=>{accountingSearch=q.value;feeStatusPanel(p)};
  p.querySelectorAll('[data-fee-member]').forEach(b=>b.onclick=()=>feeModal(data.attendance.find(x=>x.id===b.dataset.feeMember),feeForMember(b.dataset.feeMember)));
  const checks=[...p.querySelectorAll('.fee-bulk-check:not(:disabled)')], all=p.querySelector('#feeCheckAll'), bulk=p.querySelector('#bulkFeePay');
  const syncBulk=()=>{const n=checks.filter(c=>c.checked).length;if(bulk){bulk.disabled=n===0;bulk.textContent='일괄 납부처리'}if(all){all.checked=checks.length>0&&n===checks.length;all.indeterminate=n>0&&n<checks.length}};
  checks.forEach(c=>c.onchange=syncBulk);
  if(all)all.onchange=()=>{checks.forEach(c=>c.checked=all.checked);syncBulk()};
  if(bulk)bulk.onclick=()=>bulkFeeModal(checks.filter(c=>c.checked).map(c=>c.value));
}
function bulkFeeModal(memberIds){
  const members=memberIds.map(id=>data.attendance.find(x=>x.id===id)).filter(Boolean),today=todayYmd();
  if(!members.length)return;
  showModal(`${members.length}명 일괄 납부처리`,`<div style="display:grid;gap:12px"><div class="accounting-note" style="margin:0"><b>${members.map(x=>esc(x.name)).join(', ')}</b><br>선택한 회원을 같은 입금일로 납부완료 처리합니다.</div><div><label class="label">입금일</label><input id="bulkFeeDate" class="field" type="date" value="${today}"></div><div><label class="label">1인 회비</label><input id="bulkFeeAmount" class="field" type="number" value="5000"></div><div><label class="label">비고 (선택)</label><input id="bulkFeeNote" class="field" placeholder="선택 회원 전체에 동일 적용"></div><div class="accounting-note">회계장부에는 합계 1건으로 들어가지 않고, 선택한 회원마다 <b>회비 +5,000원 내역이 개별 1건씩</b> 생성됩니다.</div></div>`,async m=>{
    const paidAt=m.querySelector('#bulkFeeDate').value,amount=Number(m.querySelector('#bulkFeeAmount').value||5000),note=m.querySelector('#bulkFeeNote').value.trim();
    if(!paidAt)throw new Error('입금일을 지정해 주세요.');
    for(const member of members){
      const existing=feeForMember(member.id);
      await DOTT_DB.upsertFee({member_id:member.id,member_name:member.name,fee_month:acctMonthKey(),status:'paid',amount,paid_at:paidAt,note:note||existing?.note||'',updated_at:new Date().toISOString()});
    }
    await loadAll();const failed=members.filter(member=>feeForMember(member.id)?.status!=='paid');if(failed.length)throw new Error(`${failed.map(x=>x.name).join(', ')} 납부 상태 저장 확인에 실패했습니다.`);accountingPanel(document.getElementById('panel'));toast(`${members.length}명 납부완료 · 장부 개별 등록 완료`);
  });
  document.querySelector('#modal .modal')?.classList.add('accounting-modal');
  const save=document.getElementById('modalSave');if(save)save.textContent=`${members.length}명 납부처리 완료`;
}
function feeModal(member,fee){
  const currentStatus=fee?.status||'unpaid',status=currentStatus==='unpaid'?'paid':currentStatus,today=todayYmd();
  showModal(`${member.name} · ${acctMonthLabel()} 회비`,`<div style="display:grid;gap:12px"><div><label class="label">상태</label><select id="feeStatus" class="field"><option value="paid" ${status==='paid'?'selected':''}>납부완료</option><option value="unpaid" ${status==='unpaid'?'selected':''}>납부전</option><option value="exempt" ${status==='exempt'?'selected':''}>면제</option></select></div><div><label class="label">금액</label><input id="feeAmount" class="field" type="number" value="${fee?.amount??5000}"></div><div><label class="label">납부일</label><input id="feeDate" class="field" type="date" value="${fee?.paid_at?acctYmd(fee.paid_at):today}"></div><div><label class="label">비고</label><input id="feeNote" class="field" value="${esc(fee?.note||'')}"></div><div class="accounting-note">납부일은 오늘이 기본값이며 실제 입금일이 다르면 수정할 수 있습니다. 납부완료 시 회계장부에 이 회원의 회비 1건이 자동 생성됩니다.</div></div>`,async m=>{
    const st=m.querySelector('#feeStatus').value,row={member_id:member.id,member_name:member.name,fee_month:acctMonthKey(),status:st,amount:Number(m.querySelector('#feeAmount').value||5000),paid_at:st==='paid'?m.querySelector('#feeDate').value:null,note:m.querySelector('#feeNote').value.trim(),updated_at:new Date().toISOString()}; await DOTT_DB.upsertFee(row);await loadAll();const saved=feeForMember(member.id);if(!saved||saved.status!==st)throw new Error('회비 상태 저장 확인에 실패했습니다. 새로고침 후 다시 시도해 주세요.');accountingPanel(document.getElementById('panel'));toast(st==='paid'?'납부완료 · 회계장부 자동등록 완료':'회비 상태를 저장했습니다.');
  });
  document.querySelector('#modal .modal')?.classList.add('accounting-modal');
  const save=document.getElementById('modalSave'); if(save)save.textContent=currentStatus==='unpaid'?'납부처리 완료':'저장';
}
function ledgerReceipts(entry){
  const rows=(data.receipts||[]).filter(r=>r.entry_id===entry.id).sort((x,y)=>(Number(x.sort_order)||0)-(Number(y.sort_order)||0)||String(x.created_at||'').localeCompare(String(y.created_at||'')));
  if(rows.length)return rows;
  if(entry.receipt_path)return [{id:null,entry_id:entry.id,receipt_path:entry.receipt_path,receipt_name:entry.receipt_name||'receipt',receipt_type:entry.receipt_type||'application/octet-stream',sort_order:1,legacy:true}];
  return [];
}
function ledgerPanel(p){
  const rows=acctRows(),closed=acctClosed(),carry=acctBalanceBefore(),feeIncome=rows.filter(x=>x.category==='회비'&&x.entry_type==='수입').reduce((a,x)=>a+Number(x.amount),0),otherIncome=rows.filter(x=>x.entry_type==='수입'&&x.category!=='회비').reduce((a,x)=>a+Number(x.amount),0),expense=rows.filter(x=>x.entry_type==='지출'&&x.category!=='미지급금').reduce((a,x)=>a+Number(x.amount),0)+rows.filter(x=>x.category==='미지급금'&&x.entry_type==='지급').reduce((a,x)=>a+Number(x.amount),0),payable=rows.filter(x=>x.category==='미지급금').reduce((a,x)=>a+(x.entry_type==='발생'?Number(x.amount):-Number(x.amount)),0),balance=carry+rows.reduce((a,x)=>a+acctCashDelta(x),0);
  p.innerHTML=`${acctMonthBar(`<button class="btn primary" id="addLedger" ${closed?'disabled':''}>+ 내역 추가</button>`)}${closed?`<div class="accounting-lockbar"><b>🔒 ${acctMonthLabel()} 마감 완료</b><span class="accounting-lock">수정 잠금</span></div>`:''}<div class="accounting-summary"><div class="accounting-stat"><small>전월 이월</small><b>${acctMoney(carry)}</b></div><div class="accounting-stat green"><small>회비 수입</small><b>${acctMoney(feeIncome)}</b></div><div class="accounting-stat green"><small>기타 수입 · 이자</small><b>${acctMoney(otherIncome)}</b></div><div class="accounting-stat red"><small>실제 지출</small><b>${acctMoney(expense)}</b></div><div class="accounting-stat purple"><small>남은 미지급금</small><b>${acctMoney(payable)}</b></div></div><div class="accounting-stat yellow" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><small>현재 장부 잔액</small><b style="margin:0">${acctMoney(balance)}</b></div>
  <div class="table-wrap ledger-table-wrap"><table class="table ledger-table"><thead><tr><th>날짜</th><th>수입/지출</th><th>구분</th><th>내용</th><th>관련 회원/거래처</th><th>금액</th><th>잔액</th><th>증빙</th><th>관리</th></tr></thead><tbody>${ledgerRowsHtml(rows,carry,closed)}</tbody></table></div><div class="accounting-note">※ 회비는 회비 현황에서 납부처리 완료 시 회원별 1건씩 자동등록되며 장부에서는 직접 수정하지 않습니다. 영수증은 관리자끼리 미리보기·다운로드할 수 있습니다.</div>`;
  wireAcctMonth(p);p.querySelector('#addLedger')?.addEventListener('click',()=>ledgerModal());p.querySelectorAll('[data-ledger-edit]').forEach(b=>b.onclick=()=>ledgerModal(data.ledger.find(x=>x.id===b.dataset.ledgerEdit)));p.querySelectorAll('[data-receipt]').forEach(b=>b.onclick=()=>receiptModal(data.ledger.find(x=>x.id===b.dataset.receipt)));
}
function ledgerRowsHtml(rows,carry,closed){let bal=carry;return rows.map(x=>{bal+=acctCashDelta(x);const payable=x.category==='미지급금',typeClass=payable?'money-payable':x.entry_type==='수입'?'money-in':'money-out',sign=x.entry_type==='수입'||(payable&&x.entry_type==='발생')?'+':'-',receipts=ledgerReceipts(x);return `<tr><td>${acctYmd(x.entry_date).slice(5)}</td><td class="${typeClass}">${esc(x.entry_type)}</td><td>${esc(x.category)}</td><td>${esc(x.description||'-')}</td><td>${esc(x.party_name||'-')}</td><td class="${typeClass}">${sign}${acctMoney(x.amount)}</td><td>${acctMoney(bal)}</td><td>${receipts.length?`<button class="receipt-link" data-receipt="${x.id}"><span class="receipt-desktop">📎 영수증 ${receipts.length}개</span><span class="receipt-mobile">📎${receipts.length}</span></button>`:'-'}</td><td>${x.source_fee_id?'-':`<button class="btn" data-ledger-edit="${x.id}" ${closed?'disabled':''}>수정</button>`}</td></tr>`}).join('')||'<tr><td colspan="9">등록된 내역이 없습니다.</td></tr>'}

function ledgerModal(x={}){
  const isPay=x.category==='미지급금',type=x.entry_type||'지출',existing=x.id?ledgerReceipts(x):[];
  showModal(x.id?'회계 내역 수정':'회계 내역 추가',`<div class="form-grid"><div><label class="label">수입 / 지출</label><select id="leType" class="field"><option ${type==='지출'?'selected':''}>지출</option><option ${type==='수입'?'selected':''}>수입</option><option ${type==='발생'?'selected':''}>발생</option><option ${type==='지급'?'selected':''}>지급</option></select></div><div><label class="label">구분</label><select id="leCat" class="field"><option ${x.category==='유지비'?'selected':''}>유지비</option><option ${x.category==='기타'?'selected':''}>기타</option><option ${isPay?'selected':''}>미지급금</option><option ${x.category==='이자수익'?'selected':''}>이자수익</option></select></div><div><label class="label">날짜</label><input id="leDate" type="date" class="field" value="${x.entry_date?acctYmd(x.entry_date):todayYmd()}"></div><div><label class="label">금액</label><input id="leAmount" type="number" class="field" value="${x.amount||''}"></div><div class="full"><label class="label">내용</label><input id="leDesc" class="field" value="${esc(x.description||'')}"></div><div class="full"><label class="label">관련 회원 / 거래처</label><input id="leParty" class="field" value="${esc(x.party_name||'')}"></div><div class="full"><label class="label">영수증 / 증빙자료 (선택)</label><input id="leReceipt" type="file" class="field" accept="image/jpeg,image/png,application/pdf" multiple><div class="accounting-note">${existing.length?`현재 <b>${existing.length}장</b> 첨부되어 있습니다. 새 파일을 선택하면 기존 영수증은 유지되고 뒤에 추가됩니다.`:'여러 장을 한 번에 선택할 수 있습니다.'}<br>JPG · PNG · PDF</div></div><div class="full"><label class="label">비고</label><input id="leNote" class="field" value="${esc(x.note||'')}"></div></div>`,async m=>{
    const cat=m.querySelector('#leCat').value;let et=m.querySelector('#leType').value;if(cat==='미지급금'&&!['발생','지급'].includes(et))et='발생';if(cat!=='미지급금'&&!['수입','지출'].includes(et))et='지출';
    const files=[...m.querySelector('#leReceipt').files];
    const row={entry_date:m.querySelector('#leDate').value,entry_type:et,category:cat,description:m.querySelector('#leDesc').value.trim(),party_name:m.querySelector('#leParty').value.trim(),amount:Number(m.querySelector('#leAmount').value),note:m.querySelector('#leNote').value.trim(),updated_at:new Date().toISOString()};
    if(!row.entry_date||!row.amount)throw new Error('날짜와 금액을 입력해 주세요.');
    if(cat==='미지급금'&&!row.party_name)throw new Error('미지급금은 관련 회원/지급 대상을 입력해 주세요.');
    const saved=x.id?await DOTT_DB.update('accounting_entries',x.id,row):await DOTT_DB.insert('accounting_entries',row);
    const entryId=x.id||saved?.id;
    if(!entryId)throw new Error('회계 내역 저장 ID를 확인하지 못했습니다.');
    let nextSort=Math.max(0,...existing.map(r=>Number(r.sort_order)||0))+1;
    for(const file of files){
      let uploaded=null;
      try{
        uploaded=await DOTT_DB.uploadReceipt(file);
        await DOTT_DB.addAccountingReceipt(entryId,uploaded,nextSort++);
      }catch(error){
        if(uploaded?.path){try{await DOTT_DB.deleteReceipt(uploaded.path)}catch(_e){}}
        throw error;
      }
    }
    await loadAll();accountingPanel(document.getElementById('panel'));toast(files.length?`회계 내역 저장 · 영수증 ${files.length}장 추가 완료`:'회계 내역을 저장했습니다.');
  });
  document.querySelector('#modal .modal')?.classList.add('accounting-modal','accounting-modal-ledger');
  if(x.id && !x.source_fee_id){
    const foot=document.querySelector('#modal .modal-foot');
    if(foot){
      const del=document.createElement('button');
      del.type='button'; del.className='btn danger'; del.textContent='내역 삭제'; del.style.marginRight='auto';
      foot.prepend(del);
      del.onclick=async()=>{
        if(!confirm('이 회계 내역을 삭제할까요?\n삭제 후에는 복구할 수 없습니다.'))return;
        del.disabled=true;
        try{
          const paths=[...new Set([...ledgerReceipts(x).map(r=>r.receipt_path),x.receipt_path].filter(Boolean))];
          await DOTT_DB.remove('accounting_entries',x.id);
          for(const path of paths){try{await DOTT_DB.deleteReceipt(path)}catch(e){console.warn(e)}}
          document.querySelector('#modal [data-close]')?.click();
          await loadAll(); accountingPanel(document.getElementById('panel')); toast('회계 내역을 삭제했습니다.');
        }catch(e){alert(e.message||e);del.disabled=false}
      };
    }
  }
}
async function receiptModal(x){
  const receipts=ledgerReceipts(x);
  if(!receipts.length)return;
  showModal('영수증 / 증빙자료',`<div id="receiptPreviewArea" class="receipt-preview-area"><div class="accounting-note">영수증을 불러오는 중...</div></div><div class="receipt-number-list">${receipts.map((r,i)=>`<button type="button" class="receipt-number ${i===0?'active':''}" data-receipt-index="${i}">${i+1}번</button>`).join('')}</div><div style="margin-top:12px;text-align:center"><a id="receiptDownload" class="btn primary" href="#" download>다운로드</a></div>`,async()=>{});
  const save=document.getElementById('modalSave');if(save)save.style.display='none';
  const preview=document.getElementById('receiptPreviewArea'),download=document.getElementById('receiptDownload');
  let activeUrl=null;
  const showReceipt=async index=>{
    const r=receipts[index];
    preview.innerHTML='<div class="accounting-note">영수증을 불러오는 중...</div>';
    const blob=await DOTT_DB.receiptBlob(r.receipt_path);
    if(activeUrl)URL.revokeObjectURL(activeUrl);
    activeUrl=URL.createObjectURL(blob);
    const isPdf=(r.receipt_type||'').includes('pdf');
    preview.innerHTML=isPdf?`<iframe src="${activeUrl}" class="receipt-pdf-preview"></iframe>`:`<img class="receipt-preview" src="${activeUrl}" alt="${index+1}번 영수증">`;
    download.href=activeUrl;download.download=r.receipt_name||`receipt-${index+1}`;
    document.querySelectorAll('#modal [data-receipt-index]').forEach(b=>b.classList.toggle('active',Number(b.dataset.receiptIndex)===index));
  };
  document.querySelectorAll('#modal [data-receipt-index]').forEach(b=>b.onclick=()=>showReceipt(Number(b.dataset.receiptIndex)).catch(e=>{preview.innerHTML=`<div class="error">${esc(e.message||e)}</div>`}));
  const close=document.querySelector('#modal [data-close]');
  if(close)close.addEventListener('click',()=>{if(activeUrl)URL.revokeObjectURL(activeUrl)},{once:true});
  await showReceipt(0);
}

function reportPanel(p){
  const rows=acctRows(),closed=acctClosed(),carry=acctBalanceBefore();
  const income=rows.filter(x=>x.entry_type==='수입').reduce((a,x)=>a+Number(x.amount),0);
  const expense=rows.filter(x=>x.entry_type==='지출').reduce((a,x)=>a+Number(x.amount),0)+rows.filter(x=>x.category==='미지급금'&&x.entry_type==='지급').reduce((a,x)=>a+Number(x.amount),0);
  const payable=rows.filter(x=>x.category==='미지급금').reduce((a,x)=>a+(x.entry_type==='발생'?Number(x.amount):-Number(x.amount)),0);
  const balance=carry+rows.reduce((a,x)=>a+acctCashDelta(x),0),cats=['회비','유지비','기타','미지급금','이자수익'];
  const lastDay=new Date(accountingMonth.getFullYear(),accountingMonth.getMonth()+1,0).getDate();
  let running=carry;
  const txRows=rows.map(x=>{running+=acctCashDelta(x);const payableRow=x.category==='미지급금',pc=payableRow?'money-payable':x.entry_type==='수입'?'money-in':'money-out',sign=x.entry_type==='수입'||(payableRow&&x.entry_type==='발생')?'+':'-';return `<tr><td>${acctYmd(x.entry_date).slice(5)}</td><td class="${pc}">${esc(x.entry_type)}</td><td>${esc(x.category)}</td><td>${esc(x.description||'-')}</td><td>${esc(x.party_name||'-')}</td><td class="num ${pc}">${sign}${acctMoney(x.amount)}</td><td class="num">${acctMoney(running)}</td></tr>`}).join('')||'<tr><td colspan="7">등록된 내역이 없습니다.</td></tr>';
  const catHtml=cats.map(c=>{const val=rows.filter(x=>x.category===c).reduce((a,x)=>a+(c==='미지급금'?(x.entry_type==='발생'?Number(x.amount):-Number(x.amount)):acctCashDelta(x)),0);const cls=val>=0?'money-in':'money-out';return `<div class="fr-cat">${c}<b class="${cls}">${val>=0?'+':'-'}${acctMoney(Math.abs(val))}</b></div>`}).join('');
  p.innerHTML=`${acctMonthBar(`<div>${closed?`<span class="accounting-lock">🔒 마감 완료</span> <button class="btn" id="reopenMonth">마감 해제</button> <button class="btn primary" id="printReport">PDF 생성</button>`:`<button class="btn primary" id="closeMonth">${accountingMonth.getMonth()+1}월 장부 마감</button>`}</div>`)}<div class="accounting-lockbar"><div><b>${closed?'🔒 마감된 장부':'마감 전 장부'}</b><div class="accounting-note">${closed?'해당 월의 회비 및 회계내역은 수정할 수 없습니다. PDF는 이 마감 데이터를 기준으로 생성됩니다.':'마감하면 해당 월의 회비 및 회계내역이 잠기고, 이후 PDF와 사이트 숫자가 동일하게 유지됩니다.'}</div></div></div>
  <article class="accounting-report final-report">
    <div class="fr-header"><h2>도파민 ${accountingMonth.getFullYear()}년 ${accountingMonth.getMonth()+1}월 회계 보고서</h2><p>회계기간 ${accountingMonth.getFullYear()}. ${String(accountingMonth.getMonth()+1).padStart(2,'0')}. 01 ~ ${accountingMonth.getFullYear()}. ${String(accountingMonth.getMonth()+1).padStart(2,'0')}. ${String(lastDay).padStart(2,'0')}</p></div>
    <section class="fr-sec"><h3>1. 월간 회계 요약</h3><div class="fr-cards"><div class="fr-card"><small>전월 이월</small><b>${acctMoney(carry)}</b></div><div class="fr-card green"><small>총 수입</small><b>${acctMoney(income)}</b></div><div class="fr-card red"><small>총 지출</small><b>${acctMoney(expense)}</b></div><div class="fr-card orange"><small>남은 미지급금</small><b>${acctMoney(payable)}</b></div></div><div class="fr-total"><span>${accountingMonth.getFullYear()}년 ${accountingMonth.getMonth()+1}월 월말 잔액</span><strong>${acctMoney(balance)}</strong></div></section>
    <section class="fr-sec"><h3>2. 장부 구분별 집계</h3><div class="fr-cats">${catHtml}</div></section>
    <section class="fr-sec"><h3>3. 전체 거래 내역</h3><table><thead><tr><th>날짜</th><th>수입/지출</th><th>구분</th><th>내용</th><th>관련 회원/거래처</th><th>금액</th><th>잔액</th></tr></thead><tbody>${txRows}</tbody></table></section>
    <section class="fr-sec"><h3>4. 미지급금 요약</h3><div class="fr-unpaidbox"><div class="fr-unpaidhead"><span>현재 지급해야 할 금액</span><strong>${acctMoney(payable)}</strong></div>${payableSummaryHtml(rows)}</div><p class="fr-note">※ 미지급금은 회원/운영진이 대신 결제한 금액 중 아직 정산되지 않은 금액을 표시합니다. 일부 지급 시 지급액을 차감하여 남은 미지급금을 자동 계산합니다.</p></section>
  </article>`;
  wireAcctMonth(p);p.querySelector('#closeMonth')?.addEventListener('click',()=>confirmCloseMonth());p.querySelector('#reopenMonth')?.addEventListener('click',()=>reopenMonth());p.querySelector('#printReport')?.addEventListener('click',()=>window.print());
}
function payableSummaryHtml(rows){const map={};rows.filter(x=>x.category==='미지급금').forEach(x=>{const k=x.party_name||'미지정';map[k]??={name:k,first:x.entry_date,desc:x.description||'-',occur:0,paid:0};if(x.entry_type==='발생'){map[k].occur+=Number(x.amount);if(String(x.entry_date)<String(map[k].first))map[k].first=x.entry_date;if(map[k].desc==='-'&&x.description)map[k].desc=x.description}else map[k].paid+=Number(x.amount)});const vals=Object.values(map),occur=vals.reduce((a,v)=>a+v.occur,0),paid=vals.reduce((a,v)=>a+v.paid,0);return `<table class="payable-table"><colgroup><col style="width:14%"><col style="width:12%"><col style="width:25%"><col style="width:16%"><col style="width:16%"><col style="width:17%"></colgroup><thead><tr><th>이름</th><th>발생일</th><th>내용</th><th>발생 금액</th><th>지급 금액</th><th>남은 미지급금</th></tr></thead><tbody>${vals.map(v=>`<tr><td><b>${esc(v.name)}</b></td><td>${acctYmd(v.first).slice(5)}</td><td>${esc(v.desc)}</td><td>${acctMoney(v.occur)}</td><td>${v.paid?acctMoney(v.paid):'-'}</td><td>${acctMoney(v.occur-v.paid)}</td></tr>`).join('')||'<tr><td colspan="6">미지급금 내역이 없습니다.</td></tr>'}${vals.length?`<tr class="fr-sumrow"><td colspan="3">합계</td><td>${acctMoney(occur)}</td><td>${acctMoney(paid)}</td><td>${acctMoney(occur-paid)}</td></tr>`:''}</tbody></table>`}
function confirmCloseMonth(){showModal(`${acctMonthLabel()} 장부를 마감하시겠습니까?`,`<div class="info-box" style="border-color:#efc79d;background:#fff5e9;color:#76522f">마감 후에는 해당 월의 <b>회비 및 회계내역을 수정할 수 없습니다.</b><br>PDF도 마감된 데이터를 기준으로 생성됩니다.</div>`,async()=>{await DOTT_DB.closeAccountingMonth(acctMonthKey());await loadAll();accountingPanel(document.getElementById('panel'));toast(`${acctMonthLabel()} 장부를 마감했습니다.`)});const save=document.getElementById('modalSave');if(save)save.textContent=`${accountingMonth.getMonth()+1}월 마감`}
async function reopenMonth(){const c=acctClosed();if(!c||!confirm(`${acctMonthLabel()} 마감을 해제할까요? 다시 수정할 수 있게 됩니다.`))return;await DOTT_DB.reopenAccountingMonth(c.id);await loadAll();accountingPanel(document.getElementById('panel'));toast('마감을 해제했습니다.')}
