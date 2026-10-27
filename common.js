const CFG = window.DOTT_CONFIG;
function esc(v=''){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function nl2br(v=''){return esc(v).replace(/\n/g,'<br>')}

const NOTICE_RICH_PREFIX='__DOTT_RICH__:';
function sanitizeNoticeRichHtml(html=''){
  const box=document.createElement('div');
  box.innerHTML=String(html||'');
  const allowed=new Set(['B','STRONG','BR','DIV','P','SPAN','FONT']);
  const colorOk=v=>/^#[0-9a-fA-F]{6}$/.test(v)||/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/.test(v);
  const clean=node=>{
    [...node.childNodes].forEach(child=>{
      if(child.nodeType===3)return;
      if(child.nodeType!==1){child.remove();return;}
      const tag=child.tagName;
      if(!allowed.has(tag)){
        const frag=document.createDocumentFragment();
        while(child.firstChild)frag.appendChild(child.firstChild);
        child.replaceWith(frag);
        clean(node);
        return;
      }
      let color='';
      if(tag==='FONT') color=child.getAttribute('color')||'';
      if(tag==='SPAN') color=child.style.color||'';
      [...child.attributes].forEach(a=>child.removeAttribute(a.name));
      if(colorOk(color)) child.setAttribute('style',`color:${color}`);
      if(tag==='FONT'){
        const span=document.createElement('span');
        if(colorOk(color)) span.setAttribute('style',`color:${color}`);
        while(child.firstChild)span.appendChild(child.firstChild);
        child.replaceWith(span);
        clean(span);
        return;
      }
      clean(child);
    });
  };
  clean(box);
  return box.innerHTML;
}
function noticeEditorHtml(v=''){
  v=String(v||'');
  return v.startsWith(NOTICE_RICH_PREFIX)?sanitizeNoticeRichHtml(v.slice(NOTICE_RICH_PREFIX.length)):nl2br(v);
}
function noticePublicHtml(v=''){
  v=String(v||'');
  return v.startsWith(NOTICE_RICH_PREFIX)?sanitizeNoticeRichHtml(v.slice(NOTICE_RICH_PREFIX.length)):nl2br(v);
}
function noticePlainText(v=''){
  v=String(v||'');
  if(!v.startsWith(NOTICE_RICH_PREFIX))return v;
  const box=document.createElement('div');
  box.innerHTML=sanitizeNoticeRichHtml(v.slice(NOTICE_RICH_PREFIX.length));
  return box.textContent||'';
}
function fmtDate(d){const x=new Date(d+'T00:00:00');return `${x.getFullYear()}년 ${x.getMonth()+1}월 ${x.getDate()}일 ${'일월화수목금토'[x.getDay()]}요일`}
function ymd(date){const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0');return `${y}-${m}-${d}`}
function todayYmd(){return ymd(new Date())}
function catInfo(v){return CFG.categories.find(c=>c.value===v)||CFG.categories.at(-1)}
function hexWithAlpha(hex,alpha='55'){return /^#[0-9a-fA-F]{6}$/.test(hex)?`${hex}${alpha}`:hex}
function tag(v){const c=catInfo(v);return `<span class="cat-tag" style="background:${hexWithAlpha(c.color,'45')};color:#1f1f1f">${esc(c.label)}</span>`}
function isCancelledStatus(v){return v==='취소'||v==='cancelled'||v==='canceled'}
function scheduleStatusLabel(v){return isCancelledStatus(v)?'취소':'예약'}
function nav(active='calendar'){
  if(active==='admin'){
    return `<header class="topbar admin-topbar"><a class="brand" href="index.html"><span class="brand-mark">D</span><span><strong>DOTT ADMIN</strong><small>도파민 운영진 관리실</small></span></a><span class="admin-top-hint">INTERNAL MANAGEMENT</span><a class="admin-link" href="${esc(CFG.publicSiteUrl)}" target="_blank" rel="noopener noreferrer">↗ 회원 사이트</a></header>`;
  }
  return `<header class="topbar"><a class="brand" href="index.html"><span class="brand-mark">D</span><span><strong>${esc(CFG.siteTitle)}</strong><small>${esc(CFG.siteSubtitle)}</small></span></a><nav class="nav">
    <a class="${active==='calendar'?'active':''}" href="index.html">예약 캘린더</a>
    <a class="${active==='boardgame'?'active':''}" href="boardgames.html">보드게임</a>
    <a class="${active==='murder'?'active':''}" href="murder.html">머더미스터리</a>
    <a class="${active==='deduction'?'active':''}" href="deduction.html">추리게임</a>
  </nav><a class="admin-link" href="admin.html">🔒 관리</a></header>`
}
function footer(){return `<footer class="footer"><span>📅 DOTT · 예약과 보유 게임을 한눈에</span><span>© ${new Date().getFullYear()} 도파민</span></footer>`}
function toast(msg){let el=document.getElementById('toast');if(!el){el=document.createElement('div');el.id='toast';el.className='toast';document.body.appendChild(el)}el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),1800)}
function showModal(title, body, onSave){const back=document.getElementById('modal');const closeModal=()=>{back.classList.remove('open');document.body.classList.remove('modal-open');document.removeEventListener('keydown',onKeyDown)};const onKeyDown=e=>{if(e.key==='Escape')closeModal()};back.innerHTML=`<div class="modal"><div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body">${body}</div><div class="modal-foot"><button class="btn" data-close>취소</button><button class="btn primary" id="modalSave">저장</button></div></div>`;back.classList.add('open');document.body.classList.add('modal-open');back.querySelectorAll('[data-close]').forEach(b=>b.onclick=closeModal);/* 폼 편집 중 드래그 선택이 배경까지 이어져도 팝업이 닫히지 않도록 바깥 클릭 닫기를 비활성화합니다. */back.onclick=e=>{if(e.target===back)e.preventDefault()};document.addEventListener('keydown',onKeyDown);back.querySelector('#modalSave').onclick=async()=>{const btn=back.querySelector('#modalSave');btn.disabled=true;try{await onSave(back);closeModal()}catch(e){alert(e.message||e)}finally{btn.disabled=false}}}
