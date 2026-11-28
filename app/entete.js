/* Mobilog — barre du haut : nouveautés (cloche), aide « ? » et menu de l'utilisateur — Tonton Business */
(function(){
"use strict";
const T = window.TP; if(!T) return;
const { S, sb, esc, frDate } = T;
const VERSION = "28/11/2026";
let annonces=[], ouvert=null, chargeLe=0;

const css = `
#topbar{display:flex;justify-content:flex-end;align-items:center;gap:8px;height:52px;margin:-22px calc(-1 * max(16px, env(safe-area-inset-right,0px))) 18px calc(-1 * max(16px, env(safe-area-inset-left,0px)));padding:0 max(16px, env(safe-area-inset-right,0px));background:#0b1d42;color:#fff;position:relative;z-index:40}
#topbar .tb{position:relative;width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.28);background:transparent;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
#topbar .tb:hover{background:rgba(255,255,255,.12)} #topbar .tb[aria-expanded="true"]{background:rgba(255,255,255,.18);border-color:#fff}
#topbar .tb svg{width:19px;height:19px}
#topbar .av{font-weight:700;font-size:13px;background:#fff;color:#0b1d42;border-color:#fff} #topbar .av:hover,#topbar .av[aria-expanded="true"]{background:#E7ECF5;color:#0b1d42}
#topbar .pt{position:absolute;top:5px;right:6px;width:9px;height:9px;border-radius:50%;background:#E5484D;box-shadow:0 0 0 2px #0b1d42}
#topbar .dd{color:var(--fg);position:absolute;top:48px;right:max(16px, env(safe-area-inset-right,0px));z-index:60;min-width:300px;max-width:min(440px,94vw);background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:6px 0}
#topbar .dd h3{margin:0;padding:8px 14px 6px;font-size:14px}
#topbar .dd .it{display:flex;gap:10px;align-items:center;width:100%;text-align:left;border:0;background:none;color:var(--fg);padding:10px 14px;font-size:14px;cursor:pointer;border-top:1px solid var(--line)}
#topbar .dd .it:hover{background:var(--surface-2)}
#topbar .dd .an{padding:10px 14px;border-top:1px solid var(--line);font-size:13px}
#topbar .dd .an b{display:block;font-size:14px} #topbar .dd .an p{margin:3px 0 0;color:var(--muted)}
#topbar .dd .ch{display:inline-block;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;margin-right:6px;vertical-align:1px}
#topbar .ch.nouveau{background:var(--run-bg);color:var(--run-bd)} #topbar .ch.maintenance{background:var(--sent-bg);color:var(--sent-bd)} #topbar .ch.info{background:var(--off-bg);color:var(--fg)}
#topbar .dd .nv{font-weight:700} #topbar .dd .sm{font-size:12px;color:var(--muted);padding:8px 14px;border-top:1px solid var(--line)}
#topbar .dd .who{padding:8px 14px 10px;font-size:13px;color:var(--muted)} #topbar .dd .who b{display:block;color:var(--fg);font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media print{ #topbar{display:none!important} }`;

const ICO = {
  cloche:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  aide:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>`
};
const cleVu = () => "mobilogAnnVu_"+(S.session?.user?.id||"");
const vu = () => { try{ return localStorage.getItem(cleVu())||""; }catch(e){ return ""; } };
const marquerVu = () => { if(annonces[0]) try{ localStorage.setItem(cleVu(), annonces[0].publie_le); }catch(e){} };
const nonLues = () => { const v=vu(); return annonces.filter(a=>!v || a.publie_le>v).length; };
const initiales = () => { const e=(S.session?.user?.email||"?").split("@")[0].replace(/[^a-zA-Z]+/g," ").trim().split(" "); return ((e[0]||"?")[0]+((e[1]||e[0]||"")[e[1]?0:1]||"")).toUpperCase(); };
const ROLE = { admin:"Administrateur", exploitant:"Exploitant" };
const TYPE = { nouveau:"Nouveau", maintenance:"Maintenance", info:"Info" };

function visible(){ return !!(S.session && S.mem && !S.mfa && window.TP_MODE!=="chauffeur" && (S.mem.role==="admin"||S.mem.role==="exploitant")); }

async function charger(force){
  if(!visible() || (!force && Date.now()-chargeLe<10*60000)) return;
  chargeLe=Date.now();
  const {data,error}=await sb.from("annonces").select("id,titre,texte,type,publie_le").order("publie_le",{ascending:false}).limit(20);
  if(!error && Array.isArray(data)){ annonces=data; dessine(); }
}

function panneau(){
  if(ouvert==="cloche") return `<div class="dd" role="dialog" aria-label="Nouveautés"><h3>Nouveautés</h3>${annonces.length?annonces.map(a=>{ const neuf=!vu()||a.publie_le>vu();
    return `<div class="an"><span class="ch ${esc(a.type)}">${esc(TYPE[a.type]||"Info")}</span><span class="muted" style="font-size:12px">${esc(frDate(String(a.publie_le).slice(0,10),{day:"numeric",month:"long",year:"numeric"}))}</span><b class="${neuf?"nv":""}">${esc(a.titre)}</b>${a.texte?`<p>${esc(a.texte)}</p>`:""}</div>`; }).join("")
    :`<div class="an muted">Aucune nouveauté pour le moment.</div>`}</div>`;
  if(ouvert==="aide") return `<div class="dd" role="menu" aria-label="Aide">
    <button type="button" class="it" role="menuitem" data-tb="guide">📖 Centre d'aide</button>
    <button type="button" class="it" role="menuitem" data-tb="tonton">💬 Poser une question à Tonton</button>
    <button type="button" class="it" role="menuitem" data-tb="sig">✉️ Contacter le support</button>
    <button type="button" class="it" role="menuitem" data-tb="cloche">🔔 Nouveautés</button>
    <div class="sm" style="text-align:right">Mobilog — version du ${VERSION}</div></div>`;
  if(ouvert==="moi") return `<div class="dd" role="menu" aria-label="Mon compte">
    <div class="who"><b>${esc(S.session?.user?.email||"")}</b>${esc(S.entreprise?.nom||"")} · ${esc(ROLE[S.mem?.role]||"")}</div>
    <button type="button" class="it" role="menuitem" data-tb="reglages">⚙️ Paramètres</button>
    <button type="button" class="it" role="menuitem" data-act="securite">🔐 Sécurité du compte</button>
    <button type="button" class="it" role="menuitem" data-act="logout">↪ Se déconnecter</button></div>`;
  return "";
}

function dessine(){
  let bar=document.getElementById("topbar");
  if(!visible()){ if(bar) bar.hidden=true; ouvert=null; return; }
  if(!bar){ const main=document.querySelector("main.main"); if(!main) return; bar=document.createElement("div"); bar.id="topbar"; main.insertBefore(bar, main.firstChild); }
  bar.hidden=false; const n=nonLues();
  bar.innerHTML = `<button type="button" class="tb" data-tb="cloche" aria-label="Nouveautés${n?` (${n} non lue${n>1?"s":""})`:""}" aria-expanded="${ouvert==="cloche"}" title="Nouveautés">${ICO.cloche}${n?`<span class="pt"></span>`:""}</button>
    <button type="button" class="tb" data-tb="aide" aria-label="Aide" aria-expanded="${ouvert==="aide"}" title="Aide">${ICO.aide}</button>
    <button type="button" class="tb av" data-tb="moi" aria-label="Mon compte" aria-expanded="${ouvert==="moi"}" title="${esc(S.session?.user?.email||"")}">${esc(initiales())}</button>${panneau()}`;
}

document.addEventListener("click", e=>{
  const b=e.target.closest("#topbar [data-tb]");
  if(!b){ if(ouvert && (!e.target.closest("#topbar .dd") || e.target.closest("#topbar [data-act]"))){ ouvert=null; setTimeout(dessine,0); } return; }
  const v=b.dataset.tb;
  if(v==="cloche"||v==="aide"||v==="moi"){ ouvert = ouvert===v ? null : v; dessine(); if(ouvert==="cloche") marquerVu(); return; }
  ouvert=null; dessine();
  if(v==="guide"||v==="tonton"||v==="sig"){ if(T.aideOuvrir) T.aideOuvrir(v==="tonton"?"aide":v); return; }
  if(v==="reglages"){ location.hash="#reglages"; }
});
document.addEventListener("keydown", e=>{ if(e.key==="Escape" && ouvert){ ouvert=null; dessine(); } });

function init(){
  const st=document.createElement("style"); st.textContent=css; document.head.appendChild(st);
  let etat="";
  setInterval(()=>{ const k=[visible(), S.session?.user?.id||"", S.entreprise?.nom||""].join("|"); if(k!==etat){ etat=k; annonces=[]; chargeLe=0; ouvert=null; dessine(); charger(true); } else charger(false); }, 1500);
}
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init); else init();
})();
