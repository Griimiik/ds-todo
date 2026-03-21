const OWNER='Griimiik', REPO='ds-todo', FILE='data.json';
const RAW_URL=`https://raw.githubusercontent.com/${OWNER}/${REPO}/main/${FILE}`;

let state={score:0,totalPlus:0,totalMinus:0,todos:[],legend:[],history:[],rewards:[],punishments:[],activePunishments:[]};
let ghToken='', encPw='', subPw='', modalMode='add', sha=null, theme='dark';
let role='';
let countdownInterval=null;

// Detekce Sub URL — parsuj hash: #sub&token=ghp_xxx&enc=XXXXX
function parseSubHash(){
  const hash=window.location.hash.slice(1); // odstraň #
  if(!hash.startsWith('sub')) return null;
  const params={};
  hash.split('&').forEach(part=>{
    const [k,v]=part.split('=');
    if(k&&v) params[k]=decodeURIComponent(v);
  });
  return params; // { token, enc } nebo null
}
const subHashParams=parseSubHash();

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

// Sub čte přes GitHub API (ne raw) aby obešel cache — token má z URL
async function ghGetRaw(){
  // Použij GitHub API s tokenem pokud ho máme (přesný, bez cache)
  // jinak fallback na raw s cache-bust
  if(ghToken){
    const r=await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`,
      {headers:{Authorization:`token ${ghToken}`,Accept:'application/vnd.github.v3+json','Cache-Control':'no-cache'}});
    if(!r.ok) throw new Error('Nepodařilo se načíst data');
    const f=await r.json();
    sha=f.sha; // uložíme SHA i pro sub (pro případ přepnutí na dom)
    return decodeURIComponent(escape(atob(f.content.replace(/\n/g,''))));
  } else {
    // Fallback bez tokenu — přidej náhodný parametr pro obejití cache
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
      // Dom — vždy načte čerstvé SHA z API
      const f=await ghGet();
      if(f){
        sha=f.sha;
        state=await decrypt(decodeURIComponent(escape(atob(f.content.replace(/\n/g,'')))),encPw);
      }
    }
    if(!state.activePunishments) state.activePunishments=[];
    renderAll();setSS('synced','✓ synced');showToast('✓ Data synchronizována');
  }catch(e){setSS('error','✗ chyba');showToast('✗ Sync selhal — '+e.message);}
}

async function save(){
  if(role==='sub'){showToast('🔒 Sub nemůže ukládat data');return;}
  setSS('syncing','↑ ukládám...');
  try{
    // Pokud nemáme SHA, načti ho nejdřív aby zápis neselhal
    if(!sha){
      const f=await ghGet();
      if(f) sha=f.sha;
    }
    await ghPut(await encrypt(state,encPw));
    setSS('synced','✓ uloženo');
  }catch(e){
    // Pokud selže kvůli konfliktu SHA, zkus znovu s čerstvým SHA
    if(e.message.includes('PUT')){
      try{
        const f=await ghGet();
        if(f) sha=f.sha;
        await ghPut(await encrypt(state,encPw));
        setSS('synced','✓ uloženo');
      }catch(e2){
        setSS('error','✗ chyba');
        showToast('✗ Uložení selhalo — '+e2.message);
      }
    } else {
      setSS('error','✗ chyba');
      showToast('✗ Uložení selhalo — '+e.message);
    }
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
    // První přihlášení — Sub heslo ještě neznáme, zkusíme dešifrovat data
    // jako ověření že heslo je správné
    try{
      const raw=await ghGetRaw();
      await decrypt(raw.trim(), storedEncPw); // ověř že enc heslo funguje
      // Sub heslo uložíme pro příští ověření
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
  document.getElementById('ls').style.display='none';

  if(subHashParams){
    // ── SUB přístup přes URL s tokenem ──
    // Token a enc heslo jsou zakódované v URL hashu
    // Sub zadá pouze Sub heslo
    if(subHashParams.token && subHashParams.enc){
      // Uložíme do localStorage pro příští návštěvy
      localStorage.setItem('gh_token', subHashParams.token);
      localStorage.setItem('enc_pw', subHashParams.enc);
    }
    // Zobraz Sub login — jen Sub heslo
    showScreen('sub-login');
  } else {
    // ── DOM přístup — normální URL ──
    const hasSetup=localStorage.getItem('gh_token')&&localStorage.getItem('enc_pw');
    if(!hasSetup){
      showScreen('ss'); // první spuštění
    } else {
      showScreen('dom-login'); // opakované přihlášení
    }
  }
}

function showScreen(id){
  ['ss','dom-login','sub-login','sub-bootstrap','ls','app'].forEach(s=>{
    const el=document.getElementById(s);
    if(el) el.style.display='none';
  });
  const target=document.getElementById(id);
  if(target) target.style.display='flex';
}

// Bootstrap Sub zařízení — Dom se přihlásí jednou aby nastavil localStorage
async function bootstrapSub(){
  const t=document.getElementById('bs-token').value.trim();
  const dp=document.getElementById('bs-dom-pw').value;
  const sp=document.getElementById('bs-sub-pw').value;
  if(!t||!dp||!sp){showToast('✗ Vyplň všechna pole');return;}

  localStorage.setItem('gh_token',t);
  localStorage.setItem('enc_pw',dp);
  localStorage.setItem('sub_pw',sp);

  ghToken=t;encPw=dp;subPw=sp;
  showScreen('sub-login');
  showToast('✓ Zařízení nastaveno');
}

// ── ROLE APLIKACE ──────────────────────────────────────────────────────
function applyRole(){
  const isDom=role==='dom';

  document.getElementById('role-badge').textContent=isDom?'DOM':'SUB';
  document.getElementById('role-badge').className='role-badge '+(isDom?'dom':'sub');

  // Quick actions — sub vidí ale jsou zablokované
  document.querySelectorAll('.qa-locked').forEach(el=>{
    el.style.opacity=isDom?'1':'0.45';
    el.style.pointerEvents=isDom?'auto':'none';
  });

  // Dom-only prvky
  document.querySelectorAll('.dom-only').forEach(el=>{
    el.style.display=isDom?'':'none';
  });

  // Tlačítko přepnutí Sub→Dom
  const rsb=document.getElementById('role-switch-btn');
  if(rsb) rsb.style.display=isDom?'none':'';

  startCountdown();
}

// ── ROLE SWITCH ────────────────────────────────────────────────────────
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
  const list=document.getElementById('active-punishments-list');
  if(!list) return;
  const now=Date.now();

  const before=state.activePunishments.length;
  state.activePunishments=state.activePunishments.filter(p=>new Date(p.until).getTime()>now);
  if(state.activePunishments.length!==before&&role==='dom') save();

  const countEl=document.getElementById('active-count');
  if(!state.activePunishments.length){
    list.innerHTML='<div class="empty"><div class="ei">✓</div>Žádné aktivní tresty<br><span style="font-size:11px">Sub je momentálně bez trestu</span></div>';
    if(countEl) countEl.textContent='';
    return;
  }

  if(countEl) countEl.textContent=state.activePunishments.length;

  list.innerHTML=state.activePunishments.map(p=>{
    const until=new Date(p.until).getTime();
    const diff=Math.max(0,until-now);
    const d=Math.floor(diff/86400000);
    const h=Math.floor((diff%86400000)/3600000);
    const m=Math.floor((diff%3600000)/60000);
    const s=Math.floor((diff%60000)/1000);
    const countdown=d>0?`${d}d ${h}h ${m}m`:`${h}h ${m}m ${s}s`;
    const urgent=diff<3600000;
    return `
      <div class="ap-item">
        <div class="ap-info">
          <div class="ap-name">${p.name}</div>
          <div class="ap-until">do ${new Date(p.until).toLocaleDateString('cs-CZ')} ${new Date(p.until).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'})}</div>
        </div>
        <div class="ap-countdown${urgent?' urgent':''}">${countdown}</div>
        ${role==='dom'?`<button class="bm d" onclick="removeActivePunishment('${p.id}')">✕</button>`:''}
      </div>`;
  }).join('');
}

function openAddActivePunishment(){
  document.getElementById('ap-modal').classList.add('open');
  document.getElementById('ap-name').value='';
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
        <div class="rpi2">
          <div class="rn">${r.name}</div>
          <div class="rc">${r.cost} bodů${!ok?` · chybí ${r.cost-state.score}`:''}</div>
        </div>
        <button class="rpb${canUse?'':' na'}" onclick="${canUse?`useReward('${r.id}')`:''}"
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
          <button class="bm d" onclick="delPunishment('${p.id}')">✕</button>`:''}
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
  if(role==='sub'&&t.done){showToast('🔒 Splněný úkol může odšrtnout jen Dom');return;}
  t.done=!t.done;renderTodo();
  if(t.done&&t.pts){
    // Sub zaškrtne → body přidá se zapíše přes Dom token (uložený lokálně)
    // Pokud Sub nemá token, pouze označí lokálně a Dom synchronizuje
    if(ghToken) await addPoints(t.pts,`✓ ${t.name}`);
    else{showToast('✓ Úkol splněn — Dom přidá body při syncu');await syncNow();}
  } else await save();
}

async function addTodo(){
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
    if(document.getElementById('modal')?.classList.contains('open')) confirmModal();
    if(document.getElementById('pin-modal')?.classList.contains('open')) submitPin();
    if(document.getElementById('ap-modal')?.classList.contains('open')) addActivePunishment();
    if(document.getElementById('sub-login')?.style.display!=='none') subLogin();
    if(document.getElementById('dom-login')?.style.display!=='none') domLogin();
  }
});

init();
