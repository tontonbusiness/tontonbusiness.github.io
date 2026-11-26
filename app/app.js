/* Mobilog — application (exploitation + conducteurs) — Tonton Business */
(function(){
"use strict";
const CFG = window.TP_CONFIG;
const MODE = window.TP_MODE==="chauffeur" ? "chauffeur" : "exploitation"; // /chauffeur = application Dream Chauffeur
const APPNAME = MODE==="chauffeur" ? "Dream Chauffeur" : "Mobilog";
const CHAUFFEUR_URL = CFG.chauffeurUrl || "https://tontonbusiness.com/chauffeur/";
// Anti-robot Cloudflare Turnstile : inactif tant que CFG.turnstileSiteKey n'est pas renseigné dans config.js
// (la clé secrète correspondante se met dans Supabase → Authentication → Attack Protection).
let tsWidget=null, tsAttente=null;
function jetonCaptcha(){
  const key=CFG.turnstileSiteKey; if(!key) return Promise.resolve(undefined);
  const charger = window.turnstile ? Promise.resolve() : new Promise((ok,ko)=>{ const s=document.createElement("script");
    s.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async=true; s.onload=ok; s.onerror=()=>ko(new Error("captcha_indisponible")); document.head.appendChild(s); });
  return charger.then(()=>new Promise((ok,ko)=>{
    // bandeau centré en bas de l'écran, visible seulement si Cloudflare demande de cocher la case
    let box=document.getElementById("tsBox");
    if(!box){ box=document.createElement("div"); box.id="tsBox";
      box.style.cssText="position:fixed;left:0;right:0;bottom:12px;z-index:9999;display:flex;flex-direction:column;align-items:center;gap:6px;padding:0 8px;pointer-events:none";
      box.innerHTML=`<div id="tsMsg" style="display:none;background:#1F3A5F;color:#fff;font:600 14px system-ui,sans-serif;padding:6px 12px;border-radius:8px;text-align:center">Vérification de sécurité : cochez la case ci-dessous</div><div id="tsWidget" style="width:300px;max-width:100%;pointer-events:auto"></div>`;
      document.body.appendChild(box); }
    tsAttente={ok,ko};
    const msg=v=>{ const m=document.getElementById("tsMsg"); if(m) m.style.display=v?"block":"none"; };
    const fini=t=>{ msg(false); const a=tsAttente; tsAttente=null; if(a) a.ok(t); };
    if(tsWidget===null) tsWidget=window.turnstile.render("#tsWidget",{sitekey:key,language:"fr",appearance:"interaction-only",callback:fini,
      "before-interactive-callback":()=>msg(true),
      "after-interactive-callback":()=>msg(false),
      "error-callback":()=>{ msg(false); const a=tsAttente; tsAttente=null; if(a) a.ko(new Error("captcha_echec")); }});
    else window.turnstile.reset(tsWidget);
  }));
}
const standalone = () => { try{ return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone===true; }catch(e){ return false; } };
const appareil = () => { const u=navigator.userAgent||""; const d=/iPhone/.test(u)?"iPhone":/iPad/.test(u)?"iPad":/Android/.test(u)?"Android":"Ordinateur"; return d+(standalone()?" · application":" · navigateur"); };
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

/* ---------- utilitaires ---------- */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2,"0");
const iso = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const todayIso = () => iso(new Date());
const addDays = (s,n) => { const [y,m,d]=s.split("-").map(Number); return iso(new Date(y,m-1,d+n)); };
const frDate = (s,opt) => { if(!s) return ""; const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d).toLocaleDateString("fr-FR",opt||{weekday:"long",day:"numeric",month:"long",year:"numeric"}); };
const shortDate = s => s ? frDate(s,{day:"2-digit",month:"2-digit"}) : "";
const toMin = t => { if(!t || !/^\d{1,2}:\d{2}/.test(t)) return null; const [h,m]=t.split(":").map(Number); return h*60+m; };
const eur = n => (Number(n)||0).toLocaleString("fr-FR",{maximumFractionDigits:0})+" €";
const store = { get(k){ try{return localStorage.getItem(k);}catch(e){return null;} }, set(k,v){ try{localStorage.setItem(k,v);}catch(e){} } };
const camel2snake = k => k.replace(/[A-Z]/g, m => "_"+m.toLowerCase());
const snake2camel = k => k.replace(/_([a-z])/g, (_,c) => c.toUpperCase());

const STATUTS = { a_planifier:{l:"À planifier"}, planifiee:{l:"Planifiée"}, envoyee:{l:"Envoyée au conducteur"}, en_cours:{l:"En cours"}, terminee:{l:"Terminée"}, annulee:{l:"Annulée"} };
const DAY0 = 6*60, DAY1 = 20*60;
const TIME_KEYS = ["enlHeure","enlHeureFin","livHeure","livHeureFin","arriveeEnl","chargeEnl","arriveeLiv","livre"];

/* ---------- état ---------- */
const S = { session:null, mem:null, entreprise:null, courses:[], conducteurs:[], camions:[], remorques:[], membres:[], loaded:false,
  view:"planning", date: todayIso(), mode:"conducteur", fStatut:"tous", fClient:"", fQ:"", fPeriode:"tout", fDate:"", fDate2:"",
  iPeriode:"30", iCond:"", iDonneur:"", me: store.get("tp_me") || "", drvDay:"today", reserveFor:null,
  importList:null, importDoc:null, authMode:"login", authErr:"", recovery:false,
  openJobs:new Set(), doneFor:null, sign:null, incType:null, incN:null };
/* problèmes signalés par le conducteur + signature du destinataire */
const INC = { retard:"Retard", attente:"Attente sur site", absent:"Client absent", casse:"Casse / manquant", acces:"Accès impossible", panne:"Panne véhicule", autre:"Autre" };
const packOn = () => S.courses.some(c=>"incidents" in c); // base de données à jour (signalement + signature)
const incOf = c => Array.isArray(c.incidents) ? c.incidents : [];
const ATT_MIN = 30;
const attDt = (d,h) => { if(!h) return null; const t=new Date((d||todayIso())+"T"+String(h).slice(0,5)+":00"); return isNaN(t)?null:t; };
const attente = c => { if(!c || c.livre || c.sousTraitantId || ["annulee","terminee","a_planifier"].includes(c.statut)) return null;
  const e = c.arriveeLiv ? {k:"liv",l:"à la livraison",since:attDt(c.livDate||c.enlDate,c.arriveeLiv),nom:c.livNom} : (c.arriveeEnl && !c.chargeEnl) ? {k:"chg",l:"au chargement",since:attDt(c.enlDate,c.arriveeEnl),nom:c.enlNom} : null;
  if(!e || !e.since) return null; const m=Math.floor((Date.now()-e.since.getTime())/60000); return (m<ATT_MIN || m>18*60) ? null : {...e,min:m}; };
const attListe = () => S.courses.map(c=>({c,a:attente(c)})).filter(x=>x.a);
const attDuree = m => m>=60 ? Math.floor(m/60)+" h "+String(m%60).padStart(2,"0") : m+" min";
const attTexte = ({c,a}) => `${condName(c.conducteurId)||"Conducteur"} est ${a.l} chez ${a.nom||c.donneur||"le client"} depuis ${attDuree(a.min)}, sans avancement`;
let attTimer=null;
function attCheck(){ if(!isStaff()) return; const L=attListe(); let vu={}; try{ vu=JSON.parse(localStorage.mobilogAttVu||"{}"); }catch(e){}
  const now=Date.now(); Object.keys(vu).forEach(k=>{ if(now-vu[k]>864e5) delete vu[k]; });
  const nouv=L.filter(x=>!vu[x.c.id+":"+x.a.k]);
  nouv.forEach(x=>{ vu[x.c.id+":"+x.a.k]=now; }); try{ localStorage.mobilogAttVu=JSON.stringify(vu); }catch(e){}
  if(nouv.length){ const x=nouv[0]; toastAct(`<span><b>Attente :</b> ${esc(attTexte(x))}${nouv.length>1?" (+"+(nouv.length-1)+" autre"+(nouv.length>2?"s":"")+")":""}</span> <button type="button" class="btn btn-ghost btn-sm" data-open="${esc(x.c.id)}">Ouvrir</button>`,20000); }
  if(!$("#mbg")){ if(S.view==="planning") render(); else renderNav(); } }
const incNew = c => incOf(c).filter(i=>!i.vu);
const hasBL = c => (c.docs||[]).some(d=>d.type==="bl");
const DRV_ST = ["envoyee","en_cours","terminee"];
/* étape d'avancement d'une course, d'après les heures validées par le chauffeur : arrivée enlèvement, chargé, arrivée livraison, livré */
const ETAPES = { chg:{l:"Au chargement",h:"arriveeEnl"}, route:{l:"En route",h:"chargeEnl"}, liv:{l:"À la livraison",h:"arriveeLiv"} };
function etape(c){ const st=c.statut||"a_planifier"; if(!DRV_ST.includes(st) || st==="terminee") return st;
  if(c.livre) return "terminee"; if(c.arriveeLiv) return "liv"; if(c.chargeEnl) return "route"; if(c.arriveeEnl) return "chg"; return st; }
const etapeLib = c => { const k=etape(c); return (ETAPES[k]||STATUTS[k]||{}).l || k; };
const FRISE = [["arriveeEnl","Enlèvement","chg"],["chargeEnl","Chargé","route"],["arriveeLiv","Livraison","liv"],["livre","Livré","terminee"]];
function friseHtml(c){ if(!DRV_ST.includes(c.statut)) return "";
  const cur = c.livre?3 : c.arriveeLiv?2 : c.chargeEnl?1 : c.arriveeEnl?0 : -1;
  const PH=[["Chargement en cours","chg","run"],["En route vers la livraison","run","liv"],["Déchargement en cours","liv","done"]];
  const ph = cur>=0 && cur<3 ? PH[cur] : null;
  const fr=`<div class="frise" role="list" aria-label="Avancement de la course">${FRISE.map(([k,l,e],i)=>{ const cl=i<=cur?"ok":"";
    const col=e==="terminee"?"done":e==="route"?"run":e; const go=ph && i===cur+1; return `<div class="fs ${cl}${go?" go":""}" role="listitem" style="--c:var(--${col}-bd);--cs:var(--${col}-bg)${go?`;--p1:var(--${ph[1]}-bd);--p2:var(--${ph[2]}-bd)`:""}"><span class="pt">${cl==="ok"?"✓":i+1}</span><b>${l}</b><span class="h">${esc(c[k]||"—")}</span></div>`; }).join("")}</div>`;
  return fr + (ph?`<div class="fnow" style="--p1:var(--${ph[1]}-bd);--p2:var(--${ph[2]}-bd)" role="status"><i class="fbar" aria-hidden="true"></i>${ph[0]}</div>`:""); }
// courses d'un conducteur pour un jour : celles qui s'enlèvent ou se livrent ce jour-là, plus (aujourd'hui) celles des 7 derniers jours pas encore terminées
function inDay(c,d){ const a=c.enlDate, b=(c.livDate&&c.livDate>=c.enlDate)?c.livDate:c.enlDate; if(!a) return false;
  if(a<=d && d<=b) return true;
  return d===todayIso() && b<d && a>=addDays(d,-7) && (c.statut==="envoyee"||c.statut==="en_cours"); }
/* plusieurs conducteurs sur une même course : « surcouche » = la course vue par UN conducteur (ses propres étapes, son rôle) */
const ROLES = { complet:"Course complète", enlevement:"Enlèvement seulement", livraison:"Livraison seulement" };
const affsOf = id => (S.affs||[]).filter(a=>a.courseId===id);
function affOverlay(c,a){ return Object.assign({},c,{conducteurId:a.conducteurId,camionId:a.camionId,remorqueId:a.remorqueId,arriveeEnl:a.arriveeEnl,chargeEnl:a.chargeEnl,arriveeLiv:a.arriveeLiv,livre:a.livre,reserve:a.reserve,vuLe:a.vuLe,_aff:a.id,_role:a.role,_part:Number(a.part)}); }
function drvOverlay(c,cid){
  const a=affsOf(c.id).find(x=>x.conducteurId===cid); let o=c, role=c.rolePrincipal||"complet";
  if(a){ o=affOverlay(c,a); role=a.role; } else if(c.conducteurId!==cid) return null;
  else o=Object.assign({},c,{_role:role,_part:Number(c.partPrincipal??100)});
  if(DRV_ST.includes(c.statut) && (a || role!=="complet" || affsOf(c.id).length)){
    const fait = role==="enlevement" ? o.chargeEnl : o.livre, debute = o.arriveeEnl||o.chargeEnl||o.arriveeLiv;
    o.statut = fait ? "terminee" : debute ? "en_cours" : "envoyee"; }
  return o; }
const meDrv = () => isStaff() ? S.me : S.mem.conducteur_id;
const drvC = id => { const c=S.courses.find(x=>x.id===id); return c ? (drvOverlay(c,meDrv())||c) : null; };
const affArg = id => { if(!isStaff()) return {}; const a=affsOf(id).find(x=>x.conducteurId===S.me); return a ? {p_aff:a.id} : {}; };
function myDay(condId,d){ return S.courses.map(c=>drvOverlay(c,condId)).filter(c=>c && DRV_ST.includes(c.statut) && inDay(c,d))
  .sort((x,y)=>(x.enlDate||"").localeCompare(y.enlDate||"") || (toMin(x.enlHeure)||0)-(toMin(y.enlHeure)||0)); }
const gmaps=(a,cp,v)=>`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([a,cp,v].filter(Boolean).join(" "))}`;
const isStaff = () => S.mem && (S.mem.role==="admin" || S.mem.role==="exploitant");
const EID = () => S.mem && S.mem.entreprise_id;

/* ---------- toast ---------- */
let tt; function toast(msg){ const t=$("#toast"); t.textContent=msg; t.hidden=false; clearTimeout(tt); tt=setTimeout(()=>t.hidden=true,3600); }
function toastAct(html,ms){ const t=$("#toast"); t.innerHTML=html; t.hidden=false; clearTimeout(tt); tt=setTimeout(()=>t.hidden=true,ms||12000); }
function errMsg(e){ const m=(e&&(e.message||e.error_description||e.msg))||"";
  if(/code_invalide/.test(m)) return "Ce code n'est pas valable ou a expiré (7 jours). Vérifie-le, ou demande un nouveau code à ton exploitation.";
  if(/captcha/i.test(m)) return "Vérification anti-robot impossible. Rechargez la page et réessayez.";
  if(/code_utilise/.test(m)) return "Ce code a déjà servi. Demande un nouveau code à ton exploitation.";
  if(/deja_exploitant/.test(m)) return "Ce navigateur est connecté avec un compte d'exploitation. Ouvrez Dream Chauffeur sur le téléphone du conducteur.";
  if(/deja_membre/.test(m)) return "Ce compte est déjà rattaché à une entreprise.";
  if(/Invalid login credentials/i.test(m)) return "E-mail ou mot de passe incorrect.";
  if(/Email not confirmed/i.test(m)) return "Votre e-mail n'est pas encore confirmé : ouvrez le lien reçu par e-mail.";
  if(/already registered|already been registered/i.test(m)) return "Un compte existe déjà avec cet e-mail : connectez-vous.";
  if(/Password should be/i.test(m)) return "Le mot de passe doit contenir au moins 8 caractères.";
  if(/rate limit|too many/i.test(m)) return "Trop d'essais d'un coup : réessayez dans quelques minutes.";
  if(/Failed to fetch|NetworkError|network/i.test(m)) return "Pas de connexion internet : réessayez.";
  if(/interdit|row-level security/i.test(m)) return "Action non autorisée pour votre compte.";
  return "L'action a échoué. Réessayez." + (m ? " ("+m.slice(0,80)+")" : "");
}

/* ---------- conversions base <-> application ---------- */
function fromDb(row){ const o={}; for(const k in row){ let v=row[k]; const ck=snake2camel(k); if(TIME_KEYS.includes(ck) && typeof v==="string") v=v.slice(0,5); o[ck]=v; } return o; }
function toDb(obj){ const o={}; for(const k in obj){ if(k==="id"||k==="entrepriseId"||k==="createdAt"||k==="updatedAt") continue; let v=obj[k]; if(v===undefined) continue; if(v==="") v=null; o[camel2snake(k)]=v; } return o; }

/* ---------- chargement des données ---------- */
let reloadTimer=null;
function scheduleReload(){ clearTimeout(reloadTimer); reloadTimer=setTimeout(loadData,250); }
async function loadData(){
  if(!S.mem) return;
  const eid=EID(); const since=addDays(todayIso(),-400);
  const q = [
    sb.from("courses").select("*").eq("entreprise_id",eid).or(`enl_date.gte.${since},enl_date.is.null`).order("enl_date",{ascending:false}).limit(3000),
    sb.from("conducteurs").select("*").eq("entreprise_id",eid),
    sb.from("camions").select("*").eq("entreprise_id",eid),
    sb.from("remorques").select("*").eq("entreprise_id",eid)
  ];
  if(isStaff()){ q.push(sb.from("membres").select("user_id,role,conducteur_id,derniere_connexion,appareil").eq("entreprise_id",eid));
    q.push(sb.from("acces_conducteurs").select("code,conducteur_id,expire_le,utilisations").eq("entreprise_id",eid)); }
  const r = await Promise.all(q);
  const bad = r.find(x=>x.error); if(bad){ toast(errMsg(bad.error)); }
  S.courses=(r[0].data||[]).map(fromDb); S.conducteurs=(r[1].data||[]).map(fromDb); S.camions=(r[2].data||[]).map(fromDb); S.remorques=(r[3].data||[]).map(fromDb);
  { const ra=await sb.from("course_affectations").select("*").eq("entreprise_id",eid); S.affs = ra.error ? [] : (ra.data||[]).map(fromDb); }
  S.membres = r[4] ? (r[4].data||[]) : [];
  S.acces = r[5] ? (r[5].data||[]).filter(a=>new Date(a.expire_le)>new Date() && !(a.utilisations>=2)) : [];
  if(isStaff()){ const n=S.courses.reduce((t,c)=>t+incNew(c).length,0);
    if(S.incN!=null && n>S.incN){ const c=S.courses.filter(x=>incNew(x).length).sort((x,y)=>String(incNew(y).slice(-1)[0].le).localeCompare(String(incNew(x).slice(-1)[0].le)))[0];
      const i=c&&incNew(c).slice(-1)[0]; if(i) toast(`Problème signalé par ${condById(c.conducteurId)?.nom||"un conducteur"} : ${INC[i.type]||"Autre"}`); }
    S.incN=n; }
  if(isStaff()){ const pa=await sb.rpc("push_actifs",{p_entreprise:eid}); S.pushActifs = pa.error ? null : new Set((pa.data||[]).map(x=>typeof x==="string"?x:Object.values(x)[0])); }
  if(isStaff()) for(const f of X.onData){ try{ await f(); }catch(e){ console.error(e); } }
  if(S.mem.role==="conducteur" && !bad) detecterNouvelles(); // jamais sur un chargement en erreur : il ferait croire que tout est nouveau
  const dejaCharge=S.loaded; S.loaded=true;
  if(dejaCharge && saisieEnCours()){ renduEnAttente=true; return; } // on ne redessine pas sous les doigts de l'utilisateur
  render();
}
/* une saisie non enregistrée (champ actif ou modifié) ne doit jamais être effacée par un rechargement en arrière-plan */
let renduEnAttente=false;
function saisieEnCours(){
  try{
    const a=document.activeElement;
    const zone=e=>e && e.closest && e.closest("#view,#modal");
    if(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && zone(a)) return true;
    return [...document.querySelectorAll("#view input,#view textarea,#modal input,#modal textarea")].some(i=>{
      if(i.type==="hidden"||i.type==="button"||i.type==="submit") return false;
      if(i.type==="checkbox"||i.type==="radio") return i.checked!==i.defaultChecked;
      return i.value!==i.defaultValue; });
  }catch(e){ return false; }
}
document.addEventListener("focusout",()=>{ setTimeout(()=>{ if(renduEnAttente && !saisieEnCours()){ renduEnAttente=false; render(); } },400); });
/* ---------- conducteur : notification d'une nouvelle course reçue ---------- */
const vuesMem = {};
function lireVues(k){ const raw=store.get(k); if(raw!==null){ try{ return new Set(JSON.parse(raw)); }catch(e){ return new Set(); } } return vuesMem[k] ? new Set(vuesMem[k]) : null; }
function ecrireVues(k,ids){ vuesMem[k]=ids; store.set(k,JSON.stringify(ids)); }
function signalerApp(n){ try{ document.title=(n?"("+n+") ":"")+APPNAME; if(n){ navigator.setAppBadge && navigator.setAppBadge(n).catch(()=>{}); } else { navigator.clearAppBadge && navigator.clearAppBadge().catch(()=>{}); } }catch(e){} }
function detecterNouvelles(){
  const k="dc_vues_"+S.mem.conducteur_id;
  const miennes=S.courses.map(c=>drvOverlay(c,S.mem.conducteur_id)).filter(c=>c && DRV_ST.includes(c.statut));
  const vues=lireVues(k);
  if(!vues){ ecrireVues(k,miennes.map(c=>c.id)); S.nouvelles=[]; return; } // première ouverture : rien à signaler
  const hier=addDays(todayIso(),-1);
  const nv=miennes.filter(c=>!vues.has(c.id) && c.statut==="envoyee" && (c.livDate||c.enlDate||"")>=hier).map(c=>c.id);
  const avant=new Set(S.nouvelles||[]); const fraiches=nv.filter(id=>!avant.has(id));
  S.nouvelles=nv; miennes.forEach(c=>{ if(!nv.includes(c.id)) vues.add(c.id); }); ecrireVues(k,[...vues].slice(-800)); signalerApp(nv.length);
  if(fraiches.length){ toast(fraiches.length>1?`${fraiches.length} nouvelles courses reçues`:"Nouvelle course reçue");
    try{ navigator.vibrate && navigator.vibrate([200,100,200]); }catch(e){}
    try{ const AC=window.AudioContext||window.webkitAudioContext; const a=new AC(), o=a.createOscillator(), g=a.createGain(); o.frequency.value=880; g.gain.value=0.08; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime+0.25); setTimeout(()=>a.close(),600); }catch(e){} }
}
const vuesEnvoyees = new Set();
function signalerVues(ids){ // « vu par le chauffeur » : visible côté exploitation
  if(!S.mem || S.mem.role!=="conducteur") return; ids=ids.filter(id=>{ const c=drvC(id); return c && !c.vuLe && !vuesEnvoyees.has(id); });
  if(!ids.length) return; ids.forEach(id=>vuesEnvoyees.add(id)); sb.rpc("marquer_vues",{p_ids:ids}).then(r=>{ if(r&&r.error) ids.forEach(id=>vuesEnvoyees.delete(id)); },()=>{ ids.forEach(id=>vuesEnvoyees.delete(id)); }); }
