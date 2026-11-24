'use strict';
// 勉強管理: 科目 → 教材 → 問題。記録は iPhone の中 + GitHub（非公開リポジトリ）に自動保存。
const KEY = 's48-check-v1';          // 前の版と同じ場所（記録をそのまま引き継ぐ）
const SYNC_KEY = 'study-sync-v1';    // GitHub の設定（トークンは記録ファイルには入れない）
const MARK = {o:'○', x:'×', t:'△'};
const WD = '日月火水木金土';
const COMMON = ['英語', '数学', '国語', '理科', '社会'];
const BUILD = (() => { try{ return new URL(document.getElementById('appjs').src).searchParams.get('v') || ''; }catch(e){ return ''; } })();
const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);

/* ---------- 日付・表示 ---------- */
const pad = n => String(n).padStart(2, '0');
const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const kd = k => new Date(k + 'T00:00:00');
const today = () => dayKey(Date.now());
const daysBetween = (a, b) => Math.round((kd(b) - kd(a)) / 864e5);
const addDays = (k, n) => { const d = kd(k); d.setDate(d.getDate() + n); return dayKey(d); };
const dayLabel = k => { const d = kd(k); return `${d.getMonth()+1}/${d.getDate()}(${WD[d.getDay()]})`; };
const md = k => { const d = kd(k); return `${d.getMonth()+1}/${d.getDate()}`; };
const weekStart = k => { const d = kd(k); return addDays(k, -((d.getDay() + 6) % 7)); };   // 月曜はじまり
const dt = ts => { const d = new Date(ts); return `${d.getMonth()+1}/${d.getDate()}(${WD[d.getDay()]}) ${d.getHours()}:${pad(d.getMinutes())}`; };
function fmt(ms){ ms = Math.max(0, ms); const s = Math.floor(ms/1000), h = Math.floor(s/3600), m = Math.floor(s%3600/60);
  return (h ? h + ':' + pad(m) : m) + ':' + pad(s%60); }
function fmtH(ms){ ms = Math.max(0, ms); const m = Math.floor(ms/60000), h = Math.floor(m/60); return h ? `${h}時間${m%60}分` : `${m}分`; }
const pct = (a, b) => b ? Math.round(a/b*100) + '%' : '—';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let toastT; function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }

/* ---------- データ ---------- */
let db = load();
function load(){ let d = null; try{ d = JSON.parse(localStorage.getItem(KEY)); }catch(e){} return migrate(d); }
function emptyDb(){ return {v:2, exams:[], subjects:[], books:[], running:null, log:[], goalMin:0, updatedAt:0, backupAt:null}; }
// 前の版（s1〜s48 だけ）の記録を「教材 1 つ」として引き継ぐ
function migrate(d){
  if(d && d.v === 2) return d;
  const n = emptyDb();
  if(d && Array.isArray(d.rounds) && d.rounds.length){
    const now = Date.now();
    const sub = {id:uid(), name:'未設定の科目', slot:0};
    const book = {id:uid(), subjectId:sub.id, name:'s1〜s48', count:48, prefix:'s', parts:d.parts || {}, target:'',
      cur:Math.min(d.cur || 0, d.rounds.length - 1), rounds:d.rounds.map(r => ({name:r.name, items:r.items || {}}))};
    d.rounds.forEach((r, i) => { if(r.running){ const its = book.rounds[i].items; const it = its[r.running.id] || (its[r.running.id] = {t:0, m:null}); it.t += now - r.running.start; } });
    book.rounds.forEach(r => Object.entries(r.items).forEach(([q, it]) => {
      const at = it.at || it.s; if(at && it.t > 0) n.log.push({d:at - it.t, ms:it.t, sub:sub.id, book:book.id, q});
    }));
    n.subjects.push(sub); n.books.push(book); n.backupAt = d.backupAt || null; n.updatedAt = Date.now();
  }
  return n;
}
function save(){ db.updatedAt = Date.now(); localStorage.setItem(KEY, JSON.stringify(db)); Sync.schedule(); }

const B = id => db.books.find(b => b.id === id);
const S = id => db.subjects.find(s => s.id === id);
const subName = id => (S(id) || {name:'（削除した科目）'}).name;
const subColor = id => { const s = S(id); return `var(--c${s && s.slot < 8 ? s.slot : 8})`; };
const dot = id => `<span class="dot" style="background:${subColor(id)}"></span>`;
function unitIds(b){
  const out = [], P = b.parts || {};
  for(let i = 1; i <= b.count; i++){ const base = b.prefix + i, k = P[base] || 1;
    if(k === 1) out.push(base); else for(let j = 1; j <= k; j++) out.push(base + '-' + j); }
  return out;
}
const baseOf = id => id.split('-')[0];
const lab = id => { const [b, p] = id.split('-'); return p ? `${b} (${p})` : b; };
const item = (b, ri, q) => { const its = b.rounds[ri].items; return its[q] || (its[q] = {t:0, m:null}); };

/* ---------- 計測（同時に動くのは 1 つだけ） ---------- */
const isRunQ = (b, ri, q) => { const r = db.running; return !!(r && r.type === 'q' && r.book === b.id && r.round === ri && r.q === q); };
function elapsedQ(b, ri, q){ const it = b.rounds[ri] && b.rounds[ri].items[q]; let t = it ? it.t : 0; if(isRunQ(b, ri, q)) t += Date.now() - db.running.start; return t; }
function runSub(){ const r = db.running; if(!r) return null; return r.type === 'q' ? (B(r.book) || {}).subjectId : r.sub; }
function runLabel(){
  const r = db.running; if(!r) return '';
  if(r.type === 'q'){ const b = B(r.book); return b ? `${subName(b.subjectId)}・${b.name} ${lab(r.q)}` : ''; }
  return `${subName(r.sub)}（問題なしで勉強）`;
}
function stopRun(){
  const r = db.running; if(!r) return;
  const ms = Date.now() - r.start;
  if(r.type === 'q'){ const b = B(r.book);
    if(b && b.rounds[r.round]){ item(b, r.round, r.q).t += ms; if(ms >= 1000) db.log.push({d:r.start, ms, sub:b.subjectId, book:b.id, q:r.q}); } }
  else if(ms >= 1000) db.log.push({d:r.start, ms, sub:r.sub});
  db.running = null;
}
function startQ(b, ri, q){ stopRun(); db.running = {type:'q', book:b.id, round:ri, q, start:Date.now()}; const it = item(b, ri, q); if(!it.s) it.s = Date.now(); }
function startFree(sub){ stopRun(); db.running = {type:'free', sub, start:Date.now()}; }

/* ---------- 勉強時間の集計 ---------- */
function studyByDay(){   // {日付: {科目id: ms}}（計測中の分も入れる）
  const m = {}; const add = (ts, sub, ms) => { const k = dayKey(ts); const o = m[k] || (m[k] = {}); o[sub] = (o[sub] || 0) + ms; };
  db.log.forEach(l => add(l.d, l.sub, l.ms));
  if(db.running) add(db.running.start, runSub(), Date.now() - db.running.start);
  return m;
}
const sumObj = o => Object.values(o || {}).reduce((a, b) => a + b, 0);
function rangeTotal(m, from, to, sub){ let t = 0; Object.keys(m).forEach(k => { if(k >= from && k <= to) t += sub ? (m[k][sub] || 0) : sumObj(m[k]); }); return Math.max(0, t); }

/* ---------- 計画（締切までに 1 日何問） ---------- */
function plan(b){
  if(!b.target) return null;
  const ids = unitIds(b), r = b.rounds[b.cur], t = today();
  const done = ids.filter(q => r.items[q] && r.items[q].m).length;
  const doneToday = ids.filter(q => { const it = r.items[q]; return it && it.m && it.at && dayKey(it.at) === t; }).length;
  const daysLeft = daysBetween(t, b.target) + 1;     // 今日と締切の日を含む
  const left = ids.length - done;
  const need = daysLeft > 0 ? Math.ceil((left + doneToday) / daysLeft) : left + doneToday;
  return {total:ids.length, done, doneToday, left, daysLeft, need};
}

/* ---------- 画面の状態 ---------- */
let tab = 'home', bookId = null, openQ = null, anaOpen = false, filter = null;

function renderAll(){
  if(bookId && !B(bookId)){ bookId = null; openQ = null; anaOpen = false; }
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('show', v.id === 'v-' + tab));
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  ({home:renderHome, books:renderBooks, log:renderLog, set:renderSet})[tab]();
  $('#book').classList.toggle('show', !!bookId);
  $('#detail').classList.toggle('show', !!(bookId && openQ));
  $('#ana').classList.toggle('show', !!(bookId && anaOpen));
  if(bookId) renderBook();
  if(bookId && openQ) renderDetail();
  if(bookId && anaOpen) renderAna();
  const rb = $('#runbar'); rb.classList.toggle('show', !!db.running && !bookId && tab !== 'home');
  $('#runLabel').innerHTML = db.running ? dot(runSub()) + esc(runLabel()) : '';
  tick();
}

