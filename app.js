const OWNER='Griimiik', REPO='ds-todo', FILE='data.json';
const RAW_URL=`https://raw.githubusercontent.com/${OWNER}/${REPO}/main/${FILE}`;

let state={score:0,totalPlus:0,totalMinus:0,todos:[],legend:[],history:[],rewards:[],punishments:[],trips:[],completedTrips:[],activePunishments:[],activeRewards:[],ideas:[],bank:[]};
let ghToken='', encPw='', subPw='', modalMode='add', sha=null, theme='dark';
let role='';
let countdownInterval=null;

// Detekce Sub URL — parsuj hash: #sub&token=ghp_xxx&enc=XXXXX
function parseSubHash(){
  const hash=window.location.hash.slice(1);
  if(!hash.startsWith('sub')) return null;
  const params={};
  hash.split('&').forEach(part=>{
    const [k,v]=part.split('=');
    if(k&&v) params[k]=decodeURIComponent(v);
  });
  return params;
}
const subHashParams=parseSubHash();

// ── THEME ──────────────────────────────────────────────────────────────
function setTheme(t){
  theme=t;
  if(t==='dark') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme',t);
  localStorage.setItem('theme',t);
  document.querySelectorAll('.tb').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tb-'+t).forEach(b=>b.classList.add('active'));
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

async function ghGetRaw(){
  if(ghToken){
    const r=await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}?nocache=`+Date.now(),
      {headers:{Authorization:`token ${ghToken}`,Accept:'application/vnd.github.v3+json'}});
    if(!r.ok) throw new Error('Nepodařilo se načíst data');
    const f=await r.json();
    sha=f.sha;
    return decodeURIComponent(escape(atob(f.content.replace(/\n/g,''))));
  } else {
    const r=await fetch(RAW_URL+'?nocache='+Date.now());
    if(!r.ok) throw new Error('Nepodařilo se načíst data');
    return r.text();
  }
}

// ── SYNC ───────────────────────────────────────────────────────────────
function setSS(s,t){const e=document.getElementById('sync-s');e.textContent=t;e.className='ss2 '+s}

async function syncNow(){
  setSS('syncing','↻ sync...');
  try{
    if(role==='sub'){
      const raw=await ghGetRaw();
      state=await decrypt(raw.trim(),encPw);
    } else {
      const f=await ghGet();
      if(f){
        sha=f.sha;
        state=await decrypt(decodeURIComponent(escape(atob(f.content.replace(/\n/g,'')))),encPw);
      }
    }
    if(!state.activePunishments) state.activePunishments=[];
    if(!state.activeRewards) state.activeRewards=[];
    if(!state.ideas) state.ideas=[];
    if(!state.bank) state.bank=[];
    if(!state.trips) state.trips=[];
    if(!state.completedTrips) state.completedTrips=[];
    if(!state.rollLog) state.rollLog={};
    checkAutoReset();
    renderAll();setSS('synced','✓ synced');showToast('✓ Data synchronizována');
  }catch(e){setSS('error','✗ chyba');showToast('✗ Sync selhal — '+e.message);}
}

async function save(){
  setSS('syncing','↑ ukládám...');
  try{
    if(!sha){const f=await ghGet();if(f) sha=f.sha;}
    await ghPut(await encrypt(state,encPw));
    setSS('synced','✓ uloženo');
  }catch(e){
    if(e.message.includes('PUT')){
      try{
        const f=await ghGet();if(f) sha=f.sha;
        await ghPut(await encrypt(state,encPw));
        setSS('synced','✓ uloženo');
      }catch(e2){setSS('error','✗ chyba');showToast('✗ Uložení selhalo — '+e2.message);}
    } else {setSS('error','✗ chyba');showToast('✗ Uložení selhalo — '+e.message);}
  }
}

// ── SETUP (Dom — první spuštění) ───────────────────────────────────────
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

  role='dom';
  await syncNow();
  if(!sha){setDefaults();await save();}

  document.getElementById('ls').style.display='none';
  document.getElementById('app').style.display='block';
  applyRole();
}

// ── SUB LOGIN ──────────────────────────────────────────────────────────
async function subLogin(){
  const pw=document.getElementById('sub-login-pw').value;
  if(!pw){showToast('✗ Zadej Sub heslo');return;}

  const storedSubPw=localStorage.getItem('sub_pw');
  const storedEncPw=localStorage.getItem('enc_pw');
  const storedToken=localStorage.getItem('gh_token');

  if(!storedEncPw||!storedToken){
    showToast('✗ Chybí přístupové údaje v URL — požádej Dom o nový odkaz');
    return;
  }

  if(!storedSubPw){
    try{
      const raw=await ghGetRaw();
      await decrypt(raw.trim(), storedEncPw);
      localStorage.setItem('sub_pw', pw);
    }catch(e){
      showToast('✗ Nepodařilo se ověřit — zkontroluj URL odkaz');
      return;
    }
  } else {
    if(pw!==storedSubPw){showToast('✗ Nesprávné Sub heslo');return;}
  }

  ghToken=storedToken;
  encPw=storedEncPw;
  role='sub';

  document.getElementById('sub-login').style.display='none';
  document.getElementById('ls').style.display='flex';
  document.getElementById('lt').textContent='Načítám data...';

  await syncNow();

  document.getElementById('ls').style.display='none';
  document.getElementById('app').style.display='block';
  applyRole();
}

// ── DOM LOGIN ──────────────────────────────────────────────────────────
async function domLogin(){
  const pw=document.getElementById('dom-login-pw').value;
  if(!pw){showToast('✗ Zadej Dom heslo');return;}

  const storedEncPw=localStorage.getItem('enc_pw');
  const storedToken=localStorage.getItem('gh_token');

  if(!storedEncPw||!storedToken){
    showToast('✗ Dom přihlášení nebylo nalezeno');return;
  }

  if(pw!==storedEncPw){showToast('✗ Nesprávné Dom heslo');return;}

  ghToken=storedToken;encPw=storedEncPw;
  role='dom';

  document.getElementById('dom-login').style.display='none';
  document.getElementById('ls').style.display='flex';
  document.getElementById('lt').textContent='Synchronizuji...';

  await syncNow();

  document.getElementById('ls').style.display='none';
  document.getElementById('app').style.display='block';
  applyRole();
}

// ── INIT ───────────────────────────────────────────────────────────────
async function init(){
  const th=localStorage.getItem('theme')||'dark';
  setTheme(th);

  if(subHashParams && subHashParams.token && subHashParams.enc){
    // Sub URL s tokenem — přihlásit automaticky bez hesla
    ghToken=subHashParams.token;
    encPw=subHashParams.enc;
    // Ulož pro příští návštěvy (stejná URL)
    localStorage.setItem('gh_token', subHashParams.token);
    localStorage.setItem('enc_pw', subHashParams.enc);
    role='sub';
    showScreen('ls');
    document.getElementById('lt').textContent='Načítám data...';
    await syncNow();
    document.getElementById('ls').style.display='none';
    document.getElementById('app').style.display='block';
    applyRole();
  } else {
    // Normální URL — Dom přihlášení
    document.getElementById('ls').style.display='none';
    const hasSetup=localStorage.getItem('gh_token')&&localStorage.getItem('enc_pw');
    if(!hasSetup){
      showScreen('ss');
    } else {
      showScreen('dom-login');
    }
  }
}

function showScreen(id){
  ['ss','dom-login','sub-bootstrap','ls','app'].forEach(s=>{
    const el=document.getElementById(s);
    if(el) el.style.display='none';
  });
  const target=document.getElementById(id);
  if(target) target.style.display='flex';
}

// ── ROLE APLIKACE ──────────────────────────────────────────────────────
function applyRole(){
  const isDom=role==='dom';

  document.getElementById('role-badge').textContent=isDom?'DOM':'SUB';
  document.getElementById('role-badge').className='role-badge '+(isDom?'dom':'sub');
  const icon=document.getElementById('role-icon');
  if(icon) icon.textContent=isDom?'🔑':'🦮';

  document.querySelectorAll('.qa-locked').forEach(el=>{
    el.style.opacity=isDom?'1':'0.45';
    el.style.pointerEvents=isDom?'auto':'none';
  });

  document.querySelectorAll('.dom-only').forEach(el=>{
    el.style.display=isDom?'':'none';
  });

  const rsb=document.getElementById('role-switch-btn');
  if(rsb) rsb.style.display=isDom?'none':'';

  startCountdown();
}

function requestDomAccess(){
  document.getElementById('pin-modal').classList.add('open');
  document.getElementById('pin-input').value='';
  setTimeout(()=>document.getElementById('pin-input').focus(),300);
}

function submitPin(){
  const pin=document.getElementById('pin-input').value;
  const storedEncPw=localStorage.getItem('enc_pw');
  const storedToken=localStorage.getItem('gh_token');
  if(pin===storedEncPw){
    ghToken=storedToken;encPw=storedEncPw;
    role='dom';
    document.getElementById('pin-modal').classList.remove('open');
    applyRole();
    showToast('✓ Dom režim aktivní');
  } else {
    showToast('✗ Nesprávné heslo');
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
  const pList=document.getElementById('active-punishments-list');
  const rList=document.getElementById('active-rewards-list');
  if(!pList) return;
  const now=Date.now();

  // Badge počet — časové tresty se už neodstraňují automaticky
  const countEl=document.getElementById('active-count');
  const total=(state.activePunishments?.length||0)+(state.activeRewards?.length||0);
  if(countEl) countEl.textContent=total||'';

  // ── TRESTY ──
  if(!state.activePunishments||!state.activePunishments.length){
    pList.innerHTML='<div class="empty" style="padding:20px 10px"><div class="ei">✓</div>Žádné tresty</div>';
  } else {
    pList.innerHTML=state.activePunishments.map(p=>{
      let timeInfo='';
      if(p.type==='task'){
        timeInfo=`<div class="ap-until">Ke splnění</div>`;
      } else {
        const until=new Date(p.until).getTime();
        const diff=until-now;
        const expired=diff<=0;
        if(expired){
          timeInfo=`<div class="ap-until" style="color:var(--red)">⏰ Čas vypršel!</div>`;
        } else {
          const d=Math.floor(diff/86400000);
          const h=Math.floor((diff%86400000)/3600000);
          const m=Math.floor((diff%3600000)/60000);
          const s=Math.floor((diff%60000)/1000);
          const countdown=d>0?`${d}d ${h}h ${m}m`:`${h}h ${m}m ${s}s`;
          const urgent=diff<3600000;
          timeInfo=`<div class="ap-until">do ${new Date(p.until).toLocaleDateString('cs-CZ')} ${new Date(p.until).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'})}</div>
                    <div class="ap-countdown${urgent?' urgent':''}">${countdown}</div>`;
        }
      }
      const penaltyInfo=p.cost?`<div style="font-size:10px;color:var(--red);margin-top:2px">Penalizace: −${p.cost} bodů</div>`:'';
      return `
        <div class="ap-item">
          <div class="ap-info">
            <div class="ap-name">${p.name}</div>
            ${timeInfo}
            ${penaltyInfo}
          </div>
          ${role==='dom'?`
            <div style="display:flex;flex-direction:column;gap:4px">
              <button class="bm done-btn" onclick="completeActivePunishment('${p.id}')" title="Trest splněn — bez penalizace">✓ Splněn</button>
              <button class="bm d" style="color:var(--red);border-color:rgba(201,110,110,.3)" onclick="failActivePunishment('${p.id}')" title="Trest nesplněn — odečíst body">✗ Nesplněn</button>
            </div>`:''}
        </div>`;
    }).join('');
  }

  // ── ODMĚNY ──
  if(!rList) return;
  if(!state.activeRewards||!state.activeRewards.length){
    rList.innerHTML='<div class="empty" style="padding:20px 10px"><div class="ei">🎁</div>Žádné odměny</div>';
  } else {
    rList.innerHTML=state.activeRewards.map(r=>`
      <div class="ap-item">
        <div class="ap-info">
          <div class="ap-name">${r.name}</div>
          <div class="ap-until">Uplatněno ${new Date(r.usedAt).toLocaleDateString('cs-CZ')}</div>
        </div>
        <button class="bm done-btn" onclick="completeActiveReward('${r.id}')" title="Splněno">✓</button>
        ${role==='dom'?`<button class="bm d" onclick="removeActiveReward('${r.id}')">✕</button>`:''}
      </div>`).join('');
  }
}

async function removeActiveReward(id){
  state.activeRewards=state.activeRewards.filter(x=>x.id!==id);
  renderActivePunishments();
  await save();
}

let apType='expiry';

function setApType(t){
  apType=t;
  document.getElementById('ap-btn-expiry').classList.toggle('active',t==='expiry');
  document.getElementById('ap-btn-task').classList.toggle('active',t==='task');
  document.getElementById('ap-expiry-row').style.display=t==='expiry'?'':'none';
}

function openAddActivePunishment(){
  document.getElementById('ap-modal').classList.add('open');
  document.getElementById('ap-name').value='';
  apType='expiry';
  setApType('expiry');
  const tomorrow=new Date(Date.now()+86400000);
  tomorrow.setSeconds(0,0);
  document.getElementById('ap-until').value=tomorrow.toISOString().slice(0,16);
}

async function addActivePunishment(){
  const nameEl=document.getElementById('ap-name');
  const name=nameEl.value.trim();
  // Získáme body, které jsme si schovali v kroku 1
  const cost=parseInt(nameEl.dataset.cost)||0; 
  
  if(!name){showToast('✗ Zadej název trestu');return;}
  
  const newPunishment = {
    id: uid(),
    name: name,
    cost: cost, // Zde se ukládá potenciální pokuta
    addedAt: new Date().toISOString()
  };

  if(apType==='expiry'){
    const until=document.getElementById('ap-until').value;
    if(!until){showToast('✗ Zadej datum');return;}
    newPunishment.until = until;
    newPunishment.type = 'expiry';
  } else {
    newPunishment.type = 'task';
  }

  if(!state.activePunishments) state.activePunishments=[];
  state.activePunishments.push(newPunishment);
  
  // Vyčistíme modal
  nameEl.value = '';
  nameEl.dataset.cost = ''; 
  
  document.getElementById('ap-modal').classList.remove('open');
  renderActivePunishments();
  await save();
  showToast('⛓️ Trest přesunut do aktivních. Body se strhnou jen při nesplnění.');
}

async function removeActivePunishment(id){
  if(!confirm('Odstranit tento trest?')) return;
  state.activePunishments=state.activePunishments.filter(x=>x.id!==id);
  renderActivePunishments();
  await save();
}

async function completeActivePunishment(id){
  if(role!=='dom'){showToast('🔒 Pouze Dom může hodnotit trest');return;}
  const p=state.activePunishments.find(x=>x.id===id);if(!p)return;
  
  if(!confirm(`Trest "${p.name}" byl SPLNĚN?\nŽádné body se NEODEČTOU.`)) return;
  
  state.activePunishments=state.activePunishments.filter(x=>x.id!==id);
  renderActivePunishments();
  await save();
  showToast('✓ Trest splněn — skóre zůstává.');
}

async function failActivePunishment(id){
  if(role!=='dom'){showToast('🔒 Pouze Dom může hodnotit trest');return;}
  const p=state.activePunishments.find(x=>x.id===id);if(!p)return;
  
  const penalty = p.cost || 0;
  if(!confirm(`Trest "${p.name}" NEBYL splněn?\nBude odečteno ${penalty} bodů.`)) return;
  
  state.activePunishments=state.activePunishments.filter(x=>x.id!==id);
  
  if(penalty > 0) {
    // Teď reálně strhneme body
    await addPoints(-penalty, `⛓️ Trest nesplněn: ${p.name}`);
  } else {
    renderActivePunishments();
    await save();
  }
  showToast(`✗ Trest nesplněn — odečteno ${penalty} bodů.`);
}

async function completeActiveReward(id){
  state.activeRewards=state.activeRewards.filter(x=>x.id!==id);
  renderActivePunishments();
  await save();
  showToast('✓ Odměna splněna');
}

// ── DEFAULTS ───────────────────────────────────────────────────────────
function setDefaults(){
  state.activePunishments=[];
  state.activeRewards=[];
  state.lastDailyReset = "";   // PŘIDÁNO
  state.lastWeeklyReset = "";  // PŘIDÁNO
  state.ideas=[];
  state.bank=[];
  state.legend=[];
  state.trips=[];
  state.completedTrips=[];
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

function copySubUrl(){
  const token=localStorage.getItem('gh_token')||'';
  const enc=localStorage.getItem('enc_pw')||'';
  const base=window.location.origin+window.location.pathname;
  const url=`${base}#sub&token=${encodeURIComponent(token)}&enc=${encodeURIComponent(enc)}`;
  navigator.clipboard.writeText(url)
    .then(()=>showToast('✓ Sub URL zkopírována — pošli ji Sub'))
    .catch(()=>{
      prompt('Zkopíruj tuto Sub URL a pošli Sub:',url);
    });
}

async function changeSubPassword(){
  const p=prompt('Nové Sub heslo (min. 4 znaky):');
  if(!p||p.length<4){showToast('✗ Příliš krátké heslo');return;}
  if(p===encPw){showToast('✗ Sub heslo musí být jiné než Dom heslo');return;}
  subPw=p;localStorage.setItem('sub_pw',p);showToast('✓ Sub heslo změněno');
}

// ── RENDER ─────────────────────────────────────────────────────────────
function renderAll(){
  renderScore();renderTodo();renderIdeas();renderHistory();renderRewards();renderTrips();renderActivePunishments();renderBank();
}

function renderScore(){
  const e=document.getElementById('score');
  e.textContent=state.score;e.className='sval'+(state.score<0?' neg':'');
  document.getElementById('splus').textContent=state.totalPlus;
  document.getElementById('sminus').textContent=state.totalMinus;
}

// ── BEZPEČNÝ AUTO REFRESH (SYNCHRONIZOVANÝ) ──────────────────────────
async function checkAutoReset() {
  const now = new Date();
  const todayStr = now.toDateString();
  const weekStr = `${now.getFullYear()}-W${getWeekNumber(now)}`;
  
  // DŮLEŽITÉ: Kontrolujeme datum přímo v datech ze serveru (state), 
  // ne v lokální paměti prohlížeče, aby DOM i SUB viděli totéž.
  let changed = false;

  // 1. DENNÍ REFRESH
  if (state.lastDailyReset !== todayStr) {
    state.todos = state.todos.filter(t => t.type !== 'daily');
    autoFillFromBank('daily', 5);
    
    // Zapíšeme datum resetu přímo do sdíleného state
    state.lastDailyReset = todayStr;
    changed = true;
  }

  // 2. TÝDENNÍ REFRESH
  if (state.lastWeeklyReset !== weekStr) {
    state.todos = state.todos.filter(t => t.type !== 'weekly');
    autoFillFromBank('weekly', 5);
    
    // Zapíšeme týden resetu přímo do sdíleného state
    state.lastWeeklyReset = weekStr;
    changed = true;
  }

  if (changed) {
    // Kdo je první (Sub nebo Dom), ten uloží novou sadu úkolů pro oba
    await save();
    renderAll();
    showToast('✨ Úkoly pro tento cyklus byly vygenerovány');
  }
}

// Pomocná funkce pro losování z banky
function autoFillFromBank(type, count) {
  const pool = (state.bank || []).filter(b => b.type === type);
  if (!pool.length) return;

  const shuffled = [...pool].sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, count);

  selected.forEach(picked => {
    state.todos.push({
      id: uid(),
      name: picked.name,
      pts: picked.pts,
      done: false,
      type: type
    });
  });
}

function getWeekNumber(d){
  const date=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
  date.setUTCDate(date.getUTCDate()+4-(date.getUTCDay()||7));
  const yearStart=new Date(Date.UTC(date.getUTCFullYear(),0,1));
  return Math.ceil((((date-yearStart)/86400000)+1)/7);
}

// Ruční přemíchání úkolů z banky (pro Dom)
async function manualRefreshTasks() {
  if (role !== 'dom') {
    showToast('🔒 Pouze Dom může úkoly přemíchat');
    return;
  }
  
  if (!confirm('Opravdu chceš smazat aktuální úkoly a vylosovat 6 nových z banky?')) return;

  // Vyčistíme aktuální seznamy
  state.todos = state.todos.filter(t => t.type !== 'daily' && t.type !== 'weekly');
  
  // Vylosujeme nové
  autoFillFromBank('daily', 5);
  autoFillFromBank('weekly', 5);
  
  await save();
  renderAll();
  showToast('🎲 Úkoly byly ručně přemíchány');
}

// ── RENDER TODO ────────────────────────────────────────────────────────
function renderTodoBlock(todos, emptyIcon, emptyText) {
  if (!todos.length) return `<div class="empty" style="padding:18px 10px"><div class="ei">${emptyIcon}</div>${emptyText}</div>`;
  return todos.map(t => {
    const parts = t.name.split('|');
    const title = parts[0].trim();
    const desc = parts[1] ? parts[1].trim() : '';

    return `
    <div class="ti ${t.done ? 'done' : ''}">
      <div class="tck" onclick="toggleTodo('${t.id}')">${t.done ? '✓' : ''}</div>
      <div class="ttx">
        <details onclick="event.stopPropagation()">
          <summary class="tn">
            ${title}
            ${desc ? '<span class="info-icon">info</span>' : ''}
          </summary>
          ${desc ? `<div class="tdesc">${desc}</div>` : ''}
        </details>
        ${t.pts ? `<div class="tp">+${t.pts} bodů</div>` : ''}
      </div>
      <div style="display:flex; gap:4px">
        ${role === 'dom' ? `<button class="bm edit-btn" onclick="event.stopPropagation();editItem('todos','${t.id}')">✎</button>` : ''}
        ${role === 'dom' ? `<button class="bm d" onclick="event.stopPropagation();delTodo('${t.id}')">✕</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

function renderTodo(){
  const active=state.todos.filter(t=>!t.type||t.type==='active');
  const daily=state.todos.filter(t=>t.type==='daily');
  const weekly=state.todos.filter(t=>t.type==='weekly');

  const total=state.todos.length;
  const done=state.todos.filter(t=>t.done).length;
  const c=document.getElementById('tcnt');
  if(c) c.textContent=`${done}/${total}`;

  const al=document.getElementById('tlist-active');
  const dl=document.getElementById('tlist-daily');
  const wl=document.getElementById('tlist-weekly');
  if(al) al.innerHTML=renderTodoBlock(active,'🎯','Žádné aktivní úkoly');
  if(dl) dl.innerHTML=renderTodoBlock(daily,'☀️','Žádné denní úkoly');
  if(wl) wl.innerHTML=renderTodoBlock(weekly,'📅','Žádné týdenní úkoly');
}

function renderIdeas(){
  const l=document.getElementById('llist');
  if(!state.ideas||!state.ideas.length){
    l.innerHTML='<div class="empty"><div class="ei">💡</div>Žádné nápady<br><span style="font-size:11px">Přidej první nápad níže</span></div>';
    return;
  }
  const typeLabels={activity:'🎯 Aktivita',punishment:'⛓️ Trest',reward:'🏆 Odměna',trip:'🌲 Výlet'};
  const subtypeLabels={active:'Aktivní',daily:'Denní',weekly:'Týdenní'};
  const typeCls={activity:'idea-tag-activity',punishment:'idea-tag-punishment',reward:'idea-tag-reward',trip:'idea-tag-trip'};
  l.innerHTML = state.ideas.map(x => {
  const parts = x.name.split('|');
  const title = parts[0].trim();
  const desc = parts[1] ? parts[1].trim() : '';

  return `
    <div class="idea-item">
      <div class="idea-checks">
        <div class="idea-check ${x.checkedDom ? 'checked' : ''}" onclick="toggleIdeaCheck('${x.id}','dom')" title="Dom souhlasí">🔑</div>
        <div class="idea-check ${x.checkedSub ? 'checked' : ''}" onclick="toggleIdeaCheck('${x.id}','sub')" title="Sub souhlasí">🦮</div>
      </div>
      <div class="idea-info">
        <details onclick="event.stopPropagation()">
          <summary class="idea-name ${x.checkedDom && x.checkedSub ? 'idea-agreed' : ''}">
            ${title}
            ${desc ? '<span class="info-icon">info</span>' : ''}
          </summary>
          ${desc ? `<div class="tdesc">${desc}</div>` : ''}
        </details>
        <div style="display:flex;gap:5px;margin-top:4px;align-items:center;flex-wrap:wrap">
          <span class="idea-type-tag ${typeCls[x.type] || ''}">${typeLabels[x.type] || x.type}</span>
          ${x.type === 'activity' && x.subtype ? `<span class="idea-type-tag" style="background:var(--bg3);color:var(--dim);border:1px solid var(--border)">${subtypeLabels[x.subtype] || x.subtype}</span>` : ''}
          ${x.checkedDom && x.checkedSub ? '<span style="font-size:9px;color:var(--green);letter-spacing:.08em">✓ oba souhlasí</span>' : ''}
        </div>
      </div>
      ${role === 'dom' ? `
        <div class="idea-dom-actions">
          <button class="badd" onclick="activateIdea('${x.id}')" style="font-size:10px;padding:5px 8px">▶ Aktivovat</button>
          <button class="bm edit-btn" onclick="editItem('ideas','${x.id}')">✎</button>
          <button class="bm d" onclick="deleteIdea('${x.id}')">✕</button>
        </div>` : ''}
    </div>`;
}).join('');
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
  const rl=document.getElementById('rlist'), pl=document.getElementById('plist');
  if (document.getElementById('rscore')) document.getElementById('rscore').textContent=`Body: ${state.score}`;
  
  rl.innerHTML=state.rewards.length
    ?state.rewards.map(r=>{
      const ok=state.score>=r.cost;
      const canUse=ok;
      return `<div class="rpi">
        <div class="rpi2">
          <div class="rn">${r.name}</div>
          <div class="rc">${r.cost} bodů${!ok?` · chybí ${r.cost-state.score}`:''}</div>
        </div>
        <div style="display:flex; gap:4px; align-items:center">
          <button class="rpb${canUse?'':' na'}" onclick="${canUse?`useReward('${r.id}')`:''}">
            ${ok?'Uplatnit':'✗ Málo bodů'}
          </button>
          ${role==='dom' ? `<button class="bm edit-btn" onclick="editItem('rewards','${r.id}')">✎</button>` : ''}
          ${role==='dom' ? `<button class="bm d" onclick="delReward('${r.id}')">✕</button>` : ''}
        </div>
      </div>`;}).join('')
    :'<div class="empty" style="padding:20px"><div class="ei">🏆</div>Žádné odměny</div>';

  pl.innerHTML=state.punishments.length
    ?state.punishments.map(p=>`
      <div class="rpi">
        <div class="rpi2"><div class="rn">${p.name}</div><div class="rc">${p.cost} bodů</div></div>
        <div style="display:flex; gap:4px; align-items:center">
          ${role==='dom'?`
            <button class="rpb" onclick="usePunishment('${p.id}')" style="border-color:rgba(201,110,110,.3);color:var(--red)">Aplikovat</button>
            <button class="bm edit-btn" onclick="editItem('punishments','${p.id}')">✎</button>
            <button class="bm d" onclick="delPunishment('${p.id}')">✕</button>`:''}
        </div>
      </div>`).join('')
    :'<div class="empty" style="padding:20px"><div class="ei">⛓️</div>Žádné tresty</div>';
}

function renderTrips(){
  const tl=document.getElementById('trips-list');
  const cl=document.getElementById('trips-completed-list');
  if(!tl) return;

  tl.innerHTML=(state.trips&&state.trips.length)
    ?state.trips.map(t=>`
      <div class="rpi">
        <div class="rpi2">
          <div class="rn">${t.name}</div>
          <div class="rc" style="color:var(--dim)">Přidáno ${new Date(t.addedAt||Date.now()).toLocaleDateString('cs-CZ')}</div>
        </div>
        <div style="display:flex; gap:4px; align-items:center">
          ${role==='dom'?`
            <button class="bm done-btn" onclick="completeTrip('${t.id}')" title="Splněno">✓</button>
            <button class="bm edit-btn" onclick="editItem('trips','${t.id}')">✎</button>
            <button class="bm d" onclick="delTrip('${t.id}')">✕</button>`:''}
        </div>
      </div>`).join('')
    :'<div class="empty" style="padding:20px"><div class="ei">🌲</div>Žádné výlety</div>';

  if(!cl) return;
  cl.innerHTML=(state.completedTrips&&state.completedTrips.length)
    ?state.completedTrips.map(t=>`
      <div class="rpi">
        <div class="rpi2">
          <div class="rn" style="text-decoration:line-through;opacity:.6">${t.name}</div>
          <div class="rc">Splněno ${new Date(t.completedAt).toLocaleDateString('cs-CZ')}</div>
        </div>
        <div style="display:flex; gap:4px; align-items:center">
          ${role==='dom'?`
            <button class="bm edit-btn" onclick="editItem('completedTrips','${t.id}')">✎</button>
            <button class="bm d" onclick="delCompletedTrip('${t.id}')">✕</button>`:''}
        </div>
      </div>`).join('')
    :'<div class="empty" style="padding:16px 10px"><div class="ei">🏁</div>Žádné splněné výlety</div>';
}

// ── ACTIONS ────────────────────────────────────────────────────────────
function uid(){return Math.random().toString(36).slice(2,9)}
function ts(){const n=new Date();return n.toLocaleDateString('cs-CZ')+' '+n.toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'})}

async function addPoints(pts,reason,force=false){
  if(role!=='dom'&&!force){showToast('🔒 Pouze Dom může měnit body');return;}
  state.score+=pts;
  if(pts>0)state.totalPlus+=pts;else state.totalMinus+=Math.abs(pts);
  state.history.push({id:uid(),pts,reason,time:ts()});
  renderAll();
  await save();
}

async function toggleTodo(id){
  const t=state.todos.find(x=>x.id===id);if(!t)return;
  const wasDone=t.done;
  t.done=!t.done;
  renderTodo();
  if(!wasDone&&t.pts){
    await addPoints(t.pts,`✓ ${t.name}`,true);
  } else if(wasDone&&t.pts){
    await addPoints(-t.pts,`↩ ${t.name} odškrtnuto`,true);
  } else {
    await save();
  }
}

async function editItem(collection, id) {
  if (role !== 'dom') return;
  const item = state[collection].find(x => x.id === id);
  if (!item) return;

  const newName = prompt(`Upravit název (použij | pro popisek):`, item.name);
  if (newName === null) return;

  // Rozhodneme, zda upravujeme body (pts) nebo cenu (cost)
  const currentVal = item.pts !== undefined ? item.pts : (item.cost !== undefined ? item.cost : "");
  const newVal = (item.pts !== undefined || item.cost !== undefined) 
    ? prompt(`Upravit hodnotu/cenu:`, currentVal) 
    : null;

  item.name = newName.trim();
  if (item.pts !== undefined) item.pts = parseInt(newVal) || 0;
  if (item.cost !== undefined) item.cost = parseInt(newVal) || 0;

  renderAll();
  await save();
  showToast('✓ Položka upravena');
}

async function addTodoToBank() {
  const nameEl = document.getElementById('t-name');
  const ptsEl = document.getElementById('t-pts');
  const typeEl = document.getElementById('t-type');

  const name = nameEl.value.trim();
  const type = typeEl.value;
  // Automatické body: Denní 1, Týdenní 5, Aktivní 20
  const pts = parseInt(ptsEl.value) || (type === 'daily' ? 1 : type === 'weekly' ? 5 : 20);

  if (!name) {
    showToast('✗ Zadej název úkolu');
    return;
  }

  if (!state.bank) state.bank = [];

  // Kontrola duplicity v bance
  if (state.bank.some(b => b.name === name && b.type === type)) {
    showToast('✗ Tento úkol už v bance existuje');
    return;
  }

  // Uložíme pouze do banky
  state.bank.push({ 
    id: uid(), 
    name: name, 
    pts: pts, 
    type: type, 
    lastUsed: 0 
  });
  
  nameEl.value = ''; 
  ptsEl.value = '';
  renderBank();
  await save();
  showToast(`✓ Uloženo do banky (${type})`);
}

async function delTodo(id){state.todos=state.todos.filter(x=>x.id!==id);renderTodo();await save();}

async function addIdea(){
  const n=document.getElementById('l-name').value.trim();
  const type=document.getElementById('l-type').value;
  const subtype=document.getElementById('l-subtype')?.value||'active';
  if(!n) return;
  if(!state.ideas) state.ideas=[];
  state.ideas.push({
    id:uid(), name:n, type,
    subtype: type==='activity'?subtype:null,
    checkedDom:role==='dom',
    checkedSub:role==='sub',
    addedAt:new Date().toISOString()
  });
  document.getElementById('l-name').value='';
  renderIdeas(); await save();
  showToast('✓ Nápad přidán');
}

async function toggleIdeaCheck(id,who){
  const idea=state.ideas.find(x=>x.id===id);
  if(!idea) return;
  if(who==='dom'&&role!=='dom'){showToast('🔒 Pouze Dom může zaškrtnout za Dom');return;}
  if(who==='sub'&&role==='dom'){showToast('🔒 Sub zaškrtne za sebe');return;}
  if(who==='dom') idea.checkedDom=!idea.checkedDom;
  else idea.checkedSub=!idea.checkedSub;
  renderIdeas(); await save();
}

async function activateIdea(id){
  if(role!=='dom'){showToast('🔒 Pouze Dom může aktivovat nápad');return;}
  const idea=state.ideas.find(x=>x.id===id);
  if(!idea) return;

  if(idea.type==='activity'){
    const pts=parseInt(prompt(`Kolik bodů za splnění aktivity "${idea.name}"?\n(0 = bez bodů)`));
    if(isNaN(pts)) return;
    const todoType=idea.subtype||'active';
    state.todos.push({id:uid(),name:idea.name,pts:Math.max(0,pts),done:false,type:todoType});
    if(!state.bank) state.bank=[];
    const inBank=state.bank.some(b=>b.name===idea.name&&b.type===todoType);
    if(!inBank){
      state.bank.push({id:uid(),name:idea.name,pts:Math.max(0,pts),type:todoType});
      showToast('✓ Aktivita přidána do úkolů + banky');
    } else {
      showToast('✓ Aktivita přidána do úkolů');
    }
    state.ideas=state.ideas.filter(x=>x.id!==id);
    renderTodo();renderIdeas();renderBank();

  } else if(idea.type==='reward'){
    const cost=parseInt(prompt(`Za kolik bodů lze uplatnit odměnu "${idea.name}"?`));
    if(isNaN(cost)||cost<0) return;
    state.rewards.push({id:uid(),name:idea.name,cost});
    state.ideas=state.ideas.filter(x=>x.id!==id);
    renderRewards();renderIdeas();
    await save();
    showToast('✓ Odměna přidána do seznamu odměn');

  } else if(idea.type==='punishment'){
    const cost=parseInt(prompt(`Kolik bodů stojí trest "${idea.name}"?`));
    if(isNaN(cost)||cost<0) return;
    state.punishments.push({id:uid(),name:idea.name,cost});
    state.ideas=state.ideas.filter(x=>x.id!==id);
    renderRewards();renderIdeas();
    await save();
    showToast('✓ Trest přidán do seznamu trestů');

  } else if(idea.type==='trip'){
    if(!state.trips) state.trips=[];
    state.trips.push({id:uid(),name:idea.name,addedAt:new Date().toISOString()});
    state.ideas=state.ideas.filter(x=>x.id!==id);
    renderTrips();renderIdeas();
    await save();
    showToast('✓ Výlet přidán do seznamu výletů');
  }
}

// ── BANK ───────────────────────────────────────────────────────────────
function renderBank(){
  const al=document.getElementById('bank-active-list');
  const dl=document.getElementById('bank-daily-list');
  const wl=document.getElementById('bank-weekly-list');
  const ac=document.getElementById('bank-active-count');
  const dc=document.getElementById('bank-daily-count');
  const wc=document.getElementById('bank-weekly-count');
  if(!dl||!wl) return;

  const active=(state.bank||[]).filter(b=>b.type==='active');
  const daily=(state.bank||[]).filter(b=>b.type==='daily');
  const weekly=(state.bank||[]).filter(b=>b.type==='weekly');

  if(ac) ac.textContent=`${active.length} úkolů`;
  if(dc) dc.textContent=`${daily.length} úkolů`;
  if(wc) wc.textContent=`${weekly.length} úkolů`;

  const renderBankList=(items,list)=>{
    if(!list) return;
    if(!items.length){
      list.innerHTML='<div class="empty" style="padding:16px 10px"><div class="ei">📭</div>Prázdná banka</div>';
      return;
    }
    const sorted=[...items].sort((a,b)=>(a.lastUsed||0)-(b.lastUsed||0));
    list.innerHTML = sorted.map(b => {
    const parts = b.name.split('|');
    const title = parts[0].trim();
    const desc = parts[1] ? parts[1].trim() : '';
    const lastUsed = b.lastUsed ? `Naposledy: ${new Date(b.lastUsed).toLocaleDateString('cs-CZ')}` : 'Ještě nepoužito';

    return `
      <div class="ti">
        <div class="ttx">
          <details onclick="event.stopPropagation()">
            <summary class="tn">
              ${title}
              ${desc ? '<span class="info-icon">info</span>' : ''}
            </summary>
            ${desc ? `<div class="tdesc">${desc}</div>` : ''}
          </details>
          <div class="tp" style="color:var(--dim)">${b.pts ? `+${b.pts} bodů · ` : ''}<span style="font-size:10px">${lastUsed}</span></div>
        </div>
        ${role === 'dom' ? `
          <button class="bm edit-btn" onclick="editItem('bank','${b.id}')">✎</button>
          <button class="bm done-btn" onclick="rollSpecific('${b.id}')" title="Přidat do úkolů">▶</button>
          <button class="bm d" onclick="deleteFromBank('${b.id}')">✕</button>` : ''}
      </div>`;
}).join('');
};
  renderBankList(active,al);
  renderBankList(daily,dl);
  renderBankList(weekly,wl);
  updateRollInfo();
}

async function rollRandom(type){
  const pool=(state.bank||[]).filter(b=>b.type===type);
  if(!pool.length){showToast('✗ Banka je prázdná');return;}

// --- PŘIDANÝ LIMIT 6 ÚKOLŮ ---
  const currentCount = state.todos.filter(t => t.type === type).length;
  if(currentCount >= 6) {
    showToast('✗ Sekce je plná (max 6 úkolů)');
    return;
  }
// -----------------------------

  if(role==='sub'){
    const todayStr=new Date().toDateString();
    if(!state.rollLog) state.rollLog={};
    const key=`${type}_${todayStr}`;
    if(state.rollLog[key]){
      const label=type==='active'?'aktivní':type==='daily'?'denní':'týdenní';
      showToast(`🔒 Dnes jsi už losovala ${label} úkol`);
      return;
    }
    state.rollLog[key]=true;
  }

  const sorted=[...pool].sort((a,b)=>(a.lastUsed||0)-(b.lastUsed||0));
  const picked=sorted[Math.floor(Math.random()*Math.min(3,sorted.length))];
  picked.lastUsed=Date.now();

  state.todos.push({id:uid(),name:picked.name,pts:picked.pts,done:false,type});
  renderTodo();renderBank();updateRollInfo();
  await save();
  showToast(`🎲 Vytaženo: "${picked.name}"`);
}

function updateRollInfo(){
  const el=document.getElementById('bank-roll-info');
  if(!el||role!=='sub'){if(el)el.textContent='';return;}
  const todayStr=new Date().toDateString();
  const log=state.rollLog||{};
  const used=[];
  if(log[`active_${todayStr}`]) used.push('aktivní');
  if(log[`daily_${todayStr}`]) used.push('denní');
  if(log[`weekly_${todayStr}`]) used.push('týdenní');
  el.textContent=used.length?`Dnes losováno: ${used.join(', ')}. Dom může losovat vždy.`:'';
}

async function rollSpecific(bankId){
  if(role!=='dom'){showToast('🔒 Pouze Dom může aktivovat konkrétní úkol');return;}
  const b=state.bank.find(x=>x.id===bankId);
  if(!b) return;
  b.lastUsed=Date.now();
  state.todos.push({id:uid(),name:b.name,pts:b.pts,done:false,type:b.type});
  renderTodo();renderBank();
  await save();
  showToast(`✓ "${b.name}" přidán do ${b.type==='active'?'aktivních':b.type==='daily'?'denních':'týdenních'} úkolů`);
}

async function deleteFromBank(id){
  state.bank=state.bank.filter(x=>x.id!==id);
  renderBank();
  await save();
}

async function deleteIdea(id){
  if(!confirm('Smazat tento nápad?')) return;
  state.ideas=state.ideas.filter(x=>x.id!==id);
  renderIdeas(); await save();
}

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
  const r=state.rewards.find(x=>x.id===id);if(!r)return;
  if(state.score<r.cost){showToast('✗ Nedostatek bodů');return;}
  if(!confirm(`Uplatnit "${r.name}" za ${r.cost} bodů?`)) return;
  await addPoints(-r.cost,`🏆 Odměna: ${r.name}`,true);
  if(!state.activeRewards) state.activeRewards=[];
  state.activeRewards.push({id:uid(),name:r.name,usedAt:new Date().toISOString()});
  renderActivePunishments();
  await save();
  showToast(`✓ Odměna "${r.name}" aktivována`);
}

// ── TRIPS LOGIC ──────────────────────────────────────────────────────────
async function addTrip(){
  const n=document.getElementById('trip-name').value.trim();
  if(!n)return;
  if(!state.trips) state.trips=[];
  state.trips.push({id:uid(),name:n,addedAt:new Date().toISOString()});
  document.getElementById('trip-name').value='';
  renderTrips();await save();
  showToast('✓ Výlet přidán');
}
async function delTrip(id){state.trips=state.trips.filter(x=>x.id!==id);renderTrips();await save();}
async function completeTrip(id){
  if(role!=='dom'){showToast('🔒 Pouze Dom může označit výlet jako splněný');return;}
  const t=state.trips.find(x=>x.id===id);if(!t)return;
  if(!confirm(`Označit výlet "${t.name}" jako splněný?`)) return;
  if(!state.completedTrips) state.completedTrips=[];
  state.completedTrips.push({...t,completedAt:new Date().toISOString()});
  state.trips=state.trips.filter(x=>x.id!==id);
  renderTrips();await save();
  showToast(`✓ Výlet "${t.name}" splněn! 🎉`);
}
async function delCompletedTrip(id){
  state.completedTrips=state.completedTrips.filter(x=>x.id!==id);
  renderTrips();await save();
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
  
  if(!confirm(`Udělit trest "${p.name}"?\nBody (${p.cost}) se odečtou POUZE pokud trest NEBUDE splněn.`)) return;
  
  // Naplníme modal daty z katalogu
  const nameEl = document.getElementById('ap-name');
  nameEl.value = p.name;
  nameEl.dataset.cost = p.cost; // Tady ukládáme body pro pozdější použití
  
  apType='task';
  setApType('task');
  document.getElementById('ap-modal').classList.add('open');
}

async function clearHistory(){if(!confirm('Vymazat historii?'))return;state.history=[];renderHistory();await save();}
async function resetScore(){
  if(role!=='dom'){showToast('🔒 Pouze Dom může resetovat skóre');return;}
  if(!confirm('Vynulovat skóre?'))return;
  state.score=0;state.totalPlus=0;state.totalMinus=0;renderScore();await save();
}

// ── MODAL ──────────────────────────────────────────────────────────────
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
  const ns=['todo','rewards','trips','punishments','active','bank','legend','settings'];
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
    if(document.getElementById('modal')?.classList.contains('open')) confirmModal();
    if(document.getElementById('pin-modal')?.classList.contains('open')) submitPin();
    if(document.getElementById('ap-modal')?.classList.contains('open')) addActivePunishment();
    if(document.getElementById('sub-login')?.style.display!=='none') subLogin();
    if(document.getElementById('dom-login')?.style.display!=='none') domLogin();
  }
});

init();