function marquerVues(){ if(!S.mem || S.mem.role!=="conducteur") return; signalerVues((S.nouvelles||[]).slice()); const k="dc_vues_"+S.mem.conducteur_id; const v=lireVues(k)||new Set(); (S.nouvelles||[]).forEach(id=>v.add(id)); ecrireVues(k,[...v]); S.nouvelles=[]; signalerApp(0); }
let channel=null;
function subscribe(){
  if(channel) sb.removeChannel(channel);
  const f=`entreprise_id=eq.${EID()}`;
  channel = sb.channel("tp-"+EID());
  ["courses","conducteurs","camions","remorques","course_affectations"].forEach(t=> channel.on("postgres_changes",{event:"*",schema:"public",table:t,filter:f},scheduleReload));
  channel.subscribe();
  if(!subscribe.done){ subscribe.done=true; // filet de sécurité si le temps réel est coupé
    setInterval(()=>{ if(S.mem && document.visibilityState==="visible") loadData(); }, 60000);
    document.addEventListener("visibilitychange",()=>{ if(S.mem && document.visibilityState==="visible") loadData(); }); }
}
async function saveCourse(id,obj){ const row=toDb(obj);
  const res = id ? await sb.from("courses").update(row).eq("id",id) : await sb.from("courses").insert(Object.assign(row,{entreprise_id:EID()})).select("id");
  if(res.error){ toast(errMsg(res.error)); return false; } saveCourse.lastId = id || (res.data&&res.data[0]&&res.data[0].id) || null; scheduleReload(); return true; }
async function patchCourse(id,patch){ return saveCourse(id,patch); }
async function tableWrite(table, op, id, obj){
  let res;
  if(op==="insert") res=await sb.from(table).insert(Object.assign(toDb(obj),{entreprise_id:EID()}));
  else if(op==="update") res=await sb.from(table).update(toDb(obj)).eq("id",id);
  else res=await sb.from(table).delete().eq("id",id);
  if(res.error){ toast(errMsg(res.error)); return false; } scheduleReload(); return true;
}

/* ---------- références ---------- */
const condById = id => S.conducteurs.find(c=>c.id===id);
const camById = id => S.camions.find(c=>c.id===id);
const remById = id => S.remorques.find(c=>c.id===id);
const condName = id => condById(id)?.nom || "";
const camName = id => camById(id)?.immat || "";
const remName = id => remById(id)?.immat || "";
const activeConds = () => S.conducteurs.filter(c=>c.actif!==false).sort((a,b)=>cmpTxt(a.nom,b.nom));
const activeCams = () => S.camions.filter(c=>c.actif!==false).sort((a,b)=>(a.immat||"").localeCompare(b.immat||""));
const activeRems = () => S.remorques.filter(c=>c.actif!==false).sort((a,b)=>(a.immat||"").localeCompare(b.immat||""));
const catVeh = k => /tracteur|semi/i.test((k&&k.type)||"") ? "tracteur" : /porteur/i.test((k&&k.type)||"") ? "porteur" : "autre";
const CAT_ORDRE = { tracteur:0, porteur:1, autre:2 }, CAT_LIB = { tracteur:"Tracteurs", porteur:"Porteurs", autre:"Autres véhicules" };
const cmpTxt = (a,b) => String(a||"").localeCompare(String(b||""),"fr",{sensitivity:"base",numeric:true});
const isTracteur = id => /tracteur|semi/i.test(camById(id)?.type||"");
const vehLabel = c => [camName(c.camionId), c.remorqueId&&isTracteur(c.camionId)?remName(c.remorqueId):""].filter(Boolean).join(" + ");
const isRepos = (c,date) => Array.isArray(c?.repos) && c.repos.includes(date);
const aFacturer = c => c.statut==="terminee" && !c.facturee;

/* ---------- navigation ---------- */
const VIEWS = ["planning","courses","indicateurs","conducteur","parametres"];
function readHash(){ const h=(location.hash||"").replace("#",""); const mc=/^course=([\w-]{1,64})$/.exec(h); if(mc && MODE==="chauffeur"){ S.ouvrir=mc[1]; history.replaceState(null,"",location.pathname+location.search); } S.view = (VIEWS.includes(h)||X.views[h])?h:(MODE==="chauffeur"?"planning":"indicateurs"); if(MODE==="chauffeur" || (S.mem && !isStaff())) S.view="conducteur"; }
window.addEventListener("hashchange",()=>{ readHash(); render(); window.scrollTo(0,0); });

function renderNav(){
  const cnt = st => S.courses.filter(c=>c.statut===st).length;
  const af = S.courses.filter(aFacturer).length;
  const L = (v,label) => `<a href="#${v}" class="${S.view===v?"on":""}">${label}</a>`;
  const sub = (st,label,n,hot) => `<a href="#courses" class="sub" data-fst="${st}">${label}<span class="cnt ${hot&&n?"hot":""}">${n}</span></a>`;
  if(X.nav){ $("#nav").innerHTML = X.nav(); $("#coName").textContent = S.entreprise?.nom || "Exploitation"; $("#whoami").textContent = S.session?.user?.email || ""; return; }
  $("#nav").innerHTML =
    `<span class="grp">EXPLOITATION</span>`+L("planning","Planning")+L("courses","Courses")+
    sub("a_planifier","À planifier",cnt("a_planifier"),true)+sub("planifiee","Planifiées",cnt("planifiee"))+
    sub("envoyee","Envoyées",cnt("envoyee"))+sub("en_cours","En cours",cnt("en_cours"))+
    sub("terminee","Terminées",cnt("terminee"))+sub("afacturer","À facturer",af)+
    L("indicateurs","Indicateurs")+`<span class="grp">TERRAIN</span>`+L("conducteur","Vue conducteur")+
    `<span class="grp">GESTION</span>`+L("parametres","Conducteurs & véhicules");
  $("#coName").textContent = S.entreprise?.nom || "Exploitation";
  $("#whoami").textContent = S.session?.user?.email || "";
}

function render(){
  renduEnAttente=false;
  const v=$("#view");
  if(MODE==="chauffeur" && !S.recovery && (!S.session || !S.mem)){ $("#side").hidden=true; v.innerHTML=vCodeEntry(); return; }
  if(S.recovery || !S.session || !S.mem){ $("#side").hidden=true; v.innerHTML = S.recovery ? vRecovery() : (!S.session ? vAuth() : vOnboard()); return; }
  $("#side").hidden = !isStaff() || S.view==="conducteur";
  if(isStaff()) renderNav();
  if(!S.loaded){ v.innerHTML=`<div class="empty">Chargement des courses…</div>`; return; }
  const fn = {planning:vPlanning, courses:vCourses, indicateurs:vIndic, conducteur:vDriver, parametres:vParams}[S.view] || X.views[S.view];
  v.innerHTML = fn();
  after[S.view] && after[S.view]();
}
const after = {};
/* points d'accroche pour les modules complémentaires (facturation, carnet d'adresses…) */
const X = { attN:()=>attListe().length, attCheck:()=>attCheck(), catVeh, CAT_LIB, CAT_ORDRE, cmpTxt, views:{}, nav:null, onData:[], after, S, sb, $, esc, toast, errMsg, openModal, closeModal, render, loadData, EID, isStaff, frDate, todayIso, addDays };

/* ---------- CONNEXION ---------- */
function authShell(inner){ const img = MODE==="chauffeur" ? `<img src="icon-192.png" alt="" style="border-radius:12px">` : `<img src="logo-or.png" alt="Tonton Business" style="width:100%;max-width:260px;border-radius:12px">`;
  return `<div class="auth"><div class="auth-card"><div class="logo"${MODE==="chauffeur"?"":' style="flex-direction:column;align-items:center;gap:8px"'}>${img}<b>${APPNAME}</b></div>${inner}</div></div>`; }
/* ---------- NOTIFICATIONS (Dream Chauffeur) ---------- */
const pushOk = () => MODE==="chauffeur" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const b64uOctets = s => { const t=atob(s.replace(/-/g,"+").replace(/_/g,"/")); return Uint8Array.from(t,ch=>ch.charCodeAt(0)); };
let swReg=null;
function swEnregistrer(){ if(!pushOk() || swReg) return swReg; swReg=navigator.serviceWorker.register("sw.js").catch(()=>null);
  navigator.serviceWorker.addEventListener("message",ev=>{ const m=ev.data||{}; if(m.type==="ouvrir" && m.course){ S.ouvrir=m.course; } if(m.type==="push"||m.type==="ouvrir") loadData(); });
  return swReg; }
async function pushAbonner(){ // l'autorisation est déjà donnée
  const reg = await swEnregistrer(); if(!reg) throw new Error("sw");
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if(!sub){ const {data,error}=await sb.functions.invoke("envoyer-push",{body:{action:"cle"}});
    if(error || !data || !data.cle) throw (error||new Error("cle"));
    sub = await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:b64uOctets(data.cle)}); }
  const j=sub.toJSON(); const {error}=await sb.rpc("abonner_push",{p_endpoint:j.endpoint,p_p256dh:j.keys.p256dh,p_auth:j.keys.auth});
  if(error) throw error; store.set("dc_push","1");
}
let pushSyncFait=false;
function pushSync(){ // à chaque ouverture : garde l'abonnement à jour (le téléphone peut le changer)
  if(pushSyncFait || !pushOk() || !S.mem || S.mem.role!=="conducteur") return; pushSyncFait=true; swEnregistrer();
  if(Notification.permission==="granted") pushAbonner().then(()=>{ if(!$("#pushCard")) return; render(); },()=>{});
}
function pushActiver(){ // doit partir directement du clic (obligatoire sur iPhone)
  let p; try{ p=Notification.requestPermission(); }catch(e){ p=null; }
  Promise.resolve(p).then(async r=>{
    if(r!=="granted"){ render(); toast(r==="denied"?"Notifications refusées. Tu peux les autoriser dans les réglages du téléphone.":"Notifications pas activées."); return; }
    try{ await pushAbonner(); render(); toast("Notifications activées : tu seras prévenu à chaque nouvelle course."); }
    catch(e){ console.error(e); render(); toast("Impossible d'activer les notifications pour le moment. Réessaie dans un instant."); }
  });
}
function pushCarte(){
  if(!pushOk() || !S.mem || S.mem.role!=="conducteur") return "";
  const perm=Notification.permission;
  if(perm==="granted" && store.get("dc_push")==="1") return "";
  const ios=/iPhone|iPad/.test(navigator.userAgent||"");
  if(perm==="denied") return `<div class="job" id="pushCard" style="gap:6px"><b>Notifications bloquées</b>
    <span>${ios?"Réglages du téléphone → <b>Notifications</b> → <b>Dream Chauffeur</b> → Autoriser les notifications.":"Réglages du téléphone → Applications → <b>Dream Chauffeur</b> → Notifications → Autoriser."}</span>
    <span class="muted" style="font-size:13px">Sans elles, tu ne vois les nouvelles courses qu'en ouvrant l'appli.</span></div>`;
  return `<div class="job" id="pushCard" style="gap:8px;border:2px solid var(--accent)"><b>Sois prévenu des nouvelles courses</b>
    <span>Ton téléphone sonne dès que l'exploitation t'envoie une course, même quand l'appli est fermée.</span>
    <button type="button" class="btn btn-accent big" data-drv="pushon" data-id="">Activer les notifications</button></div>`;
}
function installTip(){
  if(MODE!=="chauffeur" || standalone() || store.get("dc_tip")==="0") return "";
  const ios=/iPhone|iPad/.test(navigator.userAgent||"");
  return `<div class="job" style="gap:6px"><b>Installe Dream Chauffeur sur ton téléphone</b>
    <span>${ios?"Dans <b>Safari</b> : bouton <b>Partager</b> (carré avec une flèche) → <b>« Sur l'écran d'accueil »</b> → Ajouter.":"Menu <b>⋮</b> du navigateur → <b>« Ajouter à l'écran d'accueil »</b> ou « Installer l'application »."}</span>
    <span class="muted" style="font-size:13px">L'icône Dream Chauffeur apparaît avec tes autres applications : tu n'as plus qu'à l'ouvrir pour voir ton programme.</span>
    <button type="button" class="linkbtn" data-act="hidetip" style="align-self:flex-start">C'est fait</button></div>`;
}
function vCodeEntry(){
  return authShell(`<h1>Bienvenue</h1>
    <p style="margin:0">Entre le <b>code d'invitation</b> reçu de ton exploitation (par SMS ou WhatsApp). Tu le fais une seule fois : ensuite, ton programme s'affiche dès que tu ouvres l'application.</p>
    <form id="codeForm" style="display:flex;flex-direction:column;gap:10px"><label class="fld">Code d'invitation<input type="text" id="cCode" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="14" style="text-transform:uppercase;letter-spacing:.15em;font-size:20px;text-align:center" required></label>
    ${S.authErr?`<p class="err" style="margin:0">${esc(S.authErr)}</p>`:""}<button class="btn btn-accent big" type="submit">Valider</button></form>`);
}
function vAuth(){
  const m=S.authMode;
  if(m==="forgot") return authShell(`<h1>Mot de passe oublié</h1><p class="muted" style="margin:0">Indiquez votre e-mail : vous recevrez un lien pour choisir un nouveau mot de passe.</p>
    <form id="authForm" style="display:flex;flex-direction:column;gap:10px"><label class="fld">E-mail<input type="email" id="aEmail" autocomplete="email" required></label>
    ${S.authErr?`<p class="err" style="margin:0">${esc(S.authErr)}</p>`:""}<button class="btn btn-accent" type="submit">Envoyer le lien</button></form>
    <button type="button" class="linkbtn" data-auth="login">Retour à la connexion</button>`);
  const signup = m==="signup";
  return authShell(`<h1>${signup?"Créer le compte de votre entreprise":"Connexion"}</h1>
    <p class="muted" style="margin:0">${signup?"Pour l'exploitation (gérant, exploitant). Les conducteurs n'ont pas besoin de compte : ils reçoivent un lien d'accès.":"Espace exploitation. Conducteur ? Utilisez l'application Dream Chauffeur et le code reçu de votre exploitation."}</p>
    <form id="authForm" style="display:flex;flex-direction:column;gap:10px">
      <label class="fld">E-mail<input type="email" id="aEmail" autocomplete="email" required></label>
      <label class="fld">Mot de passe<input type="password" id="aPass" autocomplete="${signup?"new-password":"current-password"}" minlength="8" required></label>
      ${S.authErr?`<p class="err" style="margin:0">${esc(S.authErr)}</p>`:""}
      <button class="btn btn-accent" type="submit">${signup?"Créer mon compte":"Se connecter"}</button></form>
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <button type="button" class="linkbtn" data-auth="${signup?"login":"signup"}">${signup?"J'ai déjà un compte":"Créer un compte entreprise"}</button>
      ${signup?"":`<button type="button" class="linkbtn" data-auth="forgot">Mot de passe oublié ?</button>`}</div>`);
}
function vRecovery(){ return authShell(`<h1>Nouveau mot de passe</h1><form id="recForm" style="display:flex;flex-direction:column;gap:10px"><label class="fld">Nouveau mot de passe (8 caractères minimum)<input type="password" id="rPass" minlength="8" autocomplete="new-password" required></label>${S.authErr?`<p class="err" style="margin:0">${esc(S.authErr)}</p>`:""}<button class="btn btn-accent" type="submit">Enregistrer</button></form>`); }
function vOnboard(){
  const anon = S.session?.user?.is_anonymous;
  if(anon) return authShell(`<h1>Accès conducteur</h1><p style="margin:0">Ce téléphone n'est rattaché à aucun conducteur. Demandez à votre exploitation un <b>nouveau lien d'accès</b>, ou saisissez le code reçu.</p>
    <form id="codeForm" style="display:flex;flex-direction:column;gap:10px"><label class="fld">Code d'accès<input type="text" id="cCode" autocomplete="one-time-code" style="text-transform:uppercase;letter-spacing:.1em" required></label>${S.authErr?`<p class="err" style="margin:0">${esc(S.authErr)}</p>`:""}<button class="btn btn-accent" type="submit">Valider</button></form>`);
  return authShell(`<h1>Bienvenue !</h1><p style="margin:0">Dernière étape : le nom de votre entreprise de transport. Vous en serez l'administrateur.</p>
    <form id="entForm" style="display:flex;flex-direction:column;gap:10px"><label class="fld">Nom de l'entreprise<input type="text" id="eNom" maxlength="120" required></label>${S.authErr?`<p class="err" style="margin:0">${esc(S.authErr)}</p>`:""}<button class="btn btn-accent" type="submit">Créer mon espace</button></form>
    <button type="button" class="linkbtn" data-act="logout">Se déconnecter</button>`);
}
document.addEventListener("submit", async e=>{
  const f=e.target;
  if(f.id==="authForm"){ e.preventDefault(); S.authErr=""; const email=$("#aEmail").value.trim(); const btn=f.querySelector("button[type=submit]"); btn.disabled=true;
    try{
      if(S.authMode==="forgot"){ const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:CFG.appUrl,captchaToken:await jetonCaptcha()}); if(error) throw error; toast("Lien envoyé : vérifiez vos e-mails."); S.authMode="login"; render(); return; }
      const pass=$("#aPass").value;
      if(S.authMode==="signup"){ const {data,error}=await sb.auth.signUp({email,password:pass,options:{emailRedirectTo:CFG.appUrl,captchaToken:await jetonCaptcha()}}); if(error) throw error;
        if(!data.session){ S.authMode="login"; S.authErr=""; render(); toast("Compte créé : confirmez votre e-mail puis connectez-vous."); return; } }
      else { const {error}=await sb.auth.signInWithPassword({email,password:pass,options:{captchaToken:await jetonCaptcha()}}); if(error) throw error; }
      S.authErr=""; await boot(); return;
    }catch(err){ S.authErr=errMsg(err); render(); }
    finally{ btn.disabled=false; } }
  if(f.id==="recForm"){ e.preventDefault(); const {error}=await sb.auth.updateUser({password:$("#rPass").value}); if(error){ S.authErr=errMsg(error); render(); return; } S.recovery=false; S.authErr=""; toast("Mot de passe modifié"); await boot(); }
  if(f.id==="entForm"){ e.preventDefault(); const nom=$("#eNom").value.trim(); if(!nom) return; const {error}=await sb.rpc("creer_entreprise",{p_nom:nom}); if(error){ S.authErr=errMsg(error); render(); return; } S.authErr=""; await boot(); }
  if(f.id==="codeForm"){ e.preventDefault(); await joinWithCode($("#cCode").value); }
});
async function joinWithCode(code){
  code=(code||"").trim().toUpperCase(); if(!code) return;
  try{
    let { data:{session} } = await sb.auth.getSession();
    if(!session){ const {data,error}=await sb.auth.signInAnonymously({options:{captchaToken:await jetonCaptcha()}}); if(error) throw error; session=data.session; }
    const {error}=await sb.rpc("rejoindre_conducteur",{p_code:code}); if(error) throw error;
    S.authErr="";
    // Dream Chauffeur : le code reste dans l'adresse, pour que l'icône installée sur l'écran d'accueil s'ouvre déjà connectée
    history.replaceState(null,"",location.pathname+(MODE==="chauffeur"?"?code="+encodeURIComponent(code):"#conducteur"));
    await boot(); toast("Téléphone rattaché : bienvenue !");
  }catch(err){ S.authErr=errMsg(err); await boot(); if(S.mem) toast(S.authErr); }
}