/* ---------- ホーム ---------- */
function renderHome(){
  const t = today(), m = studyByDay();
  let h = '<h1 class="ttl">勉強管理</h1>';
  if(db.running){
    h += `<div class="runcard"><div style="min-width:0"><div class="hint">${dot(runSub())}${esc(runLabel())}</div><div class="big" data-live="run"></div></div>
      <button class="circle start on" data-act="stopRun">ストップ</button></div>`;
  }
  // 試験までの日数
  const ex = db.exams.filter(e => daysBetween(t, e.date) >= 0).sort((a, b) => a.date < b.date ? -1 : 1);
  h += '<h2>試験まで</h2>';
  if(ex.length) h += '<div class="cards">' + ex.map(e => { const d = daysBetween(t, e.date);
    return `<div class="card" data-act="editExam" data-id="${e.id}"><div class="k">${esc(e.name)}（${md(e.date)}）</div><div class="v">${d === 0 ? '今日' : `あと ${d}<small> 日</small>`}</div></div>`; }).join('') + '</div>';
  else h += `<div class="note">試験日を登録すると、残りの日数が出ます<button class="btn wide" data-act="addExam">試験日を登録</button></div>`;
  // 今日の勉強時間
  const todayMs = rangeTotal(m, t, t);
  h += '<h2>今日の勉強時間</h2><div class="note"><div class="big" data-live="today">' + fmtH(todayMs) + '</div>';
  if(db.goalMin){ const p = Math.min(100, Math.round(todayMs / (db.goalMin * 60000) * 100));
    h += `<div class="meter${p >= 100 ? ' done' : ''}"><i style="width:${p}%"></i></div>
      <div class="hint">目標 ${fmtH(db.goalMin*60000)} ・ ${p >= 100 ? '<span class="ok">✓ 達成</span>' : p + '%'}</div>`; }
  else h += '<div class="hint"><a href="#" data-act="editGoal">1日の目標時間を決める</a></div>';
  const subsToday = db.subjects.filter(s => (m[t] || {})[s.id] > 0);
  if(subsToday.length) h += '<div style="margin-top:6px">' + subsToday.map(s =>
    `<div style="display:flex; justify-content:space-between">${'<span>' + dot(s.id) + esc(s.name) + '</span>'}<span class="hint" style="font-size:14px" data-live="sub" data-sub="${s.id}">${fmtH(m[t][s.id])}</span></div>`).join('') + '</div>';
  h += '</div>';
  // 勉強をはじめる
  h += '<h2>問題なしで勉強をはじめる（単語・暗記など）</h2>';
  if(db.subjects.length) h += '<div class="subjbtns">' + db.subjects.map(s => {
    const on = db.running && db.running.type === 'free' && db.running.sub === s.id;
    return `<button class="subjbtn" data-act="startFree" data-sub="${s.id}">${dot(s.id)}${esc(s.name)}<span class="pl">${on ? '計測中' : '▶'}</span></button>`; }).join('') + '</div>'
    + '<div class="hint" style="margin:6px 4px">問題集を解くときは「教材」から問題を開いてスタートしてください</div>';
  else h += `<div class="note">まず科目を登録してください<button class="btn wide" data-act="addSubjects">よく使う科目をまとめて登録</button></div>`;
  // 今日の計画
  const plans = db.books.map(b => ({b, p:plan(b)})).filter(x => x.p);
  h += '<h2>今日の計画</h2>';
  if(plans.length) h += plans.map(({b, p}) => {
    let st;
    if(p.left === 0) st = '<span class="ok">✓ 完了</span>';
    else if(p.daysLeft <= 0) st = `<span class="late">! 締切を過ぎています（残り ${p.left} 問）</span>`;
    else if(p.doneToday >= p.need) st = `<span class="ok">✓ 今日の分 達成</span>`;
    else st = `今日 <b>${p.doneToday} / ${p.need}</b> 問`;
    const pr = Math.round(p.done / p.total * 100);
    return `<div class="plan" data-act="openBook" data-id="${b.id}"><div class="h"><span class="n">${dot(b.subjectId)}${esc(b.name)}</span><span>${st}</span></div>
      <div class="meter${p.left === 0 ? ' done' : ''}"><i style="width:${pr}%"></i></div>
      <div class="s">${esc(b.rounds[b.cur].name)} ${p.done}/${p.total} 問 ・ 締切 ${md(b.target)}${p.daysLeft > 0 ? `（あと ${p.daysLeft} 日）` : ''} ・ 残り ${p.left} 問</div></div>`; }).join('');
  else h += '<div class="note hint" style="font-size:13px">教材に「締切」を入れると、1日に何問やれば間に合うかがここに出ます（教材 → 教材を開く → 設定）</div>';
  // 今週
  const ws = weekStart(t), lws = addDays(ws, -7), lwe = addDays(ws, -1);
  h += `<h2>今週</h2><div class="cards">
    <div class="card"><div class="k">今週の勉強時間</div><div class="v" data-live="week">${fmtH(rangeTotal(m, ws, t))}</div></div>
    <div class="card"><div class="k">先週</div><div class="v">${fmtH(rangeTotal(m, lws, lwe))}</div></div></div>`;
  $('#v-home').innerHTML = h;
}

/* ---------- 教材の一覧 ---------- */
function bookSummary(b){
  const ids = unitIds(b), r = b.rounds[b.cur];
  const done = ids.filter(q => r.items[q] && r.items[q].m), o = done.filter(q => r.items[q].m === 'o').length;
  return {n:ids.length, done:done.length, o};
}
function renderBooks(){
  let h = '<h1 class="ttl">教材</h1>';
  if(!db.subjects.length) h += `<div class="note">まず科目を登録してください<button class="btn wide" data-act="addSubjects">よく使う科目をまとめて登録</button></div>`;
  const groups = db.subjects.map(s => ({id:s.id, books:db.books.filter(b => b.subjectId === s.id)}));
  const orphan = db.books.filter(b => !S(b.subjectId)); if(orphan.length) groups.push({id:null, books:orphan});
  groups.forEach(g => {
    h += `<h2>${g.id ? dot(g.id) + esc(subName(g.id)) : '科目なし'}</h2>`;
    if(!g.books.length){ h += '<div class="hint" style="margin:0 4px">まだ教材がありません</div>'; return; }
    h += g.books.map(b => { const s = bookSummary(b), p = Math.round(s.done / s.n * 100);
      return `<div class="book" data-act="openBook" data-id="${b.id}"><div class="n">${esc(b.name)}</div>
        <div class="meter${s.done === s.n ? ' done' : ''}"><i style="width:${p}%"></i></div>
        <div class="s">${esc(b.rounds[b.cur].name)} ${s.done}/${s.n} 問 ・ 正答率 ${pct(s.o, s.done)}${b.target ? ' ・ 締切 ' + md(b.target) : ''}</div></div>`; }).join('');
  });
  if(db.subjects.length) h += '<button class="btn wide primary" data-act="addBook">＋ 教材を追加</button>';
  $('#v-books').innerHTML = h;
}

/* ---------- 教材の中（問題一覧） ---------- */
function renderBook(){
  const b = B(bookId), ri = b.cur, R = b.rounds[ri], ids = unitIds(b);
  $('#bTitle').textContent = b.name;
  const sel = $('#round');
  sel.innerHTML = b.rounds.map((r, i) => `<option value="${i}">${esc(r.name)}</option>`).join(''); sel.value = ri;
  const c = {o:0, x:0, t:0, none:0}; let total = 0;
  ids.forEach(q => { const it = R.items[q]; c[it && it.m ? it.m : 'none']++; total += elapsedQ(b, ri, q); });
  $('#bStats').innerHTML = ['o','x','t','none'].map(k => `<div class="stat ${k}${filter === k ? ' on' : ''}" data-act="filter" data-f="${k}"><b>${c[k]}</b>${k === 'none' ? '未' : MARK[k]}</div>`).join('');
  const done = ids.length - c.none;
  $('#bTotal').textContent = `合計 ${fmt(total)}　・　${done}/${ids.length}問` + (done ? `　・　正答率 ${Math.round(c.o/done*100)}%` : '') + (filter ? '　（絞り込み中）' : '');
  // 一覧は 1 問 1 行。小問に分けた問題も 1 行にまとめ、印を並べて出す（中の (1)(2) は問題の画面で切り替える）
  const groups = []; ids.forEach(q => { const g = groups[groups.length - 1];
    if(g && g.base === baseOf(q)) g.subs.push(q); else groups.push({base:baseOf(q), subs:[q]}); });
  const mk = q => (R.items[q] || {}).m || null;
  $('#bList').innerHTML = '<div class="grid">' + groups.filter(g => { if(!filter) return true;
      return g.subs.some(q => filter === 'none' ? !mk(q) : mk(q) === filter); })
    .map(g => {
      const ms = g.subs.map(mk), multi = g.subs.length > 1;
      const runQ = g.subs.find(q => isRunQ(b, ri, q)), t = g.subs.reduce((a, q) => a + elapsedQ(b, ri, q), 0);
      const cls = ms.every(Boolean) ? (ms.includes('x') ? 'x' : ms.includes('t') ? 't' : 'o') : '';   // 全部付いたら色を付ける
      const st = multi
        ? `<span class="st multi">${ms.map(m => m ? `<span class="${m}">${MARK[m]}</span>` : '<span class="n">・</span>').join('')}</span>`
        : `<span class="st${ms[0] ? '' : ' none'}">${ms[0] ? MARK[ms[0]] : (runQ ? '計測中' : 'まだ')}</span>`;
      const open = runQ || g.subs.find(q => !mk(q)) || g.subs[0];   // 計測中か、まだの小問から開く
      return `<div class="tile${cls ? ' ' + cls : ''}${runQ ? ' running' : ''}" data-act="openQ" data-q="${open}">
        <div class="id">${esc(g.base)}${multi ? ` <span class="p">${g.subs.length}問</span>` : ''}</div>
        <div class="right"><span class="tm"${runQ ? ` data-live="qsum" data-base="${esc(g.base)}"` : ''}>${t || runQ ? fmt(t) : ''}</span>${st}</div></div>`; }).join('') + '</div>';
}

