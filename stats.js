(function dottStatsModule() {
  'use strict';
  const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const fmt = value => Number(value || 0).toLocaleString('ko-KR');
  const inMonth = (value, month) => String(value || '').slice(0, 7) === month;
  const isCancelled = status => ['취소', 'cancelled', 'canceled'].includes(String(status || '').toLowerCase());
  const startOfDay = value => new Date(`${value}T00:00:00`);
  const shiftMonth = (value, amount) => {
    const [year, month] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1 + amount, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const monthLabel = value => `${Number(value.slice(0, 4))}년 ${Number(value.slice(5, 7))}월`;
  const shortMonth = value => `${Number(value.slice(5, 7))}월`;
  const categories = [
    {id: 'boardgame', name: '보드게임', color: '#486fb4'},
    {id: 'murder', name: '머더미스터리', color: '#7699ca'},
    {id: 'deduction', name: '추리게임', color: '#9aabc5'},
    {id: 'other', name: '기타', color: '#c4cedd'}
  ];
  const categoryOf = value => categories.some(x => x.id === value) ? value : 'other';
  const countMonth = (schedules, month) => schedules.filter(x => inMonth(x.event_date, month) && !isCancelled(x.status)).length;

  function summarize({data, month, today}) {
    if (!MONTH_PATTERN.test(month) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
      throw new Error('통계 조회 기간을 확인해 주세요.');
    }
    const currentMonth = today.slice(0, 7);
    const scheduled = (data.schedules || []).filter(x => inMonth(x.event_date, month) && !isCancelled(x.status));
    const categoryCounts = Object.fromEntries(categories.map(c => [c.id, 0]));
    scheduled.forEach(x => { categoryCounts[categoryOf(x.category)]++; });
    const people = scheduled.reduce((sum, x) => sum + Math.max(0, Math.floor(number(x.people))), 0);
    const lastMonth = shiftMonth(month, -1);
    const previousCount = countMonth(data.schedules || [], lastMonth);
    const trend = Array.from({length: 6}, (_, i) => {
      const key = shiftMonth(month, i - 5);
      return {month: key, count: countMonth(data.schedules || [], key)};
    });

    // 현재 회원 명단을 기준으로 선택 월까지 가입한 회원만 계산합니다.
    // 탈퇴자의 과거 재적 여부를 완전히 재구성할 수는 없습니다.
    const activeMembers = (data.attendance || []).filter(x => x.member_status !== 'left');
    const members = activeMembers.filter(x => !x.joined_at || String(x.joined_at).slice(0, 7) <= month);
    const fees = new Map();
    (data.fees || []).filter(x => inMonth(x.fee_month, month)).forEach(x => {
      if (x.member_id) fees.set(String(x.member_id), x);
    });
    let paid = 0, exempt = 0;
    for (const member of members) {
      const status = fees.get(String(member.id))?.status;
      if (status === 'paid') paid++;
      else if (status === 'exempt') exempt++;
    }
    const feeTarget = Math.max(0, members.length - exempt);
    const unpaid = Math.max(0, feeTarget - paid);
    const feeRate = feeTarget ? Math.round(paid / feeTarget * 100) : null;

    // 마지막 출석일이 최근 30일 안이라면 그 기간 중 최소 한 번 출석한 회원입니다.
    const cutoff = startOfDay(today);
    cutoff.setDate(cutoff.getDate() - 29);
    const recentCount = activeMembers.filter(member => {
      const raw = String(member.last_attended_at || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
      const d = startOfDay(raw);
      return d >= cutoff && d <= startOfDay(today);
    }).length;
    const attendanceRate = activeMembers.length ? Math.round(recentCount / activeMembers.length * 100) : null;
    return {
      month, currentMonth, future: month > currentMonth, scheduled, count: scheduled.length,
      people, previousCount, trend, categoryCounts, members: members.length, paid, exempt, unpaid,
      feeTarget, feeRate, activeMembers: activeMembers.length, recentCount, attendanceRate
    };
  }

  function render(panel, {data, month, today, warnings = [], changeMonth, navigate}) {
    const model = summarize({data, month, today});
    const scheduleMissing = warnings.includes('일정');
    const feeMissing = warnings.includes('회비') || warnings.includes('출석');
    const activityMissing = warnings.includes('출석');
    const money = rate => rate === null ? '—' : `${rate}%`;
    const placeholder = () => '<span class="stats-placeholder">확인 필요</span>';
    const count = (n, missing = false) => missing ? placeholder() : fmt(n);
    const percent = (n, missing = false) => missing ? placeholder() : money(n);
    const current = month === today.slice(0, 7);
    const monthlyFeeDisabled = model.future;
    const trendMax = Math.max(1, ...model.trend.map(x => x.count));
    const categoryTotal = model.count || 1;
    const feeAll = model.paid + model.exempt + model.unpaid;
    const feeMax = Math.max(1, feeAll);
    const feeSections = [
      {id:'paid',title:'납부',value:model.paid},
      {id:'exempt',title:'면제',value:model.exempt},
      {id:'unpaid',title:'미납',value:model.unpaid}
    ];
    const dashStat = (label, value, foot, note = '') => `<article class="stats-kpi"><div class="stats-kpi-label">${label}</div><strong>${value}</strong><div class="stats-kpi-foot">${foot}</div>${note ? `<span class="stats-kpi-note">${note}</span>` : ''}</article>`;

    panel.innerHTML = `
      <section class="stats-top">
        <div><span class="stats-eyebrow">DOTT OPERATIONS / ANALYTICS</span><h2>월별 운영 통계</h2><p>기존 예약 · 출석 · 회비 데이터를 읽기 전용으로 분석합니다.</p></div>
        <div class="stats-month-control" aria-label="통계 조회 월">
          <button type="button" class="stats-month-arrow" id="statsPrev" aria-label="이전 달">‹</button>
          <span id="statsMonthLabel">${monthLabel(month)}</span>
          <button type="button" class="stats-month-arrow" id="statsNext" aria-label="다음 달">›</button>
          <button type="button" class="stats-today-btn" id="statsCurrent" ${current ? 'disabled' : ''}>이번 달</button>
        </div>
      </section>
      ${warnings.length ? `<div class="stats-warning" role="status">⚠ ${warnings.map(x => String(x).replace(/[&<>"']/g, '')).join(' · ')} 데이터 조회에 문제가 있습니다. 통계가 불완전할 수 있어요.</div>` : ''}
      <div class="stats-kpi-grid">
        ${dashStat('선택 월 예약된 벙',count(model.count, scheduleMissing),'취소된 예약 제외',scheduleMissing ? '' : `전월 ${fmt(model.previousCount)}건`)}
        ${dashStat('예약 인원 합계',count(model.people,scheduleMissing),'각 벙의 예약 인원을 더한 값','같은 사람이 여러 번 포함될 수 있음')}
        ${dashStat('회비 납부율',monthlyFeeDisabled ? '—' : percent(model.feeRate,feeMissing),monthlyFeeDisabled?'아직 도래하지 않은 달':`납부 대상 ${count(model.feeTarget,feeMissing)}명 중 ${count(model.paid,feeMissing)}명`, '면제 회원 제외 · 현재 회원 명단 기준')}
        ${dashStat('최근 30일 출석 회원율',percent(model.attendanceRate,activityMissing),`오늘 기준 ${count(model.recentCount,activityMissing)}명 / 재적 ${count(model.activeMembers,activityMissing)}명`,'선택 월과 무관한 최근 활동 지표')}
      </div>
      <div class="stats-panel-grid">
        <section class="stats-panel">
          <header class="stats-panel-head"><div><h3>예약된 벙 추이</h3><p>선택 월까지 6개월 · 취소 제외</p></div><span class="stats-panel-tag">6 MONTHS</span></header>
          ${scheduleMissing ? '<div class="stats-no-data">일정 데이터 조회가 필요합니다.</div>' : `
          <div class="stats-bars" role="group" aria-label="월별 예약된 벙 개수">
            ${model.trend.map(t => `<button type="button" class="stats-bar-cell ${t.month === month ? 'selected' : ''}" data-stats-month="${t.month}" aria-label="${monthLabel(t.month)} ${t.count}건 보기" title="${monthLabel(t.month)} · ${t.count}건">
              <span class="stats-bar-number">${fmt(t.count)}</span><span class="stats-bar-track"><span class="stats-bar-fill" style="height:${Math.max(t.count ? 7 : 0, t.count/trendMax * 100)}%"></span></span><span class="stats-bar-month">${shortMonth(t.month)}</span></button>`).join('')}
          </div>`}
          <div class="stats-chart-caption">막대를 클릭하면 해당 월의 통계로 이동합니다.</div>
        </section>
        <section class="stats-panel">
          <header class="stats-panel-head"><div><h3>게임 유형별 벙</h3><p>${monthLabel(month)} · 예약 건수 기준</p></div><span class="stats-panel-tag">CATEGORY</span></header>
          ${scheduleMissing ? '<div class="stats-no-data">일정 데이터 조회가 필요합니다.</div>' : `
            <div class="stats-distribution" role="img" aria-label="${categories.map(c=>`${c.name} ${model.categoryCounts[c.id]}건`).join(', ')}">
              ${categories.filter(c=>model.categoryCounts[c.id]).map(c=>`<span style="width:${model.categoryCounts[c.id] / categoryTotal * 100}%;background:${c.color}"></span>`).join('')}
            </div>
            <div class="stats-category-list">${categories.map(c=>`<div class="stats-category-row"><span><i style="background:${c.color}"></i>${c.name}</span><b>${fmt(model.categoryCounts[c.id])}건</b></div>`).join('')}</div>`}
        </section>
        <section class="stats-panel">
          <header class="stats-panel-head"><div><h3>회비 납부 현황</h3><p>${monthLabel(month)} · 재적 회원 명단 기준</p></div><button type="button" class="stats-panel-link" data-stats-go="accounting">회비 관리 →</button></header>
          ${monthlyFeeDisabled ? '<div class="stats-no-data">미래 월의 회비 납부율은 아직 집계하지 않습니다.</div>' : feeMissing ? '<div class="stats-no-data">회원·회비 데이터를 다시 불러와 주세요.</div>' : `
            <div class="stats-fee-track" role="img" aria-label="납부 ${model.paid}명, 면제 ${model.exempt}명, 미납 ${model.unpaid}명">
              ${feeSections.filter(x=>x.value).map(x=>`<span class="stats-fee-${x.id}" style="width:${x.value / feeMax * 100}%"></span>`).join('')}
            </div>
            <div class="stats-fee-grid">${feeSections.map(x=>`<div><span class="stats-fee-dot stats-fee-${x.id}"></span><small>${x.title}</small><strong>${fmt(x.value)}<em>명</em></strong></div>`).join('')}</div>
            <p class="stats-panel-footnote">면제 회원은 납부 대상에서 제외합니다. 현재 활동 회원 중 해당 월까지 가입한 사람을 기준으로 계산합니다.</p>`}
        </section>
        <section class="stats-panel">
          <header class="stats-panel-head"><div><h3>최근 회원 활동</h3><p>오늘 기준 최근 30일 · 마지막 출석일 활용</p></div><button type="button" class="stats-panel-link" data-stats-go="attendance">출석 관리 →</button></header>
          ${activityMissing ? '<div class="stats-no-data">출석 데이터를 다시 불러와 주세요.</div>' : `
            <div class="stats-activity"><strong>${fmt(model.recentCount)}<small>명</small></strong><span>최근 30일 출석한 회원</span></div>
            <div class="stats-activity-track"><span style="width:${model.attendanceRate === null ? 0 : model.attendanceRate}%"></span></div>
            <div class="stats-activity-caption">현재 재적 ${fmt(model.activeMembers)}명 중 ${money(model.attendanceRate)} · 탈퇴 회원 제외</div>
            <p class="stats-panel-footnote">과거 월별 실제 참석률은 계산할 수 없습니다. 현재 데이터에는 회원별 <b>마지막 출석일</b>만 저장되기 때문입니다.</p>`}
        </section>
      </div>
      <div class="stats-method-note">통계 안내 · 예약된 벙은 실제 개최 완료가 아닌 등록 일정 기준입니다. 예약 인원 합계는 고유 참여자 수가 아닙니다. 회비 집계는 현재 회원 명단을 기준으로 하므로 과거 탈퇴자 포함 여부를 완전히 복원하지 못합니다. 최신 내역은 상단 <b>새로고침</b>을 눌러 반영해 주세요.</div>
    `;
    panel.querySelector('#statsPrev').onclick = () => changeMonth(shiftMonth(month, -1));
    panel.querySelector('#statsNext').onclick = () => changeMonth(shiftMonth(month, 1));
    panel.querySelector('#statsCurrent').onclick = () => changeMonth(today.slice(0, 7));
    panel.querySelectorAll('[data-stats-month]').forEach(btn => btn.onclick = () => changeMonth(btn.dataset.statsMonth));
    panel.querySelectorAll('[data-stats-go]').forEach(btn => btn.onclick = () => navigate(btn.dataset.statsGo));
  }

  window.DOTT_STATS = {render, summarize, shiftMonth};
})();