/* ---------- PLANNING ---------- */
function lanes(list){
  const items = list.map(c=>{ let a=toMin(c.enlHeure); if(a==null) a=8*60; let b=toMin(c.livHeure);
    if(b==null||(c.livDate&&c.livDate!==c.enlDate)||b<=a) b=Math.min(a+120,24*60); return {c,a,b}; }).sort((x,y)=>x.a-y.a);
  const ends=[]; let clash=false;
  items.forEach(it=>{ let l=ends.findIndex(e=>e<=it.a); if(l<0){ l=ends.length; ends.push(0);} ends[l]=it.b; it.l=l; });
  items.forEach(it=>{ it.clash = items.some(o=>o!==it && o.a<it.b && it.a<o.b); if(it.clash) clash=true; });
  return {items, n:Math.max(1,ends.length), clash};
}
const pct = m => ((Math.min(Math.max(m,DAY0),DAY1)-DAY0)/(DAY1-DAY0)*100);
function hourLines(){ return [6,8,10,12,14,16,18].map(h=>`<span class="hourline" style="left:${pct(h*60)}%"></span>`).join(""); }
function vPlanning(){
  const day = S.courses.filter(c=>c.enlDate===S.date && c.statut!=="annulee");
  const todo = day.filter(c=>!(c.sousTraitantId || (S.mode==="conducteur"?c.conducteurId:c.camionId)) || c.statut==="a_planifier");
  const conds = activeConds(), cams = activeCams();
  const rowsSrc = S.mode==="conducteur" ? conds.concat(X.planRows?X.planRows():[]) : cams;
  const alerts=[];
  attListe().forEach(x=>alerts.push(`<div class="alert" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:space-between"><span><b>Attente ${esc(x.a.l)} :</b> ${esc(attTexte(x))}</span><button type="button" class="btn btn-ghost btn-sm" data-open="${esc(x.c.id)}">Ouvrir</button></div>`));
  if(X.planAlerts) alerts.push(...X.planAlerts());
  S.courses.filter(c=>incNew(c).length).slice(0,8).forEach(c=>incNew(c).forEach(i=>alerts.push(`<div class="alert" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:space-between"><span><b>Problème signalé${i.heure?" à "+esc(i.heure):""} :</b> ${esc(INC[i.type]||"Autre")} — ${esc(condById(c.conducteurId)?.nom||"Conducteur")} · ${esc(c.donneur||"")}${i.commentaire?" — "+esc(i.commentaire):""}</span><button type="button" class="btn btn-ghost btn-sm" data-open="${esc(c.id)}">Ouvrir la course</button></div>`)));
  const rowsHtml = rowsSrc.map(r=>{
    let mine = r.st ? day.filter(c=>c.sousTraitantId===r.stId && c.statut!=="a_planifier") : day.filter(c=>!c.sousTraitantId && (S.mode==="conducteur"?c.conducteurId:c.camionId)===r.id && c.statut!=="a_planifier");
    if(!r.st) (S.affs||[]).filter(a=>(S.mode==="conducteur"?a.conducteurId:a.camionId)===r.id).forEach(a=>{ const c=day.find(x=>x.id===a.courseId); if(c && c.statut!=="a_planifier") mine.push(affOverlay(c,a)); });
    const L = lanes(mine);
    const off = !r.st && S.mode==="conducteur" && isRepos(r,S.date);
    const label = S.mode==="conducteur" ? r.nom : r.immat;
    const subl = r.st ? "Sous-traitant" : S.mode==="conducteur" ? (camName(r.camionId)? "Véhicule habituel : "+camName(r.camionId):"Pas de véhicule habituel") : (r.type||"");
    if(L.clash) alerts.push(`<div class="alert"><b>Chevauchement :</b> ${esc(label)} a des courses aux mêmes heures.</div>`);
    if(off && mine.length) alerts.push(`<div class="alert"><b>Repos :</b> ${esc(label)} est en repos mais a ${mine.length} course(s).</div>`);
    const ca = mine.reduce((s,c)=>{ const part = c._aff ? c._part : (affsOf(c.id).length ? Number(c.partPrincipal??100) : 100); return s+(Number(c.prix)||0)*part/100; },0);
    const h = Math.max(62, L.n*44+12);
    const blocks = L.items.map(it=>{ const c=it.c; const other = S.mode==="conducteur" ? vehLabel(c) : [condName(c.conducteurId), c.remorqueId&&isTracteur(c.camionId)?remName(c.remorqueId):""].filter(Boolean).join(" · ");
      return `<button type="button" class="blk st-${esc(etape(c))} ${it.clash?"clash":""}" data-open="${esc(c.id)}" ${c._aff?"":`data-drag="${esc(c.id)}" draggable="true"`} style="left:${pct(it.a)}%;width:calc(${Math.max(pct(it.b)-pct(it.a),4)}% - 3px);top:${6+it.l*44}px;height:40px" title="${esc(c.donneur)} · ${esc(etapeLib(c))}">
        <b>${esc(c.donneur||"Sans client")}${c._aff?` · ${esc(c._role==="enlevement"?"enlèvement":c._role==="livraison"?"livraison":"partagée")}`:(affsOf(c.id).length?" · +"+affsOf(c.id).length:"")}${c.statut==="envoyee"&&c.conducteurId&&("vuLe" in c)?(c.vuLe?" · vu":" · non vu"):""}</b><span>↑ ${esc(c.enlHeure||"--:--")} ${esc(c.enlVille||"")} → ↓ ${esc(c.livHeure||"")} ${esc(c.livVille||"")}${other?" · "+esc(other):""}</span></button>`; }).join("");
    const tog = S.mode==="conducteur" && !r.st ? `<button type="button" class="btn btn-ghost btn-sm" data-repos="${esc(r.id)}" style="align-self:flex-start;margin-top:4px">${off?"Remettre au travail":"Mettre en repos"}</button>` : "";
    return `<div class="row ${off?"off":""} ${L.clash?"warn":""}" data-drop="${esc(r.id)}">
      <div class="who"><b>${esc(label)}</b><span class="muted" style="font-size:12px">${esc(subl)}</span>${off?'<span style="font-size:12px;font-weight:700">Repos</span>':""}${tog}</div>
      <div class="ca num">${ca?eur(ca):"—"}</div>
      <div class="tl" style="height:${h}px">${hourLines()}${blocks}${!mine.length&&!off?`<span class="muted" style="position:absolute;left:12px;top:20px;font-size:12px">${r.st?"Déposez ici une course à lui confier":"Disponible — déposez une course ici"}</span>`:""}</div></div>`;
  }).join("");
  const byRem={}; day.filter(c=>c.remorqueId && isTracteur(c.camionId) && c.statut!=="a_planifier").forEach(c=>(byRem[c.remorqueId]=byRem[c.remorqueId]||[]).push(c));
  Object.entries(byRem).forEach(([rid,l])=>{ if(l.length>1 && lanes(l).clash) alerts.push(`<div class="alert"><b>Remorque en double :</b> ${esc(remName(rid))} est prévue sur deux courses aux mêmes heures.</div>`); });
  const nCond = conds.filter(c=>!isRepos(c,S.date)).length;
  const engaged = new Set(day.filter(c=>c.conducteurId&&c.statut!=="a_planifier").map(c=>c.conducteurId)).size;
  const caDay = day.reduce((s,c)=>s+(Number(c.prix)||0),0);
  const toSend = aEnvoyer().length;
  return `<div class="bar"><h1>Planning</h1>
    <div class="datebox"><button type="button" aria-label="Jour précédent" data-day="-1">‹</button>
      <label style="display:flex;align-items:center"><span style="position:absolute;left:-9999px">Date</span><input type="date" id="pDate" value="${S.date}"></label>
      <button type="button" aria-label="Jour suivant" data-day="1">›</button></div>
    <button type="button" class="btn btn-ghost btn-sm" data-day="0">Aujourd'hui</button>
    <div class="seg" role="group" aria-label="Affichage"><button type="button" class="${S.mode==="conducteur"?"on":""}" data-mode="conducteur">Par conducteur</button><button type="button" class="${S.mode==="camion"?"on":""}" data-mode="camion">Par véhicule</button></div>
    ${toSend?`<button type="button" class="btn btn-accent" data-act="send">Tout envoyer (${toSend})</button>`:""}</div>
  <p class="muted" style="margin:0">${esc(frDate(S.date))}</p>
  <div class="kpis">
    <div class="kpi"><small>Courses du jour</small><b class="num">${day.length}</b></div>
    <div class="kpi ${todo.length?"warn":""}"><small>À planifier</small><b class="num">${todo.length}</b></div>
    <div class="kpi"><small>Conducteurs engagés</small><b class="num">${engaged} / ${nCond}</b></div>
    <div class="kpi ${alerts.length?"bad":""}"><small>Alertes</small><b class="num">${alerts.length}</b></div>
    <div class="kpi dark"><small>CA du jour</small><b class="num">${eur(caDay)}</b></div></div>
  ${alerts.length?`<div class="alerts">${alerts.join("")}</div>`:""}
  <div class="plan">
    <section class="panel todo" data-drop="__todo" aria-label="Courses à planifier">
      <h2>À planifier <span class="pill hot">${todo.length}</span></h2>
      ${todo.length? todo.sort((a,b)=>(toMin(a.enlHeure)||0)-(toMin(b.enlHeure)||0)).map(cardHtml).join("") : `<p class="muted" style="margin:0">Aucune course à planifier ce jour. Créez une course ou importez une confirmation PDF.</p>`}
      <p class="muted" style="margin:0;font-size:12px">Glissez une course sur une ligne, ou cliquez dessus pour l'affecter.</p>
    </section>
    <section class="panel grid-wrap" aria-label="Planning de la journée"><div class="grid">
      <div class="ghead"><div class="who">${S.mode==="conducteur"?"Conducteur":"Véhicule"}</div><div class="ca">CA</div><div class="tl">${[6,8,10,12,14,16,18].map(h=>`<span style="left:${pct(h*60)}%;transform:none;padding-left:4px">${pad(h)}:00</span>`).join("")}</div></div>
      ${rowsHtml || `<div class="empty">Ajoutez vos ${S.mode==="conducteur"?"conducteurs":"véhicules"} dans <a href="#parametres">Conducteurs & véhicules</a>.</div>`}
    </div></section>
  </div>
  <div class="legend">${[["planifiee","Planifiée"],["envoyee","Envoyée"],["chg","Au chargement"],["route","En route"],["liv","À la livraison"],["terminee","Terminée"]].map(([s,l])=>`<span><i class="st-${s}"></i>${l}</span>`).join("")}<span><i style="border-color:var(--danger)"></i>Alerte</span></div>`;
}
function cardHtml(c){
  const m=[c.palettes&&c.palettes+" pal.",c.colis&&c.colis+" colis",c.poids&&Number(c.poids).toLocaleString("fr-FR")+" kg",c.metres&&c.metres+" m"].filter(Boolean).join(" · ");
  return `<button type="button" class="card" draggable="true" data-drag="${esc(c.id)}" data-open="${esc(c.id)}">
    <span class="t"><b>${esc(c.donneur||"Sans client")}</b><b class="num">${c.prix?eur(c.prix):""}</b></span>
    <span>↑ ${esc(c.enlHeure||"--:--")} ${esc(c.enlVille||"")}${c.enlCp?" ("+esc(String(c.enlCp).slice(0,2))+")":""}</span>
    <span>↓ ${esc(c.livHeure||"--:--")} ${esc(c.livVille||"")}${c.livCp?" ("+esc(String(c.livCp).slice(0,2))+")":""}</span>
    ${m?`<span class="muted">${esc(m)}</span>`:""}${c.ref?`<span class="muted">Réf. ${esc(c.ref)}</span>`:""}${incNew(c).length?`<span style="color:var(--danger);font-weight:700">Problème : ${esc(INC[incNew(c).slice(-1)[0].type]||"Autre")}</span>`:""}</button>`;
}
after.conducteur = ()=>{ // une course affichée sur le téléphone du conducteur, appli au premier plan = course vue
  if(S.ouvrir && S.loaded){ const c=S.courses.find(x=>x.id===S.ouvrir); S.ouvrir=null; if(c){ drvAction("voirnv",c.id); return; } }
  if(S.mem && S.mem.role==="conducteur" && document.visibilityState==="visible") signalerVues([...document.querySelectorAll('[id^="job-"]')].map(e=>e.id.slice(4))); };
after.planning = ()=>{
  const d=$("#pDate"); d && d.addEventListener("change",()=>{ if(d.value){ S.date=d.value; render(); } });
  document.querySelectorAll("[data-drag]").forEach(el=>el.addEventListener("dragstart",e=>{ e.dataTransfer.setData("text/plain",el.dataset.drag); e.dataTransfer.effectAllowed="move"; }));
  document.querySelectorAll("[data-drop]").forEach(z=>{
    z.addEventListener("dragover",e=>{ e.preventDefault(); z.classList.add("drop-on"); });
    z.addEventListener("dragleave",()=>z.classList.remove("drop-on"));
    z.addEventListener("drop",e=>{ e.preventDefault(); z.classList.remove("drop-on"); const id=e.dataTransfer.getData("text/plain"); if(id) assign(id,z.dataset.drop); });
  });
};
async function assign(id,target){
  const c=S.courses.find(x=>x.id===id); if(!c) return;
  if(target==="__todo"){ if(await patchCourse(id,{conducteurId:null,camionId:null,remorqueId:null,statut:"a_planifier"})) toast("Course remise à planifier"); return; }
  if(String(target).startsWith("st:")){ if(X.assignSt) X.assignSt(c,String(target).slice(3)); return; }
  const patch={}; const VU="vuLe" in c;
  if(c.sousTraitantId){ patch.sousTraitantId=null; patch.ordreEnvoyeLe=null; }
  if(S.mode==="conducteur"){ const k=condById(target); patch.conducteurId=target; if(!c.camionId && k?.camionId) patch.camionId=k.camionId; if(isRepos(k,S.date)) toast(k.nom+" est en repos ce jour-là."); }
  else patch.camionId=target;
  const cam=patch.camionId||c.camionId;
  if(cam && isTracteur(cam) && !c.remorqueId && camById(cam)?.remorqueId) patch.remorqueId=camById(cam).remorqueId;
  // affecter à un conducteur = lui envoyer la course tout de suite (annulable quelques secondes)
  const avant=c.statut||"a_planifier", chauffeur=patch.conducteurId||c.conducteurId;
  const prev={conducteurId:c.conducteurId||null,camionId:c.camionId||null,remorqueId:c.remorqueId||null,statut:avant,envoyeLe:c.envoyeLe||null};
  if(chauffeur && (avant==="a_planifier"||avant==="planifiee")){ patch.statut="envoyee"; patch.envoyeLe=new Date().toISOString(); patch.modifieApresEnvoi=false; }
  else if(avant==="a_planifier") patch.statut="planifiee";
  if(VU && (patch.statut==="envoyee" || (patch.conducteurId && patch.conducteurId!==c.conducteurId))) patch.vuLe=null; // nouvel envoi ou nouveau conducteur : pas encore vu
  if(!(await patchCourse(id,patch))) return;
  if(patch.statut==="envoyee" || (avant==="envoyee" && patch.conducteurId && patch.conducteurId!==c.conducteurId)) annonceEnvoi([Object.assign({},c,patch)],{id,prev});
  else toast(chauffeur?"Course affectée":"Véhicule affecté — choisissez un conducteur pour envoyer la course");
}
const aEnvoyer = () => { const lim=addDays(todayIso(),-7); return S.courses.filter(c=>c.conducteurId && c.statut==="planifiee" && (!c.enlDate || c.enlDate>=lim)); };
function pousserCourses(cs){ // vraie notification sur le téléphone du conducteur (si activée)
  const ids=cs.filter(c=>c.conducteurId).map(c=>c.id); if(!ids.length) return;
  sb.functions.invoke("envoyer-push",{body:{courses:ids}}).then(({data})=>{
    const s=$("#toast span"); if(!s || $("#toast").hidden || !data) return;
    if(data.envoyes>0) s.textContent += cs.length===1 ? " · notification reçue sur son téléphone" : " · notifications envoyées";
    else if(cs.length===1) s.textContent += " · notifications pas activées sur son téléphone";
  }).catch(()=>{});
}
function annonceEnvoi(cs, undo){
  const c=cs[0], k=condById(c.conducteurId), un=cs.length===1; S.undoSend=undo||null; pousserCourses(cs);
  const d=((k&&k.tel)||"").replace(/\D/g,""); const intl=/^0\d{9}$/.test(d)?"33"+d.slice(1):(/^33\d{9}$/.test(d)?d:"");
  const msg=k?`Bonjour ${(k.nom||"").split(" ")[0]}, une nouvelle course t'attend dans Dream Chauffeur : ${c.donneur||"course"}, enlèvement ${frDate(c.enlDate,{weekday:"long",day:"numeric",month:"long"})}${c.enlHeure?" à "+c.enlHeure:""}${c.enlVille?" · "+c.enlVille:""}. ${CHAUFFEUR_URL}`:"";
  const bouton=`style="margin-left:10px;background:transparent;border:1px solid var(--side-muted);color:var(--side-fg);border-radius:8px;padding:5px 10px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block"`;
  toastAct(`<span>${un?`Course envoyée à ${esc(k?k.nom:"le conducteur")}`:`${cs.length} courses envoyées aux conducteurs`}</span>${undo?`<button type="button" data-act="undosend" ${bouton}>Annuler</button>`:""}${un&&intl?`<a href="https://wa.me/${intl}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener" ${bouton}>Prévenir par WhatsApp</a>`:""}`, 12000);
}
function avecEnvoi(e,o){ // bouton « Enregistrer et envoyer » de la fiche
  if(!(e.submitter && e.submitter.dataset.send==="1")) return true;
  if(!o.conducteurId){ toast("Choisissez d'abord le conducteur à qui envoyer la course."); return false; }
  if(o.statut==="a_planifier"||o.statut==="planifiee"){ o.statut="envoyee"; o.envoyeLe=new Date().toISOString(); o.modifieApresEnvoi=false; if(S.courses.some(x=>"vuLe" in x)) o.vuLe=null; }
  return true; }
async function sendPlanning(){
  const list=aEnvoyer(); // toutes les courses affectées et pas encore envoyées, quel que soit le jour affiché
  if(!list.length){ toast("Toutes les courses affectées sont déjà envoyées."); return; }
  const {error}=await sb.from("courses").update({statut:"envoyee",envoye_le:new Date().toISOString(),modifie_apres_envoi:false}).in("id",list.map(c=>c.id)).eq("statut","planifiee");
  if(error){ toast(errMsg(error)); return; } scheduleReload(); annonceEnvoi(list);
}

/* ---------- COURSES ---------- */
document.addEventListener("click",e=>{ const j=e.target.closest("[data-fdj],[data-fdclr],[data-fdr]"); if(!j || S.view!=="courses") return;
  const iso=d=>{ const x=new Date(d.getTime()-d.getTimezoneOffset()*60000); return x.toISOString().slice(0,10); };
  if(j.dataset.fdr){ const n=new Date(); let a,b;
    if(j.dataset.fdr==="mois"){ a=new Date(n.getFullYear(),n.getMonth(),1); b=new Date(n.getFullYear(),n.getMonth()+1,0); }
    else if(j.dataset.fdr==="mois1"){ a=new Date(n.getFullYear(),n.getMonth()-1,1); b=new Date(n.getFullYear(),n.getMonth(),0); }
    else { b=n; a=new Date(n.getFullYear(),n.getMonth(),n.getDate()-6); }
    S.fDate=iso(a); S.fDate2=iso(b); S.fPeriode="tout"; }
  else if(j.dataset.fdclr){ S.fDate=""; S.fDate2=""; } else { let d=S.fDate||todayIso(); S.fDate=addDays(d,Number(j.dataset.fdj)); S.fPeriode="tout"; }
  render(); });
