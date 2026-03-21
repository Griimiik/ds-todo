const OWNER='Griimiik', REPO='ds-todo', FILE='data.json';
let state={score:0,totalPlus:0,totalMinus:0,todos:[],legend:[],history:[],rewards:[],punishments:[],activePunishments:[]};
let ghToken='', encPw='', subPw='', modalMode='add', sha=null, theme='dark';
let role=''; // 'dom' nebo 'sub'
let countdownInterval=null;

// ── THEME ──────────────────────────────────────────────────────────────
function setTheme(t){
  theme=t;
  if(t==='dark') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme',t);
  localStorage.setItem('theme',t);
  document.querySelectorAll('.tb').forEach(b=>b.classList.remove('active'));
  const el=document.getElementById('tb-'+t);
  if(el) el.classList.add('active');
}

// ── CRYPTO ─────────────────────────────────────────────────────────────
async function getKey(pw){
  const e=new TextEncoder();
  const r=await crypto.subtle.importKey('raw',e.encode(pw),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2',salt:e.encode('ds-tracker-salt-v1'),iterations:100000,hash:'SHA-256'},
    r,{name:'AES-GCM',length:256},false,['encrypt','decrypt']
  );
}
async function encrypt(d,pw){
  const k=await getKey(pw),iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},k,new TextEncoder().encode(JSON.stringify(d)));
  const c=new Uint8Array(iv.length+ct.byteLength);c.set(iv);c.set(new Uint8Array(ct),iv.length);
  return btoa(String.fromCharCode(...c));
}
async function decrypt(b64,pw){
  const c=Uint8Array.from(atob(b64),x=>x.charCodeAt(0));
  const k=await getKey(pw);
  const d=await crypto.subtle.decrypt({name:'AES-GCM',iv:c.slice(0,12)},k,c.slice(12));
  return JSON.parse(new TextDecoder().decode(d));
}