/* ---------- 問題の画面 ---------- */
function renderDetail(){
  const b = B(bookId), ri = b.cur, it = b.rounds[ri].items[openQ] || {}, on = isRunQ(b, ri, openQ);
  $('#dSub').innerHTML = dot(b.subjectId) + esc(b.name) + ' ・ ' + esc(b.rounds[ri].name);
  $('#dTitle').textContent = lab(openQ);
  $('#dWhen').innerHTML = (it.s ? '開始 ' + dt(it.s) : 'まだ始めていません') + (it.at && it.m ? '<br>' + MARK[it.m] + 'を付けた日時 ' + dt(it.at) : '');
  const k = (b.parts || {})[baseOf(openQ)] || 1;
  $('#dSplit').textContent = k > 1 ? `小問の数を変える（今 ${k} 個）` : '(1)(2)… の小問に分ける';
  // 小問の切り替え
  const subs = unitIds(b).filter(q => baseOf(q) === baseOf(openQ));
  $('#dParts').innerHTML = subs.length > 1 ? subs.map(q => { const m = (b.rounds[ri].items[q] || {}).m;
    return `<button class="part${q === openQ ? ' on' : ''}" data-act="openQ" data-q="${q}">(${q.split('-')[1]})<b class="${m || ''}">${m ? MARK[m] : '・'}</b></button>`; }).join('') : '';
  const w = $('#watch'); w.dataset.live = 'watch'; w.textContent = fmt(elapsedQ(b, ri, openQ)); w.classList.toggle('on', on);
  const st = $('#startQ'); st.textContent = on ? 'ストップ' : (elapsedQ(b, ri, openQ) ? '再開' : 'スタート'); st.classList.toggle('on', on);
  document.querySelectorAll('.dm').forEach(x => x.classList.toggle('on', it.m === x.dataset.m));
  const ids = unitIds(b), i = ids.indexOf(openQ);
  $('#prevQ').disabled = i <= 0; $('#nextQ').disabled = i === ids.length - 1;
}

/* ---------- 教材の分析 ---------- */
function renderAna(){
  const b = B(bookId), ids = unitIds(b);
  $('#aTitle').textContent = b.name + ' の分析';
  const A = [];
  b.rounds.forEach((r, ri) => ids.forEach(q => { const it = r.items[q]; if(it && it.m) A.push({ri, q, m:it.m, t:it.t, at:it.at}); }));
  const cnt = a => ({o:a.filter(x => x.m === 'o').length, x:a.filter(x => x.m === 'x').length, t:a.filter(x => x.m === 't').length, n:a.length,
    time:a.reduce((s, x) => s + x.t, 0), timed:a.filter(x => x.t > 0).length});
  const avg = c => c.timed ? fmt(c.time / c.timed) : '—';
  const card = (k, v) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const all = cnt(A), dated = A.filter(x => x.at), days = {};
  dated.forEach(x => (days[dayKey(x.at)] = days[dayKey(x.at)] || []).push(x));
  const dayKeys = Object.keys(days).sort();
  let h = '<h2>全体（すべての回）</h2><div class="cards">';
  h += card('解いた問題', `${all.n}<small> 問</small>`) + card('正答率（○の割合）', pct(all.o, all.n));
  h += card('○ / × / △', `<span style="color:var(--o)">${all.o}</span> / <span style="color:var(--x)">${all.x}</span> / <span style="color:var(--t)">${all.t}</span>`);
  h += card('1問の平均時間', avg(all)) + card('合計時間', fmt(all.time)) + card('取り組んだ日数', `${dayKeys.length}<small> 日</small>`) + '</div>';
  const r = b.rounds[b.cur], cur = cnt(A.filter(x => x.ri === b.cur)), curDated = dated.filter(x => x.ri === b.cur);
  h += `<h2>ペース（${esc(r.name)}）</h2>`;
  if(curDated.length){
    const first = Math.min(...curDated.map(x => x.at)), curDays = new Set(curDated.map(x => dayKey(x.at))).size;
    const span = daysBetween(dayKey(first), today()) + 1, perDay = curDated.length / span, left = ids.length - cur.n;
    let fin;
    if(left === 0) fin = '全問終わりました';
    else { const d = Math.ceil(left / perDay), f = addDays(today(), d); fin = `このペースだと、残り ${left} 問はあと約 <b>${d} 日</b>（${md(f)}ごろ）で終わります`; }
    const p = plan(b);
    if(p && left) fin += `<br>締切 ${md(b.target)} に間に合わせるには 1日 <b>${p.need} 問</b>`;
    h += `<div class="cards">${card('進み具合', `${cur.n}<small> / ${ids.length} 問</small>`)}${card('正答率', pct(cur.o, cur.n))}
      ${card('1日あたり（始めた日から）', `${perDay.toFixed(1)}<small> 問</small>`)}${card('取り組んだ日の平均', `${(curDated.length / curDays).toFixed(1)}<small> 問</small>`)}</div>
      <div class="note" style="margin-top:8px">${md(dayKey(first))} に始めて ${span} 日目（うち取り組んだ日 ${curDays} 日）<br>${fin}</div>`;
  } else h += '<div class="note empty">この回は、まだ日時つきの記録がありません</div>';
  h += '<h2>日別</h2>';
  if(dayKeys.length){
    h += '<table><tr><th>日付</th><th>問</th><th>○</th><th>×</th><th>△</th><th>正答率</th><th>時間</th><th>平均</th></tr>';
    dayKeys.slice().reverse().forEach(k => { const c = cnt(days[k]);
      h += `<tr><td>${dayLabel(k)}</td><td>${c.n}</td><td class="o">${c.o}</td><td class="x">${c.x}</td><td class="t">${c.t}</td><td>${pct(c.o, c.n)}</td><td>${fmt(c.time)}</td><td>${avg(c)}</td></tr>`; });
    h += '</table>';
  } else h += '<div class="note empty">まだ記録がありません</div>';
  h += '<h2>回ごと</h2><table><tr><th>回</th><th>済</th><th>正答率</th><th>○</th><th>×</th><th>△</th><th>平均</th></tr>';
  b.rounds.forEach((rr, i) => { const c = cnt(A.filter(x => x.ri === i));
    h += `<tr><td>${esc(rr.name)}</td><td>${c.n}/${ids.length}</td><td>${pct(c.o, c.n)}</td><td class="o">${c.o}</td><td class="x">${c.x}</td><td class="t">${c.t}</td><td>${avg(c)}</td></tr>`; });
  h += '</table>';
  // 苦手な問題（× か △ が付いたことがある問題）
  const weak = ids.map(q => ({q, ms:b.rounds.map(r => (r.items[q] || {}).m).filter(Boolean)})).filter(x => x.ms.some(m => m !== 'o'));
  h += '<h2>苦手な問題（×・△ が付いたことがある）</h2>';
  h += weak.length ? '<div class="rows">' + weak.map(x => `<div class="rowi"><b>${esc(lab(x.q))}</b><span class="r">${x.ms.map(m => MARK[m]).join(' → ')}</span></div>`).join('') + '</div>'
    : '<div class="note empty">ありません</div>';
  if(A.length > dated.length) h += `<div class="hint" style="margin-top:12px">日時の記録を始める前に付けた ${A.length - dated.length} 問は、日別とペースには入っていません</div>`;
  h += '<div class="hint" style="margin-top:8px">正答率 = ○ ÷ 解いた問題（△は正解に入れていません）。日付は○×△を付けた日で数えています</div>';
  $('#aBody').innerHTML = h;
}