function vCourses(){
  const q=S.fQ.trim().toLowerCase(); const t=todayIso();
  let list=S.courses.slice();
  if(S.fStatut==="afacturer") list=list.filter(aFacturer); else if(S.fStatut!=="tous") list=list.filter(c=>c.statut===S.fStatut);
  if(S.fClient) list=list.filter(c=>(c.donneur||"").trim()===S.fClient);
  if(S.fDate){ const a=S.fDate, b=(S.fDate2&&S.fDate2>=S.fDate)?S.fDate2:S.fDate;
    list=list.filter(c=>{ const e=c.enlDate||"", l=c.livDate||c.enlDate||""; return (e>=a&&e<=b)||(l>=a&&l<=b); }); }
  if(S.fPeriode==="jour") list=list.filter(c=>c.enlDate===t);
  if(S.fPeriode==="semaine"){ const a=addDays(t,-((new Date().getDay()+6)%7)), b=addDays(a,6); list=list.filter(c=>c.enlDate>=a&&c.enlDate<=b); }
  if(q) list=list.filter(c=>[c.donneur,c.ref,c.enlVille,c.livVille,c.enlNom,c.livNom,condName(c.conducteurId),camName(c.camionId),remName(c.remorqueId),c.marchandise].join(" ").toLowerCase().includes(q));
  list.sort((a,b)=>(b.enlDate||"").localeCompare(a.enlDate||"") || (toMin(a.enlHeure)||0)-(toMin(b.enlHeure)||0));
  const cnt=st=> st==="tous"?S.courses.length: st==="afacturer"?S.courses.filter(aFacturer).length : S.courses.filter(c=>c.statut===st).length;
  const stSel=`<label class="fsel"><span class="sr">Statut</span><select id="fStSel">${[["tous","Tous les statuts"],["a_planifier","À planifier"],["planifiee","Planifiées"],["envoyee","Envoyées"],["en_cours","En cours"],["terminee","Terminées"],["afacturer","À facturer"],["annulee","Annulées"]].map(([k,l])=>`<option value="${k}" ${S.fStatut===k?"selected":""}>${l} (${cnt(k)})</option>`).join("")}</select></label>`;
  const cls=[...new Set(S.courses.map(c=>(c.donneur||"").trim()).filter(Boolean))].sort((x,y)=>x.localeCompare(y));
  const clSel=`<label class="fsel"><span class="sr">Client</span><select id="fClSel"><option value="">Tous les clients</option>${cls.map(n=>`<option value="${esc(n)}" ${S.fClient===n?"selected":""}>${esc(n)}</option>`).join("")}</select></label>`;
  const IC_REF='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>', IC_EXP='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></svg>', IC_EYE='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  S._expList=list;
  const chips=`<div class="frow">${stSel}${clSel}<button type="button" class="btn btn-ghost fbtn" data-act="refresh" title="Actualiser la liste" aria-label="Actualiser la liste">${IC_REF}</button><button type="button" class="btn btn-navy fbtn fexp" data-act="export">${IC_EXP} Exporter</button></div>`;
  const rows=list.slice(0,300).map(c=>{ const m=[c.palettes&&c.palettes+" pal.",c.colis&&c.colis+" colis",c.poids&&Number(c.poids).toLocaleString("fr-FR")+" kg",c.metres&&c.metres+" m"].filter(Boolean).join(", ");
    return `<tr class="click strow" style="--st-c:var(--${({planifiee:"plan",envoyee:"sent",en_cours:"run",route:"run",chg:"chg",liv:"liv",terminee:"done"})[etape(c)]||"off"}-bd)" data-open="${esc(c.id)}" tabindex="0"><td>${statChip(c)}</td>
    <td><b>${esc(c.donneur||"—")}</b>${c.ref?`<div class="muted">Réf. ${esc(c.ref)}</div>`:""}</td>
    <td>${esc(c.enlNom||"")}<div class="muted">${esc(c.enlCp||"")} ${esc(c.enlVille||"")}</div></td>
    <td class="num">${esc(shortDate(c.enlDate))} ${esc(c.enlHeure||"")}${c.arriveeEnl?`<div class="muted">Réel : ${esc(c.arriveeEnl)}</div>`:""}</td>
    <td>${esc(c.livNom||"")}<div class="muted">${esc(c.livCp||"")} ${esc(c.livVille||"")}</div></td>
    <td class="num">${esc(shortDate(c.livDate||c.enlDate))} ${esc(c.livHeure||"")}${c.livre?`<div class="muted">Réel : ${esc(c.livre)}</div>`:""}</td>
    <td>${esc(m||c.marchandise||"")}</td>
    <td>${esc(condName(c.conducteurId)||"—")}${affsOf(c.id).length?` <span class="chip" title="${esc(affsOf(c.id).map(a=>condName(a.conducteurId)).join(", "))}">+${affsOf(c.id).length}</span>`:""}<div class="muted">${esc(vehLabel(c))}</div></td>
    <td class="r num"><b>${c.prix?eur(c.prix):"—"}</b>${c.facturee?`<div class="muted">Facturée</div>`:""}</td>
    <td class="acts" data-act="noop"><button type="button" class="ib" data-open="${esc(c.id)}" title="Ouvrir la course" aria-label="Ouvrir la course">${IC_EYE}</button><details class="rowm"><summary class="ib" title="Autres actions" aria-label="Autres actions">⋯</summary><div class="rowm-pop"><button type="button" data-open="${esc(c.id)}">Ouvrir</button>${c.statut==="annulee"?"":`<button type="button" data-r="dup" data-id="${esc(c.id)}">Dupliquer…</button>`}</div></details></td></tr>`; }).join("");
  const actives=S.courses.filter(c=>c.statut!=="annulee");
  const nJour=actives.filter(c=>c.enlDate===t||c.livDate===t).length, nFin=S.courses.filter(c=>c.statut==="terminee"&&((c.livDate||c.enlDate)===t)).length, nRun=cnt("en_cours"), nTr=cnt("a_planifier")+S.courses.filter(c=>c.statut!=="annulee"&&incNew(c).length).length;
  const IC={jour:'<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h11v9H2zM13 9h4l3 3v3h-7zM6 18.5a1.5 1.5 0 1 0 0-.01M17 18.5a1.5 1.5 0 1 0 0-.01"/></svg>',fin:'<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>',run:'<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',tr:'<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18.5v.01"/></svg>'};
  const kp=(cls,ic,l,n)=>`<div class="kt ${cls}"><span class="kic">${ic}</span><span><small>${l}</small><b class="num">${n}</b></span></div>`;
  const ktiles=`<div class="ktiles" role="group" aria-label="Aujourd'hui en un coup d'œil">${kp("kj",IC.jour,"Courses du jour",nJour)}${kp("kf",IC.fin,"Terminées aujourd'hui",nFin)}${kp("kr",IC.run,"En cours",nRun)}${kp("kx",IC.tr,"À traiter",nTr)}</div>`;
  return `<div class="bar"><h1>Courses</h1><button type="button" class="btn btn-ghost" data-act="import">Importer une confirmation PDF</button><button type="button" class="btn btn-accent" data-act="new">+ Nouvelle course</button></div>
  ${ktiles}
  <div class="filters">${chips}</div>
  <div class="filters"><label style="flex:1 1 260px"><span style="position:absolute;left:-9999px">Rechercher</span><input type="search" id="fQ" placeholder="Rechercher : client, ville, référence, conducteur…" value="${esc(S.fQ)}"></label>
   <div class="seg" role="group" aria-label="Période">${[["tout","Toutes dates"],["jour","Aujourd'hui"],["semaine","Cette semaine"]].map(([k,l])=>`<button type="button" class="${S.fPeriode===k&&!S.fDate?"on":""}" data-fper="${k}">${l}</button>`).join("")}</div>
   <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap" role="group" aria-label="Choisir des dates">
     ${S.fDate&&!S.fDate2?`<button type="button" class="btn btn-ghost btn-sm" data-fdj="-1" aria-label="Jour précédent">‹</button>`:""}
     <label style="display:flex;gap:6px;align-items:center">Du<input type="date" id="fDate" value="${esc(S.fDate)}" style="width:auto"></label>
     ${S.fDate&&!S.fDate2?`<button type="button" class="btn btn-ghost btn-sm" data-fdj="1" aria-label="Jour suivant">›</button>`:""}
     <label style="display:flex;gap:6px;align-items:center">au<input type="date" id="fDate2" value="${esc(S.fDate2)}" style="width:auto"></label>
     ${S.fDate?`<button type="button" class="btn btn-ghost btn-sm" data-fdclr="1">Effacer les dates</button>`:""}</div></div>
  ${S.fDate?(()=>{ const a=S.fDate, b=(S.fDate2&&S.fDate2>=S.fDate)?S.fDate2:S.fDate; const act=list.filter(c=>c.statut!=="annulee");
     const ne=act.filter(c=>c.enlDate>=a&&c.enlDate<=b).length, nl=act.filter(c=>{ const l=c.livDate||c.enlDate||""; return l>=a&&l<=b; }).length, tot=act.reduce((x,c)=>x+(Number(c.prix)||0),0);
     const lib = a===b ? frDate(a,{weekday:"long",day:"numeric",month:"long",year:"numeric"}) : "du "+frDate(a,{day:"numeric",month:"long",year:"numeric"})+" au "+frDate(b,{day:"numeric",month:"long",year:"numeric"});
     return `<div class="banner" role="status"><span><b>${esc(lib)}</b> : ${act.length} course${act.length>1?"s":""} (${ne} enlèvement${ne>1?"s":""}, ${nl} livraison${nl>1?"s":""}) · ${eur(tot)} HT</span></div>`; })():""}
  <div class="panel tbl-wrap">${list.length?`<table class="tcourses"><thead><tr><th>Statut</th><th>Donneur d'ordre</th><th>Enlèvement</th><th>Date d'enlèvement</th><th>Livraison</th><th>Date de livraison</th><th>Marchandises</th><th>Conducteur · véhicule</th><th class="r">Prix HT</th><th aria-label="Actions"></th></tr></thead><tbody>${rows}</tbody></table>`:`<div class="empty">${S.fDate?"Aucune course (enlèvement ou livraison) sur cette période.":"Aucune course pour le moment. Créez une course ou importez une confirmation PDF."}</div>`}</div>`;
}
function statChip(c){ const st=c.statut||"a_planifier"; const et=etape(c); let x=`<span class="chip st-${esc(et)}">${esc(etapeLib(c))}</span>`; if(ETAPES[et] && c[ETAPES[et].h]) x+=`<div class="muted" style="font-size:12px;margin-top:3px">depuis ${esc(c[ETAPES[et].h])}</div>`;
  if(c.reserve) x+=`<div style="margin-top:4px"><span class="chip" style="border-color:var(--danger);color:var(--danger)">Réserve</span></div>`;
  if(st==="envoyee" && c.conducteurId && ("vuLe" in c)) x+=`<div style="margin-top:4px;font-size:12px;font-weight:600;color:var(--${c.vuLe?"ok":"accent-ink"})">${c.vuLe?"Vue par le chauffeur · "+esc(new Date(c.vuLe).toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})):`Pas encore vue <button type="button" class="linkbtn" data-act="relancer" data-id="${esc(c.id)}" style="font-size:12px;margin-left:6px">Relancer</button>`}</div>`;
  if(st==="planifiee" && c.sousTraitantId) x+=`<div class="muted" style="margin-top:4px;font-size:12px">Sous-traitée</div>`;
  if(st==="planifiee" && c.conducteurId) x+=`<div style="margin-top:6px"><button type="button" class="btn btn-accent btn-sm" data-act="sendone" data-id="${esc(c.id)}">Envoyer</button></div>`;
  if(incNew(c).length) x+=`<div style="margin-top:4px"><span class="chip" style="border-color:var(--danger);color:var(--danger)">Problème signalé</span></div>`;
  if(c.modifieApresEnvoi && st==="envoyee") x+=`<div class="muted" style="font-size:11px;margin-top:3px">Modifiée après envoi</div>`;
  return x; }
function exportCourses(){
  const L=(S._expList||[]); if(!L.length){ toast("Aucune course à exporter"); return; }
  const q=v=>{ v=(v==null?"":String(v)); return /[;"\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; };
  const head=["Statut","Donneur d'ordre","Référence","Enlèvement","Date d'enlèvement","Livraison","Date de livraison","Marchandises","Conducteur","Véhicule","Prix HT (€)"];
  const rows=L.map(c=>[etapeLib(c),c.donneur,c.ref,[c.enlNom,c.enlCp,c.enlVille].filter(Boolean).join(" "),(c.enlDate||"")+" "+(c.enlHeure||""),[c.livNom,c.livCp,c.livVille].filter(Boolean).join(" "),(c.livDate||c.enlDate||"")+" "+(c.livHeure||""),c.marchandise||"",condName(c.conducteurId)||"",vehLabel(c)||"",c.prix?String(Number(c.prix)).replace(".",","):""].map(v=>q(typeof v==="string"?v.trim():v)).join(";"));
  const blob=new Blob(["\ufeff"+[head.map(q).join(";"),...rows].join("\r\n")],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="courses-"+todayIso()+".csv"; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },500);
  toast(L.length+" course"+(L.length>1?"s":"")+" exportée"+(L.length>1?"s":"")+" (fichier ouvrable avec Excel)");
}
after.courses = ()=>{
  const fs_=$("#fStSel"); if(fs_) fs_.addEventListener("change",()=>{ S.fStatut=fs_.value; render(); });
  const fc_=$("#fClSel"); if(fc_) fc_.addEventListener("change",()=>{ S.fClient=fc_.value; render(); }); const okD=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)?v:""; const fd=$("#fDate"), fd2=$("#fDate2");
  if(fd) fd.addEventListener("change",()=>{ S.fDate=okD(fd.value); if(!S.fDate) S.fDate2=""; else S.fPeriode="tout"; render(); });
  if(fd2) fd2.addEventListener("change",()=>{ const v=okD(fd2.value); S.fDate2=v; if(v){ S.fPeriode="tout"; if(!S.fDate) S.fDate=v; else if(v<S.fDate){ S.fDate2=S.fDate; S.fDate=v; } } render(); }); const q=$("#fQ"); if(q){ q.addEventListener("input",()=>{ S.fQ=q.value; const pos=q.selectionStart; render(); const n=$("#fQ"); n.focus(); try{n.setSelectionRange(pos,pos);}catch(e){} }); }
  document.querySelectorAll("tr[data-open]").forEach(tr=>tr.addEventListener("keydown",e=>{ if(e.key==="Enter") openCourse(tr.dataset.open); })); };

/* ---------- FORMULAIRE COURSE ---------- */
const F = [
  ["donneur","Donneur d'ordre","text","d"],["ref","Référence client","text","d"],["prix","Prix HT (€)","number","d"],["contact","Contact / téléphone","text","d"],
  ["enlNom","Site d'enlèvement","text","e"],["enlAdresse","Adresse","text","e",1],["enlCp","Code postal","text","e"],["enlVille","Ville","text","e"],["enlDate","Date","date","e"],["enlHeure","Heure","time","e"],["enlHeureFin","Jusqu'à","time","e"],
  ["livNom","Site de livraison","text","l"],["livAdresse","Adresse","text","l",1],["livCp","Code postal","text","l"],["livVille","Ville","text","l"],["livDate","Date","date","l"],["livHeure","Heure","time","l"],["livHeureFin","Jusqu'à","time","l"],
  ["palettes","Palettes","number","m"],["colis","Colis","number","m"],["poids","Poids (kg)","number","m"],["metres","Mètres de plancher","number","m"],["marchandise","Description","text","m",1],
  ["instructions","Instructions pour le conducteur","textarea","i",1]
];
function fieldHtml([k,l,t,,w],v){ const val=esc(v??"");
  if(t==="textarea") return `<label class="fld ${w?"wide":""}">${l}<textarea id="f_${k}">${val}</textarea></label>`;
  return `<label class="fld ${w?"wide":""}">${l}<input id="f_${k}" type="${t}" ${t==="number"?'step="any" inputmode="decimal"':""} value="${val}"></label>`; }
/* ---------- plusieurs conducteurs / camions sur une même course ---------- */
const affOk = () => !S.courses.length || ("rolePrincipal" in S.courses[0]);
const roleOpts = v => Object.entries(ROLES).map(([k,l])=>`<option value="${k}" ${(v||"complet")===k?"selected":""}>${l}</option>`).join("");
function affRow(a={}){
  const co=`<option value="">— Conducteur —</option>`+activeConds().map(k=>`<option value="${esc(k.id)}" ${a.conducteurId===k.id?"selected":""}>${esc(k.nom)}</option>`).join("");
  const ca=`<option value="">— Camion —</option>`+activeCams().map(k=>`<option value="${esc(k.id)}" ${a.camionId===k.id?"selected":""}>${esc(k.immat)}</option>`).join("");
  const re=`<option value="">— Sans remorque —</option>`+activeRems().map(k=>`<option value="${esc(k.id)}" ${a.remorqueId===k.id?"selected":""}>${esc(k.immat)}</option>`).join("");
  return `<div class="affrow" data-aff="${esc(a.id||"")}" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;border:1px solid var(--line,#d9dde3);border-radius:10px;padding:10px">
    <label class="fld" style="flex:2;min-width:150px">Conducteur<select class="affin" data-k="conducteurId">${co}</select></label>
    <label class="fld" style="flex:2;min-width:130px">Camion<select class="affin" data-k="camionId">${ca}</select></label>
    <label class="fld" style="flex:2;min-width:130px">Remorque<select class="affin" data-k="remorqueId">${re}</select></label>
    <label class="fld" style="flex:2;min-width:160px">Rôle<select class="affin" data-k="role">${roleOpts(a.role)}</select></label>
    <label class="fld" style="flex:1;min-width:80px">Part (%)<input class="affin affpart" data-k="part" type="number" step="any" inputmode="decimal" value="${esc(a.part??"")}"></label>
    <button type="button" class="btn btn-ghost btn-sm" data-aff-act="del" aria-label="Retirer cette affectation">✕</button></div>`; }
function affBlock(c){
  if(!affOk()) return "";
  const L=c.id?affsOf(c.id):[];
  return `<div id="affBox" style="grid-column:1/-1;display:flex;flex-direction:column;gap:8px;margin-top:6px">
    <label class="fld">Rôle du conducteur ci-dessus<select id="f_rolePrincipal">${roleOpts(c.rolePrincipal)}</select></label>
    <label class="fld">Sa part du prix (%)<input id="f_partPrincipal" class="affpart" type="number" step="any" inputmode="decimal" value="${esc(c.partPrincipal??100)}"></label>
    <b>Autres conducteurs et camions sur cette même course ?</b>
    <span class="muted" style="font-size:13px">Un seul prix et une seule facture. Chacun valide ses propres étapes ; la part (%) sert uniquement à calculer la marge par camion.</span>
    <div id="affRows" style="display:flex;flex-direction:column;gap:10px">${L.map(affRow).join("")}</div>
    <button type="button" class="btn btn-ghost btn-sm" data-aff-act="add" style="align-self:flex-start">+ Ajouter un conducteur / un camion</button>
    <span id="affTot" class="muted" style="font-size:13px"></span></div>`; }
function affLire(){
  return [...document.querySelectorAll("#affRows .affrow")].map(r=>{ const o={id:r.dataset.aff||null};
    r.querySelectorAll(".affin").forEach(i=>{ const k=i.dataset.k; let v=i.value.trim(); if(k==="part") v=v===""?null:Number(v.replace(",",".")); o[k]=(v===""||(typeof v==="number"&&!isFinite(v)))?null:v; });
    if(!o.role) o.role="complet"; return o; }); }
function affTotal(){ const t=$("#affTot"); if(!t) return; const rows=affLire(); if(!rows.length){ t.textContent=""; return; }
  const pp=$("#f_partPrincipal"); const tot=(Number((pp&&pp.value||"").replace(",","."))||0)+rows.reduce((a,x)=>a+(x.part||0),0);
  t.textContent="Total des parts : "+(Math.round(tot*100)/100)+" %"+(Math.abs(tot-100)>0.01?" — il devrait faire 100 %":""); t.style.color=Math.abs(tot-100)>0.01?"var(--danger)":""; }
function affEquilibrer(){ const rows=[...document.querySelectorAll("#affRows .affrow")]; const n=rows.length+1, part=Math.floor(100/n);
  rows.forEach(r=>{ r.querySelector(".affpart").value=String(part); }); const pp=$("#f_partPrincipal"); if(pp) pp.value=String(100-part*rows.length); affTotal(); }
document.addEventListener("click",e=>{ const b=e.target.closest("[data-aff-act]"); if(!b) return;
  if(b.dataset.affAct==="add"){ $("#affRows").insertAdjacentHTML("beforeend",affRow({role:"complet"})); affEquilibrer(); const i=$("#affRows .affrow:last-child select"); i&&i.focus(); }
  else if(b.dataset.affAct==="del"){ b.closest(".affrow").remove(); affEquilibrer(); } });
document.addEventListener("input",e=>{ if(e.target.classList&&e.target.classList.contains("affpart")) affTotal(); });
function affControle(o,L){
  const ids=[o.conducteurId].filter(Boolean);
  for(const a of L){ if(!a.conducteurId) return "Choisissez le conducteur de chaque affectation ajoutée (ou retirez la ligne).";
    if(ids.includes(a.conducteurId)) return "Un même conducteur ne peut pas être affecté deux fois à la course."; ids.push(a.conducteurId); }
  if(L.length && !o.conducteurId) return "Choisissez d'abord le conducteur principal.";
  const tot=(o.partPrincipal??100)+L.reduce((t,a)=>t+(a.part||0),0); if(L.length && Math.abs(tot-100)>0.01) return "Le total des parts doit faire 100 % (actuellement "+(Math.round(tot*100)/100)+" %).";
  return null; }
async function affSync(courseId,L){
  const avant=affsOf(courseId); let ok=true;
  for(const a of avant) if(!L.some(x=>x.id===a.id)) ok = (await tableWrite("course_affectations","delete",a.id)) && ok;
  for(const x of L){ const o={courseId,conducteurId:x.conducteurId,camionId:x.camionId||null,remorqueId:(x.camionId&&isTracteur(x.camionId))?(x.remorqueId||null):null,role:x.role,part:x.part??0};
    if(x.id){ const old=avant.find(a=>a.id===x.id); const same=old&&["conducteurId","camionId","remorqueId","role"].every(k=>(old[k]||null)===(o[k]||null))&&Number(old.part)===Number(o.part); if(!same) ok=(await tableWrite("course_affectations","update",x.id,o))&&ok; }
    else ok=(await tableWrite("course_affectations","insert",null,o))&&ok; }
  return ok; }
function courseForm(c,opts={}){
  const grp=g=>F.filter(f=>f[3]===g).map(f=>fieldHtml(f,c[f[0]])).join("");
  const condOpts=`<option value="">— Non affecté —</option>`+activeConds().map(k=>`<option value="${esc(k.id)}" ${c.conducteurId===k.id?"selected":""}>${esc(k.nom)}</option>`).join("");
  const camOpts=`<option value="">— Aucun —</option>`+activeCams().map(k=>`<option value="${esc(k.id)}" ${c.camionId===k.id?"selected":""}>${esc(k.immat)} · ${esc(k.type||"")}</option>`).join("");
  const remOpts=`<option value="">— Aucune —</option>`+activeRems().map(k=>`<option value="${esc(k.id)}" ${c.remorqueId===k.id?"selected":""}>${esc(k.immat)}</option>`).join("");
  const stOpts=Object.entries(STATUTS).map(([k,v])=>`<option value="${k}" ${(c.statut||"a_planifier")===k?"selected":""}>${v.l}</option>`).join("");
  const docs=(c.docs||[]).map((d,i)=>`<li><button type="button" class="linkbtn" data-doc="${esc(d.path)}">${esc(d.type==="confirmation"?"Confirmation client":d.type==="bl"?"BL / CMR":d.type==="signature"?"Signature du destinataire":d.type==="reserve"?"Photo de la réserve":"Document")} — ${esc(d.nom||"")}</button>${c.id?` · <button type="button" class="linkbtn" data-pdf="${esc(d.path)}" data-cid="${esc(c.id)}" title="Télécharger ce document en PDF">PDF</button>`:""}</li>`).join("");
  const incs=incOf(c);
  const incHtml = incs.length ? `<div class="${incNew(c).length?"alert":""}" style="display:flex;flex-direction:column;gap:6px"><b>Problèmes signalés par le conducteur</b><ul style="margin:0;padding-left:18px">${incs.map(i=>`<li>${esc(i.heure||"")}${i.le?" ("+esc(frDate(String(i.le).slice(0,10),{day:"numeric",month:"short"}))+")":""} · <b style="color:inherit">${esc(INC[i.type]||"Autre")}</b>${i.commentaire?" — "+esc(i.commentaire):""}${i.path?` · <button type="button" class="linkbtn" data-doc="${esc(i.path)}">Voir la photo</button>`:""}${i.vu?` <span class="muted">(traité)</span>`:""}</li>`).join("")}</ul>${incNew(c).length?`<button type="button" class="btn btn-ghost btn-sm" data-act="incvu" style="align-self:flex-start">Marquer comme traité</button>`:""}</div>` : "";
  const sigHtml = c.signataire ? `<div><b>Livraison signée par :</b> ${esc(c.signataire)}</div>` : "";
  return `<h2>${opts.title||"Course"}</h2>
  ${opts.draft?"":friseHtml(c)}
  ${opts.note?`<div class="banner">${opts.note}</div>`:""}
  <form id="cForm" style="display:flex;flex-direction:column;gap:14px">
  <fieldset><legend>Donneur d'ordre</legend>${grp("d")}</fieldset>
  <fieldset><legend>Enlèvement</legend>${grp("e")}</fieldset>
  <fieldset><legend>Livraison</legend>${grp("l")}</fieldset>
  <fieldset><legend>Marchandises</legend>${grp("m")}${cmdBlock(c)}</fieldset>
  ${opts.draft?"":`<fieldset><legend>Affectation</legend>
    <label class="fld">Conducteur<select id="f_conducteurId">${condOpts}</select></label>
    ${X.stSelect?X.stSelect(c):""}
    <label class="fld">Camion / tracteur<select id="f_camionId">${camOpts}</select></label>
    <label class="fld" id="remWrap" ${isTracteur(c.camionId)?"":"hidden"}>Remorque<select id="f_remorqueId">${remOpts}</select></label>
    ${affBlock(c)}
    <label class="fld">Statut<select id="f_statut">${stOpts}</select></label>
    <label class="fld" style="flex-direction:row;align-items:center;gap:8px;margin-top:18px"><input type="checkbox" id="f_facturee" ${c.facturee?"checked":""} style="width:20px;height:20px">Facturée</label></fieldset>
  <fieldset><legend>Suivi réel (rempli par le conducteur)</legend>
    <label class="fld">Arrivée enlèvement<input type="time" id="f_arriveeEnl" value="${esc(c.arriveeEnl||"")}"></label>
    <label class="fld">Chargé<input type="time" id="f_chargeEnl" value="${esc(c.chargeEnl||"")}"></label>
    <label class="fld">Arrivée livraison<input type="time" id="f_arriveeLiv" value="${esc(c.arriveeLiv||"")}"></label>
    <label class="fld">Livré<input type="time" id="f_livre" value="${esc(c.livre||"")}"></label>
    <label class="fld wide">Réserves à la livraison<textarea id="f_reserve" placeholder="Vide = sans réserve">${esc(c.reserve||"")}</textarea></label></fieldset>`}
  <fieldset><legend>Consignes</legend>${grp("i")}</fieldset>
  ${incHtml}${sigHtml}${c.id&&X.courseExtra?X.courseExtra(c):""}
  ${docs?`<div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>Documents</b>${c.id?`<button type="button" class="btn btn-ghost btn-sm" data-pdfall="${esc(c.id)}">Tous les documents en PDF</button>`:""}</div><ul style="margin:6px 0 0">${docs}</ul></div>`:""}
  <div class="row-btns" id="formBtns">
    ${opts.canDelete?`<button type="button" class="btn btn-danger" data-act="askdel" style="margin-right:auto">Supprimer</button>`:""}
    <button type="button" class="btn btn-ghost" data-act="${opts.draft?"impback":"close"}">${opts.draft?"Retour":"Annuler"}</button>
    ${!opts.draft && (!c.statut||c.statut==="a_planifier"||c.statut==="planifiee") ? `<button type="submit" class="btn btn-ghost" data-send="0">Enregistrer sans envoyer</button><button type="submit" class="btn btn-accent" data-send="1">Enregistrer et envoyer</button>` : `<button type="submit" class="btn btn-accent">${opts.draft?"Valider ces informations":"Enregistrer"}</button>`}</div>
  </form>`;
}
/* ---------- commandes multiples sur une course ---------- */
const cmdOk = () => !S.courses.length || ("commandes" in S.courses[0]);
const cmdRow = (l={}) => `<div class="cmdrow" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
  <label class="fld" style="flex:2;min-width:140px">Commande / référence<input class="cmdin" data-k="ref" type="text" value="${esc(l.ref||"")}" placeholder="Ex. : commande 1"></label>
  <label class="fld" style="flex:1;min-width:80px">Colis<input class="cmdin" data-k="colis" type="number" step="any" inputmode="decimal" value="${esc(l.colis??"")}"></label>
  <label class="fld" style="flex:1;min-width:80px">Palettes<input class="cmdin" data-k="palettes" type="number" step="any" inputmode="decimal" value="${esc(l.palettes??"")}"></label>
  <label class="fld" style="flex:1;min-width:80px">Poids (kg)<input class="cmdin" data-k="poids" type="number" step="any" inputmode="decimal" value="${esc(l.poids??"")}"></label>
  <button type="button" class="btn btn-ghost btn-sm" data-cmd="del" aria-label="Retirer cette commande">✕</button></div>`;