// ── GITHUB ─────────────────────────────────────────────────────────────
async function ghGet(){
  const r=await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`,
    {headers:{Authorization:`token ${ghToken}`,Accept:'application/vnd.github.v3+json'}});
  if(r.status===404) return null;
  if(!r.ok) throw new Error('GitHub GET selhal');
  return r.json();
}
async function ghPut(enc){
  const body={message:'update',content:btoa(unescape(encodeURIComponent(enc)))};
  if(sha) body.sha=sha;
  const r=await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`,{
    method:'PUT',
    headers:{Authorization:`token ${ghToken}`,Accept:'application/vnd.github.v3+json','Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  if(!r.ok) throw new Error('GitHub PUT selhal');
  sha=(await r.json()).content.sha;
}

// ── SYNC ───────────────────────────────────────────────────────────────
function setSS(s,t){const e=document.getElementById('sync-s');e.textContent=t;e.className='ss2 '+s}

async function syncNow(){
  setSS('syncing','↻ sync...');
  try{
    const f=await ghGet();
    if(f){sha=f.sha;state=await decrypt(decodeURIComponent(escape(atob(f.content.replace(/\n/g,'')))),encPw);}
    if(!state.activePunishments) state.activePunishments=[];
    renderAll();setSS('synced','✓ synced');showToast('✓ Data synchronizována');
  }catch(e){setSS('error','✗ chyba');showToast('✗ Sync selhal — '+e.message);}
}

async function save(){
  setSS('syncing','↑ ukládám...');
  try{await ghPut(await encrypt(state,encPw));setSS('synced','✓ uloženo');}
  catch(e){setSS('error','✗ chyba');showToast('✗ Uložení selhalo — '+e.message);}
}

// ── SETUP ──────────────────────────────────────────────────────────────
async function setupApp(){
  const t=document.getElementById('s-token').value.trim();
  const p=document.getElementById('s-pw').value;
  const sp=document.getElementById('s-subpw').value;
  if(!t||!p||!sp){showToast('✗ Vyplň všechna pole');return;}
  if(p.length<6){showToast('✗ Dom heslo musí mít alespoň 6 znaků');return;}
  if(sp.length<4){showToast('✗ Sub heslo musí mít alespoň 4 znaky');return;}
  if(p===sp){showToast('✗ Dom a Sub heslo musí být různá');return;}

  ghToken=t;encPw=p;subPw=sp;
  localStorage.setItem('gh_token',t);
  localStorage.setItem('enc_pw',p);
  localStorage.setItem('sub_pw',sp);

  document.getElementById('ss').style.display='none';
  document.getElementById('ls').style.display='flex';
  document.getElementById('lt').textContent='Připojuji...';
  await syncNow();
  if(!sha){setDefaults();await save();}
  document.getElementById('ls').style.display='none';
  document.getElementById('app').style.display='block';
  role='dom';
  applyRole();
}

// ── LOGIN (Sub / Dom rozlišení při startu) ─────────────────────────────
function showLoginScreen(){
  document.getElementById('ls').style.display='none';
  document.getElementById('login-screen').style.display='flex';
}

async function loginSubmit(){
  const pw=document.getElementById('login-pw').value;
  if(!pw){showToast('✗ Zadej heslo');return;}

  if(pw===encPw){
    // Dom login — potřebuje token
    role='dom';
    document.getElementById('login-screen').style.display='none';
    document.getElementById('ls').style.display='flex';
    document.getElementById('lt').textContent='Synchronizuji...';
    await syncNow();
    document.getElementById('ls').style.display='none';
    document.getElementById('app').style.display='block';
    applyRole();
  } else if(pw===subPw){
    // Sub login — read-only přes GitHub raw (bez tokenu)
    role='sub';
    document.getElementById('login-screen').style.display='none';
    document.getElementById('ls').style.display='flex';
    document.getElementById('lt').textContent='Načítám data...';
    await syncNowSub();
    document.getElementById('ls').style.display='none';
    document.getElementById('app').style.display='block';
    applyRole();
  } else {
    showToast('✗ Nesprávné heslo');
    document.getElementById('login-pw').value='';
  }
}

// Sub sync — čte přímo z GitHub bez write tokenu
async function syncNowSub(){
  setSS('syncing','↻ sync...');
  try{
    // raw GitHub přes API s tokenem (token je uložen pro doma, sub ho nemá)
    // Použijeme uložený token pokud existuje, jinak public raw
    const t=localStorage.getItem('gh_token');
    const headers=t?{Authorization:`token ${t}`,Accept:'application/vnd.github.v3+json'}:{Accept:'application/vnd.github.v3+json'};
    const r=await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`,{headers});
    if(!r.ok) throw new Error('Nepodařilo se načíst data');
    const f=await r.json();
    sha=f.sha;
    state=await decrypt(decodeURIComponent(escape(atob(f.content.replace(/\n/g,'')))),encPw);
    if(!state.activePunishments) state.activePunishments=[];
    renderAll();setSS('synced','✓ synced');
  }catch(e){setSS('error','✗ chyba');showToast('✗ Sync selhal — '+e.message);}
}

// ── ROLE APLIKACE ──────────────────────────────────────────────────────
function applyRole(){
  const isDom=role==='dom';

  // Header role badge
  document.getElementById('role-badge').textContent=isDom?'DOM':'SUB';
  document.getElementById('role-badge').className='role-badge '+(isDom?'dom':'sub');

  // Quick action tlačítka — sub vidí ale zablokovaná
  document.querySelectorAll('.qa-locked').forEach(el=>{
    el.style.opacity=isDom?'1':'0.45';
    el.style.pointerEvents=isDom?'auto':'none';
    el.title=isDom?'':el.getAttribute('data-locked-msg')||'Pouze pro Dom';
  });

  // Záložka nastavení — sub nevidí
  const settingsTab=document.getElementById('tab-settings');
  settingsTab.style.display=isDom?'':'none';

  // Add form tlačítka v legendě — sub nevidí
  document.querySelectorAll('.dom-only').forEach(el=>{
    el.style.display=isDom?'':'none';
  });

  // Tlačítko přepnutí role
  document.getElementById('role-switch-btn').style.display=isDom?'none':'';

  // Spustit countdown aktivních trestů
  startCountdown();
}

// ── ROLE SWITCH (Sub → Dom přes PIN) ───────────────────────────────────
function requestDomAccess(){
  document.getElementById('pin-modal').classList.add('open');
  document.getElementById('pin-input').value='';
  setTimeout(()=>document.getElementById('pin-input').focus(),300);
}

function submitPin(){
  const pin=document.getElementById('pin-input').value;
  if(pin===encPw){
    role='dom';
    document.getElementById('pin-modal').classList.remove('open');
    applyRole();
    showToast('✓ Dom režim aktivní');
  } else {
    showToast('✗ Nesprávný PIN');
    document.getElementById('pin-input').value='';
  }
}

function switchToSub(){
  role='sub';
  applyRole();
  showToast('Sub režim aktivní');
}

// ── ACTIVE PUNISHMENTS ─────────────────────────────────────────────────
function startCountdown(){
  if(countdownInterval) clearInterval(countdownInterval);
  renderActivePunishments();
  countdownInterval=setInterval(renderActivePunishments,1000);
}

function renderActivePunishments(){
  const list=document.getElementById('active-punishments-list');
  if(!list) return;
  const now=Date.now();

  // Vyčistit expirované
  const before=state.activePunishments.length;
  state.activePunishments=state.activePunishments.filter(p=>new Date(p.until).getTime()>now);
  if(state.activePunishments.length!==before && role==='dom') save();

  if(!state.activePunishments.length){
    list.innerHTML='<div class="empty"><div class="ei">✓</div>Žádné aktivní tresty<br><span style="font-size:11px">Sub je momentálně bez trestu</span></div>';
    document.getElementById('active-count').textContent='';
    return;
  }

  document.getElementById('active-count').textContent=state.activePunishments.length;

  list.innerHTML=state.activePunishments.map(p=>{
    const until=new Date(p.until).getTime();
    const diff=Math.max(0,until-now);
    const d=Math.floor(diff/86400000);
    const h=Math.floor((diff%86400000)/3600000);
    const m=Math.floor((diff%3600000)/60000);
    const s=Math.floor((diff%60000)/1000);
    const countdown=d>0?`${d}d ${h}h ${m}m`:`${h}h ${m}m ${s}s`;
    const urgent=diff<3600000; // méně než hodina
    return `
      <div class="ap-item">
        <div class="ap-info">
          <div class="ap-name">${p.name}</div>
          <div class="ap-until">do ${new Date(p.until).toLocaleDateString('cs-CZ')} ${new Date(p.until).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'})}</div>
        </div>
        <div class="ap-countdown ${urgent?'urgent':''}">${countdown}</div>
        ${role==='dom'?`<button class="bm d" onclick="removeActivePunishment('${p.id}')">✕</button>`:''}
      </div>`;
  }).join('');
}

function openAddActivePunishment(){
  document.getElementById('ap-modal').classList.add('open');
  document.getElementById('ap-name').value='';
  // Default: zítra ve stejnou hodinu
  const tomorrow=new Date(Date.now()+86400000);
  tomorrow.setSeconds(0,0);
  document.getElementById('ap-until').value=tomorrow.toISOString().slice(0,16);
}

async function addActivePunishment(){
  const name=document.getElementById('ap-name').value.trim();
  const until=document.getElementById('ap-until').value;
  if(!name||!until){showToast('✗ Vyplň název i datum');return;}
  if(new Date(until).getTime()<=Date.now()){showToast('✗ Datum musí být v budoucnosti');return;}
  if(!state.activePunishments) state.activePunishments=[];
  state.activePunishments.push({id:uid(),name,until,addedAt:new Date().toISOString()});
  document.getElementById('ap-modal').classList.remove('open');
  renderActivePunishments();
  await save();
  showToast('✓ Aktivní trest přidán');
}

async function removeActivePunishment(id){
  if(!confirm('Ukončit tento trest předčasně?')) return;
  state.activePunishments=state.activePunishments.filter(x=>x.id!==id);
  renderActivePunishments();
  await save();
}

// ── INIT ───────────────────────────────────────────────────────────────
async function init(){
  const t=localStorage.getItem('gh_token');
  const p=localStorage.getItem('enc_pw');
  const sp=localStorage.getItem('sub_pw');
  const th=localStorage.getItem('theme')||'dark';
  setTheme(th);

  if(t&&p&&sp){
    ghToken=t;encPw=p;subPw=sp;
    // Zobraz login screen pro výběr role
    document.getElementById('ls').style.display='none';
    showLoginScreen();
  } else if(t&&p&&!sp){
    // Stará konfigurace bez sub hesla — přesměruj na setup
    document.getElementById('ls').style.display='none';
    document.getElementById('ss').style.display='flex';
  } else {
    document.getElementById('ls').style.display='none';
    document.getElementById('ss').style.display='flex';
  }
}

// ── DEFAULTS ───────────────────────────────────────────────────────────
function setDefaults(){
  state.activePunishments=[];
  state.legend=[
    {id:uid(),name:'Splněný denní úkol',pts:10,type:'reward'},
    {id:uid(),name:'Splněný týdenní úkol',pts:25,type:'reward'},
    {id:uid(),name:'Výjimečné chování',pts:50,type:'reward'},
    {id:uid(),name:'Nesplněný úkol',pts:-15,type:'punishment'},
    {id:uid(),name:'Porušení pravidla',pts:-30,type:'punishment'},
  ];
  state.rewards=[
    {id:uid(),name:'🎬 Výběr večerního filmu',cost:50},
    {id:uid(),name:'🍫 Oblíbená sladkost',cost:30},
    {id:uid(),name:'💆 Masáž',cost:80},
    {id:uid(),name:'🌟 Volný večer',cost:100},
  ];
  state.punishments=[
    {id:uid(),name:'📝 Psaní věty 20×',cost:20},
    {id:uid(),name:'📵 Bez telefonu 2 hodiny',cost:15},
    {id:uid(),name:'🛌 Brzy spát bez zábavy',cost:25},
  ];
}

function logout(){
  if(!confirm('Odhlásit a smazat přihlašovací údaje?')) return;
  localStorage.clear();location.reload();
}

async function changePassword(){
  const p=prompt('Nové Dom heslo (min. 6 znaků):');
  if(!p||p.length<6){showToast('✗ Příliš krátké heslo');return;}
  encPw=p;localStorage.setItem('enc_pw',p);await save();showToast('✓ Dom heslo změněno');
}

async function changeSubPassword(){
  const p=prompt('Nové Sub heslo (min. 4 znaky):');
  if(!p||p.length<4){showToast('✗ Příliš krátké heslo');return;}
  if(p===encPw){showToast('✗ Sub heslo musí být jiné než Dom heslo');return;}
  subPw=p;localStorage.setItem('sub_pw',p);showToast('✓ Sub heslo změněno');
}

// ── RENDER ─────────────────────────────────────────────────────────────
function renderAll(){
  renderScore();renderTodo();renderLegend();renderHistory();renderRewards();renderActivePunishments();
}

function renderScore(){
  const e=document.getElementById('score');
  e.textContent=state.score;e.className='sval'+(state.score<0?' neg':'');
  document.getElementById('splus').textContent=state.totalPlus;
  document.getElementById('sminus').textContent=state.totalMinus;
}

function renderTodo(){
  const l=document.getElementById('tlist'),c=document.getElementById('tcnt');
  const done=state.todos.filter(t=>t.done).length;
  c.textContent=`${done}/${state.todos.length}`;
  if(!state.todos.length){
    l.innerHTML='<div class="empty"><div class="ei">📋</div>Žádné úkoly<br><span style="font-size:11px">Přidej první úkol níže</span></div>';
    return;
  }
  l.innerHTML=state.todos.map(t=>`
    <div class="ti ${t.done?'done':''}" onclick="toggleTodo('${t.id}')">
      <div class="tck">${t.done?'✓':''}</div>
      <div class="ttx"><div class="tn">${t.name}</div>${t.pts?`<div class="tp">+${t.pts} bodů</div>`:''}</div>
      ${role==='dom'?`<button class="bm d" onclick="event.stopPropagation();delTodo('${t.id}')">✕</button>`:''}
    </div>`).join('');
}

function renderLegend(){
  const l=document.getElementById('llist');
  if(!state.legend.length){l.innerHTML='<div class="empty"><div class="ei">📖</div>Prázdná legenda</div>';return;}
  l.innerHTML=state.legend.map(x=>`
    <div class="li">
      <span class="lb ${x.type==='reward'?'lr':'lp'}">${x.type==='reward'?'odměna':'trest'}</span>
      <span class="ln">${x.name}</span>
      <span class="lv ${x.pts>0?'vp':'vn'}">${x.pts>0?'+':''}${x.pts}</span>
      ${role==='dom'?`<button class="bm d" onclick="delLegend('${x.id}')">✕</button>`:''}
    </div>`).join('');
}

function renderHistory(){
  const l=document.getElementById('hlist');
  if(!state.history.length){l.innerHTML='<div class="empty"><div class="ei">🕐</div>Žádná historie</div>';return;}
  l.innerHTML=[...state.history].reverse().map(h=>`
    <div class="hsti">
      <div class="hd" style="background:${h.pts>0?'var(--green)':'var(--red)'}"></div>
      <div class="hi2"><div class="hn">${h.reason||(h.pts>0?'Body přidány':'Body odebrány')}</div><div class="htm">${h.time}</div></div>
      <div class="hv" style="color:${h.pts>0?'var(--green)':'var(--red)'}">${h.pts>0?'+':''}${h.pts}</div>
    </div>`).join('');
}

function renderRewards(){
  const rl=document.getElementById('rlist'),pl=document.getElementById('plist');
  document.getElementById('rscore').textContent=`Body: ${state.score}`;
  rl.innerHTML=state.rewards.length
    ?state.rewards.map(r=>{
      const ok=state.score>=r.cost;
      const canUse=ok&&role==='dom';
      return `<div class="rpi">
        <div class="rpi2"><div class="rn">${r.name}</div><div class="rc">${r.cost} bodů${!ok?` · chybí ${r.cost-state.score}`:''}</div></div>
        <button class="rpb${ok?(role==='dom'?'':' na'):' na'}"
          onclick="${canUse?`useReward('${r.id}')`:''}"
          title="${role==='sub'?'Pouze Dom může uplatnit odměnu':''}">
          ${ok?(role==='dom'?'Uplatnit':'🔒 Dom'):'✗ Málo bodů'}
        </button>
        ${role==='dom'?`<button class="bm d" onclick="delReward('${r.id}')">✕</button>`:''}
      </div>`;}).join('')
    :'<div class="empty" style="padding:20px"><div class="ei">🏆</div>Žádné odměny</div>';

  pl.innerHTML=state.punishments.length
    ?state.punishments.map(p=>`
      <div class="rpi">
        <div class="rpi2"><div class="rn">${p.name}</div><div class="rc">${p.cost} bodů</div></div>
        ${role==='dom'?`
          <button class="rpb" onclick="usePunishment('${p.id}')" style="border-color:rgba(201,110,110,.3);color:var(--red)">Aplikovat</button>
          <button class="bm d" onclick="delPunishment('${p.id}')">✕</button>
        `:''}
      </div>`).join('')
    :'<div class="empty" style="padding:20px"><div class="ei">⚡</div>Žádné tresty</div>';
}

// ── ACTIONS ────────────────────────────────────────────────────────────
function uid(){return Math.random().toString(36).slice(2,9)}
function ts(){const n=new Date();return n.toLocaleDateString('cs-CZ')+' '+n.toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'})}

async function addPoints(pts,reason){
  if(role!=='dom'){showToast('🔒 Pouze Dom může měnit body');return;}
  state.score+=pts;
  if(pts>0)state.totalPlus+=pts;else state.totalMinus+=Math.abs(pts);
  state.history.push({id:uid(),pts,reason,time:ts()});
  renderAll();await save();
}

async function toggleTodo(id){
  const t=state.todos.find(x=>x.id===id);if(!t)return;
  // Sub může zaškrtnout splnění, ale ne odšrtnout
  if(role==='sub'&&t.done){showToast('🔒 Splněný úkol může odškrtnout jen Dom');return;}
  t.done=!t.done;renderTodo();
  if(t.done&&t.pts) await addPoints(t.pts,`✓ ${t.name}`);
  else await save();
}

async function addTodo(){
  if(role!=='dom'){showToast('🔒 Pouze Dom může přidávat úkoly');return;}
  const n=document.getElementById('t-name').value.trim();
  const p=parseInt(document.getElementById('t-pts').value)||0;
  if(!n)return;
  state.todos.push({id:uid(),name:n,pts:p,done:false});
  document.getElementById('t-name').value='';document.getElementById('t-pts').value='';
  renderTodo();await save();
}

async function delTodo(id){state.todos=state.todos.filter(x=>x.id!==id);renderTodo();await save();}

async function addLegend(){
  const n=document.getElementById('l-name').value.trim();
  const pr=parseInt(document.getElementById('l-pts').value)||0;
  const type=document.getElementById('l-type').value;
  if(!n)return;
  const pts=type==='punishment'?-Math.abs(pr):Math.abs(pr);
  state.legend.push({id:uid(),name:n,pts,type});
  document.getElementById('l-name').value='';document.getElementById('l-pts').value='';
  renderLegend();await save();
}
async function delLegend(id){state.legend=state.legend.filter(x=>x.id!==id);renderLegend();await save();}

async function addReward(){
  const n=document.getElementById('r-name').value.trim();
  const c=parseInt(document.getElementById('r-cost').value)||0;
  if(!n)return;
  state.rewards.push({id:uid(),name:n,cost:c});
  document.getElementById('r-name').value='';document.getElementById('r-cost').value='';
  renderRewards();await save();
}
async function delReward(id){state.rewards=state.rewards.filter(x=>x.id!==id);renderRewards();await save();}
async function useReward(id){
  if(role!=='dom'){showToast('🔒 Pouze Dom může uplatnit odměnu');return;}
  const r=state.rewards.find(x=>x.id===id);if(!r)return;
  if(state.score<r.cost){showToast('✗ Nedostatek bodů');return;}
  if(confirm(`Uplatnit "${r.name}" za ${r.cost} bodů?`))await addPoints(-r.cost,`🏆 ${r.name}`);
}

async function addPunishment(){
  const n=document.getElementById('p-name').value.trim();
  const c=parseInt(document.getElementById('p-cost').value)||0;
  if(!n)return;
  state.punishments.push({id:uid(),name:n,cost:c});
  document.getElementById('p-name').value='';document.getElementById('p-cost').value='';
  renderRewards();await save();
}
async function delPunishment(id){state.punishments=state.punishments.filter(x=>x.id!==id);renderRewards();await save();}
async function usePunishment(id){
  if(role!=='dom'){showToast('🔒 Pouze Dom může udělit trest');return;}
  const p=state.punishments.find(x=>x.id===id);if(!p)return;
  if(confirm(`Udělit trest "${p.name}" (−${p.cost} bodů)?`))await addPoints(-p.cost,`⚡ ${p.name}`);
}

async function clearHistory(){if(!confirm('Vymazat historii?'))return;state.history=[];renderHistory();await save();}
async function resetScore(){
  if(role!=='dom'){showToast('🔒 Pouze Dom může resetovat skóre');return;}
  if(!confirm('Vynulovat skóre?'))return;
  state.score=0;state.totalPlus=0;state.totalMinus=0;renderScore();await save();
}

// ── MODAL (body) ───────────────────────────────────────────────────────
function openModal(m){
  if(role!=='dom'){showToast('🔒 Pouze Dom může měnit body');return;}
  modalMode=m;
  document.getElementById('modal-t').textContent=m==='add'?'+ Přidat body':'− Odebrat body';
  document.getElementById('m-ok').className='bc '+(m==='add'?'pos':'neg');
  document.getElementById('m-pts').value='';document.getElementById('m-rsn').value='';
  document.getElementById('modal').classList.add('open');
  setTimeout(()=>document.getElementById('m-pts').focus(),300);
}
function closeModal(){document.getElementById('modal').classList.remove('open')}
function cmo(e){if(e.target.id==='modal')closeModal()}
async function confirmModal(){
  const p=parseInt(document.getElementById('m-pts').value);
  if(!p||p<=0)return;
  const r=document.getElementById('m-rsn').value.trim();
  closeModal();await addPoints(modalMode==='add'?p:-p,r);
}

// ── TABS ───────────────────────────────────────────────────────────────
function sw(n){
  const ns=['todo','legend','history','rewards','active','settings'];
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',ns[i]===n));
  document.querySelectorAll('.sec').forEach(s=>s.classList.remove('active'));
  document.getElementById('sec-'+n).classList.add('active');
}

// ── TOAST ──────────────────────────────────────────────────────────────
function showToast(m){
  const t=document.getElementById('toast');
  t.textContent=m;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2800);
}

// ── ENTER ──────────────────────────────────────────────────────────────
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    if(document.getElementById('modal').classList.contains('open')) confirmModal();
    if(document.getElementById('pin-modal').classList.contains('open')) submitPin();
    if(document.getElementById('ap-modal').classList.contains('open')) addActivePunishment();
    if(document.getElementById('login-screen').style.display!=='none') loginSubmit();
  }
});

init();