/* ---------- 記録（勉強時間） ---------- */
let chartDays = 14, chartSel = null;
function renderLog(){
  const m = studyByDay(), t = today(), ws = weekStart(t), ms = t.slice(0, 8) + '01';
  let h = '<h1 class="ttl">勉強時間の記録</h1><div class="cards">';
  [['今日', t, t], ['今週', ws, t], ['今月', ms, t], ['これまで', '0000', t]].forEach(([k, a, z]) =>
    h += `<div class="card"><div class="k">${k}</div><div class="v">${fmtH(rangeTotal(m, a, z))}</div></div>`);
  h += '</div>';
  // グラフ
  const keys = Array.from({length:chartDays}, (_, i) => addDays(t, i - chartDays + 1));
  const subs = db.subjects.filter(s => keys.some(k => (m[k] || {})[s.id] > 0));
  const other = keys.some(k => Object.keys(m[k] || {}).some(id => !S(id) && m[k][id] > 0));
  h += `<h2 style="display:flex; justify-content:space-between; align-items:center">日ごとの勉強時間
    <span><button class="btn sm${chartDays === 14 ? ' primary' : ''}" data-act="chartDays" data-n="14">2週間</button>
    <button class="btn sm${chartDays === 28 ? ' primary' : ''}" data-act="chartDays" data-n="28">4週間</button></span></h2>`;
  h += '<div class="chart">' + chartSvg(m, keys, subs, other) + `<div class="tip" id="tip">${tipText(m, chartSel && keys.includes(chartSel) ? chartSel : t)}</div>`;
  if(subs.length + (other ? 1 : 0) >= 2) h += '<div class="legend">' + subs.map(s => `<span>${dot(s.id)}${esc(s.name)}</span>`).join('') + (other ? `<span>${dot(null)}その他</span>` : '') + '</div>';
  h += '</div><div class="hint" style="margin:4px">棒をタップすると、その日の内訳が出ます</div>';
  // 科目ごと
  if(db.subjects.length){
    h += '<h2>科目ごと</h2><table><tr><th>科目</th><th>今日</th><th>今週</th><th>今月</th><th>これまで</th></tr>';
    db.subjects.forEach(s => h += `<tr><td>${dot(s.id)}${esc(s.name)}</td><td>${fmtH(rangeTotal(m, t, t, s.id))}</td><td>${fmtH(rangeTotal(m, ws, t, s.id))}</td><td>${fmtH(rangeTotal(m, ms, t, s.id))}</td><td>${fmtH(rangeTotal(m, '0000', t, s.id))}</td></tr>`);
    h += '</table>';
  }
  // 日別（表）
  const dk = Object.keys(m).filter(k => sumObj(m[k]) > 0).sort().reverse();
  h += '<h2>日別</h2>';
  h += dk.length ? '<table><tr><th>日付</th><th>合計</th><th style="text-align:left">内訳</th></tr>' + dk.map(k =>
    `<tr><td>${dayLabel(k)}</td><td>${fmtH(sumObj(m[k]))}</td><td class="wrap">${Object.entries(m[k]).filter(([, v]) => v >= 60000).map(([id, v]) => esc(subName(id)) + ' ' + fmtH(v)).join('、')}</td></tr>`).join('') + '</table>'
    : '<div class="note empty">まだ記録がありません</div>';
  h += '<button class="btn wide" data-act="addManual">＋ 勉強時間を手で追加</button>';
  h += '<div class="hint" style="margin:8px 4px">問題のストップウォッチと「問題なしで勉強」の時間が、ここに自動で入ります</div>';
  $('#v-log').innerHTML = h;
}
function chartSvg(m, keys, subs, other){
  const W = 360, H = 190, L = 30, Bt = 20, T = 8, n = keys.length, cw = (W - L - 4) / n, bw = Math.max(6, Math.min(16, cw * .62));
  const tot = keys.map(k => Math.max(0, sumObj(m[k])));
  const maxH = Math.max(1, Math.ceil(Math.max(...tot) / 3.6e6));
  const step = maxH <= 4 ? 1 : maxH <= 8 ? 2 : 3, top = Math.ceil(maxH / step) * step;
  const y = v => T + (H - T - Bt) * (1 - v / (top * 3.6e6));
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="日ごとの勉強時間">`;
  for(let v = 0; v <= top; v += step) s += `<line class="gl" x1="${L}" x2="${W}" y1="${y(v*3.6e6)}" y2="${y(v*3.6e6)}"/><text x="${L - 4}" y="${y(v*3.6e6) + 3}" text-anchor="end">${v}h</text>`;
  const order = subs.map(x => x.id); if(other) order.push('__other');
  keys.forEach((k, i) => {
    const x0 = L + i * cw, bx = x0 + (cw - bw) / 2, d = m[k] || {};
    const vals = order.map(id => id === '__other' ? Object.keys(d).filter(z => !S(z)).reduce((a, z) => a + Math.max(0, d[z]), 0) : Math.max(0, d[id] || 0));
    s += `<g class="col${chartSel === k ? ' sel' : ''}" data-act="chartSel" data-k="${k}"><rect class="hit" x="${x0}" y="${T}" width="${cw}" height="${H - T - Bt}" fill="transparent" rx="4"/>`;
    let acc = 0; const segs = [];
    vals.forEach((v, j) => { if(v <= 0) return; segs.push({j, a:acc, b:acc + v}); acc += v; });
    segs.forEach((g, idx) => {
      const y1 = y(g.b), y0 = y(g.a), last = idx === segs.length - 1;
      let hgt = y0 - y1 - (last ? 0 : 2); if(hgt < .5) return;    // 2px のすき間
      const col = order[g.j] === '__other' ? 'var(--c8)' : subColor(order[g.j]);
      if(last && hgt > 4){ const r = 4;   // 一番上だけ角を丸める
        s += `<path d="M${bx},${y0} V${y1 + r} Q${bx},${y1} ${bx + r},${y1} H${bx + bw - r} Q${bx + bw},${y1} ${bx + bw},${y1 + r} V${y0} Z" style="fill:${col}"/>`;
      } else s += `<rect x="${bx}" y="${y0 - hgt}" width="${bw}" height="${hgt}" style="fill:${col}"/>`;
    });
    if(n <= 14 || i % 2 === (n - 1) % 2)   // 4週間のときは1日おきに日付
      s += `<text x="${x0 + cw/2}" y="${H - 6}" text-anchor="middle"${k === today() ? ' style="font-weight:700; fill:var(--fg)"' : ''}>${kd(k).getDate()}</text>`;
    s += '</g>';
  });
  return s + '</svg>';
}
function tipText(m, k){
  const d = m[k] || {}, tot = Math.max(0, sumObj(d));
  const parts = Object.entries(d).filter(([, v]) => v >= 60000).map(([id, v]) => `${dot(S(id) ? id : null)}${esc(subName(id))} ${fmtH(v)}`);
  return `<b>${dayLabel(k)}　合計 ${fmtH(tot)}</b><br>${parts.length ? parts.join('　') : '<span class="hint">勉強の記録はありません</span>'}`;
}

/* ---------- 設定 ---------- */
function renderSet(){
  const t = today();
  let h = '<h1 class="ttl">設定</h1><h2>試験日</h2>';
  h += db.exams.length ? '<div class="rows">' + db.exams.slice().sort((a, b) => a.date < b.date ? -1 : 1).map(e => { const d = daysBetween(t, e.date);
    return `<div class="rowi" data-act="editExam" data-id="${e.id}"><span>${esc(e.name)}</span><span class="r">${e.date.replace(/-/g, '/')}　${d > 0 ? 'あと' + d + '日' : d === 0 ? '今日' : '終了'}</span></div>`; }).join('') + '</div>' : '';
  h += '<button class="btn wide" data-act="addExam">＋ 試験日を追加</button>';
  h += '<h2>科目</h2>';
  h += db.subjects.length ? '<div class="rows">' + db.subjects.map(s => `<div class="rowi" data-act="editSubject" data-id="${s.id}"><span>${dot(s.id)}${esc(s.name)}</span><span class="r">教材 ${db.books.filter(b => b.subjectId === s.id).length}</span></div>`).join('') + '</div>' : '';
  h += '<button class="btn wide" data-act="addSubject">＋ 科目を追加</button>';
  if(COMMON.some(n => !db.subjects.some(x => x.name === n))) h += `<button class="btn wide" data-act="addSubjects">${COMMON.join('・')} をまとめて登録</button>`;
  h += `<h2>1日の目標時間</h2><div class="rows"><div class="rowi" data-act="editGoal"><span>目標</span><span class="r">${db.goalMin ? fmtH(db.goalMin*60000) : '決めていない'}</span></div></div>`;
  // GitHub
  const c = Sync.cfg;
  h += '<h2>GitHub に自動保存</h2><div class="note">';
  if(c.token){
    h += `保存先: <b>${esc(c.repo)}</b>（非公開）<br>` + (c.err ? `<span class="late">! ${esc(c.err)}</span>` : c.last ? `最後に保存・確認した日時: ${dt(c.last)}` : 'まだ保存していません');
    h += '<div style="display:flex; gap:8px; margin-top:10px"><button class="btn" style="flex:1" data-act="syncNow">今すぐ保存</button><button class="btn" style="flex:1" data-act="syncSetup">設定を変える</button></div>';
    h += '<div class="hint" style="margin-top:6px">記録を変えると数秒後に自動で GitHub に保存されます。アプリを開いたときは GitHub の新しい記録を読み込みます</div>';
  } else h += 'まだ設定していません。設定すると、記録が GitHub の非公開リポジトリに自動で保存され、履歴を消しても・別の端末でも戻せます。'
    + '<button class="btn wide" data-act="syncSetup">トークンを貼り付けて設定</button>';
  h += '<button class="btn wide primary" data-act="qrScan">📷 QR コードでトークンを受け取る（iPhone）</button>'
    + '<button class="btn wide" data-act="qrShow">トークンを QR コードにする（PC）</button>'
    + '<div class="hint" style="margin-top:4px">PC で作ったトークンは、PC でこのアプリを開いて「トークンを QR コードにする」を押し、iPhone のこのアプリで「📷 QR コードで受け取る」を押して写します</div>';
  h += `<details style="margin-top:8px"><summary class="hint" style="font-size:13px">トークンの作り方</summary><div class="hint" style="font-size:13px; margin-top:6px">
    1. <a href="https://github.com/settings/personal-access-tokens/new?name=%E5%8B%89%E5%BC%B7%E7%AE%A1%E7%90%86&amp;target_name=${esc(c.repo.split('/')[0])}&amp;expires_in=366&amp;contents=write" target="_blank" rel="noopener">GitHub のトークン作成ページ</a>を開く（GitHub にログインした状態で）<br>
    2. Token name に「勉強管理」、Expiration は選べるいちばん長い期間<br>
    3. Repository access で「Only select repositories」→ <b>${esc(c.repo.split('/')[1] || '')}</b> を選ぶ<br>
    4. Permissions の Repository permissions で <b>Contents</b> を「Read and write」にする<br>
    5. 下の「Generate token」を押して、出てきた github_pat_… をコピーし、上の設定に貼り付ける<br>
    ※ トークンはパスワードと同じです。人に見せないでください。履歴を消すとトークンも消えるので、iPhone のパスワードアプリかメモに控えておくと、すぐ戻せます
  </div></details>`;
  h += '</div>';
  h += `<h2>ファイルに保存</h2><div class="note">${db.backupAt ? '最後に保存した日時: ' + dt(db.backupAt) : 'まだファイルに保存していません'}
    <div style="display:flex; gap:8px; margin-top:10px"><button class="btn" style="flex:1" data-act="fileSave">ファイルに保存</button><button class="btn" style="flex:1" data-act="fileLoad">ファイルから戻す</button></div></div>`;
  h += `<div class="hint" style="text-align:center; margin-top:16px">版 ${esc(BUILD || '不明')}</div>`;
  $('#v-set').innerHTML = h;
}

/* ---------- 入力フォーム ---------- */
function form(title, fields, opts = {}){
  return new Promise(res => {
    const L = $('#form'), box = L.querySelector('.fields');
    L.querySelector('h3').textContent = title;
    box.innerHTML = fields.map((f, i) => `<label>${esc(f.label)}` + (f.type === 'select'
      ? `<select data-i="${i}">${f.options.map(o => `<option value="${esc(o.value)}"${o.value === f.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
      : `<input data-i="${i}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}${f.type === 'number' ? ' inputmode="numeric" min="0"' : ''}${f.type === 'password' ? ' autocomplete="off"' : ''}>`)
      + (f.hint ? `<small>${esc(f.hint)}</small>` : '') + '</label>').join('');
    const del = L.querySelector('.fdel'); del.style.display = opts.del ? '' : 'none'; del.textContent = opts.del || '';
    L.classList.add('show');
    const done = v => { L.classList.remove('show'); L.onclick = null; res(v); };
    L.onclick = e => {
      if(e.target === L) return done(null);
      const a = e.target.dataset.f; if(!a) return;
      if(a === 'cancel') done(null);
      else if(a === 'del') done({_del:true});
      else { const v = {}; fields.forEach((f, i) => { const el = box.querySelector(`[data-i="${i}"]`);
        v[f.key] = f.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value.trim(); }); done(v); }
    };
  });
}
const subjectOptions = () => db.subjects.map(s => ({value:s.id, label:s.name}));
function nextSlot(){ const used = new Set(db.subjects.map(s => s.slot)); for(let i = 0; i < 8; i++) if(!used.has(i)) return i; return 8; }