function cmdBlock(c){
  if(!cmdOk()) return "";
  const L=Array.isArray(c.commandes)?c.commandes:[];
  return `<div class="wide" id="cmdBox" style="grid-column:1/-1;display:flex;flex-direction:column;gap:8px;margin-top:6px">
    <b>Plusieurs commandes sur cette course ?</b><span class="muted" style="font-size:13px">Ajoutez une ligne par commande : les totaux (colis, palettes, poids) se calculent tout seuls.</span>
    <div id="cmdRows" style="display:flex;flex-direction:column;gap:10px">${L.map(cmdRow).join("")}</div>
    <button type="button" class="btn btn-ghost btn-sm" data-cmd="add" style="align-self:flex-start">+ Ajouter une commande</button></div>`; }
function cmdLire(){
  return [...document.querySelectorAll("#cmdRows .cmdrow")].map(r=>{ const o={};
    r.querySelectorAll(".cmdin").forEach(i=>{ let v=i.value.trim(); if(i.dataset.k!=="ref") v = v===""?null:Number(v.replace(",",".")); o[i.dataset.k]= (v===""||(typeof v==="number"&&!isFinite(v)))?null:v; }); return o; })
    .filter(o=>o.ref||o.colis!=null||o.palettes!=null||o.poids!=null); }
function cmdSomme(){
  const L=cmdLire(); if(!L.length) return;
  [["colis","f_colis"],["palettes","f_palettes"],["poids","f_poids"]].forEach(([k,id])=>{ const el=$("#"+id); if(!el) return;
    const vals=L.map(o=>o[k]).filter(v=>v!=null); if(vals.length) el.value=String(Math.round(vals.reduce((a,b)=>a+b,0)*100)/100); }); }
document.addEventListener("click",e=>{ const b=e.target.closest("[data-cmd]"); if(!b) return;
  if(b.dataset.cmd==="add"){ $("#cmdRows").insertAdjacentHTML("beforeend",cmdRow({})); const i=$("#cmdRows .cmdrow:last-child .cmdin"); i&&i.focus(); }
  else if(b.dataset.cmd==="del"){ b.closest(".cmdrow").remove(); cmdSomme(); } });
document.addEventListener("input",e=>{ if(e.target.classList&&e.target.classList.contains("cmdin")) cmdSomme(); });
/* texte du détail des commandes (écran conducteur) */
const cmdTexte = c => (Array.isArray(c.commandes)?c.commandes:[]).map(l=>[l.ref,l.colis!=null&&l.colis+" colis",l.palettes!=null&&l.palettes+" pal.",l.poids!=null&&l.poids+" kg"].filter(Boolean).join(" · ")).filter(Boolean);
function readForm(base){
  const o={};
  F.forEach(([k,,t])=>{ const el=$("#f_"+k); if(!el) return; let v=el.value.trim(); if(t==="number") v = v===""?null:Number(v.replace(",",".")); o[k]=v===""?null:v; });
  ["conducteurId","camionId","remorqueId","statut","arriveeEnl","chargeEnl","arriveeLiv","livre","reserve"].forEach(k=>{ const el=$("#f_"+k); if(el) o[k]=el.value.trim()||null; });
  const fc=$("#f_facturee"); if(fc) o.facturee=fc.checked;
  const rp=$("#f_rolePrincipal"); if(rp){ o.rolePrincipal=rp.value||"complet"; const pp=$("#f_partPrincipal"); const pv=pp?pp.value.trim().replace(",","."):""; o.partPrincipal=pv===""?100:Number(pv); if(!isFinite(o.partPrincipal)) o.partPrincipal=100; }
  if($("#cmdRows")){ const cl=cmdLire(); if(cl.length || (Array.isArray(base.commandes)&&base.commandes.length)) o.commandes=cl; }
  const stEl=$("#f_sousTraitantId");
  if(stEl){ const nv=stEl.value||null, av=base.sousTraitantId||null; o.sousTraitantId=nv;
    if(nv && nv!==av){ o.conducteurId=null; o.camionId=null; o.remorqueId=null; o.ordreEnvoyeLe=null; o.vuLe=null; if(o.statut==='envoyee'||o.statut==='a_planifier') o.statut='planifiee'; }
    else if(nv && o.conducteurId){ o.sousTraitantId=null; o.ordreEnvoyeLe=null; }
    else if(!nv && av){ o.ordreEnvoyeLe=null; }
    if(av && (o.sousTraitantId||null)!==av && Array.isArray(base.couts)) o.couts=base.couts.filter(l=>l.st!==av); }
  if(o.camionId && !isTracteur(o.camionId)) o.remorqueId=null;
  if(!o.statut) o.statut=base.statut||"a_planifier";
  if(o.statut==="a_planifier" && o.conducteurId) o.statut="planifiee";
  if(!o.livDate) o.livDate=o.enlDate;
  return o;
}
function openModal(html){ $("#modal").innerHTML=`<div class="modal-bg" id="mbg"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  if($("#modal [data-lock]")) return; // écrans du conducteur : pas de clavier qui s'ouvre tout seul
  const first=$("#modal input, #modal select, #modal button"); first && first.focus(); }
function closeModal(){ $("#modal").innerHTML=""; openId=null; S.doneFor=null; S.sign=null; }
let openId=null;
function openCourse(id){
  const c=S.courses.find(x=>x.id===id); if(!c) return; openId=id;
  openModal(courseForm(c,{title:esc(c.donneur||"Course")+(c.ref?` <span class="muted" style="font-size:14px;font-family:var(--text)">Réf. ${esc(c.ref)}</span>`:""),canDelete:true}));
  $("#cForm").addEventListener("submit",async e=>{ e.preventDefault(); const o=readForm(c);
    const affL=$("#affRows")?affLire():null; if(affL){ const er=affControle(o,affL); if(er){ toast(er); return; } }
    if(!avecEnvoi(e,o)) return; const envoi=o.statut==="envoyee" && c.statut!=="envoyee";
    // n'envoyer que les champs modifiés dans la fiche, et vérifier que personne ne les a changés entre-temps
    const modif=Object.keys(o).filter(k=>!["id","entrepriseId","createdAt","updatedAt"].includes(k) && o[k]!==undefined && !memeValeur(o[k],c[k]));
    if(modif.length && $("#cForm").dataset.forcer!=="1"){
      const cols=[...new Set(modif.map(camel2snake))].join(",");
      const {data:cur,error:ce}=await sb.from("courses").select(cols).eq("id",c.id).maybeSingle();
      if(ce){ toast(errMsg(ce)); return; }
      if(!cur){ toast("Cette course n'existe plus (supprimée entre-temps)."); return; }
      const actuel=fromDb(cur); const conflits=modif.filter(k=>!memeValeur(actuel[k],c[k]) && !memeValeur(actuel[k],o[k]));
      if(conflits.length){ conflitCourse(c.id,conflits,e.submitter); return; } }
    const patch={}; modif.forEach(k=>patch[k]=o[k]);
    if(!modif.length || await saveCourse(c.id,patch)){ if(affL) await affSync(c.id,affL); closeModal(); if(envoi) annonceEnvoi([Object.assign({},c,o)]); else toast("Course enregistrée"); } });
}
// compare deux valeurs de fiche (vide = null, nombres écrits en texte, heures 08:00 / 08:00:00, listes)
function memeValeur(a,b){ const n=v=>{ if(v===undefined||v===null||v==="") return null; if(typeof v==="object") return JSON.stringify(v);
    const t=String(v).trim(); if(/^\d{2}:\d{2}(:\d{2})?$/.test(t)) return t.slice(0,5); if(t!=="" && !isNaN(Number(t))) return String(Number(t)); return t; };
  return n(a)===n(b); }
// quelqu'un d'autre (exploitant ou conducteur) a modifié les mêmes champs : on prévient au lieu d'écraser
function conflitCourse(id,champs,bouton){
  const f=$("#cForm"); if(!f) return; let box=$("#conflitBox");
  if(!box){ box=document.createElement("div"); box.id="conflitBox"; f.prepend(box); }
  box.setAttribute("role","alert");
  box.style.cssText="border:2px solid #C0392B;background:#FDECEA;color:#3A1410;border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:14px;line-height:1.45";
  const SECT={e:"enlèvement",l:"livraison"}, AUTRES={conducteurId:"conducteur",camionId:"véhicule",remorqueId:"remorque",statut:"statut",arriveeEnl:"arrivée à l'enlèvement",chargeEnl:"chargement",arriveeLiv:"arrivée à la livraison",livre:"livraison faite",reserve:"réserves",facturee:"facturée",commandes:"commandes",sousTraitantId:"sous-traitant",couts:"coûts",rolePrincipal:"rôle",partPrincipal:"part"};
  const nomChamp=k=>{ const f=F.find(x=>x[0]===k); if(f) return f[1].charAt(0).toLowerCase()+f[1].slice(1)+(SECT[f[3]]&&!/enlèvement|livraison/i.test(f[1])?" ("+SECT[f[3]]+")":""); return AUTRES[k]||k.replace(/([A-Z])/g," $1").toLowerCase(); };
  const noms=champs.map(k=>esc(nomChamp(k))).join(", ");
  box.innerHTML=`<b>Cette course a été modifiée par quelqu'un d'autre</b> (un autre exploitant ou le conducteur) depuis que vous l'avez ouverte, sur : ${noms}. Vos changements <b>n'ont pas été enregistrés</b>.
    <div class="row-btns" style="margin-top:10px;justify-content:flex-start"><button type="button" class="btn btn-ghost btn-sm" id="conflitVoir">Voir la version à jour</button><button type="button" class="btn btn-accent btn-sm" id="conflitForcer">Enregistrer quand même mes changements</button></div>`;
  box.scrollIntoView({block:"nearest"});
  $("#conflitVoir").onclick=async()=>{ closeModal(); await loadData(); openCourse(id); };
  $("#conflitForcer").onclick=()=>{ f.dataset.forcer="1"; f.requestSubmit(bouton && bouton.form===f ? bouton : undefined); };
}
function newCourse(prefill){
  const c=Object.assign({enlDate:S.date,statut:"a_planifier"},prefill||{});
  openModal(courseForm(c,{title:"Nouvelle course"}));
  $("#cForm").addEventListener("submit",async e=>{ e.preventDefault(); const o=readForm(c);
    if(!o.donneur||!o.enlDate){ toast("Indiquez au moins le donneur d'ordre et la date d'enlèvement."); return; }
    const affL=$("#affRows")?affLire():null; if(affL){ const er=affControle(o,affL); if(er){ toast(er); return; } }
    o.source="manuel"; if(!avecEnvoi(e,o)) return;
    if(await saveCourse(null,o)){ if(affL&&affL.length&&saveCourse.lastId) await affSync(saveCourse.lastId,affL); closeModal(); if(o.statut==="envoyee") annonceEnvoi([Object.assign({},c,o)]); else toast(o.conducteurId?"Course créée, pas encore envoyée au conducteur":"Course créée"); } });
}
async function openDoc(path){
  const {data,error}=await sb.storage.from("documents").createSignedUrl(path,600);
  if(error){ toast(errMsg(error)); return; }
  window.open(data.signedUrl,"_blank","noopener");
}

/* ---------- IMPORT PDF ---------- */
function startImport(){ const inp=$("#pdfInput"); inp.value=""; inp.click(); }
$("#pdfInput").addEventListener("change",e=>{ const f=e.target.files&&e.target.files[0]; if(f) readDocument(f); });
function fileToBase64(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result).split(",")[1]); r.onerror=rej; r.readAsDataURL(file); }); }
const NUMK=["prix","palettes","colis","poids","metres"];
function clean(x){ const o={}; F.forEach(([k,,t])=>{ let v=x[k]; if(v===undefined||v==="") v=null;
  if(v!=null && t==="number"){ v=Number(String(v).replace(/\s/g,"").replace(",",".")); if(!isFinite(v)) v=null; }
  if(v!=null && t==="date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) v=null;
  if(v!=null && t==="time"){ const m=String(v).match(/(\d{1,2})[:hH](\d{2})?/); v=m?pad(m[1])+":"+(m[2]||"00"):null; }
  if(v!=null && t!=="number") v=String(v).slice(0,400);
  o[k]=v; }); return o; }
async function readDocument(file){
  if(file.size>9*1024*1024){ toast("Fichier trop lourd (9 Mo maximum)."); return; }
  let stopped=false;
  openModal(`<h2>Lecture de la confirmation</h2><p id="impMsg">Envoi de « ${esc(file.name)} »…</p><div class="row-btns"><button type="button" class="btn btn-ghost" id="impStop">Arrêter</button></div>`);
  $("#impStop").addEventListener("click",()=>{ stopped=true; closeModal(); });
  const msg=t=>{ const m=$("#impMsg"); if(m) m.textContent=t; };
  try{
    const mediaType = file.type || (/\.pdf$/i.test(file.name)?"application/pdf":"image/jpeg");
    // 1. on garde le document original
    const path=`${EID()}/confirmations/${Date.now()}-${file.name.replace(/[^\w.\-]+/g,"_").slice(-80)}`;
    const up=await sb.storage.from("documents").upload(path,file,{contentType:mediaType,upsert:false});
    S.importDoc = up.error ? null : {path, nom:file.name};
    // 2. lecture par l'IA
    msg("Lecture du document et remplissage de la course… (10 à 40 secondes)");
    const data=await fileToBase64(file);
    const {data:res,error}=await sb.functions.invoke("lire-confirmation",{body:{data,mediaType}});
    if(stopped) return;
    if(error){ let detail=""; try{ detail=(await error.context.json()).error||""; }catch(e){}
      const t = /FunctionsFetchError|Failed to send/i.test(error.name+error.message) ? "La lecture automatique n'est pas encore activée sur votre espace."
        : detail==="cle_manquante" ? "La lecture automatique n'est pas encore activée (clé API manquante)."
        : detail==="limite" ? "Limite quotidienne de lectures automatiques atteinte pour votre entreprise. Elle se remet à zéro demain ; en attendant, créez la course à la main."
        : "La lecture a échoué. Réessayez ou créez la course à la main.";
      throw {ui:t}; }
    const list=(res && Array.isArray(res.courses)) ? res.courses.filter(x=>x&&typeof x==="object") : [];
    if(!list.length) throw {ui:"Le document ne semble pas contenir de course lisible. Créez-la à la main."};
    S.importList=list.map(clean); showImport();
  }catch(e){
    if(stopped) return;
    openModal(`<h2>Import impossible</h2><p>${esc(e.ui||errMsg(e))}</p><div class="row-btns"><button type="button" class="btn btn-ghost" data-act="close">Fermer</button><button type="button" class="btn btn-accent" data-act="new">Créer à la main</button></div>`);
  }
}
function showImport(){
  const L=S.importList;
  const cards=L.map((c,i)=>`<div class="card" style="cursor:default"><span class="t"><b>${esc(c.donneur||"Donneur d'ordre ?")}</b><b>${c.prix?eur(c.prix):"Prix ?"}</b></span>
    <span>↑ ${esc(c.enlDate?shortDate(c.enlDate):"date ?")} ${esc(c.enlHeure||"")} · ${esc(c.enlNom||"")} ${esc(c.enlVille||"")}</span>
    <span>↓ ${esc(c.livDate?shortDate(c.livDate):"")} ${esc(c.livHeure||"")} · ${esc(c.livNom||"")} ${esc(c.livVille||"")}</span>
    <span class="muted">${esc([c.palettes&&c.palettes+" pal.",c.poids&&c.poids+" kg",c.marchandise].filter(Boolean).join(" · "))}${c.ref?" · Réf. "+esc(c.ref):""}</span>
    ${!c.enlDate?`<span style="color:var(--danger);font-weight:600">Date d'enlèvement manquante : à compléter.</span>`:""}
    <div style="display:flex;gap:8px;margin-top:6px"><button type="button" class="btn btn-ghost btn-sm" data-impedit="${i}">Vérifier et modifier</button><button type="button" class="btn btn-ghost btn-sm" data-impdel="${i}">Retirer</button></div></div>`).join("");
  openModal(`<h2>${L.length} course(s) trouvée(s)</h2><p class="muted" style="margin:0">Vérifiez les informations avant de les créer. Elles iront dans « À planifier ».</p>
    <div style="display:flex;flex-direction:column;gap:10px">${cards}</div>
    <div class="row-btns"><button type="button" class="btn btn-ghost" data-act="close">Annuler</button><button type="button" class="btn btn-accent" data-act="impsave" ${L.length?"":"disabled"}>Créer ${L.length} course(s)</button></div>`);
}
function editImport(i){
  const c=S.importList[i];
  openModal(courseForm(c,{title:"Vérifier la course",draft:true,note:"Corrigez si besoin, puis validez."}));
  $("#cForm").addEventListener("submit",e=>{ e.preventDefault(); S.importList[i]=readForm(c); showImport(); });
}
async function saveImport(){
  const L=S.importList||[];
  if(L.some(c=>!c.enlDate)){ toast("Complétez la date d'enlèvement des courses concernées."); return; }
  const rows=L.map(c=>Object.assign(toDb(Object.assign({},c,{statut:"a_planifier",source:"pdf",livDate:c.livDate||c.enlDate})),{entreprise_id:EID(),
    docs: S.importDoc?[{path:S.importDoc.path,nom:S.importDoc.nom,type:"confirmation",le:new Date().toISOString()}]:[]}));
  const {error}=await sb.from("courses").insert(rows);
  if(error){ toast(errMsg(error)); return; }
  S.importList=null; closeModal(); toast(rows.length+" course(s) créée(s) — à planifier");
  if(L[0]&&L[0].enlDate) S.date=L[0].enlDate;
  scheduleReload(); if(S.view!=="planning") location.hash="planning";
}

/* ---------- VUE CONDUCTEUR ---------- */
function vDriver(){
  const staff=isStaff();
  const meId = staff ? S.me : S.mem.conducteur_id;
  const me=condById(meId);
  const day = S.drvDay==="today"?todayIso():addDays(todayIso(),1);
  const sel = staff ? `<label style="display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--side-muted)">Aperçu pour le conducteur<select id="meSel"><option value="">— Choisir —</option>${activeConds().map(k=>`<option value="${esc(k.id)}" ${S.me===k.id?"selected":""}>${esc(k.nom)}</option>`).join("")}</select></label>` : "";
  const back = staff ? `<p class="muted" style="text-align:center;margin:0"><a href="${MODE==="chauffeur"?esc(CFG.appUrl):"#planning"}">Retour à l'exploitation</a></p>` : `<p class="muted" style="text-align:center;margin:0;font-size:12px"><button type="button" class="linkbtn" data-act="refresh">Actualiser</button></p>`;
  const logo = MODE==="chauffeur" ? `<img src="icon-192.png" alt="Dream Chauffeur" style="width:38px;border-radius:9px">` : `<img src="../logo-blanc.png" alt="Mobilog" style="width:38px">`;
  const tip = staff ? "" : installTip();
  if(!me) return `<div class="drv"><div class="drv-head"><h1>Vue conducteur</h1>${staff?`<p style="margin:0;color:var(--side-muted)">Choisissez un conducteur pour voir son écran.</p>${sel}`:`<p style="margin:0">Votre fiche conducteur est introuvable. Contactez votre exploitation.</p>`}</div>${back}</div>`;
  const vis=myDay(me.id,day);
  const hidden=S.courses.filter(c=>(c.conducteurId===me.id||affsOf(c.id).some(a=>a.conducteurId===me.id)) && c.enlDate===day && (c.statut==="planifiee"||c.statut==="a_planifier")).length;
  const curId=(vis.find(c=>c.statut==="en_cours")||vis.find(c=>c.statut==="envoyee")||{}).id;
  const nDone=vis.filter(c=>c.statut==="terminee").length, allDone=vis.length>0 && nDone===vis.length;
  const jobs=vis.map((c,i)=> c.statut==="terminee" && !S.openJobs.has(c.id) ? jobLine(c,i+1) : jobHtml(c,i+1,c.id===curId)).join("");
  const veh = camName(me.camionId) ? camName(me.camionId)+(isTracteur(me.camionId)&&remName(camById(me.camionId)?.remorqueId)?" + "+remName(camById(me.camionId).remorqueId):"") : "";
  const nvL = staff ? [] : (S.nouvelles||[]).map(id=>drvC(id)).filter(Boolean).sort((a,b)=>(a.enlDate||"").localeCompare(b.enlDate||"")||(toMin(a.enlHeure)||0)-(toMin(b.enlHeure)||0));
  const nvVisible = nvL.find(c=>inDay(c,todayIso())||inDay(c,addDays(todayIso(),1)));
  const nvHtml = nvL.length ? `<div role="status" style="background:var(--accent-soft);border:2px solid var(--accent);border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:10px">
      <b style="font-size:17px">${nvL.length>1?nvL.length+" nouvelles courses reçues":"Nouvelle course reçue"}</b>
      ${nvL.map(c=>`<div style="font-size:14px"><b>${esc(c.donneur||"Course")}</b> — ${esc(frDate(c.enlDate,{weekday:"long",day:"numeric",month:"long"}))}${c.enlHeure?" à "+esc(c.enlHeure):""}<div class="muted">${esc(c.enlVille||"?")} → ${esc(c.livVille||"?")}</div></div>`).join("")}
      <div class="two">${nvVisible?`<button type="button" class="btn btn-navy big" data-drv="voirnv" data-id="${esc(nvVisible.id)}">Voir la course</button>`:`<span></span>`}<button type="button" class="btn btn-ghost big" data-drv="vunv" data-id="">J'ai vu</button></div></div>` : "";
  const prog = vis.length ? `<div class="prog" role="img" aria-label="${nDone} course${nDone>1?"s":""} sur ${vis.length} terminée${nDone>1?"s":""}"><div class="prog-bar"><span style="width:${Math.round(nDone/vis.length*100)}%"></span></div><span>${nDone} sur ${vis.length} terminée${nDone>1?"s":""}</span></div>` : "";
  return `<div class="drv"><div class="drv-head"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h1>Bonjour ${esc((me.nom||"").split(" ")[0])}</h1>${logo}</div>
    <span style="color:var(--side-muted)">${esc(frDate(day,{weekday:"long",day:"numeric",month:"long"}))}${veh?" · "+esc(veh):""}</span>
    <div class="seg" role="group" aria-label="Jour" style="align-self:flex-start"><button type="button" class="${S.drvDay==="today"?"on":""}" data-dday="today">Aujourd'hui</button><button type="button" class="${S.drvDay==="tomorrow"?"on":""}" data-dday="tomorrow">Demain</button></div>
    ${prog}
    ${sel}</div>
    ${nvHtml}
    ${staff?"":pushCarte()}
    ${tip}
    ${allDone && S.drvDay==="today" ? `<div class="job">${dayRecapHtml(me.id)}</div>` : ""}
    ${vis.length?jobs:`<div class="job"><b>Aucune course envoyée${S.drvDay==="today"?" pour aujourd'hui":" pour demain"}.</b><span class="muted">${staff&&hidden?`${hidden} course(s) prévue(s) mais pas encore envoyée(s).`:"Le planning apparaîtra ici dès que l'exploitation l'aura envoyé."}</span></div>`}
    <p class="muted" style="text-align:center;font-size:12px;margin:0">Chaque bouton envoie l'heure réelle à l'exploitation.</p>${back}</div>`;
}
/* course terminée repliée sur une ligne */
function jobLine(c,n){
  const chips=(c.reserve?`<span class="chip" style="border-color:var(--danger);color:var(--danger)">Réserve</span>`:"")+(hasBL(c)?"":`<span class="chip" style="border-color:var(--accent);color:var(--accent-ink)">BL à envoyer</span>`);
  return `<button type="button" class="jobline" id="job-${esc(c.id)}" data-drv="toggle" data-id="${esc(c.id)}" aria-expanded="false"><span class="dot ok" aria-hidden="true">✓</span><span class="jl-main"><b>${n} · ${esc(c.donneur||"Course")}</b><span class="muted">${esc(c.livVille||"")}${c._role==="enlevement"?(c.chargeEnl?" · chargé "+esc(c.chargeEnl):""):(c.livre?" · livré "+esc(c.livre):"")}</span>${chips?`<span class="subs">${chips}</span>`:""}</span><span class="jl-chev" aria-hidden="true">Voir</span></button>`;
}
/* récapitulatif quand toutes les courses du jour sont livrées */
function dayRecapHtml(condId){
  const t=todayIso(), L=myDay(condId,t), T=myDay(condId,addDays(t,1)).filter(c=>c.statut!=="terminee");
  const res=L.filter(c=>c.reserve).length, bl=L.filter(hasBL).length, sig=L.filter(c=>c.signataire).length;
  const stat=(v,l)=>`<span class="recap-i"><b>${v}</b>${l}</span>`;
  return `<div class="dayhead"><span class="dot ok" aria-hidden="true">✓</span><b>Journée terminée, bravo !</b></div>
    <div class="recap">${stat(L.length,L.length>1?"courses livrées":"course livrée")}${stat(res,res>1?"réserves":"réserve")}${stat(bl+"/"+L.length,"BL envoyés")}${packOn()?stat(sig+"/"+L.length,"signatures"):""}</div>
    ${bl<L.length?`<div class="banner"><span><b>Il manque ${L.length-bl} photo${L.length-bl>1?"s":""} de BL / CMR.</b> Ouvre la course marquée « BL à envoyer » et prends la photo.</span></div>`:""}
    ${T.length?`<div><b>Demain : ${T.length} course${T.length>1?"s":""}</b><div class="muted">Premier enlèvement${T[0].enlHeure?" à "+esc(T[0].enlHeure):""}${T[0].enlVille?" · "+esc(T[0].enlVille):""}${T[0].donneur?" ("+esc(T[0].donneur)+")":""}</div></div><button type="button" class="btn btn-navy" data-dday="tomorrow">Voir le programme de demain</button>`
      :`<span class="muted">Le programme de demain apparaîtra ici dès que l'exploitation l'aura envoyé.</span>`}`;
}
/* écran affiché juste après « Livré » : BL, puis prochaine course ou fin de journée */
function showDone(id){
  const c=drvC(id); if(!c) return;
  const L=myDay(c.conducteurId,todayIso());
  const next=L.find(x=>x.statut==="en_cours")||L.find(x=>x.statut==="envoyee");
  const blBlock = hasBL(c) ? `<div class="okline">✓ Photo du BL / CMR envoyée</div>`
    : `<div class="banner" style="flex-direction:column;align-items:stretch"><b>Il manque la photo du BL / CMR</b><span>Prends-la maintenant : l'exploitation en a besoin pour facturer.</span><label class="btn btn-accent big" style="position:relative">Prendre la photo du BL / CMR<input type="file" accept="image/*,application/pdf" class="hidden-file" data-bl="${esc(id)}"></label></div>`;
  const suite = next ? `<div class="nextcard"><span class="eyebrow">Prochaine course</span><b style="font-size:17px">${esc(next.donneur||"Course")}</b>
      <div><b>Enlèvement${next.enlHeure?" · "+esc(next.enlHeure):""}</b><div>${esc(next.enlNom||"")}</div><div class="muted">${esc([next.enlAdresse,next.enlCp,next.enlVille].filter(Boolean).join(" "))}</div></div>
      <div><b>Livraison${next.livHeure?" · "+esc(next.livHeure):""}</b><div class="muted">${esc([next.livNom,next.livVille].filter(Boolean).join(" · "))}</div></div>
      <a class="btn btn-navy big" href="${next.chargeEnl?gmaps(next.livAdresse,next.livCp,next.livVille):gmaps(next.enlAdresse,next.enlCp,next.enlVille)}" target="_blank" rel="noopener">Ouvrir le GPS</a></div>
      <button type="button" class="btn btn-ghost" data-drv="next" data-id="${esc(next.id)}">Voir le détail de la course</button>`
    : `<div class="nextcard">${dayRecapHtml(c.conducteurId)}</div><button type="button" class="btn btn-ghost" data-act="close">Fermer</button>`;
  openModal(`<div data-lock="1" class="drvmodal"><div class="dayhead"><span class="dot ok" aria-hidden="true">✓</span><div><h2>Course terminée</h2><span class="muted">${esc(c.donneur||"")}${c.livre?" · livré à "+esc(c.livre):""}${c.signataire?" · signé par "+esc(c.signataire):""}</span></div></div>
    ${c.reserve?`<div class="alert"><b>Réserve :</b> ${esc(c.reserve)}</div>`:""}${blBlock}${suite}</div>`);
  S.doneFor=id;
}
/* signature du destinataire avec le doigt */
function openSign(id,reserve){
  const c=drvC(id); if(!c) return;
  openModal(`<div data-lock="keep" class="drvmodal"><h2>Signature du destinataire</h2>
    <span class="muted">${esc(c.livNom||c.donneur||"")} — passe le téléphone à la personne qui réceptionne la marchandise.</span>
    ${reserve?`<div class="alert"><b>Réserve notée :</b> ${esc(reserve)}</div>`:""}
    <label class="fld">Nom de la personne qui signe<input type="text" id="sigNom" autocomplete="off" maxlength="80"></label>
    <div class="sigwrap"><canvas id="sigPad" aria-label="Zone de signature"></canvas><span class="sighint" id="sigHint">Signer ici avec le doigt</span></div>
    <button type="button" class="linkbtn" data-drv="sigClear" style="align-self:flex-start">Effacer la signature</button>
    <button type="button" class="btn btn-accent big" data-drv="sigOk" data-id="${esc(id)}">Valider la livraison</button>
    <div class="two"><button type="button" class="btn btn-ghost" data-drv="sigCancel">Retour</button><button type="button" class="btn btn-ghost" data-drv="sigSkip" data-id="${esc(id)}">Personne pour signer</button></div></div>`);
  S.sign={id,reserve,drawn:false};
  const cv=$("#sigPad"); if(!cv) return;
  const dpr=Math.min(window.devicePixelRatio||1,2), r=cv.getBoundingClientRect();
  cv.width=Math.round(r.width*dpr); cv.height=Math.round(r.height*dpr);
  const x=cv.getContext("2d"); x.scale(dpr,dpr);
  // la signature est une image jointe à la course : toujours encre foncée sur fond blanc
  const blank=()=>{ x.fillStyle="#FFFFFF"; x.fillRect(0,0,r.width,r.height); };
  blank(); x.strokeStyle="#14202E"; x.lineWidth=2.4; x.lineCap="round"; x.lineJoin="round";
  let on=false; const pos=e=>{ const b=cv.getBoundingClientRect(); return [e.clientX-b.left,e.clientY-b.top]; };
  cv.addEventListener("pointerdown",e=>{ e.preventDefault(); on=true; try{cv.setPointerCapture(e.pointerId);}catch(_){ }
    const [a,b]=pos(e); x.beginPath(); x.moveTo(a,b); x.lineTo(a+0.1,b+0.1); x.stroke(); if(S.sign) S.sign.drawn=true; const h=$("#sigHint"); if(h) h.hidden=true; });
  cv.addEventListener("pointermove",e=>{ if(!on) return; e.preventDefault(); const [a,b]=pos(e); x.lineTo(a,b); x.stroke(); });
  ["pointerup","pointercancel"].forEach(t=>cv.addEventListener(t,()=>{ on=false; }));
  S.sign.clear=()=>{ blank(); S.sign.drawn=false; const h=$("#sigHint"); if(h) h.hidden=false; };
}
/* signalement d'un problème à l'exploitation */
function openIncident(id){
  const c=drvC(id); if(!c) return; S.incType=null;
  openModal(`<div data-lock="1" class="drvmodal"><h2>Signaler un problème</h2>
    <span class="muted">${esc(c.donneur||"Course")} — l'exploitation est prévenue tout de suite.</span>
    <div class="inctypes" role="radiogroup" aria-label="Type de problème">${Object.entries(INC).map(([k,l])=>`<button type="button" role="radio" aria-checked="false" class="btn btn-ghost" data-inctype="${k}">${l}</button>`).join("")}</div>
    <label class="fld">Précisions (facultatif)<textarea id="incTxt" maxlength="500" placeholder="Exemple : 2 h d'attente au quai 4"></textarea></label>
    <label class="btn btn-ghost" style="position:relative"><span id="incPhotoLbl">Ajouter une photo (facultatif)</span><input type="file" accept="image/*" class="hidden-file" id="incPhoto"></label>
    <div class="two"><button type="button" class="btn btn-ghost" data-act="close">Annuler</button><button type="button" class="btn btn-accent" data-drv="incOk" data-id="${esc(id)}">Envoyer</button></div></div>`);
}
/* photos de réserve : prises sur l'écran « Livré avec réserves », envoyées à la validation et rattachées à la course */
const RES_MAX = 5;
const resPhHtml = () => { const n=(S.resPh||[]).length;
  const th=(S.resPh||[]).map((p,i)=>`<span class="rph"><img src="${p.url}" alt="Photo ${i+1} de la réserve"><button type="button" data-drv="resPhDel" data-i="${i}" aria-label="Retirer la photo ${i+1}">×</button></span>`).join("");
  return `${th?`<div class="rphs">${th}</div>`:""}${n<RES_MAX?`<label class="btn btn-ghost" style="position:relative">📷 Prendre une photo${n?` (${n}/${RES_MAX})`:""}<input type="file" accept="image/*" capture="environment" class="hidden-file" id="resPhoto"></label>`:`<span class="muted">${RES_MAX} photos maximum.</span>`}${n?"":`<span class="muted" style="font-size:13px">Ajoute une photo pour justifier la réserve.</span>`}`; };
