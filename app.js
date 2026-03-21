const OWNER='Griimiik', REPO='ds-todo', FILE='data.json';
let state={score:0,totalPlus:0,totalMinus:0,todos:[],legend:[],history:[],rewards:[],punishments:[]};
let ghToken='', encPw='', modalMode='add', sha=null, theme='dark';

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
  if(!t||!p){showToast('✗ Vyplň token i heslo');return;}
  if(p.length<6){showToast('✗ Heslo musí mít alespoň 6 znaků');return;}
  ghToken=t;encPw=p;
  localStorage.setItem('gh_token',t);localStorage.setItem('enc_pw',p);
  document.getElementById('ss').style.display='none';
  document.getElementById('ls').style.display='flex';
  document.getElementById('lt').textContent='Připojuji...';
  await syncNow();
  if(!sha){setDefaults();await save();}
  document.getElementById('ls').style.display='none';
  document.getElementById('app').style.display='block';
}

function setDefaults(){
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
  if(!confirm('Odpojit zařízení?')) return;
  localStorage.removeItem('gh_token');localStorage.removeItem('enc_pw');location.reload();
}

async function changePassword(){
  const p=prompt('Nové heslo (min. 6 znaků):');
  if(!p||p.length<6){showToast('✗ Příliš krátké heslo');return;}
  encPw=p;localStorage.setItem('enc_pw',p);await save();showToast('✓ Heslo změněno');
}

// ── INIT ───────────────────────────────────────────────────────────────
async function init(){
  const t=localStorage.getItem('gh_token'),p=localStorage.getItem('enc_pw');
  const th=localStorage.getItem('theme')||'dark';
  setTheme(th);
  if(t&&p){
    ghToken=t;encPw=p;
    document.getElementById('lt').textContent='Synchronizuji...';
    await syncNow();
    document.getElementById('ls').style.display='none';
    document.getElementById('app').style.display='block';
  } else {
    document.getElementById('ls').style.display='none';
    document.getElementById('ss').style.display='flex';
  }
}

// ── RENDER ─────────────────────────────────────────────────────────────
function renderAll(){renderScore();renderTodo();renderLegend();renderHistory();renderRewards();}

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
      <button class="bm d" onclick="event.stopPropagation();delTodo('${t.id}')">✕</button>
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
      <button class="bm d" onclick="delLegend('${x.id}')">✕</button>
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
      return `<div class="rpi">
        <div class="rpi2"><div class="rn">${r.name}</div><div class="rc">${r.cost} bodů${!ok?` · chybí ${r.cost-state.score}`:''}</div></div>
        <button class="rpb${ok?'':' na'}" onclick="${ok?`useReward('${r.id}')`:''}">${ok?'Uplatnit':'✗ Málo bodů'}</button>
        <button class="bm d" onclick="delReward('${r.id}')">✕</button>
      </div>`;}).join('')
    :'<div class="empty" style="padding:20px"><div class="ei">🏆</div>Žádné odměny</div>';
  pl.innerHTML=state.punishments.length
    ?state.punishments.map(p=>`
      <div class="rpi">
        <div class="rpi2"><div class="rn">${p.name}</div><div class="rc">${p.cost} bodů</div></div>
        <button class="rpb" onclick="usePunishment('${p.id}')" style="border-color:rgba(201,110,110,.3);color:var(--red)">Aplikovat</button>
        <button class="bm d" onclick="delPunishment('${p.id}')">✕</button>
      </div>`).join('')
    :'<div class="empty" style="padding:20px"><div class="ei">⚡</div>Žádné tresty</div>';
}

// ── ACTIONS ────────────────────────────────────────────────────────────
function uid(){return Math.random().toString(36).slice(2,9)}
function ts(){const n=new Date();return n.toLocaleDateString('cs-CZ')+' '+n.toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'})}

async function addPoints(pts,reason){
  state.score+=pts;
  if(pts>0)state.totalPlus+=pts;else state.totalMinus+=Math.abs(pts);
  state.history.push({id:uid(),pts,reason,time:ts()});
  renderAll();await save();
}
async function toggleTodo(id){
  const t=state.todos.find(x=>x.id===id);if(!t)return;
  t.done=!t.done;renderTodo();
  if(t.done&&t.pts)await addPoints(t.pts,`✓ ${t.name}`);else await save();
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
  const p=state.punishments.find(x=>x.id===id);if(!p)return;
  if(confirm(`Aplikovat trest "${p.name}" (−${p.cost} bodů)?`))await addPoints(-p.cost,`⚡ ${p.name}`);
}

async function clearHistory(){if(!confirm('Vymazat historii?'))return;state.history=[];renderHistory();await save();}
async function resetScore(){if(!confirm('Vynulovat skóre?'))return;state.score=0;state.totalPlus=0;state.totalMinus=0;renderScore();await save();}

// ── MODAL ──────────────────────────────────────────────────────────────
function openModal(m){
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
  const ns=['todo','legend','history','rewards','settings'];
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

document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&document.getElementById('modal').classList.contains('open'))confirmModal();
});

init();