/* ---------- 操作 ---------- */
const ACT = {
  tab(d){ tab = d.tab; window.scrollTo(0, 0); renderAll(); },
  stopRun(){ stopRun(); save(); renderAll(); },
  startFree(d){ const r = db.running; if(r && r.type === 'free' && r.sub === d.sub){ stopRun(); toast('ストップしました'); } else { startFree(d.sub); toast(subName(d.sub) + ' をスタートしました'); } save(); renderAll(); },
  openBook(d){ bookId = d.id; filter = null; openQ = null; anaOpen = false; renderAll(); $('#book').scrollTo(0, 0); },
  closeBook(){ bookId = null; renderAll(); },
  openQ(d){ openQ = d.q; renderAll(); },
  closeDetail(){ openQ = null; renderAll(); },
  prevQ(){ const ids = unitIds(B(bookId)), i = ids.indexOf(openQ); if(i > 0){ openQ = ids[i-1]; renderAll(); } },
  nextQ(){ const ids = unitIds(B(bookId)), i = ids.indexOf(openQ); if(i < ids.length - 1){ openQ = ids[i+1]; renderAll(); } },
  toggleQ(){ const b = B(bookId); if(isRunQ(b, b.cur, openQ)) stopRun(); else startQ(b, b.cur, openQ); save(); renderAll(); },
  mark(d){ const b = B(bookId), it = item(b, b.cur, openQ);
    it.m = it.m === d.m ? null : d.m;
    if(it.m) it.at = Date.now(); else delete it.at;
    if(it.m && isRunQ(b, b.cur, openQ)) stopRun();     // 印を付けたら計測は止める
    save(); renderAll(); },
  resetQ(){ const b = B(bookId), it = item(b, b.cur, openQ);
    if(isRunQ(b, b.cur, openQ)){ db.running = null; }
    if(it.t) db.log.push({d:it.s || Date.now(), ms:-it.t, sub:b.subjectId, book:b.id, q:openQ, fix:1});
    it.t = 0; delete it.s; save(); renderAll(); },
  editTime(){ const b = B(bookId), cur = elapsedQ(b, b.cur, openQ);
    const v = prompt(lab(openQ) + ' の時間（例 3:25 / 秒数 / 空で0）', fmt(cur)); if(v === null) return;
    const s = v.trim(); let sec;
    if(s === '') sec = 0; else if(/^\d+(:\d{1,2}){0,2}$/.test(s)) sec = s.split(':').reduce((a, x) => a*60 + Number(x), 0); else return toast('形式が違います');
    if(isRunQ(b, b.cur, openQ)) stopRun();
    const it = item(b, b.cur, openQ), diff = sec*1000 - it.t;
    if(diff) db.log.push({d:it.s || Date.now(), ms:diff, sub:b.subjectId, book:b.id, q:openQ, fix:1});   // 勉強時間の記録も直す
    it.t = sec*1000; if(!it.s && sec) it.s = Date.now(); save(); renderAll(); },
  split(){ const b = B(bookId), base = baseOf(openQ); b.parts = b.parts || {};
    const cur = b.parts[base] || 1, v = prompt(`${base} の小問の数（1 にすると分けない）`, cur > 1 ? cur : 2); if(v === null) return;
    const k = parseInt(v, 10); if(!(k >= 1 && k <= 20)) return toast('1〜20 の数で入れてください'); if(k === cur) return;
    const gone = []; for(let i = k + 1; i <= cur; i++) gone.push(base + '-' + i);
    const lost = b.rounds.some(r => gone.some(id => r.items[id] && (r.items[id].m || r.items[id].t))) || (db.running && db.running.book === b.id && gone.includes(db.running.q));
    if(lost && !confirm(`${gone.map(lab).join('、')} の記録が消えます。よろしいですか？`)) return;
    const ren = (ri, from, to) => { const r = b.rounds[ri]; if(r.items[from]){ r.items[to] = r.items[from]; delete r.items[from]; }
      const x = db.running; if(x && x.type === 'q' && x.book === b.id && x.round === ri && x.q === from) x.q = to; };
    b.rounds.forEach((r, ri) => {
      gone.forEach(id => { delete r.items[id]; const x = db.running; if(x && x.type === 'q' && x.book === b.id && x.round === ri && x.q === id) db.running = null; });
      if(cur === 1 && k > 1) ren(ri, base, base + '-1');
      if(cur > 1 && k === 1) ren(ri, base + '-1', base);
    });
    if(k === 1) delete b.parts[base]; else b.parts[base] = k;
    if(!unitIds(b).includes(openQ)) openQ = k === 1 ? base : base + '-1';
    save(); renderAll(); },
  filter(d){ filter = filter === d.f ? null : d.f; renderAll(); },
  newRound(){ const b = B(bookId), name = prompt('新しい回の名前', (b.rounds.length + 1) + '回目'); if(!name) return;
    b.rounds.push({name:name.trim(), items:{}}); b.cur = b.rounds.length - 1; filter = null; save(); renderAll(); },
  roundMenu(){ const b = B(bookId), r = b.rounds[b.cur];
    const v = prompt(`「${r.name}」をどうしますか？\n1: 名前を変える\n2: この回の記録を全部消す\n3: この回を削除する`);
    if(v === '1'){ const n = prompt('新しい名前', r.name); if(n){ r.name = n.trim(); save(); renderAll(); } }
    else if(v === '2'){ if(confirm(`「${r.name}」の時間と印を全部消します。よろしいですか？`)){ if(db.running && db.running.book === b.id && db.running.round === b.cur) db.running = null; r.items = {}; save(); renderAll(); } }
    else if(v === '3'){ if(b.rounds.length === 1) return toast('最後の1つは削除できません（2で記録を消せます）');
      if(confirm(`「${r.name}」を削除します。よろしいですか？`)){ if(db.running && db.running.book === b.id){ if(db.running.round === b.cur) db.running = null; else if(db.running.round > b.cur) db.running.round--; }
        b.rounds.splice(b.cur, 1); b.cur = 0; save(); renderAll(); } } },
  copyBook(){ const b = B(bookId), r = b.rounds[b.cur], lines = [b.name + ' ' + r.name];
    unitIds(b).forEach(q => { const it = r.items[q] || {}; lines.push(`${lab(q)}\t${fmt(elapsedQ(b, b.cur, q))}\t${it.m ? MARK[it.m] : ''}\t${it.at ? dt(it.at) : ''}`); });
    lines.push($('#bTotal').textContent.replace(/　（.*$/, ''));
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => toast('コピーしました'), () => prompt('コピーしてください', text)); },
  openAna(){ anaOpen = true; renderAll(); $('#ana').scrollTo(0, 0); },
  closeAna(){ anaOpen = false; renderAll(); },
  async addBook(){
    const v = await form('教材を追加', [
      {key:'sub', label:'科目', type:'select', options:subjectOptions(), value:db.subjects[0].id},
      {key:'name', label:'教材の名前', placeholder:'例: 青チャート 数IA'},
      {key:'count', label:'問題の数', type:'number', value:48},
      {key:'prefix', label:'番号の前に付ける文字（なくてもOK）', value:'', placeholder:'例: s → s1, s2, …', hint:'(1)(2) の小問は、あとで問題ごとに分けられます'},
      {key:'target', label:'締切（この日までに1周する）', type:'date', value:'', hint:'入れると、ホームに「今日やる問題数」が出ます。あとで決めてもOK'}]);
    if(!v) return;
    if(!v.name) return toast('教材の名前を入れてください');
    if(!(v.count >= 1 && v.count <= 2000)) return toast('問題の数は 1〜2000 で入れてください');
    const b = {id:uid(), subjectId:v.sub, name:v.name, count:Math.floor(v.count), prefix:v.prefix.replace(/-/g, ''), parts:{}, target:v.target, cur:0, rounds:[{name:'1回目', items:{}}]};
    db.books.push(b); save(); bookId = b.id; renderAll(); toast('教材を追加しました'); },
  async editBook(){
    const b = B(bookId);
    const v = await form('教材の設定', [
      {key:'sub', label:'科目', type:'select', options:subjectOptions(), value:b.subjectId},
      {key:'name', label:'教材の名前', value:b.name},
      {key:'count', label:'問題の数', type:'number', value:b.count, hint:'減らしても、記録は消えずに見えなくなるだけです'},
      {key:'prefix', label:'番号の前に付ける文字', value:b.prefix, hint:'変えると、今までの記録とつながらなくなるので注意'},
      {key:'target', label:'締切（この日までに今の回を1周する）', type:'date', value:b.target || ''}], {del:'この教材を削除'});
    if(!v) return;
    if(v._del){ if(!confirm(`「${b.name}」と、その○×△・時間の記録を削除します。\n（勉強時間の合計からは消えません）\nよろしいですか？`)) return;
      if(db.running && db.running.book === b.id) stopRun();
      db.books = db.books.filter(x => x !== b); bookId = null; save(); renderAll(); return; }
    if(!v.name) return toast('教材の名前を入れてください');
    if(!(v.count >= 1 && v.count <= 2000)) return toast('問題の数は 1〜2000 で入れてください');
    if(v.sub !== b.subjectId) db.log.forEach(l => { if(l.book === b.id) l.sub = v.sub; });
    Object.assign(b, {subjectId:v.sub, name:v.name, count:Math.floor(v.count), prefix:v.prefix.replace(/-/g, ''), target:v.target});
    if(db.running && db.running.book === b.id && !unitIds(b).includes(db.running.q)) stopRun();
    if(openQ && !unitIds(b).includes(openQ)) openQ = null;
    save(); renderAll(); },
  async addExam(){ const v = await form('試験日を追加', [{key:'name', label:'試験の名前', placeholder:'例: 共通テスト'}, {key:'date', label:'日付', type:'date', value:''}]);
    if(!v) return; if(!v.name || !v.date) return toast('名前と日付を入れてください');
    db.exams.push({id:uid(), name:v.name, date:v.date}); save(); renderAll(); },
  async editExam(d){ const e = db.exams.find(x => x.id === d.id);
    const v = await form('試験日', [{key:'name', label:'試験の名前', value:e.name}, {key:'date', label:'日付', type:'date', value:e.date}], {del:'この試験日を削除'});
    if(!v) return; if(v._del){ db.exams = db.exams.filter(x => x !== e); save(); renderAll(); return; }
    if(!v.name || !v.date) return toast('名前と日付を入れてください'); e.name = v.name; e.date = v.date; save(); renderAll(); },
  async addSubject(){ const v = await form('科目を追加', [{key:'name', label:'科目の名前', placeholder:'例: 英語、数学、物理、日本史'}]);
    if(!v || !v.name) return; db.subjects.push({id:uid(), name:v.name, slot:nextSlot()}); save(); renderAll(); },
  addSubjects(){ COMMON.forEach(n => { if(!db.subjects.some(s => s.name === n)) db.subjects.push({id:uid(), name:n, slot:nextSlot()}); });
    save(); renderAll(); toast(COMMON.join('・') + ' を登録しました（設定で名前を変えられます）'); },
  async editSubject(d){ const s = S(d.id), nb = db.books.filter(b => b.subjectId === s.id).length;
    const v = await form('科目', [{key:'name', label:'科目の名前', value:s.name}], {del:'この科目を削除'});
    if(!v) return;
    if(v._del){ if(nb) return toast('この科目の教材があるので削除できません（先に教材の科目を変えるか削除してください）');
      if(!confirm(`「${s.name}」を削除します。よろしいですか？`)) return;
      if(db.running && db.running.type === 'free' && db.running.sub === s.id) stopRun();
      db.subjects = db.subjects.filter(x => x !== s); save(); renderAll(); return; }
    if(v.name){ s.name = v.name; save(); renderAll(); } },
  async editGoal(){ const v = await form('1日の目標時間', [{key:'h', label:'時間', type:'number', value:Math.floor((db.goalMin || 0) / 60)}, {key:'m', label:'分', type:'number', value:(db.goalMin || 0) % 60, hint:'0時間0分にすると目標なし'}]);
    if(!v) return; db.goalMin = Math.max(0, (v.h || 0) * 60 + (v.m || 0)); save(); renderAll(); },
  async addManual(){ if(!db.subjects.length) return toast('先に科目を登録してください');
    const v = await form('勉強時間を手で追加', [{key:'sub', label:'科目', type:'select', options:subjectOptions(), value:db.subjects[0].id},
      {key:'date', label:'日付', type:'date', value:today()}, {key:'h', label:'時間', type:'number', value:0}, {key:'m', label:'分', type:'number', value:30}]);
    if(!v) return; const ms = ((v.h || 0) * 60 + (v.m || 0)) * 60000;
    if(!v.date || ms <= 0) return toast('日付と時間を入れてください');
    db.log.push({d:kd(v.date).getTime() + 12 * 3.6e6, ms, sub:v.sub, manual:1}); save(); renderAll(); toast('追加しました'); },
  chartDays(d){ chartDays = Number(d.n); renderAll(); },
  chartSel(d){ chartSel = d.k; document.querySelectorAll('.chart .col').forEach(g => g.classList.toggle('sel', g.dataset.k === d.k)); $('#tip').innerHTML = tipText(studyByDay(), d.k); },
  syncNow(){ Sync.sync(true); },
  async syncSetup(){ const c = Sync.cfg;
    const v = await form('GitHub に保存する設定', [
      {key:'token', label:'トークン（github_pat_ で始まる文字）', type:'password', value:c.token, hint:'作り方はこの下の説明を見てください。トークンはこの iPhone の中だけに置かれます'},
      {key:'repo', label:'保存先のリポジトリ', value:c.repo}], {del:c.token ? 'GitHub への保存をやめる' : ''});
    if(!v) return;
    if(v._del){ Object.assign(c, {token:'', sha:null, last:null, err:null}); Sync.store(); renderAll(); return; }
    if(!v.token || !/^[\w.-]+\/[\w.-]+$/.test(v.repo)) return toast('トークンとリポジトリを入れてください');
    Object.assign(c, {token:v.token, repo:v.repo, sha:null, last:null, err:null}); Sync.store();
    toast('接続を確かめています…'); await Sync.sync(true); },
  fileSave(){ fileSave(); },
  async qrShow(){
    const v = await form('トークンを QR コードにする', [{key:'token', label:'トークン（github_pat_ で始まる文字）を貼り付け', type:'password', value:Sync.cfg.token,
      hint:'この画面ではトークンを保存しません。QR コードを出すだけです'}]);
    if(!v || !v.token) return;
    if(!/^(github_pat_|ghp_)\w+$/.test(v.token)) return toast('トークンの形が違います（github_pat_ で始まる文字）');
    try{ await loadScript('lib/qrcode.js'); }catch(e){ return toast('QR コードの部品を読み込めませんでした'); }
    const q = qrcode(0, 'M'); q.addData(`STUDYTOKEN1 ${Sync.cfg.repo} ${v.token}`); q.make();
    openSheet(`<h3>iPhone で読み取ってください</h3>
      <div style="background:#fff; padding:16px; border-radius:12px; width:min(100%, 340px); margin:0 auto">${q.createSvgTag({cellSize:6, margin:4, scalable:true})}</div>
      <div class="hint" style="font-size:14px; margin:10px 2px">iPhone のホーム画面の「勉強管理」→ 設定 →「📷 QR コードでトークンを受け取る」を押して、この画面を写します。<br>
      ※ カメラアプリで読み取らないでください（Safari で開いてしまい、アプリに入りません）<br>※ 終わったら閉じてください。この QR コードはトークンそのものです</div>
      <button class="btn wide primary" data-sheet="close">閉じる</button>`);
  },
  async qrScan(){ qrScan(); },
  fileLoad(){ $('#bkFile').click(); },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if(!el) return;
  if(el.tagName === 'A') e.preventDefault();
  const f = ACT[el.dataset.act]; if(f) f(el.dataset, el);
});
$('#round').addEventListener('change', e => { const b = B(bookId); b.cur = Number(e.target.value); filter = null; save(); renderAll(); });