function resPhClear(){ (S.resPh||[]).forEach(p=>{ try{URL.revokeObjectURL(p.url);}catch(e){} }); S.resPh=[]; S.resTxt=""; }
function reduirePhoto(file){ return new Promise(res=>{
  if(!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size<900*1024){ res(file); return; }
  const url=URL.createObjectURL(file); const img=new Image();
  img.onload=()=>{ try{ const k=Math.min(1,1800/Math.max(img.width,img.height)); const cv=document.createElement("canvas"); cv.width=Math.round(img.width*k); cv.height=Math.round(img.height*k);
      cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height); URL.revokeObjectURL(url); cv.toBlob(b=>res(b&&b.size<file.size?b:file),"image/jpeg",.82); }catch(e){ URL.revokeObjectURL(url); res(file); } };
  img.onerror=()=>{ URL.revokeObjectURL(url); res(file); }; img.src=url; }); }
async function envoyerPhotosReserve(id){ const L=(S.resPh||[]).slice(); if(!L.length) return; let ko=0;
  for(let i=0;i<L.length;i++){ try{ const f=await reduirePhoto(L[i].file); const ext=f.type==="image/jpeg"?".jpg":((L[i].file.name.match(/\.\w+$/)||[".jpg"])[0].toLowerCase());
      const path=`${EID()}/reserve/${id}-${Date.now()}-${i}${ext}`; const up=await sb.storage.from("documents").upload(path,f,{contentType:f.type||"image/jpeg"}); if(up.error){ ko++; continue; }
      const {error}=await sb.rpc("ajouter_document",{p_course:id,p_path:path,p_nom:"photo-reserve-"+(i+1),p_type:"reserve"}); if(error) ko++; }
    catch(e){ ko++; } }
  if(ko) toast(ko===L.length ? "La livraison est validée, mais les photos n'ont pas pu être envoyées. Préviens l'exploitation." : "La livraison est validée, mais "+ko+" photo"+(ko>1?"s":"")+" n'a pas pu être envoyée"+(ko>1?"s":"")+".");
}
async function deliver(id,reserve){
  const {error}=await sb.rpc("etape_course",Object.assign({p_course:id,p_etape:"livre",p_reserve:reserve||null},affArg(id)));
  if(error){ toast(errMsg(error)); return false; }
  S.reserveFor=null; resPhClear(); await loadData(); showDone(id); return true;
}
function jobHtml(c,n,cur){
  const st=c.statut; const done=st==="terminee"||st==="annulee"; const id=esc(c.id);
  const maps=gmaps;
  // prochaine étape à valider : chaque bouton est placé directement sous l'enlèvement ou la livraison concernés
  const role=c._role||"complet", roleLiv=role==="livraison", roleEnl=role==="enlevement";
  const next = done ? null : roleLiv ? (!c.arriveeLiv?"arrivee_liv":"livre") : !c.arriveeEnl ? "arrivee_enl" : !c.chargeEnl ? "charge_enl" : roleEnl ? null : !c.arriveeLiv ? "arrivee_liv" : "livre";
  const enlCur = next==="arrivee_enl"||next==="charge_enl", livCur = next==="arrivee_liv"||next==="livre";
  let enlBtn="", livBtn="";
  if(next==="arrivee_enl") enlBtn=`<button type="button" class="btn btn-navy big" data-drv="arrivee_enl" data-id="${id}">Je suis arrivé à l'enlèvement</button>`;
  else if(next==="charge_enl") enlBtn=`<button type="button" class="btn btn-navy big" data-drv="charge_enl" data-id="${id}">Chargement terminé</button>`;
  else if(next==="arrivee_liv") livBtn=`<button type="button" class="btn btn-navy big" data-drv="arrivee_liv" data-id="${id}">Je suis arrivé à la livraison</button>`;
  else if(next==="livre") livBtn = S.reserveFor===c.id
    ? `<label class="fld">Décrivez la réserve (casse, manquant, retard…)<textarea id="resTxt">${esc(S.resTxt||"")}</textarea></label><div id="resPhBox" class="rbox">${resPhHtml()}</div><div class="two"><button type="button" class="btn btn-ghost" data-drv="resCancel" data-id="${id}">Annuler</button><button type="button" class="btn btn-danger" data-drv="resOk" data-id="${id}">Valider la livraison</button></div>`
    : `<div class="two"><button type="button" class="btn btn-accent big" data-drv="livre" data-id="${id}">Livré sans réserve</button><button type="button" class="btn btn-danger big" data-drv="reserve" data-id="${id}">Livré avec réserves</button></div>`;
  // le rond est aussi un bouton : un appui valide l'étape en cours
  const dot=(ok,isCur,which)=>{
    if(ok) return `<span class="dot ok" aria-label="Fait">✓</span>`;
    if(!next) return `<span class="dot"></span>`;
    if(isCur && next!=="livre") return `<button type="button" class="dot cur" data-drv="${next}" data-id="${id}" aria-label="Valider l'étape"></button>`;
    if(isCur) return `<span class="dot cur" aria-label="À faire maintenant"></span>`;
    return `<button type="button" class="dot" data-drv="pasencore" data-id="${id}" data-which="${which}" aria-label="À faire plus tard"></button>`;
  };
  const sub=(lbl,t)=>`<span class="sub ${t?"ok":""}">${t?"✓ ":""}${lbl}${t?" "+esc(t):""}</span>`;
  const step=(ok,isCur,which,title,heure,lines,subs,btn)=>`<div class="step ${isCur?"now":""}">${dot(ok,isCur,which)}<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px"><b>${title}${heure?" · "+esc(heure):""}</b>${lines}<div class="subs">${subs}</div>${btn}</div></div>`;
  const m=[c.palettes&&c.palettes+" palettes",c.colis&&c.colis+" colis",c.poids&&Number(c.poids).toLocaleString("fr-FR")+" kg",c.metres&&c.metres+" m"].filter(Boolean).join(" · ");
  const bl=(c.docs||[]).filter(d=>d.type==="bl").length;
  const autreJour = c.enlDate && c.livDate && c.livDate!==c.enlDate;
  const jour = d => autreJour && d ? " · "+esc(frDate(d,{weekday:"short",day:"numeric",month:"short"})) : "";
  const incs = incOf(c).map(i=>`<div class="alert"><b>Signalé${i.heure?" à "+esc(i.heure):""} · ${esc(INC[i.type]||"Autre")}</b>${i.commentaire?" — "+esc(i.commentaire):""}</div>`).join("");
  return `<article class="job ${cur?"cur":""}" id="job-${id}">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b style="font-size:16px">${n} · ${esc(c.donneur||"")}${(S.nouvelles||[]).includes(c.id)?` <span class="chip" style="border-color:var(--accent);background:var(--accent);color:var(--on-accent);vertical-align:middle">Nouveau</span>`:""}</b><span style="display:flex;align-items:center;gap:8px">${st==="terminee"?`<button type="button" class="linkbtn" data-drv="toggle" data-id="${id}" aria-expanded="true">Replier</button>`:""}<span class="chip st-${esc(st)}">${esc(STATUTS[st]?.l||"")}</span></span></div>
    ${step(!!c.chargeEnl||roleLiv,enlCur,"enl","Enlèvement"+jour(c.enlDate),c.enlHeure,`<div>${esc(c.enlNom||"")}</div><div>${esc(c.enlAdresse||"")} ${esc(c.enlCp||"")} ${esc(c.enlVille||"")}</div><a href="${maps(c.enlAdresse,c.enlCp,c.enlVille)}" target="_blank" rel="noopener">Ouvrir le GPS</a>`,roleLiv?`<span class="sub">Enlèvement assuré par un autre conducteur</span>`:sub("Arrivé",c.arriveeEnl)+sub("Chargé",c.chargeEnl),enlBtn)}
    ${step(!!c.livre||roleEnl,livCur,"liv","Livraison"+jour(c.livDate),c.livHeure,`<div>${esc(c.livNom||"")}</div><div>${esc(c.livAdresse||"")} ${esc(c.livCp||"")} ${esc(c.livVille||"")}</div><a href="${maps(c.livAdresse,c.livCp,c.livVille)}" target="_blank" rel="noopener">Ouvrir le GPS</a>`,roleEnl?`<span class="sub">Livraison assurée par un autre conducteur</span>`:sub("Arrivé",c.arriveeLiv)+sub("Livré",c.livre)+(c.signataire?`<span class="sub ok">✓ Signé par ${esc(c.signataire)}</span>`:""),livBtn)}
    ${role!=="complet"?`<div class="alert" style="background:var(--accent-soft);color:inherit"><b>${esc(ROLES[role])}</b> — la course est partagée avec un autre conducteur.</div>`:""}
    ${vehLabel(c)?`<div style="font-size:13px"><b>Véhicule :</b> ${esc(vehLabel(c))}</div>`:""}
    ${m||c.ref?`<div class="muted" style="font-size:13px">${esc(m)}${c.ref?" · Réf. "+esc(c.ref):""}</div>`:""}
    ${cmdTexte(c).length>1?`<div style="font-size:13px"><b>Commandes :</b><ul style="margin:4px 0 0;padding-left:18px">${cmdTexte(c).map(t=>`<li>${esc(t)}</li>`).join("")}</ul></div>`:""}
    ${c.instructions?`<div style="background:var(--accent-soft);border-radius:8px;padding:8px 10px;font-size:13px"><b>Consignes :</b> ${esc(c.instructions)}</div>`:""}
    ${c.contact?`<div style="font-size:13px">Contact : <span style="user-select:all">${esc(c.contact)}</span></div>`:""}
    ${c.reserve?`<div class="alert"><b>Réserve :</b> ${esc(c.reserve)}</div>`:""}
    ${incs}
    <div class="${packOn()&&st!=="annulee"?"two":""}"><label class="btn btn-ghost" style="position:relative">Photo BL / CMR${bl?` (${bl})`:""}<input type="file" accept="image/*,application/pdf" class="hidden-file" data-bl="${id}"></label>${packOn()&&st!=="annulee"?`<button type="button" class="btn btn-ghost" data-drv="incident" data-id="${id}">Signaler un problème</button>`:""}</div>
    ${(roleLiv?c.arriveeLiv:c.arriveeEnl)&&!done?`<button type="button" class="btn btn-ghost btn-sm" data-drv="annuler" data-id="${id}" style="align-self:center">Annuler la dernière étape</button>`:""}
  </article>`;
}
async function drvAction(act,id,el){
  if(act==="pasencore"){ toast("Valide d'abord l'enlèvement : arrivé, puis chargé."); return; }
  if(act==="pushon"){ pushActiver(); return; }
  if(act==="vunv"){ marquerVues(); render(); return; }
  if(act==="voirnv"){ const c=drvC(id); marquerVues(); if(c) S.drvDay = inDay(c,todayIso()) ? "today" : "tomorrow"; render(); const j=document.getElementById("job-"+id); j&&j.scrollIntoView({block:"start"}); return; }
  if(act==="toggle"){ S.openJobs.has(id)?S.openJobs.delete(id):S.openJobs.add(id); render(); return; }
  if(act==="incident"){ openIncident(id); return; }
  if(act==="next"){ closeModal(); S.drvDay="today"; render(); const j=document.getElementById("job-"+id); j&&j.scrollIntoView({block:"start"}); return; }
  if(act==="reserve"){ resPhClear(); S.reserveFor=id; render(); const r=$("#resTxt"); r&&r.focus(); return; }
  if(act==="resCancel"){ S.reserveFor=null; resPhClear(); render(); return; }
  if(act==="resPhDel"){ const p=(S.resPh||[]).splice(Number(el.dataset.i),1)[0]; if(p){ try{URL.revokeObjectURL(p.url);}catch(e){} } const b=$("#resPhBox"); if(b) b.innerHTML=resPhHtml(); return; }
  if(act==="sigClear"){ S.sign&&S.sign.clear&&S.sign.clear(); return; }
  if(act==="sigCancel"){ closeModal(); return; }
  if(act==="sigSkip"){ const rv=S.sign?S.sign.reserve:null; closeModal(); await deliver(id,rv); return; }
  if(act==="sigOk"){
    const nom=($("#sigNom")?.value||"").trim();
    if(!nom){ toast("Indique le nom de la personne qui signe."); $("#sigNom")?.focus(); return; }
    if(!S.sign||!S.sign.drawn){ toast("La signature est vide : fais signer dans le cadre."); return; }
    const rv=S.sign.reserve, lbl=el.textContent; el.disabled=true; el.textContent="Envoi…";
    const fail=m=>{ toast(m); el.disabled=false; el.textContent=lbl; };
    const blob=await new Promise(r=>$("#sigPad").toBlob(r,"image/png"));
    if(!blob){ fail("La signature n'a pas pu être enregistrée. Réessaie."); return; }
    const path=`${EID()}/signatures/${id}-${Date.now()}.png`;
    const up=await sb.storage.from("documents").upload(path,blob,{contentType:"image/png"});
    if(up.error){ fail("La signature n'a pas pu être envoyée. Vérifie le réseau et réessaie."); return; }
    const sg=await sb.rpc("signer_livraison",{p_course:id,p_nom:nom,p_path:path});
    if(sg.error){ fail(errMsg(sg.error)); return; }
    closeModal(); await deliver(id,rv); return;
  }
  if(act==="incOk"){
    if(!S.incType){ toast("Choisis d'abord le type de problème."); return; }
    const lbl=el.textContent; el.disabled=true; el.textContent="Envoi…";
    const fail=m=>{ toast(m); el.disabled=false; el.textContent=lbl; };
    let path=null; const f=$("#incPhoto")?.files?.[0];
    if(f){ if(f.size>9*1024*1024){ fail("Photo trop lourde (9 Mo maximum)."); return; }
      const ext=(f.name.match(/\.\w+$/)||[".jpg"])[0].toLowerCase(); path=`${EID()}/incidents/${id}-${Date.now()}${ext}`;
      const up=await sb.storage.from("documents").upload(path,f,{contentType:f.type||"image/jpeg"});
      if(up.error){ fail("La photo n'a pas pu être envoyée. Réessaie, ou envoie sans photo."); return; } }
    const {error}=await sb.rpc("signaler_incident",{p_course:id,p_type:S.incType,p_commentaire:$("#incTxt")?.value||"",p_path:path});
    if(error){ fail(errMsg(error)); return; }
    closeModal(); toast("Problème signalé à l'exploitation"); scheduleReload(); return;
  }
  if(act==="livre"||act==="resOk"){
    let reserve=null;
    if(act==="resOk"){ reserve=($("#resTxt")?.value||"").trim(); if(!reserve){ toast("Décrivez la réserve avant de valider."); return; }
      if((S.resPh||[]).length){ const bt=el; if(bt){ bt.disabled=true; bt.textContent="Envoi des photos…"; } await envoyerPhotosReserve(id); } }
    if(packOn()) openSign(id,reserve); else await deliver(id,reserve);
    return;
  }
  const {error}=await sb.rpc("etape_course",Object.assign({p_course:id,p_etape:act,p_reserve:null},affArg(id)));
  if(error){ toast(errMsg(error)); return; }
  scheduleReload();
}
async function uploadBL(id,file){
  if(file.size>9*1024*1024){ toast("Photo trop lourde (9 Mo maximum)."); return; }
  toast("Envoi de la photo…");
  const ext=(file.name.match(/\.\w+$/)||[".jpg"])[0].toLowerCase();
  const path=`${EID()}/bl/${id}-${Date.now()}${ext}`;
  const up=await sb.storage.from("documents").upload(path,file,{contentType:file.type||"image/jpeg"});
  if(up.error){ toast("La photo n'a pas pu être envoyée. Réessayez."); return; }
  const {error}=await sb.rpc("ajouter_document",{p_course:id,p_path:path,p_nom:file.name||"photo",p_type:"bl"});
  if(error){ toast(errMsg(error)); return; }
  toast("Photo du BL / CMR envoyée"); const again=S.doneFor===id; await loadData(); if(again) showDone(id);
}

