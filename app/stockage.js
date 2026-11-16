/* Mobilog — stockage : entrées / sorties de palettes, stock par client, tarifs, prestations, facturation, simulateur — Tonton Business */
(function(){
"use strict";
const T = window.TP; if(!T) return;
const { S, sb, $, esc, toast, openModal, closeModal, render, EID, frDate, todayIso } = T;
const K = T.K = { ready:false, err:"", mvts:[], svcs:[], prest:[], regl:[], fact:[], tab:"stock", mq:"", mois:"", facClient:"", draft:null,
  sim:{ lignes:[{nb:10,L:120,l:80,h:150,kg:500}], n:1, u:"mois", mode:"mois", mvt:true, client:"" } };

/* ---------- aides ---------- */
const money = n => (Number(n)||0).toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})+" €";
const qtxt = n => (Number(n)||0).toLocaleString("fr-FR",{maximumFractionDigits:2});
const d2 = s => s ? frDate(String(s).slice(0,10),{day:"2-digit",month:"2-digit",year:"numeric"}) : "";
const r2 = x => { x=Number(x)||0; const sg=x<0?-1:1; return sg*Number(Math.round(Number(Math.abs(x).toPrecision(12)+"e2"))+"e-2"); };
const norm = s => String(s||"").trim().toLowerCase().replace(/\s+/g," ");
const clients = () => (T.fx && T.fx.ready()) ? T.fx.clients().filter(c=>!c.sous_traitant) : [];
const clientNom = id => { const c=(T.fx&&T.fx.ready()?T.fx.clients():[]).find(x=>x.id===id); return c?c.nom:""; };
const uuid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,ch=>{ const r=Math.random()*16|0; return (ch==="x"?r:(r&3|8)).toString(16); });
const kErr = e => { const m=(e&&e.message)||""; if(/stock_/.test(m) && /(does not exist|schema cache|relation)/i.test(m)) return "La rubrique Stockage n'est pas encore activée sur cette base."; return T.errMsg(e); };
const TP_LIB = { europe:"Palette Europe 80 × 120", hors_gabarit:"Palette hors gabarit" };
const TP_CODE = { europe:"sto_europe", hors_gabarit:"sto_hg" };
const ym = s => String(s).slice(0,7);
const moisLib = m => { const [y,mo]=m.split("-").map(Number); return new Date(y,mo-1,1).toLocaleDateString("fr-FR",{month:"long",year:"numeric"}); };
const jMois = m => { const [y,mo]=m.split("-").map(Number); return new Date(y,mo,0).getDate(); };
const dDiff = (a,b) => { const p=s=>{ const [y,m,d]=String(s).slice(0,10).split("-").map(Number); return Date.UTC(y,m-1,d); }; return Math.round((p(b)-p(a))/864e5); };
const moisListe = () => { const out=[]; const n=new Date(); for(let i=0;i<18;i++){ const d=new Date(n.getFullYear(),n.getMonth()-i,1); out.push(d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")); } return out; };
const SEUIL_VIEUX = 30;

const DEFAUT = [
  ["sto_europe","stockage","Stockage palette Europe 80 × 120 (hauteur ≤ 1,80 m, ≤ 800 kg)","palette / mois",15,1],
  ["sto_hg","stockage","Stockage palette hors gabarit (autre format, hauteur > 1,80 m ou > 800 kg)","palette / mois",22,2],
  ["sto_m2","stockage","Stockage au sol au m² (marchandise non palettisée)","m² / mois",null,3],
  ["man_entree","manutention","Entrée : déchargement, contrôle et mise en stock","palette",4,4],
  ["man_sortie","manutention","Sortie : déstockage et chargement","palette",4,5],
  ["man_vrac","manutention","Déchargement de marchandise en vrac (carton, conteneur)","heure",35,6],
  ["man_prepa","manutention","Préparation de commande (prélèvement de cartons sur palette)","carton",1.2,7],
  ["svc_film","service","Filmage ou refilmage","palette",5,8],
  ["svc_repal","service","Re-palettisation (hors fourniture de palette)","palette",8,9],
  ["svc_palette","service","Fourniture d'une palette Europe","palette",10,10],
  ["svc_etiq","service","Étiquetage","palette",1.5,11],
  ["svc_inv","service","Inventaire à la demande","heure",35,12],
  ["svc_livr","service","Livraison Île-de-France au départ de l'entrepôt","course",null,13] ];
const GROUPES = { stockage:"Stockage", manutention:"Entrées, sorties et manutention", service:"Services complémentaires" };

/* ---------- chargement ---------- */
async function load(){
  const e=EID(); const f=t=>sb.from(t).select("*").eq("entreprise_id",e).limit(5000);
  const [m,s,p,r,fa]=await Promise.all([f("stock_mouvements"),f("stock_services"),f("stock_prestations"),f("stock_reglages"),f("stock_factures")]);
  if(m.error || p.error){ K.ready=false; K.err=""; return; }
  K.ready=true; K.mvts=m.data||[]; K.svcs=(s.data||[]); K.prest=(p.data||[]).sort((a,b)=>a.ordre-b.ordre); K.regl=r.data||[]; K.fact=fa.data||[];
  K.mvts.sort((a,b)=>String(b.date_mvt).localeCompare(String(a.date_mvt))||String(b.created_at).localeCompare(String(a.created_at)));
  if(!K.prest.length && T.isStaff()){ const rows=DEFAUT.map(([code,groupe,libelle,unite,prix,ordre])=>({entreprise_id:e,code,groupe,libelle,unite,prix,ordre}));
    const ins=await sb.from("stock_prestations").insert(rows); if(!ins.error){ const q=await f("stock_prestations"); K.prest=(q.data||[]).sort((a,b)=>a.ordre-b.ordre); } }
}
T.onData.push(load);
async function reload(){ await load(); render(); }
const off = () => `<div class="bar"><h1>Stockage</h1></div><div class="pan"><b>La rubrique Stockage n'est pas encore activée sur cette base.</b><span class="muted">${esc(K.err||"La mise à jour de la base de données n'a pas encore été appliquée.")}</span></div>`;

/* ---------- tarifs ---------- */
const prest = code => K.prest.find(p=>p.code===code);
const reglage = cid => K.regl.find(r=>r.client_id===cid) || { client_id:cid, mode:"mois", prix:{} };
function prixDe(code, cid){ const r=cid?reglage(cid):null; if(r && r.prix && r.prix[code]!==undefined && r.prix[code]!==null && r.prix[code]!=="") return Number(r.prix[code]); const p=prest(code); return p && p.prix!=null ? Number(p.prix) : null; }
const modeLib = m => m==="prorata" ? "au prorata des jours" : "mois commencé = mois dû";

/* classement d'une palette : seule la palette Europe 80 × 120, ≤ 1,80 m et ≤ 800 kg est « standard » */
function classer(p){ const L=Number(p.L)||0, l=Number(p.l)||0, h=Number(p.h)||0, kg=Number(p.kg)||0; const a=Math.min(L,l), b=Math.max(L,l); const raisons=[];
  if(!(a===80 && b===120)) raisons.push("format "+(L||"?")+" × "+(l||"?")+" cm");
  if(h>180) raisons.push("hauteur "+h+" cm"); if(kg>800) raisons.push("poids "+kg+" kg");
  return { type: raisons.length?"hors_gabarit":"europe", raisons }; }

/* ---------- stock : premier entré, premier sorti ---------- */
function lotsFrom(list){
  const ms=list.slice().sort((a,b)=>String(a.date_mvt).localeCompare(String(b.date_mvt))||(a.sens===b.sens?0:a.sens==="entree"?-1:1)||String(a.created_at||"").localeCompare(String(b.created_at||"")));
  const q={europe:[],hors_gabarit:[]}, closed=[]; let excess=0;
  ms.forEach(m=>{ const Q=q[m.type_palette]||q.europe; if(m.sens==="entree"){ Q.push({nb:m.nb,from:m.date_mvt}); return; }
    let r=m.nb; while(r>0 && Q.length){ const h=Q[0]; const t=Math.min(h.nb,r); closed.push({type:m.type_palette,nb:t,from:h.from,to:m.date_mvt}); h.nb-=t; r-=t; if(!h.nb) Q.shift(); } excess+=r; });
  const open=[]; Object.keys(q).forEach(t=>q[t].forEach(h=>open.push({type:t,nb:h.nb,from:h.from,to:null})));
  return { open, closed, excess };
}
const lotsClient = cid => lotsFrom(K.mvts.filter(m=>m.client_id===cid));
function stockParClient(){ const ids=[...new Set(K.mvts.map(m=>m.client_id).filter(Boolean))]; const t=todayIso();
  return ids.map(id=>{ const lo=lotsClient(id); const eu=lo.open.filter(x=>x.type==="europe").reduce((s,x)=>s+x.nb,0), hg=lo.open.filter(x=>x.type==="hors_gabarit").reduce((s,x)=>s+x.nb,0);
    const vieux=lo.open.filter(x=>dDiff(x.from,t)>SEUIL_VIEUX).reduce((s,x)=>s+x.nb,0); const age=lo.open.length?Math.max(...lo.open.map(x=>dDiff(x.from,t))):0;
    return { id, nom:clientNom(id)||(K.mvts.find(m=>m.client_id===id)||{}).client_nom||"?", eu, hg, tot:eu+hg, vieux, age, excess:lo.excess, lots:lo }; })
    .sort((a,b)=>b.tot-a.tot || a.nom.localeCompare(b.nom)); }

/* ---------- calcul de la facturation d'un mois ---------- */
function calcMois(cid, mois){
  const ms=mois+"-01", me=mois+"-"+String(jMois(mois)).padStart(2,"0"), reg=reglage(cid), lo=lotsClient(cid), nj=jMois(mois); const lignes=[]; const alertes=[];
  const segs=lo.closed.concat(lo.open);
  ["europe","hors_gabarit"].forEach(type=>{
    const sg=segs.filter(s=>s.type===type && s.from<=me && (s.to==null || s.to>=ms)); if(!sg.length) return;
    const pu=prixDe(TP_CODE[type],cid); const nb=sg.reduce((s,x)=>s+x.nb,0);
    if(pu==null) alertes.push("Le tarif « "+TP_LIB[type]+" » n'est pas renseigné.");
    if(reg.mode==="prorata"){ const pj=sg.reduce((s,x)=>{ const a=x.from>ms?x.from:ms, b=(x.to==null||x.to>me)?me:x.to; return s+x.nb*(dDiff(a,b)+1); },0);
      lignes.push({ designation:`Stockage ${TP_LIB[type].toLowerCase()} — ${moisLib(mois)} (prorata : ${qtxt(pj)} palettes-jours sur ${nj} jours)`, qte:r2(pj/nj), pu:pu||0 }); }
    else lignes.push({ designation:`Stockage ${TP_LIB[type].toLowerCase()} — ${moisLib(mois)} (${qtxt(nb)} palette${nb>1?"s":""}, mois commencé)`, qte:nb, pu:pu||0 }); });
  const inM=K.mvts.filter(m=>m.client_id===cid && ym(m.date_mvt)===mois);
  const ent=inM.filter(m=>m.sens==="entree").reduce((s,m)=>s+m.nb,0), sor=inM.filter(m=>m.sens==="sortie").reduce((s,m)=>s+m.nb,0);
  if(ent){ const pu=prixDe("man_entree",cid); if(pu==null) alertes.push("Le tarif d'entrée n'est pas renseigné."); lignes.push({ designation:`Entrées de palettes — ${moisLib(mois)} (déchargement, contrôle, mise en stock)`, qte:ent, pu:pu||0 }); }
  if(sor){ const pu=prixDe("man_sortie",cid); if(pu==null) alertes.push("Le tarif de sortie n'est pas renseigné."); lignes.push({ designation:`Sorties de palettes — ${moisLib(mois)} (déstockage et chargement)`, qte:sor, pu:pu||0 }); }
  const sv=K.svcs.filter(x=>x.client_id===cid && ym(x.date_svc)===mois && !x.piece_id);
  sv.forEach(x=>lignes.push({ designation:`${x.libelle} — ${d2(x.date_svc)}${x.note?" — "+x.note:""}`, qte:Number(x.qte), pu:Number(x.pu)||0, svc:x.id }));
  if(lo.excess) alertes.push("Des sorties dépassent le stock enregistré pour ce client : vérifiez les mouvements.");
  return { lignes, alertes };
}
const withTva = ls => ls.map(l=>({ designation:l.designation, qte:l.qte, pu:l.pu, tva:T.fx.tvaDef() }));

/* ---------- page « Stockage » ---------- */
const TABS = [["stock","Stock"],["mvts","Mouvements"],["svc","Prestations"],["fact","Facturer"],["sim","Simulateur"],["tarifs","Tarifs"]];
T.views.stockage = () => {
  if(!K.ready) return off();
  if(!(T.fx && T.fx.ready())) return `<div class="bar"><h1>Stockage</h1></div><div class="pan"><b>La facturation n'est pas encore activée sur cette base.</b><span class="muted">Le stockage utilise le Carnet d'adresses et les factures.</span></div>`;
  const bar=`<div class="bar"><h1>Stockage</h1><div class="seg" role="group" aria-label="Rubrique" style="flex-wrap:wrap">${TABS.map(([k,l])=>`<button type="button" class="${K.tab===k?"on":""}" data-k="tab" data-v="${k}">${l}</button>`).join("")}</div></div>`;
  return bar + ({stock:vStock,mvts:vMvts,svc:vSvc,fact:vFact,sim:vSim,tarifs:vTarifs}[K.tab]||vStock)();
};
T.after.stockage = () => { const q=$("#kQ"); if(q) q.addEventListener("input",()=>{ K.mq=q.value; const pos=q.selectionStart; render(); const n=$("#kQ"); if(n){ n.focus(); try{ n.setSelectionRange(pos,pos); }catch(e){} } }); if(K.tab==="sim") simMaj(); };

function vStock(){
  const L=stockParClient(); const tot=L.reduce((s,x)=>s+x.tot,0), hg=L.reduce((s,x)=>s+x.hg,0), vieux=L.reduce((s,x)=>s+x.vieux,0), nc=L.filter(x=>x.tot>0).length;
  return `<div class="kpis"><div class="kpi"><small>Palettes en stock</small><b class="num">${qtxt(tot)}</b></div><div class="kpi"><small>Clients avec du stock</small><b class="num">${nc}</b></div>
    <div class="kpi"><small>Hors gabarit</small><b class="num">${qtxt(hg)}</b></div><div class="kpi ${vieux?"warn":""}"><small>Plus de ${SEUIL_VIEUX} jours</small><b class="num">${qtxt(vieux)}</b></div></div>
  <div class="row-btns" style="justify-content:flex-start"><button type="button" class="btn btn-accent" data-k="mvt" data-sens="entree">+ Entrée de palettes</button><button type="button" class="btn btn-navy" data-k="mvt" data-sens="sortie">+ Sortie de palettes</button></div>
  <div class="pan">${L.length?`<div class="tbl-wrap"><table><thead><tr><th>Client</th><th style="text-align:right">Europe</th><th style="text-align:right">Hors gabarit</th><th style="text-align:right">Total</th><th>Plus ancienne</th><th>Tarif</th></tr></thead><tbody>${L.map(x=>`<tr class="click" tabindex="0" data-k="client" data-id="${esc(x.id)}"><td><b>${esc(x.nom)}</b>${x.excess?`<div><span class="chip late">Sorties supérieures au stock</span></div>`:""}</td>
      <td class="num" style="text-align:right">${qtxt(x.eu)}</td><td class="num" style="text-align:right">${qtxt(x.hg)}</td><td class="num" style="text-align:right"><b>${qtxt(x.tot)}</b></td>
      <td>${x.tot?(x.vieux?`<span class="chip" style="border-color:var(--accent);color:var(--accent-ink)">${x.age} j · ${qtxt(x.vieux)} palette${x.vieux>1?"s":""} > ${SEUIL_VIEUX} j</span>`:`${x.age} j`):"—"}</td><td class="muted">${esc(modeLib(reglage(x.id).mode))}</td></tr>`).join("")}</tbody></table></div>`
    :`<div class="empty">Aucun mouvement pour le moment. Enregistrez une première entrée de palettes : le stock de chaque client se calcule tout seul.</div>`}</div>`;
}

function vMvts(){
  const q=norm(K.mq); const rows=K.mvts.filter(m=>!q||norm([m.client_nom,m.chauffeur,m.societe,m.plaque,m.note,m.emplacement].join(" ")).includes(q)).slice(0,300);
  return `<div class="row-btns" style="justify-content:flex-start"><button type="button" class="btn btn-accent" data-k="mvt" data-sens="entree">+ Entrée de palettes</button><button type="button" class="btn btn-navy" data-k="mvt" data-sens="sortie">+ Sortie de palettes</button>
    <input class="fin" id="kQ" type="search" placeholder="Rechercher : client, chauffeur, plaque…" value="${esc(K.mq)}" style="max-width:320px;margin-left:auto" aria-label="Rechercher un mouvement"></div>
  <div class="pan">${rows.length?`<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Mouvement</th><th>Client</th><th style="text-align:right">Palettes</th><th>Type</th><th>Origine / destination</th><th>Emplacement</th></tr></thead><tbody>${rows.map(m=>`<tr class="click" tabindex="0" data-k="mvtopen" data-id="${esc(m.id)}"><td class="num">${d2(m.date_mvt)}</td>
    <td><span class="chip ${m.sens==="entree"?"st-terminee":"st-envoyee"}">${m.sens==="entree"?"Entrée":"Sortie"}</span></td><td><b>${esc(m.client_nom)}</b></td><td class="num" style="text-align:right">${qtxt(m.nb)}</td><td>${esc(TP_LIB[m.type_palette]||m.type_palette)}</td>
    <td>${m.origine==="course"?"Course Dream"+(m.course_id?` · ${esc(trajet(S.courses.find(c=>c.id===m.course_id)))}`:""):m.origine==="externe"?`Chauffeur externe : ${esc([m.chauffeur,m.societe,m.plaque].filter(Boolean).join(" · ")||"—")}`:"—"}${m.note?`<div class="muted">${esc(m.note)}</div>`:""}</td><td>${esc(m.emplacement||"—")}</td></tr>`).join("")}</tbody></table></div>`
    :`<div class="empty">Aucun mouvement ${q?"ne correspond à la recherche":"enregistré"}.</div>`}</div>`;
}
const trajet = c => c ? `${c.enlVille||"?"} → ${c.livVille||"?"}` : "";

function vSvc(){
  const rows=K.svcs.slice().sort((a,b)=>String(b.date_svc).localeCompare(String(a.date_svc))).slice(0,300);
  return `<div class="row-btns" style="justify-content:flex-start"><button type="button" class="btn btn-accent" data-k="svcnew">+ Prestation</button><span class="muted" style="font-size:13px">Vrac, préparation de commande, filmage, étiquetage, inventaire… Elles s'ajoutent à la facture du mois du client.</span></div>
  <div class="pan">${rows.length?`<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Client</th><th>Prestation</th><th style="text-align:right">Quantité</th><th style="text-align:right">Prix HT</th><th style="text-align:right">Total HT</th><th>Facturée</th></tr></thead><tbody>${rows.map(x=>`<tr class="click" tabindex="0" data-k="svcopen" data-id="${esc(x.id)}"><td class="num">${d2(x.date_svc)}</td><td><b>${esc(x.client_nom)}</b></td><td>${esc(x.libelle)}${x.note?`<div class="muted">${esc(x.note)}</div>`:""}</td>
    <td class="num" style="text-align:right">${qtxt(x.qte)} ${esc(x.unite||"")}</td><td class="num" style="text-align:right">${money(x.pu)}</td><td class="num" style="text-align:right">${money(r2(x.qte*x.pu))}</td><td>${x.piece_id?`<span class="chip st-terminee">Oui</span>`:`<span class="chip st-a_planifier">À facturer</span>`}</td></tr>`).join("")}</tbody></table></div>`
    :`<div class="empty">Aucune prestation ponctuelle enregistrée.</div>`}</div>`;
}

function vFact(){
  const cl=clients(); const mois=K.mois||moisListe()[1]||moisListe()[0]; K.mois=mois; const cid=K.facClient||"";
  const calc = cid ? calcMois(cid,mois) : null; const t = calc ? T.fx.totals(withTva(calc.lignes)) : null; const deja = cid ? K.fact.find(f=>f.client_id===cid && f.mois===mois) : null;
  return `<div class="pan"><h2>Préparer la facture de stockage d'un client</h2><div class="fgrid">
    <label class="fld">Client<select class="fin" id="kf_client"><option value="">— Choisir —</option>${cl.map(c=>`<option value="${esc(c.id)}" ${c.id===cid?"selected":""}>${esc(c.nom)}</option>`).join("")}</select></label>
    <label class="fld">Mois<select class="fin" id="kf_mois">${moisListe().map(m=>`<option value="${m}" ${m===mois?"selected":""}>${esc(moisLib(m))}</option>`).join("")}</select></label></div>
    ${cid?`<span class="muted">Mode de stockage de ce client : <b>${esc(modeLib(reglage(cid).mode))}</b> · <button type="button" class="linkbtn" data-k="client" data-id="${esc(cid)}">modifier</button></span>`:""}
    ${deja?`<div class="banner"><span><b>Une facture de stockage a déjà été préparée pour ${esc(moisLib(mois))}</b> le ${d2(deja.created_at)}. Vérifiez dans Facturation → Factures avant d'en créer une autre.</span></div>`:""}
    ${calc?(calc.lignes.length?`${calc.alertes.map(a=>`<div class="alert">${esc(a)}</div>`).join("")}<div class="tbl-wrap"><table><thead><tr><th>Désignation</th><th style="text-align:right">Qté</th><th style="text-align:right">Prix HT</th><th style="text-align:right">Total HT</th></tr></thead><tbody>${calc.lignes.map(l=>`<tr><td>${esc(l.designation)}</td><td class="num" style="text-align:right">${qtxt(l.qte)}</td><td class="num" style="text-align:right">${money(l.pu)}</td><td class="num" style="text-align:right">${money(r2(l.qte*l.pu))}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right"><b>Total HT</b></td><td class="num" style="text-align:right"><b>${money(t.ht)}</b></td></tr><tr><td colspan="3" style="text-align:right">TVA</td><td class="num" style="text-align:right">${money(t.tva)}</td></tr><tr><td colspan="3" style="text-align:right"><b>Total TTC</b></td><td class="num" style="text-align:right"><b>${money(t.ttc)}</b></td></tr></tfoot></table></div>
      <div class="row-btns" style="justify-content:flex-start"><button type="button" class="btn btn-accent" data-k="facturer">Créer la facture (brouillon)</button><span class="muted" style="font-size:13px">Vous vérifiez les lignes, puis vous finalisez comme pour les autres factures.</span></div>`
      :`<div class="empty">Rien à facturer pour ${esc(moisLib(mois))} : aucune palette en stock, aucun mouvement et aucune prestation ce mois-là.</div>`):`<span class="muted">Choisissez un client et un mois : Mobilog calcule le stockage, les entrées, les sorties et les prestations.</span>`}</div>`;
}

/* ---------- simulateur ---------- */
function simCalc(){ const s=K.sim; const nj=Math.max(0,Number(s.n)||0)*({jours:1,semaines:7,mois:30}[s.u]||30);
  const mE=Math.max(1,Math.ceil(nj/30)), mP=nj/30; const lignes=[]; let totE=0,totP=0,ent=0;
  s.lignes.forEach((p,i)=>{ const nb=Math.max(0,Math.floor(Number(p.nb)||0)); if(!nb) return; const c=classer(p); const pu=prixDe(TP_CODE[c.type],s.client||null); if(pu==null) return; ent+=nb;
    totE+=r2(nb*pu*mE); totP+=r2(nb*pu*mP); lignes.push({ i,nb,type:c.type,raisons:c.raisons,pu }); });
  const pe=prixDe("man_entree",s.client||null)||0, ps=prixDe("man_sortie",s.client||null)||0; const man = s.mvt ? r2(ent*pe)+r2(ent*ps) : 0;
  const base = s.mode==="prorata" ? totP : totE; const ht=r2(base+man); const tva=r2(ht*T.fx.tvaDef()/100);
  return { nj, mE, mP:r2(mP), lignes, totE:r2(totE), totP:r2(totP), man, ent, pe, ps, ht, tva, ttc:r2(ht+tva) };
}
function simHtml(){ const s=K.sim, c=simCalc();
  return `<div class="kpis"><div class="kpi"><small>Mois commencé (${c.mE} mois)</small><b class="num">${money(c.totE)}</b></div><div class="kpi"><small>Au prorata (${qtxt(c.mP)} mois)</small><b class="num">${money(c.totP)}</b></div>
    ${s.mvt?`<div class="kpi"><small>Entrées + sorties</small><b class="num">${money(c.man)}</b></div>`:""}<div class="kpi" style="border-color:var(--accent);border-width:2px"><small>Total HT (${s.mode==="prorata"?"prorata":"mois commencé"})</small><b class="num">${money(c.ht)}</b></div></div>
    <div class="tbl-wrap"><table><thead><tr><th>Palettes</th><th>Classement</th><th style="text-align:right">Tarif / mois</th><th style="text-align:right">Stockage HT</th></tr></thead><tbody>${c.lignes.length?c.lignes.map(l=>`<tr><td>${qtxt(l.nb)}</td><td><span class="chip ${l.type==="europe"?"st-terminee":"st-envoyee"}">${esc(TP_LIB[l.type])}</span>${l.raisons.length?`<div class="muted" style="font-size:12px">${esc(l.raisons.join(", "))}</div>`:""}</td><td class="num" style="text-align:right">${money(l.pu)}</td><td class="num" style="text-align:right">${money(r2(l.nb*l.pu*(s.mode==="prorata"?c.mP:c.mE)))}</td></tr>`).join("")
      :`<tr><td colspan="4" class="muted">Indiquez le nombre de palettes.</td></tr>`}${s.mvt&&c.ent?`<tr><td>${qtxt(c.ent)}</td><td>Entrée + sortie</td><td class="num" style="text-align:right">${money(c.pe+c.ps)}</td><td class="num" style="text-align:right">${money(c.man)}</td></tr>`:""}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right">TVA (${T.fx.tvaDef()} %)</td><td class="num" style="text-align:right">${money(c.tva)}</td></tr><tr><td colspan="3" style="text-align:right"><b>Total TTC</b></td><td class="num" style="text-align:right"><b>${money(c.ttc)}</b></td></tr></tfoot></table></div>`; }
function vSim(){ const s=K.sim, cl=clients();
  return `<div class="pan"><h2>Simulateur de prix de stockage</h2><span class="muted">Donnez les dimensions, le poids et la durée : Mobilog trouve le type de palette et calcule le prix.</span>
    <div id="kSimLignes" style="display:flex;flex-direction:column;gap:8px">${s.lignes.map((p,i)=>`<div class="fgrid" style="align-items:end">
      <label class="fld">Palettes<input class="fin num kSim" type="number" inputmode="numeric" min="1" data-i="${i}" data-f="nb" value="${esc(p.nb)}"></label>
      <label class="fld">Long. (cm)<input class="fin num kSim" type="number" inputmode="decimal" min="0" data-i="${i}" data-f="L" value="${esc(p.L)}"></label>
      <label class="fld">Larg. (cm)<input class="fin num kSim" type="number" inputmode="decimal" min="0" data-i="${i}" data-f="l" value="${esc(p.l)}"></label>
      <label class="fld">Haut. (cm)<input class="fin num kSim" type="number" inputmode="decimal" min="0" data-i="${i}" data-f="h" value="${esc(p.h)}"></label>
      <label class="fld">Poids / palette (kg)<input class="fin num kSim" type="number" inputmode="decimal" min="0" data-i="${i}" data-f="kg" value="${esc(p.kg)}"></label>
      ${s.lignes.length>1?`<button type="button" class="btn btn-ghost btn-sm" data-k="simdel" data-i="${i}" aria-label="Retirer cette ligne">Retirer</button>`:""}</div>`).join("")}</div>
    <div><button type="button" class="btn btn-ghost btn-sm" data-k="simadd">+ Ajouter un autre type de palette</button></div>
    <div class="fgrid"><label class="fld">Durée<input class="fin num kSim" type="number" inputmode="decimal" min="0" step="any" data-f="n" value="${esc(s.n)}"></label>
      <label class="fld">Unité<select class="fin kSim" data-f="u"><option value="jours" ${s.u==="jours"?"selected":""}>jours</option><option value="semaines" ${s.u==="semaines"?"selected":""}>semaines</option><option value="mois" ${s.u==="mois"?"selected":""}>mois</option></select></label>
      <label class="fld">Calcul retenu<select class="fin kSim" data-f="mode"><option value="mois" ${s.mode==="mois"?"selected":""}>Mois commencé</option><option value="prorata" ${s.mode==="prorata"?"selected":""}>Au prorata des jours</option></select></label>
      <label class="fld">Tarifs du client<select class="fin kSim" data-f="client"><option value="">Catalogue standard</option>${cl.map(c=>`<option value="${esc(c.id)}" ${c.id===s.client?"selected":""}>${esc(c.nom)}</option>`).join("")}</select></label></div>
    <label style="display:flex;gap:8px;align-items:center;font-size:14px"><input type="checkbox" class="kSim" data-f="mvt" ${s.mvt?"checked":""} style="width:20px;height:20px">Ajouter la manutention : entrée et sortie de chaque palette</label>
    <div id="kSimOut">${simHtml()}</div>
    <div class="row-btns" style="justify-content:flex-start"><button type="button" class="btn btn-accent" data-k="simdevis">Créer un devis</button><button type="button" class="btn btn-ghost" data-k="simcopy">Copier le détail</button>
      <span class="muted" style="font-size:13px">Le devis est créé pour le client choisi ci-dessus (carnet d'adresses).</span></div></div>`; }
function simMaj(){ const o=$("#kSimOut"); if(o) o.innerHTML=simHtml(); }
function simLignesDevis(){ const s=K.sim, c=simCalc(); const mois = s.mode==="prorata" ? c.mP : c.mE; const out=[];
  c.lignes.forEach(l=>out.push({ designation:`Stockage ${TP_LIB[l.type].toLowerCase()} — ${qtxt(l.nb)} palette${l.nb>1?"s":""} × ${qtxt(mois)} mois (${s.n} ${s.u}, ${s.mode==="prorata"?"prorata":"mois commencé"})`, qte:r2(l.nb*mois), pu:l.pu }));
  if(s.mvt && c.ent){ out.push({ designation:`Entrée de palettes (déchargement, contrôle, mise en stock) — ${qtxt(c.ent)} palettes`, qte:c.ent, pu:c.pe }); out.push({ designation:`Sortie de palettes (déstockage et chargement) — ${qtxt(c.ent)} palettes`, qte:c.ent, pu:c.ps }); }
  return out; }

/* ---------- tarifs ---------- */
function vTarifs(){
  return `<div class="pan"><h2>Catalogue de tarifs (HT)</h2><span class="muted">Ces prix servent aux mouvements, à la facturation et au simulateur. Laissez vide pour « sur devis ». Un tarif spécial pour un client se règle depuis la fiche du client, dans l'onglet Stock.</span>
    ${Object.keys(GROUPES).map(g=>`<h3 style="margin:10px 0 0">${GROUPES[g]}</h3><div class="tbl-wrap"><table><thead><tr><th>Prestation</th><th>Unité</th><th style="text-align:right">Prix HT (€)</th></tr></thead><tbody>${K.prest.filter(p=>p.groupe===g).map(p=>`<tr><td>${esc(p.libelle)}</td><td>${esc(p.unite)}</td>
      <td style="text-align:right"><input class="fin num" type="number" inputmode="decimal" min="0" step="0.01" id="kp_${esc(p.code)}" value="${p.prix==null?"":esc(p.prix)}" placeholder="sur devis" style="max-width:130px;text-align:right" aria-label="Prix de ${esc(p.libelle)}"></td></tr>`).join("")}</tbody></table></div>`).join("")}
    <div class="row-btns" style="justify-content:flex-start"><button type="button" class="btn btn-accent" data-k="tarifsave">Enregistrer les tarifs</button></div></div>`;
}
async function enregistrerTarifs(){ let n=0;
  for(const p of K.prest){ const el=$("#kp_"+p.code); if(!el) continue; const v=el.value.trim()===""?null:Number(el.value.replace(",","."));
    if(v!=null && !(v>=0)){ toast("Un prix n'est pas valide."); return; } if((p.prix==null?null:Number(p.prix))===v) continue;
    const r=await sb.from("stock_prestations").update({prix:v}).eq("id",p.id); if(r.error){ toast(kErr(r.error)); return; } p.prix=v; n++; }
  toast(n?"Tarifs enregistrés":"Aucun changement"); }

/* ---------- fiche d'un client : lots en stock, mode de facturation, prix spéciaux ---------- */
function openClient(id){ const x=stockParClient().find(c=>c.id===id)||{ id, nom:clientNom(id), lots:{open:[]}, tot:0 }; const reg=reglage(id); const t=todayIso();
  const prix=K.prest.filter(p=>p.prix!=null || p.code.startsWith("sto_"));
  openModal(`<div data-lock="keep" style="display:flex;flex-direction:column;gap:14px"><h2>${esc(x.nom||"Client")}</h2>
    <div class="pan"><h2>Palettes en stock : ${qtxt(x.tot||0)}</h2>${x.lots.open.length?`<div class="tbl-wrap"><table><thead><tr><th style="text-align:right">Palettes</th><th>Type</th><th>Entrées le</th><th style="text-align:right">Depuis</th></tr></thead><tbody>${x.lots.open.sort((a,b)=>a.from.localeCompare(b.from)).map(l=>{ const j=dDiff(l.from,t);
      return `<tr><td class="num" style="text-align:right">${qtxt(l.nb)}</td><td>${esc(TP_LIB[l.type])}</td><td class="num">${d2(l.from)}</td><td class="num" style="text-align:right">${j>SEUIL_VIEUX?`<span class="chip" style="border-color:var(--accent);color:var(--accent-ink)">${j} j</span>`:j+" j"}</td></tr>`; }).join("")}</tbody></table></div>`:`<span class="muted">Aucune palette en stock.</span>`}</div>
    <div class="pan"><h2>Facturation du stockage</h2><label class="fld">Une palette qui reste quelques jours se facture…<select class="fin" id="kc_mode"><option value="mois" ${reg.mode==="mois"?"selected":""}>au mois commencé (le mois est dû en entier)</option><option value="prorata" ${reg.mode==="prorata"?"selected":""}>au prorata des jours présents</option></select></label>
      <h3 style="margin:6px 0 0">Prix spéciaux (vide = prix du catalogue)</h3><div class="fgrid">${prix.map(p=>`<label class="fld">${esc(p.libelle.split(" (")[0])} <span class="muted">(${esc(p.unite)}, catalogue : ${p.prix==null?"sur devis":money(p.prix)})</span><input class="fin num" type="number" inputmode="decimal" min="0" step="0.01" data-kc="${esc(p.code)}" value="${reg.prix&&reg.prix[p.code]!=null?esc(reg.prix[p.code]):""}"></label>`).join("")}</div></div>
    <div class="row-btns"><button type="button" class="btn btn-ghost" data-k="mvt" data-sens="entree" data-client="${esc(id)}" style="margin-right:auto">+ Entrée</button><button type="button" class="btn btn-ghost" data-act="close">Fermer</button><button type="button" class="btn btn-accent" data-k="clientsave" data-id="${esc(id)}">Enregistrer</button></div></div>`);
}
async function enregistrerClient(id){ const mode=$("#kc_mode").value; const prix={}; document.querySelectorAll("[data-kc]").forEach(i=>{ const v=i.value.trim(); if(v!=="") prix[i.dataset.kc]=Number(v.replace(",",".")); });
  if(Object.values(prix).some(v=>!(v>=0))){ toast("Un prix n'est pas valide."); return; }
  const r=await sb.from("stock_reglages").upsert({entreprise_id:EID(),client_id:id,mode,prix},{onConflict:"entreprise_id,client_id"}); if(r.error){ toast(kErr(r.error)); return; }
  closeModal(); toast("Réglages enregistrés"); reload(); }

/* ---------- fiche d'un mouvement ---------- */
function blankMvt(sens,cid){ return { id:uuid(), isNew:true, sens, client_id:cid||"", date_mvt:todayIso(), type_palette:"europe", nb:"", emplacement:"", origine:"autre", course_id:"", chauffeur:"", societe:"", plaque:"", note:"" }; }
function openMvt(id,sens,cid){ const src=id?K.mvts.find(m=>m.id===id):null; if(id&&!src) return;
  K.draft = src ? Object.assign({},src,{isNew:false,course_id:src.course_id||"",client_id:src.client_id||"",nb:src.nb,emplacement:src.emplacement||"",chauffeur:src.chauffeur||"",societe:src.societe||"",plaque:src.plaque||"",note:src.note||""}) : blankMvt(sens,cid);
  drawMvt(); }
const opt = (v,l,cur) => `<option value="${esc(v)}" ${String(cur??"")===String(v)?"selected":""}>${esc(l)}</option>`;
function drawMvt(){ const D=K.draft, cl=clients(); const ent=D.sens==="entree";
  const courses=S.courses.filter(c=>c.statut!=="annulee").slice().sort((a,b)=>String(b.enlDate||"").localeCompare(String(a.enlDate||""))).slice(0,150);
  const dispo = D.client_id ? lotsClient(D.client_id).open.filter(l=>l.type===D.type_palette).reduce((s,l)=>s+l.nb,0) : null;
  openModal(`<div data-lock="keep" style="display:flex;flex-direction:column;gap:14px"><h2>${D.isNew?(ent?"Entrée de palettes":"Sortie de palettes"):(ent?"Entrée":"Sortie")+" du "+d2(D.date_mvt)}</h2>
    <div class="fgrid"><label class="fld">Client (propriétaire des palettes)<select class="fin" id="km_client"><option value="">— Choisir —</option>${cl.map(c=>opt(c.id,c.nom,D.client_id)).join("")}</select></label>
      <label class="fld">Date<input class="fin" type="date" id="km_date" value="${esc(D.date_mvt)}"></label>
      <label class="fld">Type de palette<select class="fin" id="km_type">${opt("europe","Europe 80 × 120 (standard)",D.type_palette)}${opt("hors_gabarit","Hors gabarit (autre format, > 1,80 m ou > 800 kg)",D.type_palette)}</select></label>
      <label class="fld">Nombre de palettes<input class="fin num" type="number" inputmode="numeric" min="1" id="km_nb" value="${esc(D.nb)}"></label>
      <label class="fld">Emplacement (facultatif)<input class="fin" id="km_emp" value="${esc(D.emplacement)}" placeholder="Ex. : allée B, rack 3"></label></div>
    ${!ent&&dispo!=null?`<span class="muted">En stock pour ce client : <b>${qtxt(dispo)}</b> palette${dispo>1?"s":""} de ce type.</span>`:""}
    <div class="fgrid"><label class="fld">${ent?"Qui dépose ?":"Qui récupère ?"}<select class="fin" id="km_orig">${opt("autre","Non précisé",D.origine)}${opt("course","Une course de Dream",D.origine)}${opt("externe","Un chauffeur externe",D.origine)}</select></label>
      ${D.origine==="course"?`<label class="fld wide">Course<select class="fin" id="km_course">${opt("","— Choisir une course —",D.course_id)}${courses.map(c=>opt(c.id,`${d2(c.enlDate)} · ${c.donneur||"?"} · ${trajet(c)}`,D.course_id)).join("")}</select></label>`:""}
      ${D.origine==="externe"?`<label class="fld">Chauffeur<input class="fin" id="km_chauf" value="${esc(D.chauffeur)}"></label><label class="fld">Société<input class="fin" id="km_soc" value="${esc(D.societe)}"></label><label class="fld">Plaque<input class="fin" id="km_plaq" value="${esc(D.plaque)}"></label>`:""}</div>
    <label class="fld">Note (état des palettes, bon de livraison, dimensions…)<textarea class="fin" id="km_note" rows="2">${esc(D.note)}</textarea></label>
    <div class="row-btns">${D.isNew?"":`<button type="button" class="btn btn-danger" data-k="mvtdel" style="margin-right:auto">Supprimer</button>`}<button type="button" class="btn btn-ghost" data-act="close">Fermer</button><button type="button" class="btn btn-accent" data-k="mvtsave">Enregistrer</button></div></div>`); }
function readMvt(){ const D=K.draft; if(!D||!$("#km_client")) return D; D.client_id=$("#km_client").value; D.date_mvt=$("#km_date").value; D.type_palette=$("#km_type").value; D.nb=$("#km_nb").value; D.emplacement=$("#km_emp").value.trim();
  D.origine=$("#km_orig").value; D.note=$("#km_note").value.trim(); D.course_id=$("#km_course")?$("#km_course").value:""; D.chauffeur=$("#km_chauf")?$("#km_chauf").value.trim():""; D.societe=$("#km_soc")?$("#km_soc").value.trim():""; D.plaque=$("#km_plaq")?$("#km_plaq").value.trim():""; return D; }
async function enregistrerMvt(){ const D=readMvt(); if(!D) return false; const nb=Math.floor(Number(D.nb));
  if(!D.client_id){ toast("Choisissez le client."); return false; } if(!D.date_mvt){ toast("Indiquez la date."); return false; } if(!(nb>=1)){ toast("Indiquez le nombre de palettes."); return false; }
  const row={ client_id:D.client_id, client_nom:clientNom(D.client_id), sens:D.sens, date_mvt:D.date_mvt, type_palette:D.type_palette, nb, emplacement:D.emplacement||null, origine:D.origine,
    course_id:D.origine==="course"?(D.course_id||null):null, chauffeur:D.origine==="externe"?(D.chauffeur||null):null, societe:D.origine==="externe"?(D.societe||null):null, plaque:D.origine==="externe"?(D.plaque||null):null, note:D.note||null };
  const cand=K.mvts.filter(m=>m.client_id===D.client_id && m.id!==D.id).concat([Object.assign({id:D.id,created_at:new Date().toISOString()},row)]);
  const ex=lotsFrom(cand).excess; if(ex>0){ toast("Cette sortie dépasse le stock du client ("+qtxt(ex)+" palette"+(ex>1?"s":"")+" de trop à cette date)."); return false; }
  const r = D.isNew ? await sb.from("stock_mouvements").insert(Object.assign({id:D.id,entreprise_id:EID()},row)) : await sb.from("stock_mouvements").update(row).eq("id",D.id);
  if(r.error){ toast(kErr(r.error)); return false; } closeModal(); toast(D.sens==="entree"?"Entrée enregistrée":"Sortie enregistrée"); await reload(); return true; }

/* ---------- prestations ponctuelles ---------- */
function openSvc(id){ const src=id?K.svcs.find(x=>x.id===id):null; if(id&&!src) return;
  K.draft = src ? Object.assign({},src,{isNew:false,note:src.note||""}) : { id:uuid(), isNew:true, client_id:"", date_svc:todayIso(), code:"man_vrac", qte:"", pu:"", note:"" };
  if(K.draft.isNew){ const p=prest(K.draft.code); K.draft.pu=prixDe(K.draft.code,null)??""; } drawSvc(); }
function drawSvc(){ const D=K.draft, cl=clients(); const p=prest(D.code)||{}; const pc=D.client_id?prixDe(D.code,D.client_id):prixDe(D.code,null);
  openModal(`<div data-lock="keep" style="display:flex;flex-direction:column;gap:14px"><h2>${D.isNew?"Nouvelle prestation":"Prestation du "+d2(D.date_svc)}</h2>
    <div class="fgrid"><label class="fld">Client<select class="fin" id="ks_client"><option value="">— Choisir —</option>${cl.map(c=>opt(c.id,c.nom,D.client_id)).join("")}</select></label>
      <label class="fld">Date<input class="fin" type="date" id="ks_date" value="${esc(D.date_svc)}"></label>
      <label class="fld wide">Prestation<select class="fin" id="ks_code">${K.prest.filter(x=>x.groupe!=="stockage").map(x=>opt(x.code,x.libelle+" ("+x.unite+")",D.code)).join("")}</select></label>
      <label class="fld">Quantité (${esc(p.unite||"")})<input class="fin num" type="number" inputmode="decimal" min="0" step="any" id="ks_qte" value="${esc(D.qte)}"></label>
      <label class="fld">Prix unitaire HT (€)<input class="fin num" type="number" inputmode="decimal" min="0" step="0.01" id="ks_pu" value="${esc(D.pu)}" placeholder="${pc==null?"sur devis : à saisir":""}"></label></div>
    <label class="fld">Note (facultatif)<input class="fin" id="ks_note" value="${esc(D.note)}"></label>
    ${D.piece_id?`<div class="banner"><span>Cette prestation est déjà sur une facture.</span></div>`:""}
    <div class="row-btns">${D.isNew||D.piece_id?"":`<button type="button" class="btn btn-danger" data-k="svcdel" style="margin-right:auto">Supprimer</button>`}<button type="button" class="btn btn-ghost" data-act="close">Fermer</button>${D.piece_id?"":`<button type="button" class="btn btn-accent" data-k="svcsave">Enregistrer</button>`}</div></div>`); }
function readSvc(){ const D=K.draft; if(!D||!$("#ks_client")) return D; D.client_id=$("#ks_client").value; D.date_svc=$("#ks_date").value; D.code=$("#ks_code").value; D.qte=$("#ks_qte").value; D.pu=$("#ks_pu").value; D.note=$("#ks_note").value.trim(); return D; }
async function enregistrerSvc(){ const D=readSvc(); const qte=Number(String(D.qte).replace(",",".")), pu=Number(String(D.pu||"0").replace(",","."));
  if(!D.client_id){ toast("Choisissez le client."); return; } if(!D.date_svc){ toast("Indiquez la date."); return; } if(!(qte>0)){ toast("Indiquez la quantité."); return; } if(!(pu>=0)){ toast("Le prix n'est pas valide."); return; }
  if(!(pu>0)){ toast("Indiquez le prix unitaire (prestation sur devis)."); return; }
  const p=prest(D.code)||{}; const row={ client_id:D.client_id, client_nom:clientNom(D.client_id), date_svc:D.date_svc, code:D.code, libelle:String(p.libelle||D.libelle||"Prestation").split(" (")[0], unite:p.unite||null, qte, pu, note:D.note||null };
  const r = D.isNew ? await sb.from("stock_services").insert(Object.assign({id:D.id,entreprise_id:EID()},row)) : await sb.from("stock_services").update(row).eq("id",D.id);
  if(r.error){ toast(kErr(r.error)); return; } closeModal(); toast("Prestation enregistrée"); reload(); }

/* ---------- facture et devis ---------- */
async function facturer(){ const cid=K.facClient, mois=K.mois; const fx=T.fx; if(!cid) return; const calc=calcMois(cid,mois); if(!calc.lignes.length){ toast("Rien à facturer."); return; }
  const lignes=withTva(calc.lignes); const t=fx.totals(lignes);
  const r=await fx.newPiece("facture",{client_id:cid,lignes,total_ht:t.ht,total_tva:t.tva,total_ttc:t.ttc,notes:"Stockage — "+moisLib(mois)}); if(r.error){ toast(fx.fErr(r.error)); return; }
  await sb.from("stock_factures").insert({entreprise_id:EID(),client_id:cid,mois,piece_id:r.data.id});
  const ids=calc.lignes.map(l=>l.svc).filter(Boolean); for(const id of ids) await sb.from("stock_services").update({piece_id:r.data.id}).eq("id",id);
  await fx.load(); await load(); location.hash="factures"; render(); fx.openPiece(r.data.id); toast("Facture créée en brouillon : vérifiez les lignes puis finalisez."); }
async function creerDevis(){ const fx=T.fx; const cid=K.sim.client; if(!cid){ toast("Choisissez d'abord le client dans « Tarifs du client »."); return; }
  const ls=simLignesDevis(); if(!ls.length){ toast("Indiquez au moins une palette."); return; } const lignes=withTva(ls); const t=fx.totals(lignes);
  const r=await fx.newPiece("devis",{client_id:cid,lignes,total_ht:t.ht,total_tva:t.tva,total_ttc:t.ttc,notes:"Simulation de stockage"}); if(r.error){ toast(fx.fErr(r.error)); return; }
  await fx.load(); location.hash="devis"; render(); fx.openPiece(r.data.id); toast("Devis créé en brouillon : vérifiez-le avant de l'envoyer."); }
async function copier(){ const c=simCalc(); const s=K.sim; const txt=["Stockage — estimation", ...simLignesDevis().map(l=>`• ${l.designation} : ${money(r2(l.qte*l.pu))} HT`), `Total HT : ${money(c.ht)} · TVA : ${money(c.tva)} · Total TTC : ${money(c.ttc)}`].join("\n");
  try{ await navigator.clipboard.writeText(txt); toast("Détail copié"); }catch(e){ toast("Copie impossible sur cet appareil."); } }

/* ---------- actions ---------- */
document.addEventListener("click", async e=>{
  const el=e.target.closest("[data-k]"); if(!el) return; const a=el.dataset.k, d=el.dataset;
  if(a==="tab"){ K.tab=d.v; render(); }
  else if(a==="mvt"){ closeModal(); openMvt(null,d.sens,d.client||""); }
  else if(a==="mvtopen"){ openMvt(d.id); }
  else if(a==="mvtsave"){ el.disabled=true; if(!(await enregistrerMvt())) el.disabled=false; }
  else if(a==="mvtdel"){ if(!el.dataset.ok){ el.dataset.ok="1"; el.textContent="Confirmer la suppression"; return; } const r=await sb.from("stock_mouvements").delete().eq("id",K.draft.id); if(r.error){ toast(kErr(r.error)); return; } closeModal(); toast("Mouvement supprimé"); reload(); }
  else if(a==="client"){ closeModal(); openClient(d.id); }
  else if(a==="clientsave"){ el.disabled=true; await enregistrerClient(d.id); el.disabled=false; }
  else if(a==="svcnew"){ openSvc(null); }
  else if(a==="svcopen"){ openSvc(d.id); }
  else if(a==="svcsave"){ el.disabled=true; await enregistrerSvc(); el.disabled=false; }
  else if(a==="svcdel"){ if(!el.dataset.ok){ el.dataset.ok="1"; el.textContent="Confirmer la suppression"; return; } const r=await sb.from("stock_services").delete().eq("id",K.draft.id); if(r.error){ toast(kErr(r.error)); return; } closeModal(); toast("Prestation supprimée"); reload(); }
  else if(a==="facturer"){ el.disabled=true; await facturer(); el.disabled=false; }
  else if(a==="tarifsave"){ el.disabled=true; await enregistrerTarifs(); el.disabled=false; }
  else if(a==="simadd"){ K.sim.lignes.push({nb:1,L:120,l:100,h:150,kg:500}); render(); }
  else if(a==="simdel"){ K.sim.lignes.splice(Number(d.i),1); render(); }
  else if(a==="simdevis"){ el.disabled=true; await creerDevis(); el.disabled=false; }
  else if(a==="simcopy"){ copier(); }
});
const onSim = e => { const t=e.target; if(!t.classList || !t.classList.contains("kSim")) return; const f=t.dataset.f; const v=t.type==="checkbox"?t.checked:t.value;
  if(t.dataset.i!==undefined) K.sim.lignes[Number(t.dataset.i)][f]=v; else K.sim[f]=v; simMaj(); };
document.addEventListener("input", onSim);
document.addEventListener("change", e=>{ onSim(e); const t=e.target;
  if(t.id==="kf_client"){ K.facClient=t.value; render(); } else if(t.id==="kf_mois"){ K.mois=t.value; render(); }
  else if(t.id==="km_orig"||t.id==="km_type"||t.id==="km_client"){ readMvt(); drawMvt(); }
  else if(t.id==="ks_code"||t.id==="ks_client"){ const D=readSvc(); if(D){ const nv=prixDe(D.code,D.client_id||null); D.pu = nv==null ? "" : nv; drawSvc(); } } });
document.addEventListener("keydown", e=>{ if(e.key==="Enter" && e.target.matches && e.target.matches("tr[data-k]")) e.target.click(); });
})();