/* ---------- 表示を動かす（0.25 秒ごと） ---------- */
function tick(){
  const r = db.running; if(!r) return;
  const m = studyByDay(), t = today();
  document.querySelectorAll('[data-live]').forEach(el => {
    const k = el.dataset.live;
    if(k === 'run') el.textContent = fmt(Date.now() - r.start);
    else if(k === 'today') el.textContent = fmtH(rangeTotal(m, t, t));
    else if(k === 'week') el.textContent = fmtH(rangeTotal(m, weekStart(t), t));
    else if(k === 'sub') el.textContent = fmtH(rangeTotal(m, t, t, el.dataset.sub));
    else if(k === 'qsum' && bookId){ const b = B(bookId); if(b) el.textContent = fmt(unitIds(b).filter(q => baseOf(q) === el.dataset.base).reduce((a, q) => a + elapsedQ(b, b.cur, q), 0)); }
    else if((k === 'q' || k === 'watch') && bookId){ const b = B(bookId), q = k === 'q' ? el.dataset.q : openQ; if(b && q && isRunQ(b, b.cur, q)) el.textContent = fmt(elapsedQ(b, b.cur, q)); }
  });
}
setInterval(tick, 250);
let lastDay = today();
setInterval(() => { if(today() !== lastDay){ lastDay = today(); renderAll(); } }, 30000);   // 日付が変わったら描き直す

