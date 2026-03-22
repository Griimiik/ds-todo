const OWNER='Griimiik', REPO='ds-todo', FILE='data.json';
const RAW_URL=`https://raw.githubusercontent.com/${OWNER}/${REPO}/main/${FILE}`;

let state={score:0,totalPlus:0,totalMinus:0,todos:[],legend:[],history:[],rewards:[],punishments:[],activePunishments:[],activeRewards:[],ideas:[]};
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
  // Odstraň active ze všech tb tlačítek
  document.querySelectorAll('.tb').forEach(b=>b.classList.remove('active'));
  // Přidej active všem tlačítkům daného tématu (header i settings)
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

// Sub čte přes GitHub API (ne raw) aby obešel cache — token má z URL
async function ghGetRaw(){
  // Použij GitHub API s tokenem pokud ho máme (přesný, bez cache)
  // jinak fallback na raw s cache-bust
  if(ghToken){
    const r=await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}?nocache=`+Date.now(),
      {headers:{Authorization:`token ${ghToken}`,Accept:'application/vnd.github.v3+json'}});
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
    if(!state.activeRewards) state.activeRewards=[];
    if(!state.ideas) state.ideas=[];
    renderAll();setSS('synced','✓ synced');showToast('✓ Data synchronizována');
  }catch(e){setSS('error','✗ chyba');showToast('✗ Sync selhal — '+e.message);}
}

async function save(){
  // Sub může ukládat přes addPoints(force=true) — zde neblokujeme
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
  const icon=document.getElementById('role-icon');
  if(icon) icon.textContent=isDom?'🔑':'🦮';

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
  const pList=document.getElementById('active-punishments-list');
  const rList=document.getElementById('active-rewards-list');
  if(!pList) return;
  const now=Date.now();

  // Auto-expire pouze tresty s expirací
  const before=state.activePunishments.length;
  state.activePunishments=state.activePunishments.filter(p=>{
    if(p.type==='task') return true; // task tresty nevypršejí
    return new Date(p.until).getTime()>now;
  });
  if(state.activePunishments.length!==before&&role==='dom') save();

  // Badge počet
  const countEl=document.getElementById('active-count');
  const total=(state.activePunishments?.length||0)+(state.activeRewards?.length||0);
  if(countEl) countEl.textContent=total||'';

  // ── TRESTY ──
  if(!state.activePunishments.length){
    pList.innerHTML='<div class="empty" style="padding:20px 10px"><div class="ei">✓</div>Žádné tresty</div>';
  } else {
    pList.innerHTML=state.activePunishments.map(p=>{
      let timeInfo='';
      if(p.type==='task'){
        timeInfo=`<div class="ap-until">Ke splnění</div>`;
      } else {
        const until=new Date(p.until).getTime();
        const diff=Math.max(0,until-now);
        const d=Math.floor(diff/86400000);
        const h=Math.floor((diff%86400000)/3600000);
        const m=Math.floor((diff%3600000)/60000);
        const s=Math.floor((diff%60000)/1000);
        const countdown=d>0?`${d}d ${h}h ${m}m`:`${h}h ${m}m ${s}s`;
        const urgent=diff<3600000;
        timeInfo=`<div class="ap-until">do ${new Date(p.until).toLocaleDateString('cs-CZ')} ${new Date(p.until).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'})}</div>
                  <div class="ap-countdown${urgent?' urgent':''}">${countdown}</div>`;
      }
      return `
        <div class="ap-item">
          <div class="ap-info">
            <div class="ap-name">${p.name}</div>
            ${timeInfo}
          </div>
          ${role==='dom'?`
            <button class="bm done-btn" onclick="completeActivePunishment('${p.id}')" title="Splněno">✓</button>
            <button class="bm d" onclick="removeActivePunishment('${p.id}')">✕</button>`:''}
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

let apType='expiry'; // 'expiry' nebo 'task'

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
  const name=document.getElementById('ap-name').value.trim();
  if(!name){showToast('✗ Zadej název trestu');return;}
  if(apType==='expiry'){
    const until=document.getElementById('ap-until').value;
    if(!until){showToast('✗ Zadej datum');return;}
    if(new Date(until).getTime()<=Date.now()){showToast('✗ Datum musí být v budoucnosti');return;}
    if(!state.activePunishments) state.activePunishments=[];
    state.activePunishments.push({id:uid(),name,until,type:'expiry',addedAt:new Date().toISOString()});
  } else {
    if(!state.activePunishments) state.activePunishments=[];
    state.activePunishments.push({id:uid(),name,type:'task',addedAt:new Date().toISOString()});
  }
  document.getElementById('ap-modal').classList.remove('open');
  renderActivePunishments();
  await save();
  showToast('✓ Aktivní trest přidán');
}

async function removeActivePunishment(id){
  if(!confirm('Odstranit tento trest?')) return;
  state.activePunishments=state.activePunishments.filter(x=>x.id!==id);
  renderActivePunishments();
  await save();
}

async function completeActivePunishment(id){
  state.activePunishments=state.activePunishments.filter(x=>x.id!==id);
  renderActivePunishments();
  await save();
  showToast('✓ Trest splněn');
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
  state.ideas=[];
  state.legend=[];
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
  renderScore();renderTodo();renderIdeas();renderHistory();renderRewards();renderActivePunishments();
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

function renderIdeas(){
  const l=document.getElementById('llist');
  if(!state.ideas||!state.ideas.length){
    l.innerHTML='<div class="empty"><div class="ei">💡</div>Žádné nápady<br><span style="font-size:11px">Přidej první nápad níže</span></div>';
    return;
  }
  const typeLabels={activity:'🎯 Aktivita',punishment:'⚡ Trest',reward:'🏆 Odměna'};
  const typeCls={activity:'idea-tag-activity',punishment:'idea-tag-punishment',reward:'idea-tag-reward'};
  l.innerHTML=state.ideas.map(x=>`
    <div class="idea-item">
      <div class="idea-checks">
        <div class="idea-check ${x.checkedDom?'checked':''}" onclick="toggleIdeaCheck('${x.id}','dom')" title="Dom souhlasí">🔑</div>
        <div class="idea-check ${x.checkedSub?'checked':''}" onclick="toggleIdeaCheck('${x.id}','sub')" title="Sub souhlasí">🦮</div>
      </div>
      <div class="idea-info">
        <div class="idea-name ${x.checkedDom&&x.checkedSub?'idea-agreed':''}">${x.name}</div>
        <div style="display:flex;gap:6px;margin-top:4px;align-items:center">
          <span class="idea-type-tag ${typeCls[x.type]||''}">${typeLabels[x.type]||x.type}</span>
          ${x.checkedDom&&x.checkedSub?'<span style="font-size:9px;color:var(--green);letter-spacing:.08em">✓ oba souhlasí</span>':''}
        </div>
      </div>
      ${role==='dom'?`
        <div class="idea-dom-actions">
          <button class="badd" onclick="activateIdea('${x.id}')" style="font-size:10px;padding:5px 8px">▶ Aktivovat</button>
          <button class="bm d" onclick="deleteIdea('${x.id}')">✕</button>
        </div>`:''}
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
      const canUse=ok; // Dom i Sub mohou uplatnit
      return `<div class="rpi">
        <div class="rpi2">
          <div class="rn">${r.name}</div>
          <div class="rc">${r.cost} bodů${!ok?` · chybí ${r.cost-state.score}`:''}</div>
        </div>
        <button class="rpb${canUse?'':' na'}" onclick="${canUse?`useReward('${r.id}')`:''}">
          ${ok?'Uplatnit':'✗ Málo bodů'}
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

async function addTodo(){
  const n=document.getElementById('t-name').value.trim();
  const p=parseInt(document.getElementById('t-pts').value)||0;
  if(!n)return;
  state.todos.push({id:uid(),name:n,pts:p,done:false});
  document.getElementById('t-name').value='';document.getElementById('t-pts').value='';
  renderTodo();await save();
}

async function delTodo(id){state.todos=state.todos.filter(x=>x.id!==id);renderTodo();await save();}

async function addIdea(){
  const n=document.getElementById('l-name').value.trim();
  const type=document.getElementById('l-type').value;
  if(!n) return;
  if(!state.ideas) state.ideas=[];
  state.ideas.push({
    id:uid(), name:n, type,
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
    // Aktivita → přidat do úkolů
    const pts=parseInt(prompt(`Kolik bodů za splnění aktivity "${idea.name}"?\n(0 = bez bodů)`));
    if(isNaN(pts)) return;
    state.todos.push({id:uid(),name:idea.name,pts:Math.max(0,pts),done:false});
    state.ideas=state.ideas.filter(x=>x.id!==id);
    renderTodo();renderIdeas();
    await save();
    showToast('✓ Aktivita přidána do úkolů');

  } else if(idea.type==='reward'){
    // Odměna → přidat do seznamu odměn
    const cost=parseInt(prompt(`Za kolik bodů lze uplatnit odměnu "${idea.name}"?`));
    if(isNaN(cost)||cost<0) return;
    state.rewards.push({id:uid(),name:idea.name,cost});
    state.ideas=state.ideas.filter(x=>x.id!==id);
    renderRewards();renderIdeas();
    await save();
    showToast('✓ Odměna přidána do seznamu odměn');

  } else if(idea.type==='punishment'){
    // Trest → přidat do seznamu trestů
    const cost=parseInt(prompt(`Kolik bodů stojí trest "${idea.name}"?`));
    if(isNaN(cost)||cost<0) return;
    state.punishments.push({id:uid(),name:idea.name,cost});
    state.ideas=state.ideas.filter(x=>x.id!==id);
    renderRewards();renderIdeas();
    await save();
    showToast('✓ Trest přidán do seznamu trestů');
  }
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
  if(role!=='dom'&&role!=='sub'){showToast('🔒 Pouze Dom nebo Sub může uplatnit odměnu');return;}
  const r=state.rewards.find(x=>x.id===id);if(!r)return;
  if(state.score<r.cost){showToast('✗ Nedostatek bodů');return;}
  if(!confirm(`Uplatnit "${r.name}" za ${r.cost} bodů?`)) return;
  await addPoints(-r.cost,`🏆 ${r.name}`,true);
  if(!state.activeRewards) state.activeRewards=[];
  state.activeRewards.push({id:uid(),name:r.name,usedAt:new Date().toISOString()});
  renderActivePunishments();
  await save();
  showToast(`✓ Odměna "${r.name}" aktivována`);
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
  if(!confirm(`Udělit trest "${p.name}" (−${p.cost} bodů)?`)) return;
  // Otevři modal pro datum
  document.getElementById('ap-name').value=p.name;
  const tomorrow=new Date(Date.now()+86400000);
  tomorrow.setSeconds(0,0);
  document.getElementById('ap-until').value=tomorrow.toISOString().slice(0,16);
  document.getElementById('ap-modal').classList.add('open');
  // Odečti body
  await addPoints(-p.cost,`⚡ ${p.name}`);
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