/* ---------- INDICATEURS ---------- */
function vIndic(){
  const t=todayIso(); const from = S.iPeriode==="mois" ? t.slice(0,8)+"01" : S.iPeriode==="tout" ? "0000" : addDays(t,-Number(S.iPeriode)+1);
  let L=S.courses.filter(c=>c.enlDate && c.enlDate>=from && c.enlDate<=t);
  if(S.iCond) L=L.filter(c=>c.conducteurId===S.iCond);
  if(S.iDonneur) L=L.filter(c=>c.donneur===S.iDonneur);
  const donneurs=[...new Set(S.courses.map(c=>c.donneur).filter(Boolean))].sort();
  const term=L.filter(c=>c.statut==="terminee"), ann=L.filter(c=>c.statut==="annulee"), nt=L.length-term.length-ann.length;
  const res=term.filter(c=>c.reserve).length;
  const docsOk=term.filter(c=>(c.docs||[]).some(d=>d.type==="bl")).length;
  const late=(prev,real)=>{ const a=toMin(prev), b=toMin(real); if(a==null||b==null) return null; return b-a; };
  const P=(k1,k2)=>{ let ok=0,lt=0,unk=0; const b=[0,0,0]; term.concat(L.filter(c=>c.statut==="en_cours")).forEach(c=>{ const d=late(c[k1],c[k2]); if(d==null){unk++;return;} if(d<=5) ok++; else { lt++; b[d<15?0:d<=45?1:2]++; } }); return {ok,lt,unk,b,tot:ok+lt+unk}; };
  const pc=P("enlHeure","arriveeEnl"), pd=P("livHeure","arriveeLiv");
  const W=(a,b)=>{ const r=[0,0,0]; term.forEach(c=>{ const x=toMin(c[a]), y=toMin(c[b]); if(x==null||y==null||y<x) return; const d=y-x; r[d<30?0:d<=60?1:2]++; }); return r; };
  const wc=W("arriveeEnl","chargeEnl"), wd=W("arriveeLiv","livre");
  const ca=L.filter(c=>c.statut!=="annulee").reduce((s,c)=>s+(Number(c.prix)||0),0);
  const punct = pd.ok+pd.lt ? Math.round(pd.ok/(pd.ok+pd.lt)*100) : null;
  const donut=(parts,center,label)=>{ const tot=parts.reduce((s,p)=>s+p[1],0)||1; let acc=0;
    const g=parts.map(p=>{ const a=acc/tot*100; acc+=p[1]; return `${p[2]} ${a}% ${acc/tot*100}%`; }).join(",");
    return `<div class="donut-row"><div class="donut" role="img" aria-label="${esc(label)}" style="background:${parts.some(p=>p[1])?`conic-gradient(${g})`:"var(--surface-2)"}"><div>${center}</div></div><div class="lg">${parts.map(p=>`<span><span class="sw" style="background:${p[2]}"></span>${p[0]} · <b class="num">${p[1]}</b></span>`).join("")}</div></div>`; };
  const pctOf=(a,b)=> b? Math.round(a/b*100)+" %" : "—";
  const stack=(p)=>{ const H=130, tot=p.tot||1; return `<div class="stack" style="height:${H}px"><div style="height:${p.ok/tot*H}px;background:var(--navy)"></div><div style="height:${p.lt/tot*H}px;background:var(--danger)"></div><div style="height:${p.unk/tot*H}px;background:var(--line)"></div></div>`; };
  const grp=(a,b)=>{ const mx=Math.max(1,...a,...b); return a.map((v,i)=>`<div class="g"><div class="b" style="height:${v/mx*120}px;background:var(--navy)"><em>${v}</em></div><div class="b" style="height:${b[i]/mx*120}px;background:var(--accent)"><em>${b[i]}</em></div></div>`).join(""); };
  const byD={}; L.forEach(c=>{ const k=c.donneur||"—"; const o=byD[k]||(byD[k]={n:0,ca:0,ok:0,mes:0,att:[],res:0}); o.n++; if(c.statut!=="annulee") o.ca+=Number(c.prix)||0; const d=late(c.livHeure,c.arriveeLiv); if(d!=null){o.mes++; if(d<=5)o.ok++;} [["arriveeEnl","chargeEnl"],["arriveeLiv","livre"]].forEach(([a,b])=>{ const x=toMin(c[a]),y=toMin(c[b]); if(x!=null&&y!=null&&y>=x) o.att.push(y-x); }); if(c.reserve) o.res++; });
  const rows=Object.entries(byD).sort((a,b)=>b[1].ca-a[1].ca).map(([k,o])=>{ const att=o.att.length?Math.round(o.att.reduce((s,x)=>s+x,0)/o.att.length):null; const warn=att!=null&&att>60;
    return `<tr ${warn?'style="background:var(--danger-soft)"':""}><td><b>${esc(k)}</b></td><td class="r num">${o.n}</td><td class="r num">${eur(o.ca)}</td><td class="r num">${o.mes?Math.round(o.ok/o.mes*100)+" %":"—"}</td><td class="r num">${att!=null?att+" min":"—"}</td><td class="r num">${o.res}</td><td>${warn?`<b style="color:var(--danger)">Attente longue : facturer l'immobilisation ?</b>`:"OK"}</td></tr>`; }).join("");
  const legend2=`<div class="lg" style="flex-direction:row;gap:12px;font-size:12px"><span><span class="sw" style="background:var(--navy)"></span>Chargement</span><span><span class="sw" style="background:var(--accent)"></span>Déchargement</span></div>`;
  return `<div class="bar"><h1>Indicateurs</h1>
    <label class="fld" style="flex-direction:row;align-items:center;gap:6px">Période<select id="iPer" style="width:auto">${[["7","7 derniers jours"],["30","30 derniers jours"],["mois","Mois en cours"],["tout","Depuis le début"]].map(([k,l])=>`<option value="${k}" ${S.iPeriode===k?"selected":""}>${l}</option>`).join("")}</select></label>
    <label class="fld" style="flex-direction:row;align-items:center;gap:6px">Conducteur<select id="iCond" style="width:auto"><option value="">Tous</option>${activeConds().map(k=>`<option value="${esc(k.id)}" ${S.iCond===k.id?"selected":""}>${esc(k.nom)}</option>`).join("")}</select></label>
    <label class="fld" style="flex-direction:row;align-items:center;gap:6px">Donneur d'ordre<select id="iDon" style="width:auto"><option value="">Tous</option>${donneurs.map(d=>`<option ${S.iDonneur===d?"selected":""}>${esc(d)}</option>`).join("")}</select></label></div>
  <div class="kpis">
    <div class="kpi"><small>Courses</small><b class="num">${L.length}</b></div>
    <div class="kpi"><small>Terminées</small><b class="num">${pctOf(term.length,L.length-ann.length)}</b></div>
    <div class="kpi"><small>Livraisons à l'heure</small><b class="num">${punct==null?"—":punct+" %"}</b></div>
    <div class="kpi ${res?"bad":""}"><small>Avec réserves</small><b class="num">${res}</b></div>
    <div class="kpi dark"><small>Chiffre d'affaires</small><b class="num">${eur(ca)}</b></div></div>
  <h2 style="font-size:17px;color:var(--navy)">Progression</h2>
  <div class="charts">
    <div class="panel chart"><h3>Statut des courses</h3>${donut([["Terminées",term.length,"var(--navy)"],["Non terminées",nt,"var(--accent)"],["Annulées",ann.length,"var(--line)"]],pctOf(term.length,L.length),"Statut des courses")}</div>
    <div class="panel chart"><h3>Réserves à la livraison</h3>${donut([["Sans réserve",term.length-res,"var(--navy)"],["Avec réserves",res,"var(--danger)"]],pctOf(term.length-res,term.length),"Réserves")}</div>
    <div class="panel chart"><h3>Documents (photo BL / CMR)</h3>${donut([["Complets",docsOk,"var(--navy)"],["Manquants",term.length-docsOk,"var(--accent)"]],pctOf(docsOk,term.length),"Documents")}</div></div>
  <h2 style="font-size:17px;color:var(--navy)">Ponctualité</h2>
  <div class="charts">
    <div class="panel chart"><h3>À l'heure ou en retard</h3><div class="bars">${stack(pc)}${stack(pd)}</div><div class="xl"><span>Chargement</span><span>Déchargement</span></div>
      <div class="lg" style="flex-direction:row;flex-wrap:wrap;gap:12px;font-size:12px"><span><span class="sw" style="background:var(--navy)"></span>À l'heure</span><span><span class="sw" style="background:var(--danger)"></span>En retard</span><span><span class="sw" style="background:var(--line)"></span>Inconnu</span></div></div>
    <div class="panel chart"><h3>Répartition des retards</h3><div class="bars" style="padding-top:18px">${grp(pc.b,pd.b)}</div><div class="xl"><span>&lt; 15 min</span><span>15–45 min</span><span>&gt; 45 min</span></div>${legend2}</div>
    <div class="panel chart"><h3>Temps passé sur place</h3><div class="bars" style="padding-top:18px">${grp(wc,wd)}</div><div class="xl"><span>&lt; 30 min</span><span>30–60 min</span><span>&gt; 60 min</span></div>${legend2}</div></div>
  <h2 style="font-size:17px;color:var(--navy)">Par donneur d'ordre</h2>
  <div class="panel tbl-wrap">${rows?`<table><thead><tr><th>Donneur d'ordre</th><th class="r">Courses</th><th class="r">CA</th><th class="r">Livré à l'heure</th><th class="r">Temps moyen sur place</th><th class="r">Réserves</th><th>Statut</th></tr></thead><tbody>${rows}</tbody></table>`:`<div class="empty">Aucune course sur cette période.</div>`}</div>
  <p class="muted" style="margin:0;font-size:12px">À l'heure = arrivée au plus 5 min après l'heure prévue. Les heures réelles viennent des boutons de la vue conducteur.</p>`;
}
after.indicateurs=()=>{ [["iPer","iPeriode"],["iCond","iCond"],["iDon","iDonneur"]].forEach(([id,k])=>{ const el=$("#"+id); el&&el.addEventListener("change",()=>{ S[k]=el.value; render(); }); }); };

/* ---------- PARAMÈTRES ---------- */
function vParams(){
  const conds=S.conducteurs.slice().sort((a,b)=>(a.nom||"").localeCompare(b.nom||""));
  const cams=S.camions.slice().sort((a,b)=>(a.immat||"").localeCompare(b.immat||""));
  const rems=S.remorques.slice().sort((a,b)=>(a.immat||"").localeCompare(b.immat||""));
  const camsG=cams.slice().sort((a,b)=>CAT_ORDRE[catVeh(a)]-CAT_ORDRE[catVeh(b)]||cmpTxt(a.immat,b.immat)); const hd=new Map(); camsG.forEach(k=>{ if(![...hd.keys()].some(id=>catVeh(camsG.find(x=>x.id===id))===catVeh(k))) hd.set(k.id,CAT_LIB[catVeh(k)]+" ("+camsG.filter(x=>catVeh(x)===catVeh(k)).length+")"); });
  const camOpt=sel=>`<option value="">—</option>`+cams.map(k=>`<option value="${esc(k.id)}" ${sel===k.id?"selected":""}>${esc(k.immat)}</option>`).join("");
  const remOpt=sel=>`<option value="">—</option>`+rems.map(k=>`<option value="${esc(k.id)}" ${sel===k.id?"selected":""}>${esc(k.immat)}</option>`).join("");
  const codeOf=id=>(S.acces||[]).find(a=>a.conducteur_id===id);
  const fmtCode=c=>c.length>6?c.slice(0,5)+" "+c.slice(5):c;
  const cnx=id=>{ const m=S.membres.find(x=>x.conducteur_id===id && x.role==="conducteur");
    if(!m) return `<span class="muted">Jamais</span>`;
    const quand = m.derniere_connexion ? new Date(m.derniere_connexion).toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"}) : "Relié";
    const notif = S.pushActifs ? (S.pushActifs.has(id) ? `<div style="font-size:12px;color:var(--ok,#1E7B4F);font-weight:600">Notifications activées</div>` : `<div style="font-size:12px;color:var(--warn,#B25E09)">Notifications pas activées</div>`) : "";
    return `<span>${esc(quand)}</span>${m.appareil?`<div class="muted" style="font-size:12px">${esc(m.appareil)}</div>`:""}${notif}<button type="button" class="linkbtn" style="font-size:12px" data-unlink="${esc(id)}">Déconnecter</button>`; };
  const codeCell=id=>{ const a=codeOf(id);
    return a ? `<span class="num" style="font-weight:700;letter-spacing:.08em;user-select:all">${esc(fmtCode(a.code))}</span><div><button type="button" class="btn btn-accent btn-sm" data-acces="${esc(id)}" style="margin-top:4px">Envoyer par…</button></div>`
             : `<button type="button" class="btn btn-ghost btn-sm" data-regen="${esc(id)}">Générer un code</button>`; };
  return `<div class="bar"><h1>Conducteurs, camions & remorques</h1></div>
  <section class="panel" style="padding:16px;display:flex;flex-direction:column;gap:10px"><h2 style="font-size:17px;color:var(--navy)">Entreprise</h2>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end"><label class="fld" style="flex:1 1 260px">Nom affiché<input type="text" id="coIn" value="${esc(S.entreprise?.nom||"")}"></label><button type="button" class="btn btn-accent" data-act="saveco">Enregistrer</button></div></section>
  <section class="panel" style="padding:16px;display:flex;flex-direction:column;gap:10px"><h2 style="font-size:17px;color:var(--navy)">Conducteurs <span class="muted" style="font-size:13px;font-family:var(--text)">${conds.length}</span></h2>
    <p class="muted" style="margin:0;font-size:13px">Chaque conducteur installe l'application <b>Dream Chauffeur</b> avec son <b>code d'invitation</b> (envoyé par WhatsApp ou SMS). Il voit ensuite son programme dès qu'il ouvre l'application, sans compte ni mot de passe.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Nom</th><th>Téléphone</th><th>Véhicule habituel</th><th>Actif</th><th>Code d'invitation</th><th>Dernière connexion</th><th></th></tr></thead><tbody>
    ${conds.map(k=>`<tr><td><input type="text" id="cn_${esc(k.id)}" value="${esc(k.nom||"")}" aria-label="Nom"></td><td><input type="tel" id="ct_${esc(k.id)}" value="${esc(k.tel||"")}" aria-label="Téléphone"></td><td><select id="cc_${esc(k.id)}" aria-label="Véhicule habituel">${camOpt(k.camionId)}</select></td><td><input type="checkbox" id="ca_${esc(k.id)}" ${k.actif!==false?"checked":""} aria-label="Actif" style="width:20px;height:20px"></td><td style="white-space:nowrap">${codeCell(k.id)}</td><td style="white-space:nowrap">${cnx(k.id)}</td><td style="white-space:nowrap"><button type="button" class="btn btn-ghost btn-sm" data-savecond="${esc(k.id)}">Enregistrer</button> <button type="button" class="btn btn-ghost btn-sm" data-delcond="${esc(k.id)}">Supprimer</button></td></tr>`).join("")}
    <tr><td><input type="text" id="cn_new" placeholder="Nouveau conducteur" aria-label="Nom du nouveau conducteur"></td><td><input type="tel" id="ct_new" placeholder="06…" aria-label="Téléphone"></td><td><select id="cc_new" aria-label="Véhicule habituel">${camOpt("")}</select></td><td></td><td></td><td></td><td><button type="button" class="btn btn-accent btn-sm" data-act="addcond">Ajouter</button></td></tr>
    </tbody></table></div></section>
  <section class="panel" style="padding:16px;display:flex;flex-direction:column;gap:10px"><h2 style="font-size:17px;color:var(--navy)">Tracteurs, porteurs et autres véhicules <span class="muted" style="font-size:13px;font-family:var(--text)">${cams.length}</span></h2>
    <div class="tbl-wrap"><table><thead><tr><th>Immatriculation</th><th>Type</th><th>Remorque habituelle</th><th>Actif</th><th></th></tr></thead><tbody>
    ${camsG.map(k=>(hd.get(k.id)?`<tr class="grp"><th colspan="5" style="text-align:left;background:var(--surface-2,#f2f4f7);font-size:13px">${esc(hd.get(k.id))}</th></tr>`:"")+`<tr><td><input type="text" id="vi_${esc(k.id)}" value="${esc(k.immat||"")}" aria-label="Immatriculation"></td><td><input type="text" id="vt_${esc(k.id)}" value="${esc(k.type||"")}" aria-label="Type"></td><td>${isTracteur(k.id)?`<select id="vr_${esc(k.id)}" aria-label="Remorque habituelle">${remOpt(k.remorqueId)}</select>`:`<span class="muted">—</span>`}</td><td><input type="checkbox" id="va_${esc(k.id)}" ${k.actif!==false?"checked":""} aria-label="Actif" style="width:20px;height:20px"></td><td style="white-space:nowrap"><button type="button" class="btn btn-ghost btn-sm" data-savecam="${esc(k.id)}">Enregistrer</button> <button type="button" class="btn btn-ghost btn-sm" data-delcam="${esc(k.id)}">Supprimer</button></td></tr>`).join("")}
    <tr><td><input type="text" id="vi_new" placeholder="AB-123-CD" aria-label="Immatriculation du nouveau camion"></td><td><input type="text" id="vt_new" placeholder="Tracteur, Porteur 19 T, VUL…" aria-label="Type"></td><td></td><td></td><td><button type="button" class="btn btn-accent btn-sm" data-act="addcam">Ajouter</button></td></tr>
    </tbody></table></div></section>
  <section class="panel" style="padding:16px;display:flex;flex-direction:column;gap:10px"><h2 style="font-size:17px;color:var(--navy)">Remorques <span class="muted" style="font-size:13px;font-family:var(--text)">${rems.length}</span></h2>
    <div class="tbl-wrap"><table><thead><tr><th>Immatriculation</th><th>Attelée à (habituellement)</th><th>Actif</th><th></th></tr></thead><tbody>
    ${rems.map(k=>`<tr><td><input type="text" id="ri_${esc(k.id)}" value="${esc(k.immat||"")}" aria-label="Immatriculation"></td><td class="muted">${esc(cams.filter(t=>t.remorqueId===k.id).map(t=>t.immat).join(", ")||"—")}</td><td><input type="checkbox" id="ra_${esc(k.id)}" ${k.actif!==false?"checked":""} aria-label="Actif" style="width:20px;height:20px"></td><td style="white-space:nowrap"><button type="button" class="btn btn-ghost btn-sm" data-saverem="${esc(k.id)}">Enregistrer</button> <button type="button" class="btn btn-ghost btn-sm" data-delrem="${esc(k.id)}">Supprimer</button></td></tr>`).join("")}
    <tr><td><input type="text" id="ri_new" placeholder="AB-123-CD" aria-label="Immatriculation de la nouvelle remorque"></td><td></td><td></td><td><button type="button" class="btn btn-accent btn-sm" data-act="addrem">Ajouter</button></td></tr>
    </tbody></table></div></section>`;
}
async function showAcces(condId, regen){
  const k=condById(condId); if(!k) return;
  let code=(S.acces||[]).find(a=>a.conducteur_id===condId)?.code;
  if(regen || !code){
    const {data,error}=await sb.rpc("generer_acces",{p_conducteur:condId});
    if(error){ toast(errMsg(error)); return; }
    code=data; S.acces=(S.acces||[]).filter(a=>a.conducteur_id!==condId).concat([{code,conducteur_id:condId,expire_le:new Date(Date.now()+7*864e5).toISOString(),utilisations:0}]);
    if(S.view==="parametres") render();
  }
  const link=CHAUFFEUR_URL+"?code="+encodeURIComponent(code);
  const shown=code.length>6?code.slice(0,5)+" "+code.slice(5):code;
  const digits=(k.tel||"").replace(/\D/g,"");
  const intl = /^0\d{9}$/.test(digits) ? "33"+digits.slice(1) : (/^33\d{9}$/.test(digits) ? digits : "");
  const prenom=(k.nom||"").split(" ")[0];
  const msg = `Bonjour ${prenom}, voici ton application Dream Chauffeur pour voir ton programme de courses : ${link}\n\nTon code d'invitation : ${shown} (valable 7 jours)\n\nSur iPhone, ouvre le lien avec Safari puis Partager → « Sur l'écran d'accueil » pour avoir l'icône.`;
  const envoiBtns = intl
    ? `<div class="two"><a class="btn" style="background:#25D366;color:#0B2E17" href="https://wa.me/${intl}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">WhatsApp</a><a class="btn btn-navy" href="sms:+${intl}?&body=${encodeURIComponent(msg)}">SMS</a></div><p class="muted" style="margin:0;font-size:12px">Le message s'ouvre déjà rempli pour ${esc(k.tel)} : il ne reste qu'à appuyer sur Envoyer. Le SMS fonctionne surtout depuis un téléphone.</p>`
    : `<p class="muted" style="margin:0;font-size:13px">Ajoutez le numéro de téléphone du conducteur pour l'envoyer directement par WhatsApp ou SMS.</p>`;
  let qrSvg=""; try{ const q=window.qrcode(0,"M"); q.addData(link); q.make(); qrSvg=q.createSvgTag({cellSize:5,margin:2,scalable:true}); }catch(e){}
  openModal(`<h2>Envoyer Dream Chauffeur à ${esc(k.nom)}</h2>
    <div class="code">${esc(shown)}</div>
    <p style="margin:0">Code d'invitation de ${esc(prenom)}. Il ouvre le lien (ou scanne le QR code) puis l'application s'ouvre directement sur son programme. Le code est valable 7 jours, pour un seul téléphone : s'il change de téléphone, générez-lui un nouveau code.</p>
    <b style="font-size:14px">Envoyer par…</b>
    ${envoiBtns}
    ${qrSvg?`<div class="qr" role="img" aria-label="QR code de l'application Dream Chauffeur">${qrSvg}</div>`:""}
    <label class="fld">Lien de l'application<input type="text" id="accLink" value="${esc(link)}" readonly></label>
    <textarea id="accMsg" hidden>${esc(msg)}</textarea>
    <div class="row-btns"><button type="button" class="btn btn-ghost" data-regen="${esc(condId)}" data-confirm="1" style="margin-right:auto">Nouveau code</button><button type="button" class="btn btn-ghost" data-copy="#accMsg">Copier le message</button><button type="button" class="btn btn-accent" data-act="close">Fermer</button></div>
    <p class="muted" style="margin:0;font-size:12px">« Nouveau code » annule l'ancien : à utiliser seulement si le code a été envoyé à la mauvaise personne. Pour retirer l'accès d'un téléphone, utilisez « Déconnecter » dans la liste.</p>`);
}

/* ---------- clics globaux ---------- */
/* une fenêtre où l'on a saisi quelque chose ne se ferme jamais par un simple clic à côté */
let downSurFond=false;
document.addEventListener("mousedown",e=>{ downSurFond = !!(e.target && e.target.id==="mbg"); },true);
document.addEventListener("touchstart",e=>{ downSurFond = !!(e.target && e.target.id==="mbg"); },{capture:true,passive:true});
function modalModifie(){
  try{ return [...document.querySelectorAll("#modal input,#modal textarea,#modal select")].some(i=>{
    if(i.type==="hidden"||i.type==="button"||i.type==="submit"||i.type==="file") return false;
    if(i.tagName==="SELECT"){ const d=[...i.options].findIndex(o=>o.defaultSelected); return i.selectedIndex!==(d<0?0:d); }
    if(i.type==="checkbox"||i.type==="radio") return i.checked!==i.defaultChecked;
    return i.value!==i.defaultValue; }); }catch(e){ return false; } }
let echapArme=0;
function allerAccueil(){ closeModal(); S.date=todayIso(); const h=(location.hash||"").replace("#",""); if(h!=="indicateurs"){ location.hash="indicateurs"; } else { S.view="indicateurs"; render(); window.scrollTo(0,0); } }
document.addEventListener("keydown",e=>{ if((e.key==="Enter"||e.key===" ") && e.target.matches && e.target.matches("[data-home]")){ e.preventDefault(); allerAccueil(); } });
document.addEventListener("click",async e=>{
  if(e.target.closest && e.target.closest("[data-home]")){ allerAccueil(); return; }
  if(e.target.id==="mbg"){ if(downSurFond && !$("#modal [data-lock='keep']") && !modalModifie()) closeModal(); return; }
  const el=e.target.closest("[data-act],[data-open],[data-day],[data-mode],[data-repos],[data-fst],[data-fper],[data-drv],[data-dday],[data-impedit],[data-impdel],[data-savecond],[data-delcond],[data-savecam],[data-delcam],[data-saverem],[data-delrem],[data-auth],[data-acces],[data-regen],[data-unlink],[data-copy],[data-doc],[data-inctype]");
  if(!el) return;
  const d=el.dataset;
  if(d.auth){ S.authMode=d.auth; S.authErr=""; render(); return; }
  if(d.act==="logout"){ if(channel) sb.removeChannel(channel); await sb.auth.signOut(); S.mem=null; S.session=null; S.loaded=false; closeModal(); render(); return; }
  if(d.act==="refresh"){ loadData(); return; }
  if(d.act==="noop") return;
  if(d.act==="export"){ exportCourses(); return; }
  if(d.act==="new"){ closeModal(); newCourse(); }
  else if(d.act==="import"){ startImport(); }
  else if(d.act==="close"){ closeModal(); }
  else if(d.act==="send"){ sendPlanning(); }
  else if(d.act==="relancer"){ const c=S.courses.find(x=>x.id===d.id); if(!c) return; const k=condById(c.conducteurId);
    const {data,error}=await sb.functions.invoke("envoyer-push",{body:{courses:[c.id]}});
    toast(error?"Notification impossible pour le moment.":(data&&data.envoyes>0?`Notification renvoyée sur le téléphone de ${k?k.nom:"le conducteur"}`:`${k?k.nom:"Le conducteur"} n'a pas encore activé les notifications dans Dream Chauffeur.`)); }
  else if(d.act==="sendone"){ const c=S.courses.find(x=>x.id===d.id); if(!c||!c.conducteurId) return; const prev={statut:c.statut,envoyeLe:c.envoyeLe||null};
    if(await patchCourse(c.id,Object.assign({statut:"envoyee",envoyeLe:new Date().toISOString(),modifieApresEnvoi:false},("vuLe" in c)?{vuLe:null}:{}))) annonceEnvoi([c],{id:c.id,prev}); }
  else if(d.act==="undosend"){ const u=S.undoSend; if(!u) return; S.undoSend=null; if(await patchCourse(u.id,u.prev)) toast("Envoi annulé"); }
  else if(d.act==="impsave"){ saveImport(); }
  else if(d.act==="impback"){ showImport(); }
  else if(d.act==="askdel"){ $("#formBtns").insertAdjacentHTML("afterbegin",`<span style="margin-right:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="color:var(--danger)">Supprimer définitivement ?</b><button type="button" class="btn btn-danger btn-sm" data-act="dodel">Oui, supprimer</button></span>`); el.remove(); }
  else if(d.act==="dodel"){ if(!openId) return; const {error}=await sb.from("courses").delete().eq("id",openId); if(error){ toast(errMsg(error)); return; } closeModal(); scheduleReload(); toast("Course supprimée"); }
  else if(d.act==="saveco"){ const v=$("#coIn").value.trim(); if(!v) return; const {error}=await sb.from("entreprises").update({nom:v}).eq("id",EID()); if(error){ toast(errMsg(error)); return; } S.entreprise.nom=v; renderNav(); toast("Nom enregistré"); }
  else if(d.act==="addcond"){ const nom=$("#cn_new").value.trim(); if(!nom){ toast("Indiquez un nom."); return; } if(await tableWrite("conducteurs","insert",null,{nom,tel:$("#ct_new").value.trim()||null,camionId:$("#cc_new").value||null,actif:true})) toast("Conducteur ajouté"); }
  else if(d.act==="addcam"){ const im=$("#vi_new").value.trim().toUpperCase(); if(!im){ toast("Indiquez l'immatriculation."); return; } if(await tableWrite("camions","insert",null,{immat:im,type:$("#vt_new").value.trim()||null,actif:true})) toast("Camion ajouté"); }
  else if(d.act==="addrem"){ const im=$("#ri_new").value.trim().toUpperCase(); if(!im){ toast("Indiquez l'immatriculation."); return; } if(await tableWrite("remorques","insert",null,{immat:im,actif:true})) toast("Remorque ajoutée"); }
  else if(d.acces){ showAcces(d.acces); }
  else if(d.regen){ if(d.confirm && !el.dataset.ok){ el.dataset.ok="1"; el.textContent="Confirmer : nouveau code"; el.classList.add("btn-danger"); return; } showAcces(d.regen,true); }
  else if(d.unlink){ if(!el.dataset.ok){ el.dataset.ok="1"; el.textContent="Confirmer la déconnexion"; el.style.color="var(--danger)"; return; }
    const {error}=await sb.from("membres").delete().eq("entreprise_id",EID()).eq("conducteur_id",d.unlink).eq("role","conducteur");
    if(error){ toast(errMsg(error)); return; } toast("Téléphone déconnecté"); loadData(); }
  else if(d.act==="hidetip"){ store.set("dc_tip","0"); render(); }
  else if(d.copy){ const inp=$(d.copy); try{ await navigator.clipboard.writeText(inp.value); toast("Copié : collez-le dans WhatsApp ou SMS"); }catch(err){ const l=$("#accLink"); l&&l.select(); toast("Copie impossible ici : sélectionnez le lien"); } }
  else if(d.doc){ openDoc(d.doc); }
  else if(d.savecond){ const id=d.savecond; if(await tableWrite("conducteurs","update",id,{nom:$("#cn_"+id).value.trim(),tel:$("#ct_"+id).value.trim()||null,camionId:$("#cc_"+id).value||null,actif:$("#ca_"+id).checked})) toast("Conducteur enregistré"); }
  else if(d.delcond||d.delcam||d.delrem){ const [t,id]=d.delcond?["conducteurs",d.delcond]:d.delcam?["camions",d.delcam]:["remorques",d.delrem];
    if(el.dataset.sure){ if(await tableWrite(t,"delete",id)) toast("Supprimé"); } else { el.dataset.sure="1"; el.textContent="Confirmer la suppression"; el.classList.add("btn-danger"); } }
  else if(d.savecam){ const id=d.savecam; const p={immat:$("#vi_"+id).value.trim().toUpperCase(),type:$("#vt_"+id).value.trim()||null,actif:$("#va_"+id).checked}; const r=$("#vr_"+id); if(r) p.remorqueId=r.value||null; if(await tableWrite("camions","update",id,p)) toast("Camion enregistré"); }
  else if(d.saverem){ const id=d.saverem; if(await tableWrite("remorques","update",id,{immat:$("#ri_"+id).value.trim().toUpperCase(),actif:$("#ra_"+id).checked})) toast("Remorque enregistrée"); }
  else if(d.open){ openCourse(d.open); }
  else if(d.day!==undefined){ S.date = d.day==="0"?todayIso():addDays(S.date,Number(d.day)); render(); }
  else if(d.mode){ S.mode=d.mode; render(); }
  else if(d.repos){ const k=condById(d.repos); if(!k) return; const r=new Set(k.repos||[]); r.has(S.date)?r.delete(S.date):r.add(S.date); await tableWrite("conducteurs","update",k.id,{repos:[...r].filter(x=>x>=addDays(todayIso(),-60))}); }
  else if(d.fst){ S.fStatut=d.fst; if(S.view!=="courses") location.hash="courses"; else render(); }
  else if(d.fper){ S.fPeriode=d.fper; S.fDate=""; S.fDate2=""; render(); }
  else if(d.drv){ drvAction(d.drv,d.id,el); }
  else if(d.dday){ S.drvDay=d.dday; if($("#modal").innerHTML) closeModal(); render(); window.scrollTo(0,0); }
  else if(d.inctype){ S.incType=d.inctype; document.querySelectorAll("[data-inctype]").forEach(b=>{ const on=b.dataset.inctype===S.incType; b.setAttribute("aria-checked",on?"true":"false"); b.classList.toggle("btn-navy",on); b.classList.toggle("btn-ghost",!on); }); }
  else if(d.act==="incvu"){ const c=S.courses.find(x=>x.id===openId); if(!c) return; if(await saveCourse(c.id,{incidents:incOf(c).map(i=>Object.assign({},i,{vu:true}))})){ closeModal(); toast("Problème marqué comme traité"); } }
  else if(d.impedit!==undefined){ editImport(Number(d.impedit)); }
  else if(d.impdel!==undefined){ S.importList.splice(Number(d.impdel),1); showImport(); }
});
document.addEventListener("change",e=>{
  if(e.target.id==="f_sousTraitantId"){ const on=!!e.target.value; ["f_conducteurId","f_camionId","f_remorqueId"].forEach(i=>{ const el=$("#"+i); if(el){ if(on) el.value=""; el.disabled=on; } }); if(on){ const w=$("#remWrap"); if(w) w.hidden=true; const stt=$("#f_statut"); if(stt && stt.value==="a_planifier") stt.value="planifiee"; } }
    if(e.target.id==="f_camionId"){ const w=$("#remWrap"); if(w){ w.hidden=!isTracteur(e.target.value); const cam=camById(e.target.value); const rs=$("#f_remorqueId"); if(rs && !rs.value && cam?.remorqueId) rs.value=cam.remorqueId; } }
  if(e.target.id==="meSel"){ S.me=e.target.value; store.set("tp_me",S.me); render(); }
  if(e.target.id==="resPhoto"){ const f=e.target.files&&e.target.files[0]; e.target.value="";
    if(f){ if(!/^image\//.test(f.type)){ toast("Choisis une photo."); } else if(f.size>25*1024*1024){ toast("Photo trop lourde."); } else if((S.resPh||[]).length<RES_MAX){ (S.resPh=S.resPh||[]).push({file:f,url:URL.createObjectURL(f)}); const b=$("#resPhBox"); if(b) b.innerHTML=resPhHtml(); } } }
  if(e.target.id==="incPhoto"){ const l=$("#incPhotoLbl"); if(l) l.textContent = e.target.files&&e.target.files[0] ? "Photo ajoutée ✓ (toucher pour changer)" : "Ajouter une photo (facultatif)"; }
  if(e.target.dataset && e.target.dataset.bl){ const f=e.target.files&&e.target.files[0]; if(f) uploadBL(e.target.dataset.bl,f); }
});
document.addEventListener("input",e=>{ if(e.target.id==="resTxt") S.resTxt=e.target.value; });
document.addEventListener("keydown",e=>{ if(e.key!=="Escape" || !$("#modal").innerHTML) return;
  if(modalModifie() && Date.now()-echapArme>3000){ echapArme=Date.now(); toast("Saisie non enregistrée : appuyez encore sur Échap pour abandonner."); return; }
  closeModal(); });

/* ---------- démarrage ---------- */
async function boot(){
  let { data:{session} } = await sb.auth.getSession();
  if(session){ // vérifie auprès du serveur que le compte existe toujours
    const { error } = await sb.auth.getUser();
    if(error && !/fetch|network/i.test(error.message||"")){ await sb.auth.signOut({scope:"local"}); session=null; }
  }
  S.session=session; S.mem=null; S.loaded=false;
  if(session){
    const {data,error}=await sb.from("membres").select("entreprise_id,role,conducteur_id").eq("user_id",session.user.id).limit(1);
    if(!error && data && data[0]){ S.mem=data[0];
      const {data:ent}=await sb.from("entreprises").select("id,nom").eq("id",S.mem.entreprise_id).single(); S.entreprise=ent||{nom:""};
      readHash(); render(); signaler(); await loadData(); subscribe(); pushSync(); if(isStaff()){ attCheck(); clearInterval(attTimer); attTimer=setInterval(attCheck,60000); } return; }
  }
  render();
}
let lastSignal=0;
function signaler(){ // « Dernière connexion » visible par l'exploitation
  if(!S.mem || S.mem.role!=="conducteur" || Date.now()-lastSignal<10*60000) return;
  lastSignal=Date.now(); sb.rpc("signaler_connexion",{p_appareil:appareil()}).then(()=>{},()=>{});
}
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") signaler(); });
sb.auth.onAuthStateChange((event)=>{ if(event==="PASSWORD_RECOVERY"){ S.recovery=true; render(); } });
window.TP = X;
// démarrage après le chargement des modules complémentaires
const demarrer = async()=>{
  const params=new URLSearchParams(location.search);
  const code=params.get("code");
  if(code && MODE==="chauffeur"){ // icône installée : déjà rattaché → on ouvre directement le programme
    await boot(); if(!S.mem) await joinWithCode(code); return; }
  if(code){ history.replaceState(null,"",location.pathname); await joinWithCode(code); return; }
  await boot();
};
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",demarrer); else demarrer();
})();