/* ---------- QR コード（PC → iPhone でトークンを渡す） ---------- */
const loaded = {};
function loadScript(src){ return loaded[src] || (loaded[src] = new Promise((ok, ng) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => { delete loaded[src]; ng(); }; document.head.appendChild(s); })); }
let sheetClose = null;
function openSheet(html, onClose){
  const L = $('#form'); L.querySelector('.sheet').dataset.saved = L.querySelector('.sheet').dataset.saved || L.querySelector('.sheet').innerHTML;
  const sh = L.querySelector('.sheet'); sh.innerHTML = html; L.classList.add('show');
  sheetClose = () => { L.classList.remove('show'); sh.innerHTML = sh.dataset.saved; delete sh.dataset.saved; L.onclick = null; sheetClose = null; if(onClose) onClose(); };
  L.onclick = e => { if(e.target === L || e.target.dataset.sheet === 'close') sheetClose(); };
}
async function qrScan(){
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return toast('この端末ではカメラが使えません。「トークンを貼り付けて設定」を使ってください');
  try{ await loadScript('lib/jsQR.js'); }catch(e){ return toast('読み取りの部品を読み込めませんでした（電波を確認）'); }
  let stream, stop = false;
  openSheet(`<h3>PC の QR コードを写してください</h3>
    <video id="qrVideo" playsinline muted autoplay style="width:100%; border-radius:12px; background:#000; aspect-ratio:1; object-fit:cover"></video>
    <div class="hint" id="qrMsg" style="font-size:14px; margin:8px 2px">カメラの使用を「許可」してください</div>
    <button class="btn wide" data-sheet="close">やめる</button>`, () => { stop = true; if(stream) stream.getTracks().forEach(t => t.stop()); });
  try{ stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}, audio:false}); }
  catch(e){ if(sheetClose) sheetClose(); return toast('カメラを使えませんでした（iPhone の設定でカメラを許可してください）'); }
  if(stop){ stream.getTracks().forEach(t => t.stop()); return; }
  const v = $('#qrVideo'); v.srcObject = stream; await v.play().catch(() => {});
  $('#qrMsg').textContent = 'QR コードを枠の中に入れてください';
  const cv = document.createElement('canvas'), cx = cv.getContext('2d', {willReadFrequently:true});
  const loop = () => {
    if(stop) return;
    if(v.videoWidth){ const w = Math.min(720, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth);
      cv.width = w; cv.height = h; cx.drawImage(v, 0, 0, w, h);
      const r = jsQR(cx.getImageData(0, 0, w, h).data, w, h, {inversionAttempts:'dontInvert'});
      if(r && useQrText(r.data)){ sheetClose(); return; } }
    requestAnimationFrame(loop);
  };
  loop();
}
// QR の中身「STUDYTOKEN1 リポジトリ トークン」を受け取って保存をはじめる
function useQrText(text){
  const m = /^STUDYTOKEN1 ([\w.-]+\/[\w.-]+) ((?:github_pat_|ghp_)\w+)$/.exec(String(text).trim());
  if(!m) return false;
  Object.assign(Sync.cfg, {repo:m[1], token:m[2], sha:null, last:null, err:null}); Sync.store();
  toast('トークンを受け取りました。GitHub に保存しています…'); Sync.sync(true).then(() => renderAll());
  return true;
}

/* ---------- ファイルに保存 / 戻す ---------- */
async function fileSave(){
  const now = new Date(), name = `study_${dayKey(now)}_${pad(now.getHours())}${pad(now.getMinutes())}.json`;
  const prev = db.backupAt; db.backupAt = now.getTime();
  const file = new File([JSON.stringify({app:'study', version:2, savedAt:now.toISOString(), data:db})], name, {type:'application/json'});
  try{
    if(navigator.canShare && navigator.canShare({files:[file]})) await navigator.share({files:[file]});
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
    save(); renderAll(); toast('保存しました');
  }catch(e){ db.backupAt = prev; if(e.name !== 'AbortError') toast('保存できませんでした'); }
}
$('#bkFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if(!f) return;
  try{
    const j = JSON.parse(await f.text());
    const raw = j && (j.app === 'study' || j.app === 's48-check') ? j.data : null;
    if(!raw) throw 0;
    const d = migrate(raw);
    if(!confirm(`${f.name}\n（科目 ${d.subjects.length}・教材 ${d.books.length}）\n\n今の記録をこのファイルの内容に置き換えます。よろしいですか？`)) return;
    db = d; bookId = null; openQ = null; anaOpen = false; save(); renderAll(); toast('ファイルから戻しました');
  }catch(err){ toast('このアプリの保存ファイルではありません'); }
});

/* ---------- GitHub で読めるまとめ（README.md） ---------- */
function mdReport(){
  const m = studyByDay(), t = today(), ws = weekStart(t), mst = t.slice(0, 8) + '01';
  const c = x => String(x).replace(/\|/g, '｜').replace(/\n/g, ' ');
  const L = [`# 勉強の記録`, '', `最終更新: ${new Date().getFullYear()}/${dt(Date.now())}（アプリから自動で書き換えています。記録の本体は data.json）`, ''];
  const ex = db.exams.filter(e => daysBetween(t, e.date) >= 0).sort((a, b) => a.date < b.date ? -1 : 1);
  if(ex.length){ L.push('## 試験まで', ''); ex.forEach(e => L.push(`- **${c(e.name)}**（${e.date.replace(/-/g, '/')}）あと ${daysBetween(t, e.date)} 日`)); L.push(''); }
  L.push('## 勉強時間', '', '| | 今日 | 今週 | 今月 | これまで |', '|---|---:|---:|---:|---:|');
  L.push(`| **合計** | ${fmtH(rangeTotal(m, t, t))} | ${fmtH(rangeTotal(m, ws, t))} | ${fmtH(rangeTotal(m, mst, t))} | ${fmtH(rangeTotal(m, '0000', t))} |`);
  db.subjects.forEach(s => L.push(`| ${c(s.name)} | ${fmtH(rangeTotal(m, t, t, s.id))} | ${fmtH(rangeTotal(m, ws, t, s.id))} | ${fmtH(rangeTotal(m, mst, t, s.id))} | ${fmtH(rangeTotal(m, '0000', t, s.id))} |`));
  const dk = Object.keys(m).filter(k => sumObj(m[k]) >= 60000).sort().reverse().slice(0, 60);
  if(dk.length){ L.push('', '### 日別（新しい順・最大 60 日）', '', '| 日付 | 合計 | 内訳 |', '|---|---:|---|');
    dk.forEach(k => L.push(`| ${dayLabel(k)} | ${fmtH(sumObj(m[k]))} | ${Object.entries(m[k]).filter(([, v]) => v >= 60000).map(([id, v]) => c(subName(id)) + ' ' + fmtH(v)).join('、')} |`)); }
  db.books.forEach(b => {
    const ids = unitIds(b);
    L.push('', `## ${c(subName(b.subjectId))}：${c(b.name)}`, '');
    const meta = [];
    if(b.target){ const p = plan(b); meta.push(`締切 ${b.target.replace(/-/g, '/')}` + (p && p.left ? `（1日 ${p.need} 問ペース）` : '')); }
    b.rounds.forEach(r => { const done = ids.filter(q => r.items[q] && r.items[q].m), o = done.filter(q => r.items[q].m === 'o').length;
      const tm = ids.reduce((a, q) => a + ((r.items[q] || {}).t || 0), 0);
      meta.push(`${c(r.name)}: ${done.length}/${ids.length} 問・正答率 ${pct(o, done.length)}・${fmt(tm)}`); });
    meta.forEach(x => L.push('- ' + x));
    const rows = ids.filter(q => b.rounds.some(r => r.items[q] && (r.items[q].m || r.items[q].t)));
    if(rows.length){
      L.push('', '| 問題 | ' + b.rounds.map(r => c(r.name)).join(' | ') + ' |', '|---|' + b.rounds.map(() => '---|').join(''));
      rows.forEach(q => L.push(`| ${c(lab(q))} | ` + b.rounds.map(r => { const it = r.items[q]; if(!it || !(it.m || it.t)) return '';
        return [it.m ? MARK[it.m] : '', it.t ? fmt(it.t) : '', it.at ? md(dayKey(it.at)) : ''].filter(Boolean).join(' '); }).join(' | ') + ' |'));
    }
  });
  return L.join('\n') + '\n';
}

/* ---------- GitHub に自動保存 ---------- */
function b64enc(str){ const u = new TextEncoder().encode(str); let s = ''; for(let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
function b64dec(b){ const s = atob(b.replace(/\s/g, '')); return new TextDecoder().decode(Uint8Array.from(s, c => c.charCodeAt(0))); }
const Sync = {
  cfg: Object.assign({token:'', repo:'syuta-chiba/study-data', path:'data.json', sha:null, last:null, err:null}, (() => { try{ return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; }catch(e){ return {}; } })()),
  timer: null, busy: false, again: false,
  store(){ localStorage.setItem(SYNC_KEY, JSON.stringify(this.cfg)); },
  schedule(){ if(!this.cfg.token) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.sync(), 4000); },
  req(method, body, keepalive, path){
    return fetch(`https://api.github.com/repos/${this.cfg.repo}/contents/${encodeURIComponent(path || this.cfg.path)}` + (method === 'GET' ? '?t=' + Date.now() : ''), {
      method, cache:'no-store', keepalive:!!keepalive,
      headers:Object.assign({Authorization:'Bearer ' + this.cfg.token, Accept:'application/vnd.github+json'}, body ? {'Content-Type':'application/json'} : {}),
      body:body ? JSON.stringify(body) : undefined});
  },
  async why(r){ if(r.status === 401) return 'トークンが正しくないか、期限が切れています';
    if(r.status === 403) return 'トークンに書き込みの許可がありません（Contents を Read and write に）';
    if(r.status === 404) return 'リポジトリが見つかりません（トークンでこのリポジトリを選んでいるか確認）';
    let m = ''; try{ m = (await r.json()).message; }catch(e){} return `GitHub エラー ${r.status} ${m}`; },
  async push(sha, keepalive){
    const r = await this.req('PUT', {message:'記録を更新 ' + dt(Date.now()), content:b64enc(JSON.stringify(db)), sha:sha || undefined}, keepalive);
    if(!r.ok) throw new Error(await this.why(r));
    this.cfg.sha = (await r.json()).content.sha;
    if(!keepalive) await this.pushReadme().catch(() => {});   // 読めるまとめ（失敗しても記録そのものは保存済み）
  },
  // GitHub のリポジトリのトップに出る README.md を、記録のまとめで書き換える
  async pushReadme(){
    const put = sha => this.req('PUT', {message:'まとめを更新 ' + dt(Date.now()), content:b64enc(mdReport()), sha:sha || undefined}, false, 'README.md');
    let r = await put(this.cfg.rsha);
    if(r.status === 409 || r.status === 422){   // sha が古い → 取り直して 1 回だけやり直す
      const g = await this.req('GET', null, false, 'README.md');
      r = await put(g.ok ? (await g.json()).sha : undefined);
    }
    if(r.ok) this.cfg.rsha = (await r.json()).content.sha;
  },
  async sync(manual){
    if(!this.cfg.token) return;
    if(this.busy){ this.again = true; return; }
    this.busy = true; clearTimeout(this.timer); this.timer = null;
    try{
      const r = await this.req('GET');
      let remote = null, sha = null;
      if(r.status === 404){
        const rr = await fetch(`https://api.github.com/repos/${this.cfg.repo}`, {headers:{Authorization:'Bearer ' + this.cfg.token}, cache:'no-store'});
        if(!rr.ok) throw new Error(await this.why(rr));     // リポジトリ自体が見えない
      } else if(!r.ok) throw new Error(await this.why(r));
      else { const j = await r.json(); sha = j.sha; remote = JSON.parse(b64dec(j.content)); }
      // この端末で初めてつなぐとき：GitHub に記録があれば、どちらを残すか聞く（空の端末で上書きしないため）
      let useRemote = remote && (remote.updatedAt || 0) > (db.updatedAt || 0);
      if(remote && !this.cfg.sha && !useRemote && (remote.updatedAt || 0) !== (db.updatedAt || 0)){
        const rb = (remote.books || []).length, rs = (remote.subjects || []).length;
        useRemote = confirm(`GitHub に記録があります（科目 ${rs}・教材 ${rb}、${remote.updatedAt ? dt(remote.updatedAt) + ' 保存' : ''}）。\n\nOK：GitHub の記録を読み込む（おすすめ）\nキャンセル：この iPhone の記録で GitHub を上書きする`);
      }
      if(useRemote){
        db = migrate(remote); localStorage.setItem(KEY, JSON.stringify(db)); this.cfg.sha = sha;
        renderAll(); toast('GitHub の新しい記録を読み込みました');
      } else if(!remote && !db.subjects.length && !db.books.length && !db.log.length){
        if(manual) toast('この端末にはまだ記録がないので、保存するものがありません');   // 空の記録で GitHub を作らない
      } else if(!remote || (remote.updatedAt || 0) < (db.updatedAt || 0)){
        await this.push(sha); if(manual) toast('GitHub に保存しました');
      } else { this.cfg.sha = sha; if(manual) toast('GitHub と同じです（保存済み）'); }
      this.cfg.last = Date.now(); this.cfg.err = null;
    }catch(e){
      this.cfg.err = e.message === 'Failed to fetch' || e.message === 'Load failed' ? 'つながりませんでした（電波がないときは、つながったら保存します）' : e.message;
      if(manual) toast(this.cfg.err);
    }finally{
      this.busy = false; this.store(); if(tab === 'set' && !$('#form').classList.contains('show')) renderAll();
      if(this.again){ this.again = false; this.schedule(); }
    }
  },
  // アプリを閉じるとき：読み込みはせずにすぐ保存（失敗しても次に開いたときに直る）
  flush(){ if(!this.cfg.token || !this.timer) return; clearTimeout(this.timer); this.timer = null;
    const body = JSON.stringify(db); this.push(this.cfg.sha, body.length < 45000).catch(() => {}); },
};
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'hidden') Sync.flush();
  else { Sync.sync(); renderAll(); }
});
window.addEventListener('online', () => Sync.sync());

/* ---------- 新しい版が出ていたら自動で読み込み直す ---------- */
async function checkUpdate(){
  if(location.protocol === 'file:' || $('#form').classList.contains('show')) return;   // 入力中は待つ
  try{
    const html = await (await fetch('index.html?check=' + Date.now(), {cache:'no-store'})).text();
    const m = /app\.js\?v=(\w+)/.exec(html);
    if(m && BUILD && m[1] !== BUILD){ Sync.flush(); toast('新しい版に更新します'); setTimeout(() => location.reload(), 800); }
  }catch(e){}
}
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') checkUpdate(); });

renderAll();
Sync.sync();
if('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js', {updateViaCache:'none'}).then(r => r.update()).catch(() => {});
checkUpdate();
