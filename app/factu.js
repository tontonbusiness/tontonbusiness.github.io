/* Mobilog — facturation de ventes, devis, carnet d'adresses, paramètres — Tonton Business */
(function(){
"use strict";
const T = window.TP; if(!T) return;
const { S, sb, $, esc, toast, openModal, closeModal, render, EID, frDate, todayIso } = T;
const F = T.F = { ready:false, err:"", clients:[], pieces:[], param:{societe:{},facturation:{}}, compteurs:[],
  filtre:{facture:"tous",avoir:"tous",devis:"tous"}, draft:null, openId:null };

/* ---------- aides ---------- */
const money = n => (Number(n)||0).toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})+" €";
const d2 = s => s ? frDate(String(s).slice(0,10),{day:"2-digit",month:"2-digit",year:"numeric"}) : "";
// arrondi au centime identique à celui de la base (demi-centime vers le haut, sans bruit de virgule flottante)
const r2 = x => { x=Number(x)||0; const sg=x<0?-1:1; return sg*Number(Math.round(Number(Math.abs(x).toPrecision(12)+"e2"))+"e-2"); };
function totals(lignes){ const by={}; (lignes||[]).forEach(l=>{ const t=Number(l.tva)||0; by[t]=r2((by[t]||0)+r2((Number(l.qte)||0)*(Number(l.pu)||0))); });
  let ht=0,tva=0; const det=Object.keys(by).map(Number).sort((a,b)=>a-b).map(t=>{ const v=r2(by[t]*t/100); ht+=by[t]; tva+=v; return {t,base:by[t],tva:v}; });
  return { ht:r2(ht), tva:r2(tva), ttc:r2(ht+tva), det }; }
const LAB = { facture:{un:"Facture",pl:"Factures",neuf:"Nouvelle facture",titre:"FACTURE"}, avoir:{un:"Avoir",pl:"Avoirs",neuf:"",titre:"AVOIR"}, devis:{un:"Devis",pl:"Devis",neuf:"Nouveau devis",titre:"DEVIS"} };
const ERR = { societe_incomplete:"Complétez d'abord Paramètres → Société : le nom et le SIRET sont obligatoires sur une facture.", client_manquant:"Choisissez un client du carnet d'adresses.",
  lignes_manquantes:"Ajoutez au moins une ligne, avec une désignation, une quantité et un prix.", deja_finalisee:"Cette pièce est déjà finalisée.", piece_verrouillee:"Une pièce finalisée ne peut plus être modifiée ni supprimée. Pour la corriger, créez un avoir.",
  compteur_en_arriere:"Le prochain numéro doit être supérieur au dernier numéro déjà utilisé.", interdit:"Action réservée à l'administrateur de l'entreprise." };
const fErr = e => { const m=(e&&e.message)||""; const k=Object.keys(ERR).find(x=>m.includes(x)); return k?ERR[k]:T.errMsg(e); };
const tvaDef = () => { const v=F.param.facturation?.tva; return (v===undefined||v===null||v==="") ? 20 : Number(v); };
const norm = s => String(s||"").trim().toLowerCase().replace(/\s+/g," ");
const clientById = id => F.clients.find(c=>c.id===id);
const clientByName = n => F.clients.find(c=>norm(c.nom)===norm(n));
const pris = () => { const s=new Set(); F.pieces.filter(p=>p.type==="facture").forEach(p=>(p.lignes||[]).forEach(l=>l.course_id&&s.add(l.course_id))); return s; };
const aFact = () => { const s=pris(); return S.courses.filter(c=>c.statut==="terminee" && !c.facturee && !s.has(c.id)); };
const enRetard = p => p.type==="facture" && p.statut==="finalisee" && p.date_echeance && p.date_echeance<todayIso();
function chip(p){ const m={ brouillon:["Brouillon","st-a_planifier"], finalisee:[p.type==="avoir"?"Finalisé":"Finalisée","st-envoyee"], payee:["Payée","st-terminee"], envoye:["Envoyé","st-envoyee"], accepte:["Accepté","st-terminee"], refuse:["Refusé","st-annulee"] }[p.statut]||[p.statut,""];
  return enRetard(p) ? `<span class="chip late">À relancer</span>` : `<span class="chip ${m[1]}">${m[0]}</span>`; }
const numero = p => p.numero || "Brouillon";
const joursRetard = p => p.date_echeance ? Math.max(0, Math.round((new Date(todayIso()+"T00:00:00") - new Date(p.date_echeance+"T00:00:00"))/864e5)) : 0;
const rels = p => Array.isArray(p.relances) ? p.relances : [];
const relTxt = p => { const r=rels(p); return r.length ? `${r.length} relance${r.length>1?"s":""} · dernière le ${d2(r[r.length-1].le)}` : ""; };
const NIV = { 1:"Rappel amiable", 2:"Relance ferme", 3:"Dernier rappel avant mise en demeure" };
const off = () => `<div class="bar"><h1>Facturation</h1></div><div class="pan"><b>La facturation n'est pas encore activée sur cette base.</b><span class="muted">${esc(F.err||"La mise à jour de la base de données n'a pas encore été appliquée.")}</span></div>`;

/* ---------- chargement ---------- */
async function load(){
  const eid=EID();
  const [c,p,pa,co] = await Promise.all([
    sb.from("clients").select("*").eq("entreprise_id",eid).order("nom"),
    sb.from("pieces").select("*").eq("entreprise_id",eid).order("created_at",{ascending:false}).limit(2000),
    sb.from("parametres").select("*").eq("entreprise_id",eid).limit(1),
    sb.from("compteurs").select("*").eq("entreprise_id",eid) ]);
  const bad=[c,p,pa,co].find(x=>x.error);
  if(bad){ F.ready=false; F.err=""; return; }
  F.ready=true; F.clients=c.data||[]; F.pieces=p.data||[]; F.compteurs=co.data||[];
  const row=(pa.data||[])[0]; F.param={ societe:(row&&row.societe)||{}, facturation:(row&&row.facturation)||{} };
}
T.onData.push(load);
async function reload(){ await load(); render(); }

/* ---------- menu ---------- */
T.nav = () => {
  const X_attN = () => (T.attN?T.attN():0);
  const cnt = st => S.courses.filter(c=>c.statut===st).length;
const NAVIC = {"planning": ["#5aa9ff", "<rect x=\"4\" y=\"5\" width=\"16\" height=\"16\" rx=\"2\"/><path d=\"M16 3v4M8 3v4M4 11h16\"/>"], "courses": ["#2fd3b0", "<circle cx=\"7\" cy=\"17\" r=\"2\"/><circle cx=\"17\" cy=\"17\" r=\"2\"/><path d=\"M5 17H3V6a1 1 0 0 1 1-1h9v12M9 17h6M13 8h4l4 4v5h-2\"/>"], "conducteur": ["#b49cff", "<circle cx=\"12\" cy=\"12\" r=\"9\"/><circle cx=\"12\" cy=\"12\" r=\"2\"/><path d=\"M12 14v7M10 12H3.5M14 12h6.5\"/>"], "devis": ["#ffb454", "<path d=\"M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2zM14 3v4a1 1 0 0 0 1 1h4M9 13h6M9 17h6M9 9h1\"/>"], "factures": ["#6fdc7a", "<path d=\"M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-2-2-3 2zM9 7h6M9 11h6M9 15h4\"/>"], "indicateurs": ["#ff8a65", "<rect x=\"3\" y=\"12\" width=\"4\" height=\"8\" rx=\"1\"/><rect x=\"10\" y=\"8\" width=\"4\" height=\"12\" rx=\"1\"/><rect x=\"17\" y=\"4\" width=\"4\" height=\"16\" rx=\"1\"/>"], "activite": ["#ff7fb0", "<path d=\"M3 12h4l3-9 4 18 3-9h4\"/>"], "soustraitants": ["#b49cff", "<circle cx=\"9\" cy=\"7\" r=\"4\"/><path d=\"M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 3.1a4 4 0 0 1 0 7.8M21 21v-2a4 4 0 0 0-3-3.85\"/>"], "litiges": ["#ff6b6b", "<path d=\"M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z\"/>"], "stockage": ["#ffb454", "<path d=\"M3 21V8l9-5 9 5v13M7 21v-8h10v8M7 17h10\"/>"], "clients": ["#5aa9ff", "<rect x=\"6\" y=\"3\" width=\"14\" height=\"18\" rx=\"2\"/><circle cx=\"13\" cy=\"10\" r=\"2\"/><path d=\"M9.5 16a3.5 3.5 0 0 1 7 0M3 7h3M3 12h3M3 17h3\"/>"], "parametres": ["#2fd3b0", "<rect x=\"5\" y=\"3\" width=\"14\" height=\"18\" rx=\"2\"/><circle cx=\"12\" cy=\"10\" r=\"2\"/><path d=\"M9 16h6\"/>"], "recurrentes": ["#2fd3b0", "<path d=\"M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3\"/>"], "reglages": ["#a9b6d3", "<path d=\"M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1\"/><circle cx=\"15\" cy=\"6\" r=\"2\"/><circle cx=\"9\" cy=\"12\" r=\"2\"/><circle cx=\"17\" cy=\"18\" r=\"2\"/>"]};
  const icn = v => { const i=NAVIC[v]; return i?`<svg class="ni-i" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="${i[0]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${i[1]}</svg>`:""; };
  const L = (v,label,extra,grp) => `<a href="#${v}"${grp?` data-grp="${grp}"`:""} class="${S.view===v?"on":""}"><span class="ni">${icn(v)}${label}</span>${extra||""}</a>`;
  const sub = (st,label,n,hot) => `<a href="#courses" class="sub ${S.view==="courses"&&S.fStatut===st?"on-st":""}" data-fst="${st}"><span style="display:flex;align-items:center"><span class="pst" style="background:var(--dot-${st})" aria-hidden="true"></span>${label}</span><span class="cnt ${hot&&n?"hot":""}">${n}</span></a>`;
  const subv = (v,label,n,hot) => `<a href="#${v}" class="sub" ${S.view===v?'style="color:var(--side-fg);font-weight:700"':""}>${label}${n===undefined?"":`<span class="cnt ${hot&&n?"hot":""}">${n}</span>`}</a>`;
  const GRP = { veh:["parametres","echvehicules","echchauffeurs"], fact:["factures","afacturer","relances","avoirs"] };
  T.navGrp = T.navGrp || {};
  const ouv = g => { const dans = GRP[g].includes(S.view); if(!dans) delete T.navGrp[g]; return T.navGrp[g]!==undefined ? T.navGrp[g] : dans; };
  const ouvV = ouv("veh"), ouvF = ouv("fact");
  const chev = o => `<svg class="chev${o?" open":""}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;
  const nb = (t,st) => F.pieces.filter(p=>p.type===t && (!st||p.statut===st)).length;
  return `<span class="grp">EXPLOITATION</span>`+L("planning","Planning",(X_attN()?`<span class="cnt hot" title="Chauffeur en attente depuis plus de 30 min">${X_attN()}</span>`:""))+L("courses","Transports")+
    sub("a_planifier","À planifier",cnt("a_planifier"),true)+sub("planifiee","Planifiés",cnt("planifiee"))+sub("envoyee","Envoyés",cnt("envoyee"))+
    sub("en_cours","En cours",cnt("en_cours"))+sub("terminee","Terminés",cnt("terminee"))+L("conducteur","Vue conducteur")+
    `<span class="grp">FACTURATION</span>`+L("devis","Devis")+L("factures","Facturation de ventes",chev(ouvF),"fact")+
    (ouvF?`<div class="subgrp">`+subv("afacturer","Transports à facturer",F.ready?aFact().length:0,true)+subv("factures","Factures",nb("facture"))+subv("relances","Relances clients",F.pieces.filter(enRetard).length,true)+subv("avoirs","Avoirs",nb("avoir"))+`</div>`:"")+
    `<span class="grp">OUTILS ET GESTION</span>`+L("indicateurs","Rapports")+L("activite","Activité chauffeurs")+L("soustraitants","Sous-traitants")+L("litiges","Litiges",(T.litigesN?T.litigesN():""))+L("stockage","Stockage")+L("clients","Carnet d'adresses")+L("parametres","Conducteurs et véhicules",(!ouvV&&(echCompte("v")+echCompte("c"))?`<span class="cnt hot">${echCompte("v")+echCompte("c")}</span>`:"")+chev(ouvV),"veh")+(ouvV?`<div class="subgrp">`+subv("echvehicules","Contrôles véhicules",echCompte("v"),true)+subv("echchauffeurs","Documents chauffeurs",echCompte("c"),true)+`</div>`:"")+L("reglages","Paramètres");
};

/* ---------- À FACTURER ---------- */
T.views.afacturer = () => {
  if(!F.ready) return off();
  const L=aFact(); const groups={}; L.forEach(c=>{ const k=(c.donneur||"Sans client").trim(); (groups[k]=groups[k]||[]).push(c); });
  const names=Object.keys(groups).sort((a,b)=>a.localeCompare(b));
  const tot=L.reduce((s,c)=>s+(Number(c.prix)||0),0);
  return `<div class="bar"><h1>Facturer des transports</h1><button type="button" class="btn btn-ghost" data-f="new" data-type="facture">+ Facture libre (sans transport)</button></div>
  <div class="kpis"><div class="kpi"><small>Transports terminés à facturer</small><b class="num">${L.length}</b></div><div class="kpi"><small>Montant HT</small><b class="num">${money(tot)}</b></div><div class="kpi"><small>Clients concernés</small><b class="num">${names.length}</b></div></div>
  ${names.length?names.map((n,gi)=>{ const cs=groups[n].sort((a,b)=>(a.enlDate||"").localeCompare(b.enlDate||"")); const st=cs.reduce((s,c)=>s+(Number(c.prix)||0),0);
    return `<div class="pan"><div class="bar"><h2 style="flex:1">${esc(n)}</h2><span class="muted">${cs.length} transport${cs.length>1?"s":""} · ${money(st)} HT</span><button type="button" class="btn btn-accent" data-f="mkfact" data-g="${gi}" data-donneur="${esc(n)}">Créer la facture</button></div>
    ${clientByName(n)?"":`<span class="muted" style="font-size:12px">Ce client n'est pas encore dans le carnet d'adresses : sa fiche sera créée avec la facture, à compléter ensuite (adresse, SIREN).</span>`}
    <div class="tbl-wrap"><table><thead><tr><th></th><th>Date</th><th>Trajet</th><th>Référence</th><th>BL / CMR</th><th style="text-align:right">Prix HT</th></tr></thead><tbody>${cs.map(c=>`<tr>
      <td><input type="checkbox" checked data-fsel="${gi}" value="${esc(c.id)}" aria-label="Inclure ce transport" style="width:18px;height:18px"></td>
      <td class="num">${d2(c.enlDate)}</td><td>${esc(c.enlVille||"?")} → ${esc(c.livVille||"?")}</td><td>${esc(c.ref||"")}</td>
      <td>${(c.docs||[]).some(d=>d.type==="bl")?"Reçu":`<span style="color:var(--danger);font-weight:600">Manquant</span>`}${c.reserve?` · <span style="color:var(--danger)">Réserve</span>`:""}</td>
      <td class="num" style="text-align:right">${c.prix?money(c.prix):`<span style="color:var(--danger);font-weight:600">Prix à saisir</span>`}</td></tr>`).join("")}</tbody></table></div></div>`; }).join("")
   :`<div class="pan"><div class="empty">Aucun transport terminé en attente de facturation.</div></div>`}`;
};
const ligneTransport = c => ({ designation:`Transport ${c.enlVille||"?"} → ${c.livVille||"?"} du ${d2(c.enlDate)}${c.ref?" — Réf. "+c.ref:""}`, qte:1, pu:Number(c.prix)||0, tva:tvaDef(), course_id:c.id });
const nbTransports = p => (p.lignes||[]).filter(l=>l.course_id).length;
async function factureTransports(cs, donneur){
  let cl=clientByName(donneur);
  if(!cl && donneur){ const r=await sb.from("clients").insert({entreprise_id:EID(),nom:donneur}).select().single(); if(r.error){ toast(fErr(r.error)); return false; } cl=r.data; }
  const lignes=cs.map(ligneTransport); const t=totals(lignes);
  const r=await sb.from("pieces").insert({entreprise_id:EID(),type:"facture",client_id:cl?cl.id:null,lignes,total_ht:t.ht,total_tva:t.tva,total_ttc:t.ttc}).select().single();
  if(r.error){ toast(fErr(r.error)); return false; }
  await load(); location.hash="factures"; render(); openPiece(r.data.id); return true;
}
async function mkFacture(el){
  const ids=[...document.querySelectorAll(`[data-fsel="${el.dataset.g}"]:checked`)].map(x=>x.value);
  const cs=S.courses.filter(c=>ids.includes(c.id)).sort((a,b)=>(a.enlDate||"").localeCompare(b.enlDate||""));
  if(!cs.length){ toast("Cochez au moins un transport."); return; }
  el.disabled=true; if(!(await factureTransports(cs, el.dataset.donneur))) el.disabled=false;
}
/* accès depuis la fiche d'un transport */
T.courseExtra = c => suiviBloc(c) + stBloc(c) + kmBloc(c) + carteBloc(c) + coutBloc(c) + factBloc(c) + (T.litigeBloc?T.litigeBloc(c):"") + (T.recBloc?T.recBloc(c):"");
const dh = t => t ? new Date(t).toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : "";
/* ---------- suivi de l'envoi : envoyée, vue par le chauffeur ---------- */
const suiviBloc = c => { if(!("vuLe" in c) || !c.conducteurId || !["envoyee","en_cours","terminee"].includes(c.statut)) return "";
  const k=S.conducteurs.find(x=>x.id===c.conducteurId); const nom=k?k.nom:"le chauffeur";
  return `<div class="banner" style="justify-content:flex-start"><span><b>Envoi :</b> ${c.envoyeLe?"envoyée à "+esc(nom)+" le "+dh(c.envoyeLe):"envoyée à "+esc(nom)} · ${c.vuLe?`<b style="color:var(--ok)">vue par ${esc(nom)} le ${dh(c.vuLe)}</b>`:`<b style="color:var(--accent-ink)">pas encore vue</b>`}</span></div>`; };
/* ---------- SOUS-TRAITANCE d'un transport : le confier, envoyer l'ordre de transport ---------- */
const stActif = () => S.courses.some(c=>"sousTraitantId" in c);
T.planRows = () => (F.ready && stActif()) ? sousTraitants().sort((a,b)=>a.nom.localeCompare(b.nom)).map(c=>({id:"st:"+c.id,stId:c.id,nom:c.nom,st:true})) : [];
async function confier(c, stId){
  const {error}=await sb.from("courses").update({sous_traitant_id:stId,conducteur_id:null,camion_id:null,remorque_id:null,statut:"planifiee",ordre_envoye_le:null,vu_le:null}).eq("id",c.id);
  if(error){ toast(fErr(error)); return false; } await T.loadData(); return true; }
T.assignSt = async (c, stId) => { if(await confier(c,stId)) openOrdre(c.id); };
const prixSt = c => { const l=coutsDe(c).find(x=>x.st===c.sousTraitantId && x.libelle===CT_TYPES[0]); return l?l.montant:""; };
T.stSelect = c => { if(!F.ready || !stActif()) return ""; const subs=sousTraitants().sort((a,b)=>a.nom.localeCompare(b.nom));
  if(!subs.length) return `<div class="fld">Sous-traitant<span class="muted" style="font-size:13px">Aucun sous-traitant enregistré. <button type="button" class="linkbtn" data-f="cnew" data-st="1">Nouveau sous-traitant</button></span></div>`;
  return `<label class="fld">Sous-traitant<select id="f_sousTraitantId"><option value="">— Aucun —</option>${subs.map(x=>`<option value="${esc(x.id)}" ${c.sousTraitantId===x.id?"selected":""}>${esc(x.nom)}</option>`).join("")}</select></label>`; };
const stBloc = c => { if(!F.ready || !stActif() || c.statut==="annulee") return "";
  const st=clientById(c.sousTraitantId);
  if(st) return `<div class="banner"><span><b>Sous-traitance :</b> confié à <b>${esc(st.nom)}</b>${prixSt(c)!==""?" · "+money(prixSt(c))+" HT":""} · ${c.ordreEnvoyeLe?"ordre de transport envoyé le "+dh(c.ordreEnvoyeLe):`<b style="color:var(--accent-ink)">ordre de transport pas encore envoyé</b>`}</span><span style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-accent btn-sm" data-f="ordre" data-id="${esc(c.id)}">Ordre de transport</button><button type="button" class="btn btn-ghost btn-sm" data-f="streprendre" data-id="${esc(c.id)}">Reprendre la course</button></span></div>`;
  if(["en_cours","terminee"].includes(c.statut)) return "";
  const subs=sousTraitants();
  return `<div class="bar" style="font-size:13px;gap:8px"><b>Sous-traiter :</b>${subs.length?`<select class="fin" id="stPick" style="width:auto;min-width:200px" aria-label="Sous-traitant"><option value="">— Choisir un sous-traitant —</option>${subs.map(x=>`<option value="${esc(x.id)}">${esc(x.nom)}</option>`).join("")}</select><button type="button" class="btn btn-ghost btn-sm" data-f="stconfier" data-id="${esc(c.id)}">Confier à ce sous-traitant</button>`:`<span class="muted">Aucun sous-traitant enregistré.</span>`}<button type="button" class="linkbtn" data-f="cnew" data-st="1">Nouveau sous-traitant</button></div>`; };
function ordreMsg(c, st, prix){ const so=F.param.societe; const j=d=>d?frDate(d,{weekday:"long",day:"numeric",month:"long",year:"numeric"}):"date à confirmer";
  const march=[c.palettes&&c.palettes+" palettes",c.colis&&c.colis+" colis",c.poids&&Number(c.poids).toLocaleString("fr-FR").replace(/[\u202f\u00a0]/g," ")+" kg",c.metres&&c.metres+" m de plancher",c.marchandise].filter(Boolean).join(", ");
  const p = prix!==""&&prix!=null ? (Number(prix)||0).toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2}).replace(/[\u202f\u00a0]/g," ")+" € HT" : "à confirmer";
  return { objet:`Ordre de transport ${c.ref?"réf. "+c.ref+" ":""}— ${c.enlVille||"?"} → ${c.livVille||"?"} — ${d2(c.enlDate)}`,
    corps:`Bonjour,\n\nNous vous confirmons l'ordre de transport suivant${c.ref?" (référence "+c.ref+")":""} :\n\nENLÈVEMENT — ${j(c.enlDate)}${c.enlHeure?" à "+c.enlHeure+(c.enlHeureFin?" (jusqu'à "+c.enlHeureFin+")":""):""}\n${[c.enlNom,c.enlAdresse,[c.enlCp,c.enlVille].filter(Boolean).join(" ")].filter(Boolean).join("\n")}\n\nLIVRAISON — ${j(c.livDate||c.enlDate)}${c.livHeure?" à "+c.livHeure+(c.livHeureFin?" (jusqu'à "+c.livHeureFin+")":""):""}\n${[c.livNom,c.livAdresse,[c.livCp,c.livVille].filter(Boolean).join(" ")].filter(Boolean).join("\n")}\n\nMarchandise : ${march||"à préciser"}${c.instructions?"\nConsignes : "+c.instructions:""}${c.contact?"\nContact sur place : "+c.contact:""}\n\nPrix convenu : ${p}\n\nMerci de nous confirmer la prise en charge par retour, et de joindre le BL / CMR émargé à votre facture.\n\nCordialement,\n${so.nom||S.entreprise?.nom||""}${so.tel?"\n"+so.tel:""}` }; }
function ordrePaper(c, st, prix){ const so=F.param.societe; const li=(a,b)=>b?`<div>${a?`<small>${a} : </small>`:""}${esc(b)}</div>`:"";
  const lieu=(t,nom,adr,cp,ville,date,h,hf)=>`<div class="box"><small>${t}</small><div><b>${esc(nom||ville||"")}</b></div>${li("",adr)}${li("",[cp,ville].filter(Boolean).join(" "))}<div><b>${date?esc(frDate(date,{weekday:"long",day:"numeric",month:"long",year:"numeric"})):"Date à confirmer"}${h?" à "+esc(h)+(hf?" – "+esc(hf):""):""}</b></div></div>`;
  return `<div class="paper"><div class="two-col"><div><b style="font-size:17px">${esc(so.nom||S.entreprise?.nom||"")}</b>${li("",so.adresse)}${li("",[so.cp,so.ville].filter(Boolean).join(" "))}${li("SIRET",so.siret)}${li("Tél.",so.tel)}${li("",so.email)}</div>
      <div style="text-align:right"><h3>ORDRE DE TRANSPORT</h3>${c.ref?`<div><b>Réf. ${esc(c.ref)}</b></div>`:""}<div><small>Émis le : </small>${d2(todayIso())}</div></div></div>
    <div class="two-col"><div></div><div class="box"><small>Transporteur sous-traitant</small><div><b>${esc(st.nom)}</b></div>${li("",st.adresse)}${li("",[st.cp,st.ville].filter(Boolean).join(" "))}${li("SIREN",st.siren)}</div></div>
    <div class="two-col">${lieu("Enlèvement",c.enlNom,c.enlAdresse,c.enlCp,c.enlVille,c.enlDate,c.enlHeure,c.enlHeureFin)}${lieu("Livraison",c.livNom,c.livAdresse,c.livCp,c.livVille,c.livDate||c.enlDate,c.livHeure,c.livHeureFin)}</div>
    <table><thead><tr><th>Marchandise</th><th class="r">Palettes</th><th class="r">Colis</th><th class="r">Poids</th><th class="r">Mètres de plancher</th></tr></thead><tbody><tr><td>${esc(c.marchandise||"—")}</td><td class="r">${esc(c.palettes??"—")}</td><td class="r">${esc(c.colis??"—")}</td><td class="r">${c.poids?Number(c.poids).toLocaleString("fr-FR")+" kg":"—"}</td><td class="r">${esc(c.metres??"—")}</td></tr></tbody></table>
    ${c.instructions?`<div class="box"><small>Consignes</small><div>${esc(c.instructions)}</div></div>`:""}${c.contact?`<div><small>Contact sur place : </small>${esc(c.contact)}</div>`:""}
    <table class="ptot"><tbody><tr><td>Prix convenu HT</td><td class="r">${prix!==""&&prix!=null?money(prix):"à confirmer"}</td></tr></tbody></table>
    <div class="legal">Merci de confirmer la prise en charge par retour. Le BL / CMR émargé par le destinataire est à joindre à votre facture. Toute difficulté (retard, attente, réserve) est à signaler immédiatement à notre exploitation.</div></div>`; }
function openOrdre(id){ const c=S.courses.find(x=>x.id===id); const st=c&&clientById(c.sousTraitantId); if(!st) return; F.ordre={id};
  const prix=prixSt(c); const m=ordreMsg(c,st,prix); const tel=String(st.tel||"").replace(/\D/g,""); const intl=/^0\d{9}$/.test(tel)?"33"+tel.slice(1):(/^33\d{9}$/.test(tel)?tel:"");
  openModal(`<div data-lock="keep" style="display:flex;flex-direction:column;gap:12px"><div class="bar"><h2 style="flex:1">Ordre de transport — ${esc(st.nom)}</h2>${c.ordreEnvoyeLe?`<span class="chip st-terminee">Envoyé le ${dh(c.ordreEnvoyeLe)}</span>`:`<span class="chip st-planifiee">Pas encore envoyé</span>`}</div>
    <div class="fgrid"><label class="fld">Prix convenu avec le sous-traitant (HT)<input class="fin num" type="number" step="0.01" min="0" id="oPrix" value="${esc(prix)}"></label><label class="fld">E-mail du sous-traitant<input class="fin" type="email" id="oMail" value="${esc(st.email||"")}" placeholder="À compléter"></label></div>
    <span class="muted" style="font-size:12px">Prix de vente de ce transport : ${c.prix?money(c.prix):"non renseigné"}. Le prix convenu est ajouté aux coûts d'achat du transport.</span>
    <label class="fld">Objet<input class="fin" id="oObj" value="${esc(m.objet)}"></label>
    <label class="fld">Message (modifiable)<textarea class="fin" id="oTxt" rows="12">${esc(m.corps)}</textarea></label>
    <span class="muted" style="font-size:12px">L'envoi se fait depuis votre messagerie ou WhatsApp. Cliquez ensuite sur « Enregistrer : ordre envoyé » pour passer la course en « Envoyé ». Le sous-traitant n'a pas l'application : c'est vous qui passerez la course en « Terminé » dans sa fiche.</span>
    <div class="row-btns"><button type="button" class="btn btn-ghost" data-act="close" style="margin-right:auto">Fermer</button><button type="button" class="btn btn-ghost" data-f="oprint">Imprimer / PDF</button><button type="button" class="btn btn-ghost" data-f="ocopy">Copier le message</button>${intl?`<button type="button" class="btn btn-ghost" data-f="owa" data-tel="${intl}">WhatsApp</button>`:""}<button type="button" class="btn btn-navy" data-f="omail">Ouvrir dans ma messagerie</button><button type="button" class="btn btn-accent" data-f="osave">Enregistrer : ordre envoyé</button></div></div>`); }
async function ordreEnregistrer(envoye){ const c=S.courses.find(x=>x.id===F.ordre.id); if(!c) return false; const v=$("#oPrix").value.trim(); const prix=v===""?null:Number(v.replace(",","."));
  if(prix!=null && !(prix>=0)){ toast("Le prix convenu n'est pas valide."); return false; }
  const autres=coutsDe(c).filter(l=>!(l.st===c.sousTraitantId && l.libelle===CT_TYPES[0])); const couts = prix==null ? autres : [{libelle:CT_TYPES[0],montant:r2(prix),st:c.sousTraitantId}].concat(autres);
  const patch={couts}; if(envoye){ patch.ordre_envoye_le=new Date().toISOString(); if(c.statut==="planifiee"||c.statut==="a_planifier") patch.statut="envoyee"; }
  const {error}=await sb.from("courses").update(patch).eq("id",c.id); if(error){ toast(fErr(error)); return false; }
  const mail=$("#oMail").value.trim(); const st=clientById(c.sousTraitantId); if(mail && st && !st.email){ await sb.from("clients").update({email:mail}).eq("id",st.id); st.email=mail; }
  return true; }
/* ---------- PRIX ET COÛTS D'ACHAT d'un transport : sous-traitance, péages, frais… et marge ---------- */
const CT = { id:null, lignes:[] };
const coutsDe = c => Array.isArray(c.couts) ? c.couts : [];
const totalCouts = c => r2(coutsDe(c).reduce((t,l)=>t+(Number(l.montant)||0),0));
function coutTot(){ const el=$("#f_prix"); const c=S.courses.find(x=>x.id===CT.id)||{}; const prix=el&&el.value.trim()!=="" ? Number(el.value.replace(",","."))||0 : Number(c.prix)||0;
  const tot=r2(CT.lignes.reduce((t,l)=>t+(Number(l.montant)||0),0)), marge=r2(prix-tot);
  return `<span>Prix de vente HT</span><span>${money(prix)}</span><span>Coûts d'achat HT</span><span>${money(tot)}</span><b class="big" style="${marge<0?"color:var(--danger)":""}">Marge</b><b class="big" style="${marge<0?"color:var(--danger)":""}">${money(marge)}${prix>0?` · ${(marge/prix*100).toLocaleString("fr-FR",{maximumFractionDigits:1})} %`:""}</b>`; }
const CT_TYPES = ["Sous-traitance / affrètement","Manutention","Attente","Hayon","Péages","Carburant","Frais de route","Immobilisation","Autre"];
const sousTraitants = () => F.clients.filter(c=>c.sous_traitant && c.actif!==false);
function coutInner(){ const subs=sousTraitants();
  return `<div class="tbl-wrap"><table class="lines" style="min-width:560px"><thead><tr><th>Coût d'achat</th><th>Sous-traitant</th><th style="width:130px">Montant HT</th><th></th></tr></thead><tbody>
    ${CT.lignes.length?CT.lignes.map((l,i)=>`<tr><td><select class="fin" data-ct="type" data-i="${i}" aria-label="Nature du coût">${CT_TYPES.map(t=>`<option ${l.type===t?"selected":""}>${t}</option>`).join("")}</select>${l.type==="Autre"?`<input class="fin" style="margin-top:4px" data-ct="texte" data-i="${i}" value="${esc(l.texte||"")}" placeholder="Précisez le coût" aria-label="Précision du coût">`:""}</td>
      <td>${l.stnom!==undefined?`<input class="fin" data-ct="stnom" data-i="${i}" value="${esc(l.stnom)}" placeholder="Nom du nouveau sous-traitant" aria-label="Nom du nouveau sous-traitant">`
        :`<select class="fin" data-ct="st" data-i="${i}" aria-label="Sous-traitant"><option value="">— Aucun (coût interne) —</option>${subs.map(x=>`<option value="${esc(x.id)}" ${l.st===x.id?"selected":""}>${esc(x.nom)}</option>`).join("")}${l.st&&!subs.some(x=>x.id===l.st)?`<option value="${esc(l.st)}" selected>${esc(clientById(l.st)?.nom||"Sous-traitant archivé")}</option>`:""}<option value="__new">+ Nouveau sous-traitant…</option></select>`}</td>
      <td><input class="fin num" type="number" step="0.01" min="0" data-ct="montant" data-i="${i}" value="${esc(l.montant??"")}" aria-label="Montant hors taxes"></td><td><button type="button" class="linkbtn" data-f="ctdel" data-i="${i}">Retirer</button></td></tr>`).join("")
      :`<tr><td colspan="4"><span class="muted">Aucun coût d'achat saisi pour ce transport.</span></td></tr>`}</tbody></table></div>
    <div class="bar"><button type="button" class="btn btn-ghost btn-sm" data-f="ctadd">+ Ajouter un coût</button><button type="button" class="btn btn-navy btn-sm" data-f="ctsave">Enregistrer les coûts</button><span style="flex:1"></span><div class="tot" id="ctTot">${coutTot()}</div></div>`; }
const coutBloc = c => { if(!("couts" in c) || c.statut==="annulee") return "";
  CT.id=c.id; CT.lignes=coutsDe(c).map(l=>({ type:CT_TYPES.includes(l.libelle)?l.libelle:"Autre", texte:CT_TYPES.includes(l.libelle)?"":(l.libelle||""), montant:l.montant, st:l.st||"" }));
  return `<div class="pan" style="background:var(--surface-2)"><h2>Prix et coûts d'achat</h2><div id="ctBox" style="display:flex;flex-direction:column;gap:10px">${coutInner()}</div></div>`; };
const factBloc = c => {
  if(!F.ready || c.statut==="annulee") return "";
  const p=F.pieces.find(x=>x.type==="facture" && (x.id===c.factureId || (x.lignes||[]).some(l=>l.course_id===c.id)));
  if(p) return `<div class="banner"><span><b>Facturation :</b> ${p.statut==="brouillon"?"ce transport est dans un brouillon de facture.":"transport facturé — facture "+esc(p.numero||"")+"."}</span><button type="button" class="btn btn-ghost btn-sm" data-f="openfact" data-id="${esc(p.id)}">Ouvrir la facture</button></div>`;
  if(c.statut!=="terminee") return `<div class="muted" style="font-size:13px"><b>Facturation :</b> ce transport pourra être facturé une fois terminé.</div>`;
  return `<div class="banner"><span><b>Facturation :</b> transport terminé, pas encore facturé${c.prix?"":" (prix à saisir)"}.</span><button type="button" class="btn btn-accent btn-sm" data-f="factcourse" data-id="${esc(c.id)}">Facturer ce transport</button></div>`;
};

/* ---------- LISTES : factures, avoirs, devis ---------- */
function listView(type){
  if(!F.ready) return off();
  const lab=LAB[type]; const all=F.pieces.filter(p=>p.type===type); const f=F.filtre[type];
  const sts = type==="facture" ? [["tous","Toutes"],["brouillon","Brouillons"],["finalisee","Finalisées"],["retard","À relancer"],["payee","Payées"]]
            : type==="devis" ? [["tous","Tous"],["brouillon","Brouillons"],["envoye","Envoyés"],["accepte","Acceptés"],["refuse","Refusés"]] : [["tous","Tous"],["brouillon","Brouillons"],["finalisee","Finalisés"]];
  const L=all.filter(p=> f==="tous" ? true : f==="retard" ? enRetard(p) : f==="finalisee" ? (p.statut==="finalisee" && !enRetard(p)) : p.statut===f);
  const sum=(arr,k)=>arr.reduce((s,p)=>s+Number(p[k]||0),0);
  const mois=todayIso().slice(0,7);
  const kpis = type==="facture" ? `<div class="kpis">
      <a class="kpi" href="#afacturer" style="text-decoration:none;color:inherit"><small>À facturer</small><b class="num">${aFact().length}</b></a>
      <div class="kpi"><small>Brouillons</small><b class="num">${all.filter(p=>p.statut==="brouillon").length}</b></div>
      <div class="kpi"><small>Finalisées, à encaisser (TTC)</small><b class="num">${money(sum(all.filter(p=>p.statut==="finalisee"&&!enRetard(p)),"total_ttc"))}</b></div>
      <a class="kpi ${all.some(enRetard)?"bad":""}" href="#relances" style="text-decoration:none;color:inherit"><small>À relancer (TTC)</small><b class="num">${money(sum(all.filter(enRetard),"total_ttc"))}</b></a>
      <div class="kpi"><small>Encaissé ce mois (TTC)</small><b class="num">${money(sum(all.filter(p=>p.statut==="payee"&&String(p.paye_le||"").slice(0,7)===mois),"total_ttc"))}</b></div></div>` : "";
  return `<div class="bar"><h1>${lab.pl}</h1>${type==="facture"?`<a class="btn btn-accent" href="#afacturer">Facturer des transports</a><button type="button" class="btn btn-navy" data-f="new" data-type="facture">+ Facture libre (sans transport)</button>`:lab.neuf?`<button type="button" class="btn btn-accent" data-f="new" data-type="${type}">+ ${lab.neuf}</button>`:""}</div>
  ${type==="facture"?`<span class="muted" style="font-size:13px"><b>Deux façons de facturer :</b> « Facturer des transports » reprend les transports terminés (une ligne par transport, qui passe ensuite en « facturé »). « Facture libre » sert pour tout le reste : location, immobilisation, frais divers, prestation sans transport saisi.</span>`:""}
  ${kpis}
  <div class="seg" role="group" aria-label="Filtre" style="align-self:flex-start;flex-wrap:wrap">${sts.map(([k,l])=>`<button type="button" class="${f===k?"on":""}" data-f="filtre" data-type="${type}" data-v="${k}">${l}</button>`).join("")}</div>
  <div class="pan"><div class="tbl-wrap"><table><thead><tr><th>Numéro</th><th>Client</th>${type==="facture"?"<th>Origine</th>":""}<th>Date</th>${type==="avoir"?"<th>Facture d'origine</th>":`<th>${type==="devis"?"Valable jusqu'au":"Échéance"}</th>`}<th style="text-align:right">Total HT</th><th style="text-align:right">Total TTC</th><th>État</th>${type==="facture"?"<th>Relances</th>":""}</tr></thead><tbody>
  ${L.length?L.map(p=>{ const cn=(p.client&&p.client.nom)||clientById(p.client_id)?.nom||"—"; const t=p.statut==="brouillon"?totals(p.lignes):{ht:p.total_ht,ttc:p.total_ttc};
    return `<tr class="click" tabindex="0" data-f="open" data-id="${esc(p.id)}"><td><b>${esc(numero(p))}</b></td><td>${esc(cn)}</td>${type==="facture"?`<td>${nbTransports(p)?`${nbTransports(p)} transport${nbTransports(p)>1?"s":""}`:`<span class="muted">Libre</span>`}</td>`:""}<td class="num">${d2(p.date_emission||p.created_at)}</td>
    <td class="num">${type==="avoir"?esc(F.pieces.find(x=>x.id===p.origine_id)?.numero||"—"):d2(p.date_echeance)}</td><td class="num" style="text-align:right">${money(t.ht)}</td><td class="num" style="text-align:right">${money(t.ttc)}</td><td>${chip(p)}</td>${type==="facture"?`<td>${relTxt(p)}</td>`:""}</tr>`; }).join("")
   :`<tr><td colspan="9"><div class="empty">${all.length?"Aucune pièce pour ce filtre.":type==="avoir"?"Aucun avoir. Un avoir se crée depuis une facture finalisée, pour l'annuler ou la corriger.":type==="facture"?"Aucune facture pour l'instant. Utilisez « Facturer des transports » ou « Facture libre ».":"Aucun devis pour l'instant."}</div></td></tr>`}
  </tbody></table></div></div>`;
}
T.views.factures = () => listView("facture");
T.views.avoirs = () => listView("avoir");
T.views.devis = () => listView("devis");

/* ---------- ÉCHÉANCES : contrôles des véhicules, documents des chauffeurs ---------- */
const ECH = { v:[["ct","Contrôle technique"],["limiteur","Limiteur de vitesse"],["chrono","Contrôle chronotachygraphe"]],
              r:[["ct","Contrôle technique"]],
              c:[["permis","Permis de conduire"],["carte","Carte conducteur"],["fimo","FIMO / FCO"],["visite","Visite médicale"]] };
const SEUIL = 30; // jours avant l'échéance où l'on prévient
const jours = d => Math.round((new Date(d+"T00:00:00") - new Date(todayIso()+"T00:00:00"))/864e5);
const echOk = d => /^\d{4}-\d{2}-\d{2}$/.test(d||"") && d>="2000-01-01" && d<="2100-12-31";
const echEtat = d => { if(!echOk(d)) return {k:"vide",txt:"À renseigner"}; const j=jours(d); return j<0 ? {k:"exp",txt:`Expiré depuis ${-j} j`} : j<=SEUIL ? {k:"bientot",txt:j===0?"Expire aujourd'hui":`Expire dans ${j} j`} : {k:"ok",txt:"Valide"}; };
const vSort = l => l.slice().sort((a,b)=>T.CAT_ORDRE[T.catVeh(a)]-T.CAT_ORDRE[T.catVeh(b)]||T.cmpTxt(a.immat,b.immat));
const rSort = l => l.slice().sort((a,b)=>T.cmpTxt(a.immat,b.immat));
const cSort = l => l.slice().sort((a,b)=>T.cmpTxt(a.nom,b.nom));
const echSrc = () => [ ...vSort(S.camions.filter(x=>x.actif!==false)).map(x=>({t:"camions",g:"v",o:x,nom:x.immat,defs:ECH.v})), ...rSort(S.remorques.filter(x=>x.actif!==false)).map(x=>({t:"remorques",g:"v",o:x,nom:x.immat,defs:ECH.r})), ...cSort(S.conducteurs.filter(x=>x.actif!==false)).map(x=>({t:"conducteurs",g:"c",o:x,nom:x.nom,defs:ECH.c})) ];
const echListe = g => echSrc().filter(e=>e.g===g).flatMap(e=>e.defs.map(([k,l])=>({nom:e.nom,l,d:(e.o.echeances||{})[k]||"",e:echEtat((e.o.echeances||{})[k])})));
function echCompte(g){ return echListe(g).filter(x=>x.e.k==="exp"||x.e.k==="bientot").length; }
T.planAlerts = () => { const out=[]; [["v","véhicules","echvehicules"],["c","chauffeurs","echchauffeurs"]].forEach(([g,nom,v])=>{ const L=echListe(g); const ex=L.filter(x=>x.e.k==="exp"), bi=L.filter(x=>x.e.k==="bientot"); if(!ex.length&&!bi.length) return;
    const detail=ex.concat(bi).slice(0,3).map(x=>`${esc(x.nom)} — ${esc(x.l)} (${esc(x.e.txt.toLowerCase())})`).join(" · ");
    out.push(`<div class="alert" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:space-between"><span><b>Échéances ${nom} :</b> ${ex.length?ex.length+" dépassée"+(ex.length>1?"s":""):""}${ex.length&&bi.length?", ":""}${bi.length?bi.length+" à renouveler sous "+SEUIL+" jours":""}. ${detail}${ex.length+bi.length>3?"…":""}</span><a class="btn btn-ghost btn-sm" href="#${v}">Voir</a></div>`); });
  return out; };
function echCell(t,o,k,l){ const d0=(o.echeances||{})[k]||""; const d=echOk(d0)?d0:""; const e=echEtat(d); const cls={exp:"late",bientot:"",ok:"st-terminee",vide:"st-a_planifier"}[e.k]; const st=e.k==="bientot"?' style="border-color:var(--accent);color:var(--accent-ink);background:var(--accent-soft)"':"";
  return `<td><input type="date" class="fin" min="2000-01-01" max="2100-12-31" style="max-width:160px" id="ech_${esc(o.id)}_${k}" data-ech="${t}" data-id="${esc(o.id)}" data-k="${k}" value="${esc(d)}" aria-label="${esc(l)} — ${esc(o.immat||o.nom||"")}"><div style="margin-top:4px"><span class="chip ${cls}"${st}>${e.txt}</span></div></td>`; }
function echView(g){
  const L=echListe(g); const n=k=>L.filter(x=>x.e.k===k).length;
  const kp=`<div class="kpis"><div class="kpi ${n("exp")?"bad":""}"><small>Expirés</small><b class="num">${n("exp")}</b></div><div class="kpi ${n("bientot")?"warn":""}"><small>À renouveler sous ${SEUIL} jours</small><b class="num">${n("bientot")}</b></div><div class="kpi"><small>Valides</small><b class="num">${n("ok")}</b></div><div class="kpi"><small>À renseigner</small><b class="num">${n("vide")}</b></div></div>`;
  const table=(titre,rows,defs,t,col)=> rows.length ? `<div class="pan"><h2>${titre}</h2><div class="tbl-wrap"><table><thead><tr><th>${col}</th>${defs.map(([,l])=>`<th>${l}</th>`).join("")}</tr></thead><tbody>${rows.map(o=>`<tr><td><b>${esc(o.immat||o.nom)}</b>${o.type?`<div class="muted">${esc(o.type)}</div>`:""}</td>${defs.map(([k,l])=>echCell(t,o,k,l)).join("")}</tr>`).join("")}</tbody></table></div></div>` : "";
  const act=x=>x.actif!==false;
  if(g==="v") return `<div class="bar"><h1>Contrôles véhicules</h1></div><span class="muted" style="font-size:13px">Saisissez la date de fin de validité de chaque contrôle : elle s'enregistre toute seule. Une alerte apparaît sur le planning ${SEUIL} jours avant l'échéance, puis quand elle est dépassée.</span>${kp}
    ${["tracteur","porteur","autre"].map(c=>table(T.CAT_LIB[c],rSort(S.camions.filter(x=>act(x)&&T.catVeh(x)===c)),ECH.v,"camions","Immatriculation")).join("")}${table("Remorques",rSort(S.remorques.filter(act)),ECH.r,"remorques","Immatriculation")}${S.camions.length+S.remorques.length?"":`<div class="pan"><div class="empty">Ajoutez d'abord vos véhicules dans « Conducteurs et véhicules ».</div></div>`}`;
  return `<div class="bar"><h1>Documents chauffeurs</h1></div><span class="muted" style="font-size:13px">Saisissez la date de fin de validité de chaque document : elle s'enregistre toute seule. Une alerte apparaît sur le planning ${SEUIL} jours avant l'échéance, puis quand elle est dépassée.</span>${kp}
    ${table("Chauffeurs",cSort(S.conducteurs.filter(act)),ECH.c,"conducteurs","Conducteur")||`<div class="pan"><div class="empty">Ajoutez d'abord vos conducteurs dans « Conducteurs et véhicules ».</div></div>`}`;
}
T.views.echvehicules = () => echView("v");
T.views.echchauffeurs = () => echView("c");

/* ---------- DISTANCES : calcul automatique par la route (services publics de l'IGN : adresse, puis itinéraire) ---------- */
const KM = { busy:false, ko:new Set(), off:false };
const kmCle = c => [c.enlAdresse,c.enlCp,c.enlVille,">",c.livAdresse,c.livCp,c.livVille].map(norm).join("|");
const kmPret = c => !!((c.enlVille||c.enlCp) && (c.livVille||c.livCp));
const kmActif = () => S.courses.some(c=>"km" in c);
const kmTxt = v => v==null ? "—" : Number(v).toLocaleString("fr-FR",{maximumFractionDigits:1})+" km";
// retire d'une adresse ce qui empêche la recherche : boîte postale, CEDEX, numéros de quais ou de portes, bâtiment
const adrNette = s => String(s||"")
  .replace(/\b(?:BP|B\.P\.|CS|TSA)\s*\d+/gi," ")
  .replace(/\bCEDEX\b\s*\d*/gi," ")
  .replace(/\b(?:quais?|portes?)\s+(?:n°\s*)?\d[^,]*/gi," ")
  .replace(/\bb[âa]t(?:iment)?\.?\s+[^,]*/gi," ")
  .replace(/\s*,(?:\s*,)+/g,",").replace(/\s+/g," ").replace(/^[\s,]+|[\s,]+$/g,"");
async function geocoder(adr,cp,ville){
  const cp5 = /^\d{5}$/.test(String(cp||"").trim()) ? String(cp).trim() : "";
  const dep = cp5 ? (/^9[78]/.test(cp5) ? cp5.slice(0,3) : cp5.slice(0,2)) : ""; // département attendu
  // nom de commune comparable : sans accents ni articles, mots triés (« Courneuve (La) » = « La Courneuve », « Saint » = « St »)
  const simple = s => String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()
    .split(" ").filter(w=>w && !/\d/.test(w) && !["le","la","les","l","de","du","des","d","cedex","arrondissement","er","e","eme"].includes(w)).map(w=>/^(saint|ste?)$/.test(w)?"st":w).sort().join(" ");
  const vS = simple(ville);
  const essai = async (q, avecCp, adresse) => { q=String(q||"").replace(/\s+/g," ").trim().slice(0,190); if(q.length<3) return null;
    const u=new URL("https://data.geopf.fr/geocodage/search"); u.searchParams.set("q",q); u.searchParams.set("limit","1"); if(avecCp && cp5) u.searchParams.set("postcode",cp5);
    const r=await fetch(u); if(!r.ok) throw new Error("geocodage "+r.status); const f=((await r.json()).features||[])[0];
    if(!(f && f.properties && f.properties.score>=0.4)) return null;
    const pc=String(f.properties.postcode||""); if(dep && pc && !pc.startsWith(dep)) return null; // résultat hors du département : refusé
    const cS=simple(f.properties.city); if(adresse && vS.length>=3 && cS && cS!==vS) return null; // rue trouvée dans une autre commune : refusée
    return f.geometry.coordinates; };
  const adrQ = adrNette(adr) ? [adrNette(adr),ville].filter(Boolean).join(" ") : "";
  const villeQ = ville && String(ville).trim().length>=3 ? ville : [cp,ville].filter(Boolean).join(" ");
  // un code postal CEDEX / BP (ex. 95502) n'existe pas dans la base d'adresses : on réessaie sans lui
  let pt = adrQ ? await essai(adrQ,true,true) : null;
  if(!pt && adrQ && cp5) pt = await essai(adrQ,false,true);
  if(!pt) pt = await essai(villeQ,true); // à défaut : le centre de la commune
  if(!pt && cp5) pt = await essai(villeQ,false,true); // sans code postal : seulement si c'est bien la même commune
  return pt;
}
async function calcKm(c){
  const a=await geocoder(c.enlAdresse,c.enlCp,c.enlVille), b=await geocoder(c.livAdresse,c.livCp,c.livVille); if(!a||!b) return null;
  const u=new URL("https://data.geopf.fr/navigation/itineraire"); u.searchParams.set("resource","bdtopo-osrm"); u.searchParams.set("profile","car"); u.searchParams.set("optimization","fastest");
  u.searchParams.set("start",a.join(",")); u.searchParams.set("end",b.join(",")); u.searchParams.set("getSteps","false"); u.searchParams.set("geometryFormat","polyline");
  const r=await fetch(u); if(!r.ok) throw new Error("itineraire "+r.status); const j=await r.json(); const d=Number(j.distance); if(!(d>=0)) return null;
  return Math.round((j.distanceUnit==="kilometer"?d:d/1000)*10)/10;
}
// file d'attente : quelques transports à la fois, sans bloquer l'écran ; une adresse introuvable n'est pas réessayée en boucle
async function kmFile(){
  if(KM.busy || KM.off || !T.isStaff() || !kmActif()) return;
  const lim=T.addDays(todayIso(),-120);
  const todo=S.courses.filter(c=>{ if(c.statut==="annulee" || !kmPret(c) || (c.enlDate && c.enlDate<lim)) return false; const k=kmCle(c); if(KM.ko.has(c.id+k)) return false; return c.km==null || (c.kmCle!==k && c.kmCle!=="manuel:"+k); }).slice(0,6);
  if(!todo.length) return; KM.busy=true; let n=0;
  for(const c of todo){ const k=kmCle(c);
    try{ const km=await calcKm(c); if(km==null){ KM.ko.add(c.id+k); continue; }
      const {error}=await sb.from("courses").update({km,km_cle:k}).eq("id",c.id); if(error){ KM.off=true; break; } c.km=km; c.kmCle=k; n++; }
    catch(e){ KM.ko.add(c.id+k); }
    await new Promise(r=>setTimeout(r,300)); }
  KM.busy=false; if(n){ render(); setTimeout(kmFile,500); }
}
T.onData.push(()=>{ setTimeout(kmFile,600); });
const kmBloc = c => { if(!kmActif() || c.statut==="annulee") return "";
  const manuel=String(c.kmCle||"").startsWith("manuel:"); const etat = c.km==null ? (kmPret(c)?"calcul automatique en attente, ou adresse introuvable":"renseignez les villes d'enlèvement et de livraison") : manuel ? "saisie à la main" : "calculée automatiquement, trajet routier enlèvement → livraison";
  return `<div class="bar" style="font-size:13px;gap:8px"><b>Distance :</b><input class="fin num" type="number" step="0.1" min="0" id="kmIn" value="${esc(c.km??"")}" style="width:110px" aria-label="Distance en kilomètres"><span>km</span><span class="muted" style="flex:1;min-width:160px">${etat}</span><button type="button" class="btn btn-ghost btn-sm" data-f="kmsave" data-id="${esc(c.id)}">Enregistrer la distance</button><button type="button" class="btn btn-ghost btn-sm" data-f="kmcalc" data-id="${esc(c.id)}">Recalculer</button></div>`; };

/* ---------- CARTE du trajet sur la fiche d'un transport (fond de carte et itinéraire : IGN) ---------- */
const CARTE = { lib:null, cache:new Map() };
const carteBloc = c => (kmActif() && c.statut!=="annulee" && kmPret(c)) ? `<div id="mapBox" data-id="${esc(c.id)}" style="height:280px;border-radius:12px;border:1px solid var(--line);overflow:hidden;background:var(--surface-2);display:grid;place-items:center" role="img" aria-label="Carte du trajet entre l'enlèvement et la livraison"><span class="muted">Chargement de la carte…</span></div>` : "";
function chargerLeaflet(){ if(window.L) return Promise.resolve(); if(CARTE.lib) return CARTE.lib;
  CARTE.lib=new Promise((ok,ko)=>{ const l=document.createElement("link"); l.rel="stylesheet"; l.href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"; document.head.appendChild(l);
    const sc=document.createElement("script"); sc.src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"; sc.onload=()=>ok(); sc.onerror=()=>{ CARTE.lib=null; ko(new Error("leaflet")); }; document.head.appendChild(sc); });
  return CARTE.lib; }
async function trajet(c){ const k=c.id+kmCle(c); if(CARTE.cache.has(k)) return CARTE.cache.get(k);
  const a=await geocoder(c.enlAdresse,c.enlCp,c.enlVille), b=await geocoder(c.livAdresse,c.livCp,c.livVille); if(!a||!b) return null;
  const u=new URL("https://data.geopf.fr/navigation/itineraire"); u.searchParams.set("resource","bdtopo-osrm"); u.searchParams.set("profile","car"); u.searchParams.set("optimization","fastest");
  u.searchParams.set("start",a.join(",")); u.searchParams.set("end",b.join(",")); u.searchParams.set("getSteps","false"); u.searchParams.set("geometryFormat","geojson");
  const r=await fetch(u); if(!r.ok) throw new Error("itineraire "+r.status); const j=await r.json();
  const ligne=(j.geometry&&j.geometry.coordinates||[]).map(p=>[p[1],p[0]]); const t={ a:[a[1],a[0]], b:[b[1],b[0]], ligne:ligne.length?ligne:[[a[1],a[0]],[b[1],b[0]]] };
  CARTE.cache.set(k,t); return t; }
async function dessinerCarte(el){
  const c=S.courses.find(x=>x.id===el.dataset.id); const ko=()=>{ if(el.isConnected) el.innerHTML=`<span class="muted">Carte indisponible pour ce trajet (adresse introuvable ou service de cartographie injoignable).</span>`; };
  if(!c){ ko(); return; }
  try{ const [t]=await Promise.all([trajet(c),chargerLeaflet()]); if(!t){ ko(); return; } if(!el.isConnected) return;
    el.innerHTML=""; el.style.display="block"; const L=window.L;
    const map=L.map(el,{scrollWheelZoom:false,attributionControl:true});
    L.tileLayer("https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",{maxZoom:18,attribution:"© IGN – Géoplateforme"}).addTo(map);
    const trace=L.polyline(t.ligne,{color:"#1F3A5F",weight:5,opacity:.85}).addTo(map);
    const pt=(p,coul,txt)=>L.circleMarker(p,{radius:9,color:"#FFFFFF",weight:3,fillColor:coul,fillOpacity:1}).addTo(map).bindTooltip(txt,{permanent:true,direction:"top",offset:[0,-8]});
    pt(t.a,"#2E7D4F","Enlèvement"+(c.enlVille?" · "+c.enlVille:"")); pt(t.b,"#F28C28","Livraison"+(c.livVille?" · "+c.livVille:""));
    map.fitBounds(trace.getBounds(),{padding:[36,36]}); setTimeout(()=>map.invalidateSize(),150);
  }catch(e){ ko(); }
}
new MutationObserver(()=>{ const el=document.getElementById("mapBox"); if(el && !el.dataset.vu){ el.dataset.vu="1"; dessinerCarte(el); } }).observe(document.getElementById("modal"),{childList:true,subtree:true});

/* ---------- ACTIVITÉ PAR CHAUFFEUR : jour, semaine, mois ---------- */
const A = { cond:"", mode:"semaine", ref:todayIso() };
const mn = h => h ? Number(h.slice(0,2))*60+Number(h.slice(3,5)) : null;
const duree = m => m==null ? "—" : (m>=60 ? Math.floor(m/60)+" h "+String(m%60).padStart(2,"0") : m+" min");
const pad2 = n => String(n).padStart(2,"0");
function actPeriode(o=A){ const [y,m,d]=o.ref.split("-").map(Number);
  if(o.mode==="jour") return { from:o.ref, to:o.ref, txt:frDate(o.ref,{weekday:"long",day:"numeric",month:"long",year:"numeric"}) };
  if(o.mode==="mois"){ const last=new Date(y,m,0).getDate(); return { from:`${y}-${pad2(m)}-01`, to:`${y}-${pad2(m)}-${pad2(last)}`, txt:frDate(`${y}-${pad2(m)}-01`,{month:"long",year:"numeric"}) }; }
  const wd=(new Date(y,m-1,d).getDay()+6)%7, from=T.addDays(o.ref,-wd), to=T.addDays(from,6);
  return { from, to, txt:`Semaine du ${frDate(from,{day:"numeric",month:"long"})} au ${frDate(to,{day:"numeric",month:"long",year:"numeric"})}` }; }
function actDecale(dir,o=A){ if(o.mode==="mois"){ const [y,m]=o.ref.split("-").map(Number); const x=new Date(y,m-1+dir,1); o.ref=`${x.getFullYear()}-${pad2(x.getMonth()+1)}-01`; } else o.ref=T.addDays(o.ref,dir*(o.mode==="jour"?1:7)); }
const TOL = 15; // minutes de tolérance avant de compter un retard
function actStats(condId, from, to){
  const L=S.courses.filter(c=>c.conducteurId===condId && c.enlDate && c.enlDate>=from && c.enlDate<=to && c.statut!=="annulee").sort((a,b)=>a.enlDate.localeCompare(b.enlDate)||(mn(a.enlHeure)||0)-(mn(b.enlHeure)||0));
  const fin=L.filter(c=>c.statut==="terminee"); let charge=0,nCharge=0,mes=0,ret=0;
  L.forEach(c=>{ const a=mn(c.arriveeEnl), ch=mn(c.chargeEnl); if(a!=null&&ch!=null&&ch>=a){ charge+=ch-a; nCharge++; }
    [[c.arriveeEnl,c.enlHeureFin||c.enlHeure],[c.arriveeLiv,c.livHeureFin||c.livHeure]].forEach(([reel,prevu])=>{ const r=mn(reel), pr=mn(prevu); if(r!=null&&pr!=null){ mes++; if(r>pr+TOL) ret++; } }); });
  const jours={}; L.forEach(c=>{ const j=jours[c.enlDate]=jours[c.enlDate]||{deb:null,fin:null,n:0,cs:[]}; j.n++; j.cs.push(c); const a=mn(c.arriveeEnl), l=(!c.livDate||c.livDate===c.enlDate)?mn(c.livre):null; if(a!=null&&(j.deb==null||a<j.deb)) j.deb=a; if(l!=null&&(j.fin==null||l>j.fin)) j.fin=l; });
  return { L, fin, couts:r2(fin.reduce((t,c)=>t+totalCouts(c),0)), km:fin.reduce((t,c)=>t+(Number(c.km)||0),0), kmN:fin.filter(c=>c.km!=null).length, ca:fin.reduce((t,c)=>t+(Number(c.prix)||0),0), charge, nCharge, mes, ret, jours,
    res:L.filter(c=>c.reserve).length, inc:L.reduce((t,c)=>t+(Array.isArray(c.incidents)?c.incidents.length:0),0),
    bl:fin.filter(c=>(c.docs||[]).some(d=>d.type==="bl")).length, sig:fin.filter(c=>c.signataire).length, joursTrav:Object.keys(jours).length };
}
const hm = m => m==null ? "—" : pad2(Math.floor(m/60))+":"+pad2(m%60);
T.views.activite = () => {
  const P=actPeriode(); const conds=S.conducteurs.filter(c=>c.actif!==false).sort((a,b)=>a.nom.localeCompare(b.nom)); const k=conds.find(c=>c.id===A.cond);
  const tete=`<div class="bar"><h1>Activité chauffeurs</h1><button type="button" class="btn btn-ghost" data-f="actprint">Imprimer / PDF</button></div>
    <div class="bar"><select class="fin" id="actCond" style="width:auto;min-width:220px" aria-label="Chauffeur"><option value="">Tous les chauffeurs (comparatif)</option>${conds.map(c=>`<option value="${esc(c.id)}" ${A.cond===c.id?"selected":""}>${esc(c.nom)}</option>`).join("")}</select>
      <div class="seg" role="group" aria-label="Période">${[["jour","Jour"],["semaine","Semaine"],["mois","Mois"]].map(([v,l])=>`<button type="button" class="${A.mode===v?"on":""}" data-f="actmode" data-v="${v}">${l}</button>`).join("")}</div>
      <button type="button" class="btn btn-ghost btn-sm" data-f="actnav" data-v="-1" aria-label="Période précédente">‹</button><b style="min-width:0">${esc(P.txt)}</b><button type="button" class="btn btn-ghost btn-sm" data-f="actnav" data-v="1" aria-label="Période suivante">›</button>
      <button type="button" class="btn btn-ghost btn-sm" data-f="actnav" data-v="0">Aujourd'hui</button></div>`;
  let corps;
  if(!k){ const rows=conds.map(c=>({c,s:actStats(c.id,P.from,P.to)}));
    const tot=rows.reduce((t,r)=>({n:t.n+r.s.fin.length,ca:t.ca+r.s.ca,km:t.km+r.s.km}),{n:0,ca:0,km:0});
    corps=`<div class="kpis"><div class="kpi"><small>Courses terminées</small><b class="num">${tot.n}</b></div><div class="kpi"><small>Chiffre d'affaires HT</small><b class="num">${money(tot.ca)}</b></div>${kmActif()?`<div class="kpi"><small>Kilomètres en charge</small><b class="num">${kmTxt(tot.km)}</b></div>`:""}<div class="kpi"><small>Chauffeurs actifs sur la période</small><b class="num">${rows.filter(r=>r.s.L.length).length} / ${conds.length}</b></div></div>
    <div class="pan"><h2>Comparatif — ${esc(P.txt)}</h2><div class="tbl-wrap"><table><thead><tr><th>Chauffeur</th><th>Jours travaillés</th><th>Courses terminées</th><th>Restant à faire</th><th style="text-align:right">CA HT</th>${kmActif()?`<th style="text-align:right">Km en charge</th><th style="text-align:right">CA / km</th>`:""}<th>Retards</th><th>Réserves</th><th>Problèmes signalés</th><th>BL manquants</th></tr></thead><tbody>
    ${rows.map(({c,s})=>`<tr class="click" tabindex="0" data-f="actpick" data-id="${esc(c.id)}"><td><b>${esc(c.nom)}</b></td><td class="num">${s.joursTrav}</td><td class="num">${s.fin.length}</td><td class="num">${s.L.length-s.fin.length}</td><td class="num" style="text-align:right">${money(s.ca)}</td>${kmActif()?`<td class="num" style="text-align:right">${s.kmN?kmTxt(s.km):"—"}</td><td class="num" style="text-align:right">${s.km>0?money(s.ca/s.km):"—"}</td>`:""}<td class="num">${s.mes?`${s.ret} / ${s.mes}`:"—"}</td><td class="num">${s.res}</td><td class="num">${s.inc}</td><td class="num">${s.fin.length-s.bl?`<span style="color:var(--danger);font-weight:700">${s.fin.length-s.bl}</span>`:"0"}</td></tr>`).join("")||`<tr><td colspan="11"><div class="empty">Aucun conducteur.</div></td></tr>`}</tbody></table></div>
    <span class="muted" style="font-size:12px">Cliquez sur un chauffeur pour voir le détail de ses courses. Retards : arrivées plus de ${TOL} minutes après l'heure prévue, sur le nombre d'arrivées mesurées.</span></div>`;
  } else { const s=actStats(k.id,P.from,P.to); const dates=Object.keys(s.jours).sort();
    corps=`<div class="kpis"><div class="kpi"><small>Courses terminées</small><b class="num">${s.fin.length}${s.L.length-s.fin.length?` <span class="muted" style="font-size:13px">+ ${s.L.length-s.fin.length} à faire</span>`:""}</b></div><div class="kpi"><small>Chiffre d'affaires HT</small><b class="num">${money(s.ca)}</b></div>${S.courses.some(c=>"couts" in c)?`<div class="kpi ${s.ca-s.couts<0?"bad":""}"><small>Marge (CA − coûts d'achat)</small><b class="num">${money(s.ca-s.couts)}</b></div>`:""}<div class="kpi"><small>Jours travaillés</small><b class="num">${s.joursTrav}</b></div>${kmActif()?`<div class="kpi"><small>Kilomètres en charge</small><b class="num">${s.kmN?kmTxt(s.km):"—"}</b></div><div class="kpi"><small>CA au kilomètre</small><b class="num">${s.km>0?money(s.ca/s.km):"—"}</b></div>`:""}
      <div class="kpi ${s.ret?"warn":""}"><small>Retards (plus de ${TOL} min)</small><b class="num">${s.mes?`${s.ret} / ${s.mes}`:"—"}</b></div><div class="kpi"><small>Temps de chargement moyen</small><b class="num">${s.nCharge?duree(Math.round(s.charge/s.nCharge)):"—"}</b></div>
      <div class="kpi ${s.res?"bad":""}"><small>Réserves</small><b class="num">${s.res}</b></div><div class="kpi ${s.inc?"bad":""}"><small>Problèmes signalés</small><b class="num">${s.inc}</b></div><div class="kpi ${s.fin.length-s.bl?"bad":""}"><small>BL envoyés</small><b class="num">${s.bl} / ${s.fin.length}</b></div></div>
    ${dates.length?dates.map(d=>{ const j=s.jours[d];
      return `<div class="pan"><div class="bar"><h2 style="flex:1">${esc(frDate(d,{weekday:"long",day:"numeric",month:"long"}))}</h2><span class="muted">${j.n} course${j.n>1?"s":""} · première arrivée ${hm(j.deb)} · dernière livraison ${hm(j.fin)}${j.deb!=null&&j.fin!=null&&j.fin>=j.deb?" · amplitude "+duree(j.fin-j.deb):""}</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>Client</th><th>Trajet</th>${kmActif()?`<th style="text-align:right">Km</th>`:""}<th>Prévu</th><th>Arrivé enl.</th><th>Chargé</th><th>Arrivé liv.</th><th>Livré</th><th>Suivi</th><th style="text-align:right">Prix HT</th></tr></thead><tbody>${j.cs.map(c=>{ const late=(r,p)=>{ const a=mn(r), b=mn(p); return a!=null&&b!=null&&a>b+TOL; };
        const notes=[c.statut!=="terminee"?`<span class="chip st-${esc(c.statut)}">${c.statut==="en_cours"?"En cours":"À faire"}</span>`:"", c.reserve?`<span class="chip late">Réserve</span>`:"", (c.incidents||[]).length?`<span class="chip late">${c.incidents.length} problème${c.incidents.length>1?"s":""}</span>`:"", c.statut==="terminee"&&!(c.docs||[]).some(x=>x.type==="bl")?`<span class="chip late">BL manquant</span>`:"", c.signataire?`<span class="chip st-terminee">Signé</span>`:""].filter(Boolean).join(" ");
        const cel=(v,l)=>`<td class="num"${l?' style="color:var(--danger);font-weight:700"':""}>${esc(v||"—")}${l?" (retard)":""}</td>`;
        return `<tr><td><b>${esc(c.donneur||"")}</b>${c.ref?`<div class="muted">Réf. ${esc(c.ref)}</div>`:""}</td><td>${esc(c.enlVille||"?")} → ${esc(c.livVille||"?")}</td>${kmActif()?`<td class="num" style="text-align:right">${kmTxt(c.km)}</td>`:""}<td class="num">${esc(c.enlHeure||"—")} → ${esc(c.livHeure||"—")}</td>${cel(c.arriveeEnl,late(c.arriveeEnl,c.enlHeureFin||c.enlHeure))}${cel(c.chargeEnl)}${cel(c.arriveeLiv,late(c.arriveeLiv,c.livHeureFin||c.livHeure))}${cel(c.livre)}<td>${notes||`<span class="muted">RAS</span>`}</td><td class="num" style="text-align:right">${c.prix?money(c.prix):"—"}</td></tr>`; }).join("")}</tbody></table></div></div>`; }).join("")
     :`<div class="pan"><div class="empty">Aucune course pour ${esc(k.nom)} sur cette période.</div></div>`}
    <span class="muted" style="font-size:12px">Les heures sont celles validées par le chauffeur dans Dream Chauffeur. Ce relevé suit l'activité : il ne remplace pas le chronotachygraphe pour le temps de travail et de conduite.${kmActif()?" Les kilomètres sont ceux du trajet routier entre l'enlèvement et la livraison des courses terminées (hors approche et retour à vide).":""}</span>`; }
  return tete+`<div id="actBody" style="display:flex;flex-direction:column;gap:14px">${corps}</div>`;
};

/* ---------- SOUS-TRAITANTS : ce que chacun a fait, par jour, semaine ou mois ---------- */
const B = { st:"", mode:"mois", ref:todayIso() };
function stStats(stId, from, to){
  const cs=S.courses.filter(c=>c.statut!=="annulee" && c.enlDate && c.enlDate>=from && c.enlDate<=to && (c.sousTraitantId===stId || coutsDe(c).some(l=>l.st===stId))).sort((a,b)=>a.enlDate.localeCompare(b.enlDate)||(mn(a.enlHeure)||0)-(mn(b.enlHeure)||0));
  const types={}; let achat=0, vente=0, couts=0, km=0;
  cs.forEach(c=>{ coutsDe(c).filter(l=>l.st===stId).forEach(l=>{ achat+=Number(l.montant)||0; types[l.libelle]=r2((types[l.libelle]||0)+(Number(l.montant)||0)); }); vente+=Number(c.prix)||0; couts+=totalCouts(c); km+=Number(c.km)||0; });
  const sans=cs.filter(c=>!coutsDe(c).some(l=>l.st===stId)).length;
  return { cs, types, achat:r2(achat), vente:r2(vente), marge:r2(vente-couts), km, sans };
}
T.views.soustraitants = () => {
  if(!F.ready) return off();
  const P=actPeriode(B); const subs=F.clients.filter(c=>c.sous_traitant).sort((a,b)=>a.nom.localeCompare(b.nom)); const k=subs.find(c=>c.id===B.st);
  const pc=(m,v)=>v>0?` · ${(m/v*100).toLocaleString("fr-FR",{maximumFractionDigits:1})} %`:"";
  const orphelins=S.courses.filter(c=>c.statut!=="annulee" && c.enlDate && c.enlDate>=P.from && c.enlDate<=P.to && coutsDe(c).some(l=>l.libelle===CT_TYPES[0] && !l.st));
  const tete=`<div class="bar"><h1>Sous-traitants</h1><button type="button" class="btn btn-ghost" data-f="stprint">Imprimer / PDF</button><button type="button" class="btn btn-accent" data-f="cnew" data-st="1">+ Nouveau sous-traitant</button></div>
    <div class="bar"><select class="fin" id="stSel" style="width:auto;min-width:220px" aria-label="Sous-traitant"><option value="">Tous les sous-traitants (comparatif)</option>${subs.map(c=>`<option value="${esc(c.id)}" ${B.st===c.id?"selected":""}>${esc(c.nom)}</option>`).join("")}</select>
      <div class="seg" role="group" aria-label="Période">${[["jour","Jour"],["semaine","Semaine"],["mois","Mois"]].map(([v,l])=>`<button type="button" class="${B.mode===v?"on":""}" data-f="stmode" data-v="${v}">${l}</button>`).join("")}</div>
      <button type="button" class="btn btn-ghost btn-sm" data-f="stnav" data-v="-1" aria-label="Période précédente">‹</button><b style="min-width:0">${esc(P.txt)}</b><button type="button" class="btn btn-ghost btn-sm" data-f="stnav" data-v="1" aria-label="Période suivante">›</button>
      <button type="button" class="btn btn-ghost btn-sm" data-f="stnav" data-v="0">Aujourd'hui</button></div>
    ${orphelins.length?`<div class="banner"><span><b>${orphelins.length} transport${orphelins.length>1?"s ont":" a"} un coût de sous-traitance sans sous-traitant nommé</b> sur cette période : ${orphelins.slice(0,4).map(c=>esc(c.donneur||"")+" du "+d2(c.enlDate)).join(", ")}${orphelins.length>4?"…":""}. Ouvrez le transport et choisissez le sous-traitant sur la ligne de coût.</span></div>`:""}`;
  let corps;
  if(!subs.length) corps=`<div class="pan"><div class="empty">Aucun sous-traitant pour l'instant. Ajoutez-en un ici, ou directement sur un coût d'achat dans la fiche d'un transport (« + Nouveau sous-traitant »).</div></div>`;
  else if(!k){ const rows=subs.map(c=>({c,s:stStats(c.id,P.from,P.to)})); const tot=rows.reduce((t,r)=>({n:t.n+r.s.cs.length,a:t.a+r.s.achat}),{n:0,a:0});
    corps=`<div class="kpis"><div class="kpi"><small>Transports sous-traités</small><b class="num">${tot.n}</b></div><div class="kpi"><small>Montant acheté HT</small><b class="num">${money(tot.a)}</b></div><div class="kpi"><small>Sous-traitants utilisés</small><b class="num">${rows.filter(r=>r.s.cs.length).length} / ${subs.length}</b></div></div>
    <div class="pan"><h2>Comparatif — ${esc(P.txt)}</h2><div class="tbl-wrap"><table><thead><tr><th>Sous-traitant</th><th>Transports confiés</th><th style="text-align:right">Acheté HT</th><th style="text-align:right">Vendu HT</th><th style="text-align:right">Marge gardée</th><th style="text-align:right">Km</th></tr></thead><tbody>
    ${rows.map(({c,s})=>`<tr class="click" tabindex="0" data-f="stpick" data-id="${esc(c.id)}"><td><b>${esc(c.nom)}</b>${c.actif===false?` <span class="muted">(archivé)</span>`:""}</td><td class="num">${s.cs.length}${s.sans?` <span class="muted" style="font-size:12px">dont ${s.sans} sans prix</span>`:""}</td><td class="num" style="text-align:right">${money(s.achat)}</td><td class="num" style="text-align:right">${money(s.vente)}</td><td class="num" style="text-align:right${s.marge<0?";color:var(--danger);font-weight:700":""}">${s.cs.length?money(s.marge)+pc(s.marge,s.vente):"—"}</td><td class="num" style="text-align:right">${s.km?kmTxt(s.km):"—"}</td></tr>`).join("")}</tbody></table></div>
    <span class="muted" style="font-size:12px">Cliquez sur un sous-traitant pour voir le détail. Marge gardée : prix de vente des transports confiés, moins tous leurs coûts d'achat.</span></div>`;
  } else { const s=stStats(k.id,P.from,P.to);
    corps=`<div class="kpis"><div class="kpi"><small>Transports confiés</small><b class="num">${s.cs.length}</b></div><div class="kpi"><small>Montant acheté HT</small><b class="num">${money(s.achat)}</b></div><div class="kpi"><small>Vendu HT</small><b class="num">${money(s.vente)}</b></div><div class="kpi ${s.marge<0?"bad":""}"><small>Marge gardée</small><b class="num">${money(s.marge)}</b></div>${kmActif()?`<div class="kpi"><small>Kilomètres</small><b class="num">${s.km?kmTxt(s.km):"—"}</b></div>`:""}</div>
    ${Object.keys(s.types).length?`<div class="pan"><h2>Ce qu'il a facturé, par nature</h2><div class="tot" style="justify-content:start">${Object.keys(s.types).sort().map(t=>`<span>${esc(t)}</span><span>${money(s.types[t])}</span>`).join("")}<b>Total acheté HT</b><b>${money(s.achat)}</b></div></div>`:""}
    <div class="pan"><h2>Transports confiés à ${esc(k.nom)}</h2><div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Client</th><th>Trajet</th>${kmActif()?`<th style="text-align:right">Km</th>`:""}<th>Coûts de ce sous-traitant</th><th style="text-align:right">Acheté HT</th><th style="text-align:right">Vendu HT</th><th style="text-align:right">Marge</th><th>État</th></tr></thead><tbody>
    ${s.cs.length?s.cs.map(c=>{ const mine=coutsDe(c).filter(l=>l.st===k.id), a=r2(mine.reduce((t,l)=>t+(Number(l.montant)||0),0)), m=r2((Number(c.prix)||0)-totalCouts(c));
      return `<tr class="click" tabindex="0" data-open="${esc(c.id)}"><td class="num">${d2(c.enlDate)}</td><td><b>${esc(c.donneur||"")}</b>${c.ref?`<div class="muted">Réf. ${esc(c.ref)}</div>`:""}</td><td>${esc(c.enlVille||"?")} → ${esc(c.livVille||"?")}</td>${kmActif()?`<td class="num" style="text-align:right">${kmTxt(c.km)}</td>`:""}<td>${mine.length?mine.map(l=>`${esc(l.libelle)} : ${money(l.montant)}`).join("<br>"):`<b style="color:var(--accent-ink)">prix à saisir</b>`}</td><td class="num" style="text-align:right">${money(a)}</td><td class="num" style="text-align:right">${c.prix?money(c.prix):"—"}</td><td class="num" style="text-align:right${m<0?";color:var(--danger);font-weight:700":""}">${money(m)}</td><td><span class="chip st-${esc(c.statut)}">${esc({a_planifier:"À planifier",planifiee:"Planifié",envoyee:"Envoyé",en_cours:"En cours",terminee:"Terminé"}[c.statut]||c.statut)}</span></td></tr>`; }).join("")
     :`<tr><td colspan="9"><div class="empty">Aucun transport confié à ${esc(k.nom)} sur cette période.</div></td></tr>`}</tbody></table></div></div>`; }
  return tete+`<div id="stBody" style="display:flex;flex-direction:column;gap:14px">${corps}</div>`;
};

/* ---------- RELANCES CLIENTS ---------- */
function retardsParClient(){ const g={}; F.pieces.filter(enRetard).forEach(p=>{ const k=p.client_id||"?"; (g[k]=g[k]||[]).push(p); });
  return Object.keys(g).map(k=>({ id:k, nom:(g[k][0].client&&g[k][0].client.nom)||clientById(k)?.nom||"Client", fact:g[k].sort((a,b)=>a.date_echeance.localeCompare(b.date_echeance)) }))
    .sort((a,b)=>joursRetard(b.fact[0])-joursRetard(a.fact[0])); }
T.views.relances = () => {
  if(!F.ready) return off();
  const G=retardsParClient(); const all=G.flatMap(g=>g.fact); const tot=all.reduce((s,p)=>s+Number(p.total_ttc||0),0);
  const jamais=all.filter(p=>!rels(p).length).length;
  return `<div class="bar"><h1>Relances clients</h1></div>
  <span class="muted" style="font-size:13px">Les factures finalisées dont l'échéance est dépassée et qui ne sont pas marquées payées. Une relance regroupe toutes les factures en retard d'un même client.</span>
  <div class="kpis"><div class="kpi ${all.length?"bad":""}"><small>Factures à relancer</small><b class="num">${all.length}</b></div><div class="kpi"><small>Montant dû (TTC)</small><b class="num">${money(tot)}</b></div><div class="kpi"><small>Clients concernés</small><b class="num">${G.length}</b></div><div class="kpi"><small>Jamais relancées</small><b class="num">${jamais}</b></div></div>
  ${G.length?G.map(g=>{ const st=g.fact.reduce((s,p)=>s+Number(p.total_ttc||0),0); const cl=clientById(g.id);
    return `<div class="pan"><div class="bar"><h2 style="flex:1">${esc(g.nom)}</h2><span class="muted">${g.fact.length} facture${g.fact.length>1?"s":""} · ${money(st)} TTC · jusqu'à ${joursRetard(g.fact[0])} j de retard</span><button type="button" class="btn btn-accent" data-f="relance" data-client="${esc(g.id)}">Relancer ce client</button></div>
    ${cl&&!cl.email?`<span class="muted" style="font-size:12px">Pas d'e-mail de facturation dans la fiche de ce client : ajoutez-le dans le carnet d'adresses pour préremplir le destinataire.</span>`:""}
    <div class="tbl-wrap"><table><thead><tr><th>Facture</th><th>Date</th><th>Échéance</th><th>Retard</th><th style="text-align:right">Total TTC</th><th>Relances</th><th></th></tr></thead><tbody>${g.fact.map(p=>`<tr><td><b>${esc(p.numero)}</b></td><td class="num">${d2(p.date_emission)}</td><td class="num">${d2(p.date_echeance)}</td><td><span class="chip late">${joursRetard(p)} j</span></td><td class="num" style="text-align:right">${money(p.total_ttc)}</td><td>${relTxt(p)||`<span class="muted">Aucune</span>`}</td><td><button type="button" class="linkbtn" data-f="open" data-id="${esc(p.id)}">Ouvrir</button></td></tr>`).join("")}</tbody></table></div></div>`; }).join("")
   :`<div class="pan"><div class="empty">Aucune facture à relancer : tout est payé ou pas encore échu.</div></div>`}`;
};
function relanceMsg(g, niv){
  const money = n => (Number(n)||0).toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2}).replace(/[\u202f\u00a0]/g," ")+" €"; // espaces simples pour les messageries
  const so=F.param.societe; const n=g.fact.length; const tot=g.fact.reduce((s,p)=>s+Number(p.total_ttc||0),0);
  const liste=g.fact.map(p=>`- Facture n° ${p.numero} du ${d2(p.date_emission)}, échue le ${d2(p.date_echeance)} : ${money(p.total_ttc)} TTC`).join("\n");
  const objet = niv===1 ? `Rappel — ${n>1?n+" factures en attente de règlement":"facture "+g.fact[0].numero+" en attente de règlement"}` : niv===2 ? `Relance — ${n>1?n+" factures impayées":"facture "+g.fact[0].numero+" impayée"}` : `Dernier rappel avant mise en demeure — ${n>1?n+" factures impayées":"facture "+g.fact[0].numero}`;
  const intro = niv===1 ? `Sauf erreur ou omission de notre part, ${n>1?"les factures suivantes restent":"la facture suivante reste"} à régler à ce jour :`
    : niv===2 ? `Malgré notre précédent rappel, nous n'avons pas reçu le règlement ${n>1?"des factures suivantes":"de la facture suivante"} :`
    : `Malgré nos relances, ${n>1?"les factures suivantes demeurent impayées":"la facture suivante demeure impayée"} :`;
  const suite = niv===1 ? `Nous vous remercions de bien vouloir procéder au règlement dans les meilleurs délais.`
    : niv===2 ? `Nous vous demandons de procéder au règlement sous 8 jours.`
    : `Sans règlement de votre part sous 8 jours, nous serons contraints de vous adresser une mise en demeure par lettre recommandée. Nous vous rappelons que les pénalités de retard et l'indemnité forfaitaire de 40 € pour frais de recouvrement, mentionnées sur nos factures, sont exigibles.`;
  const corps = `Bonjour,\n\n${intro}\n\n${liste}\n\nTotal dû : ${money(tot)} TTC\n\n${suite}${so.iban?`\n\nRèglement par virement — IBAN : ${so.iban}${so.bic?" — BIC : "+so.bic:""}`:""}\n\nSi votre règlement a été effectué entre-temps, merci de ne pas tenir compte de ce message.\n\nCordialement,\n${so.nom||""}${so.tel?"\n"+so.tel:""}`;
  return { objet, corps };
}
function openRelance(clientId){
  const g=retardsParClient().find(x=>x.id===clientId); if(!g){ toast("Ce client n'a plus de facture à relancer."); return; }
  const deja=Math.max(0,...g.fact.map(p=>rels(p).length)); const niv=Math.min(3,deja+1); const cl=clientById(clientId)||{}; const m=relanceMsg(g,niv);
  F.relance={ id:clientId, niv };
  openModal(`<div data-lock="keep" style="display:flex;flex-direction:column;gap:12px"><h2>Relancer ${esc(g.nom)}</h2>
    <span class="muted">${g.fact.length} facture${g.fact.length>1?"s":""} en retard · ${deja?deja+" relance"+(deja>1?"s":"")+" déjà enregistrée"+(deja>1?"s":""):"aucune relance enregistrée"}.</span>
    <div class="fgrid"><label class="fld">Niveau de la relance<select class="fin" id="rNiv">${[1,2,3].map(k=>`<option value="${k}" ${k===niv?"selected":""}>${k}. ${NIV[k]}</option>`).join("")}</select></label>
      <label class="fld">E-mail du client<input class="fin" type="email" id="rMail" value="${esc(cl.email||"")}" placeholder="À compléter"></label></div>
    <label class="fld">Objet<input class="fin" id="rObj" value="${esc(m.objet)}"></label>
    <label class="fld">Message (modifiable)<textarea class="fin" id="rTxt" rows="12">${esc(m.corps)}</textarea></label>
    <span class="muted" style="font-size:12px">L'envoi se fait depuis votre messagerie : « Ouvrir dans ma messagerie » prépare l'e-mail, ou copiez le message. Cliquez ensuite sur « Enregistrer la relance » pour en garder la trace sur les factures.</span>
    <div class="row-btns"><button type="button" class="btn btn-ghost" data-act="close" style="margin-right:auto">Fermer</button><button type="button" class="btn btn-ghost" data-f="rcopy">Copier le message</button><button type="button" class="btn btn-navy" data-f="rmail">Ouvrir dans ma messagerie</button><button type="button" class="btn btn-accent" data-f="rsave">Enregistrer la relance</button></div></div>`);
}

/* ---------- le document (aperçu écran + impression) ---------- */
function paper(p){
  const fin = p.statut!=="brouillon";
  const em = fin ? (p.emetteur||{}) : F.param.societe; const me = fin ? (p.mentions||{}) : F.param.facturation;
  const cl = fin ? (p.client||{}) : (clientById(p.client_id)||{});
  const t = totals(p.lignes); if(fin){ t.ht=Number(p.total_ht); t.tva=Number(p.total_tva); t.ttc=Number(p.total_ttc); }
  const orig = p.origine_id ? F.pieces.find(x=>x.id===p.origine_id) : null;
  const li = (a,b) => b ? `<div>${a?`<small>${a} : </small>`:""}${esc(b)}</div>` : "";
  const logo = em.logo || F.param.societe.logo || "";
  return `<div class="paper">${fin?"":`<div class="wm">BROUILLON</div>`}
    <div class="two-col"><div>${logo?`<img src="${esc(logo)}" alt="Logo" style="display:block;width:340px;max-width:100%;height:auto;margin-bottom:8px">`:""}<b style="font-size:17px">${esc(em.nom||"Votre société")}</b>${li("",[em.forme,em.capital?"au capital de "+em.capital:""].filter(Boolean).join(" "))}${li("",em.adresse)}${li("",[em.cp,em.ville].filter(Boolean).join(" "))}${li("SIRET",em.siret)}${li("RCS",em.rcs)}${li("TVA",em.tva_intra)}${li("Tél.",em.tel)}${li("",em.email)}</div>
      <div style="text-align:right"><h3>${LAB[p.type].titre}</h3><div><b>N° ${esc(p.numero||"— (brouillon)")}</b></div><div><small>Date : </small>${d2(p.date_emission||todayIso())}</div>${p.type==="facture"&&p.date_echeance?`<div><small>Échéance : </small><b>${d2(p.date_echeance)}</b></div>`:""}${p.type==="devis"&&p.date_echeance?`<div><small>Valable jusqu'au : </small>${d2(p.date_echeance)}</div>`:""}${orig?`<div><small>Avoir sur la facture </small>${esc(orig.numero||"")}</div>`:""}</div></div>
    <div class="two-col"><div></div><div class="box"><small>${p.type==="devis"?"Destinataire":"Facturé à"}</small><div><b>${esc(cl.nom||"Client à choisir")}</b></div>${li("",cl.adresse)}${li("",[cl.cp,cl.ville].filter(Boolean).join(" "))}${li("SIREN",cl.siren)}${li("TVA",cl.tva_intra)}</div></div>
    <table><thead><tr><th>Désignation</th><th class="r">Qté</th><th class="r">Prix unitaire HT</th><th class="r">TVA</th><th class="r">Total HT</th></tr></thead><tbody>
    ${(p.lignes||[]).map(l=>`<tr><td>${esc(l.designation||"")}</td><td class="r">${(Number(l.qte)||0).toLocaleString("fr-FR")}</td><td class="r">${money(l.pu)}</td><td class="r">${(Number(l.tva)||0).toLocaleString("fr-FR")} %</td><td class="r">${money(r2((Number(l.qte)||0)*(Number(l.pu)||0)))}</td></tr>`).join("")}</tbody></table>
    <table class="ptot"><tbody><tr><td>Total HT</td><td class="r">${money(t.ht)}</td></tr>${t.det.map(d=>`<tr><td>TVA ${d.t.toLocaleString("fr-FR")} % <small>sur ${money(d.base)}</small></td><td class="r">${money(d.tva)}</td></tr>`).join("")}<tr><td>Total TTC</td><td class="r">${money(t.ttc)}</td></tr></tbody></table>
    ${p.notes?`<div>${esc(p.notes).replace(/\n/g,"<br>")}</div>`:""}
    ${p.type==="facture"?`<div class="box"><b>Règlement</b>${p.date_echeance?`<div>À régler au plus tard le ${d2(p.date_echeance)}, par virement.</div>`:""}${li("IBAN",em.iban)}${li("BIC",em.bic)}</div>`:""}
    <div class="legal">${p.type==="devis"?"Devis gratuit. ":""}Nature de l'opération : prestation de services (transport routier de marchandises).${me.tva_debits?" TVA acquittée sur les débits.":""}
    ${p.type==="facture"?` Pas d'escompte pour paiement anticipé. En cas de retard de paiement : pénalités ${esc(me.penalites||"au taux de trois fois le taux d'intérêt légal")}, et indemnité forfaitaire pour frais de recouvrement de 40 €.`:""}
    ${me.pied?`<div>${esc(me.pied)}</div>`:""}</div></div>`;
}

/* ---------- ouverture / édition d'une pièce ---------- */
function openPiece(id){
  const p=F.pieces.find(x=>x.id===id); if(!p) return; F.openId=id;
  if(p.statut==="brouillon"){ F.draft=JSON.parse(JSON.stringify(p)); if(!F.draft.lignes.length) F.draft.lignes.push({designation:"",qte:1,pu:0,tva:tvaDef()}); return drawEditor(); }
  F.draft=null;
  const orig = p.type==="facture" && F.pieces.find(x=>x.type==="avoir" && x.origine_id===p.id);
  const acts = p.type==="facture" ? (p.statut==="payee" ? `<span class="muted" style="margin-right:auto">Payée le ${d2(p.paye_le)}</span><button type="button" class="btn btn-ghost" data-f="unpaid">Annuler le paiement</button>`
        : `<label class="fld" style="margin-right:auto">Payée le<input type="date" class="fin" id="fPaye" value="${todayIso()}"></label><button type="button" class="btn btn-navy" data-f="paid">Marquer comme payée</button>`)+
        (orig?`<button type="button" class="btn btn-ghost" data-f="open" data-id="${esc(orig.id)}">Voir l'avoir ${esc(orig.numero||"(brouillon)")}</button>`:`<button type="button" class="btn btn-ghost" data-f="avoir">Créer un avoir</button>`)
    : p.type==="devis" ? `<span style="margin-right:auto">${chip(p)}</span>${p.statut!=="accepte"?`<button type="button" class="btn btn-ghost" data-f="dstat" data-v="accepte">Accepté par le client</button>`:""}${p.statut!=="refuse"?`<button type="button" class="btn btn-ghost" data-f="dstat" data-v="refuse">Refusé</button>`:""}<button type="button" class="btn btn-navy" data-f="tofact">Transformer en facture</button>` : "";
  openModal(`<div data-lock="1" style="display:flex;flex-direction:column;gap:14px"><div class="bar"><h2 style="flex:1">${LAB[p.type].un} ${esc(p.numero||"")}</h2>${chip(p)}</div>
    ${enRetard(p)?`<div class="alert" style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap"><span><b>À relancer :</b> échéance dépassée de ${joursRetard(p)} jour${joursRetard(p)>1?"s":""}. ${relTxt(p)||"Aucune relance envoyée."}</span><button type="button" class="btn btn-ghost btn-sm" data-f="relance" data-client="${esc(p.client_id||"")}">Relancer le client</button></div>`:""}
    ${paper(p)}
    <div class="row-btns" style="align-items:flex-end">${acts}<button type="button" class="btn btn-ghost" data-f="print">Imprimer / PDF</button><button type="button" class="btn btn-accent" data-act="close">Fermer</button></div></div>`);
}
function drawEditor(){
  const p=F.draft; const lab=LAB[p.type]; const t=totals(p.lignes);
  const cls=F.clients.filter(c=>c.actif!==false||c.id===p.client_id);
  const orig=p.origine_id?F.pieces.find(x=>x.id===p.origine_id):null;
  openModal(`<div data-lock="keep" style="display:flex;flex-direction:column;gap:14px"><div class="bar"><h2 style="flex:1">${lab.un} — brouillon</h2>${orig?`<span class="muted">Avoir sur la facture ${esc(orig.numero||"")}</span>`:""}</div>
    <div class="fgrid"><label class="fld">Client<select class="fin" id="fClient"><option value="">— Choisir dans le carnet d'adresses —</option>${cls.map(c=>`<option value="${esc(c.id)}" ${p.client_id===c.id?"selected":""}>${esc(c.nom)}</option>`).join("")}</select></label>
      ${p.type!=="avoir"?`<label class="fld">${p.type==="devis"?"Valable jusqu'au":"Échéance (vide = délai du client)"}<input type="date" class="fin" id="fEch" value="${esc(p.date_echeance||"")}"></label>`:""}</div>
    <div class="tbl-wrap"><table class="lines"><thead><tr><th style="min-width:240px">Désignation</th><th style="width:84px">Qté</th><th style="width:120px">Prix unitaire HT</th><th style="width:84px">TVA %</th><th style="text-align:right;width:110px">Total HT</th><th></th></tr></thead><tbody>
    ${p.lignes.map((l,i)=>`<tr><td><input class="fin" data-fl="designation" data-i="${i}" value="${esc(l.designation||"")}" aria-label="Désignation">${l.course_id?`<div class="muted" style="font-size:11px;margin-top:2px">Lié à un transport : il passera en « facturé » à la finalisation.</div>`:""}</td>
      <td><input class="fin num" type="number" step="0.01" data-fl="qte" data-i="${i}" value="${esc(l.qte??"")}" aria-label="Quantité"></td>
      <td><input class="fin num" type="number" step="0.01" data-fl="pu" data-i="${i}" value="${esc(l.pu??"")}" aria-label="Prix unitaire hors taxes"></td>
      <td><input class="fin num" type="number" step="0.1" min="0" data-fl="tva" data-i="${i}" value="${esc(l.tva??"")}" aria-label="Taux de TVA"></td>
      <td class="num" style="text-align:right" id="fLt${i}">${money(r2((Number(l.qte)||0)*(Number(l.pu)||0)))}</td>
      <td><button type="button" class="linkbtn" data-f="delline" data-i="${i}">Retirer</button></td></tr>`).join("")}</tbody></table></div>
    <div class="bar"><button type="button" class="btn btn-ghost btn-sm" data-f="addline">+ Ajouter une ligne libre</button>${p.type==="facture"?addCourseSel(p):""}${(F.param.facturation.produits||[]).length?`<select class="fin" id="fAddProd" style="width:auto;max-width:260px" aria-label="Ajouter un produit du catalogue"><option value="">+ Ajouter un produit du catalogue…</option>${F.param.facturation.produits.map((x,i)=>`<option value="${i}">${esc(x.nom)}${x.prix?" · "+money(x.prix):""}</option>`).join("")}</select>`:""}<span style="flex:1"></span><div class="tot" id="fTot">${totHtml(t)}</div></div>
    <label class="fld">Texte libre sur le document (facultatif)<textarea class="fin" id="fNotes" rows="2">${esc(p.notes||"")}</textarea></label>
    <div id="fConfirm"></div>
    <div class="row-btns"><button type="button" class="btn btn-danger" data-f="del" style="margin-right:auto">Supprimer le brouillon</button><button type="button" class="btn btn-ghost" data-act="close">Fermer</button><button type="button" class="btn btn-ghost" data-f="preview">Aperçu</button><button type="button" class="btn btn-navy" data-f="save">Enregistrer</button><button type="button" class="btn btn-accent" data-f="askfin">Finaliser</button></div></div>`);
}
function addCourseSel(p){ const deja=new Set(p.lignes.map(l=>l.course_id).filter(Boolean)); const cn=norm(clientById(p.client_id)?.nom);
  const L=aFact().filter(c=>!deja.has(c.id)).sort((a,b)=>(norm(b.donneur)===cn)-(norm(a.donneur)===cn) || (a.enlDate||"").localeCompare(b.enlDate||""));
  return L.length ? `<select class="fin" id="fAddCourse" style="width:auto;max-width:320px" aria-label="Ajouter un transport terminé"><option value="">+ Ajouter un transport terminé…</option>${L.map(c=>`<option value="${esc(c.id)}">${esc(c.donneur||"")} · ${esc(c.enlVille||"?")} → ${esc(c.livVille||"?")} · ${d2(c.enlDate)}${c.prix?" · "+money(c.prix):""}</option>`).join("")}</select>` : ""; }
const totHtml = t => `<span>Total HT</span><span>${money(t.ht)}</span><span>TVA</span><span>${money(t.tva)}</span><b class="big">Total TTC</b><b class="big">${money(t.ttc)}</b>`;
function readDraft(){ const p=F.draft; if(!p) return; const c=$("#fClient"); if(c) p.client_id=c.value||null; const e=$("#fEch"); if(e) p.date_echeance=e.value||null; const n=$("#fNotes"); if(n) p.notes=n.value.trim()||null; }
async function saveDraft(silent){
  readDraft(); const p=F.draft; const t=totals(p.lignes);
  const lignes=p.lignes.map(l=>Object.assign({},l,{designation:String(l.designation||"").trim(),qte:Number(l.qte)||0,pu:Number(l.pu)||0,tva:Number(l.tva)||0}));
  const {error}=await sb.from("pieces").update({client_id:p.client_id,date_echeance:p.date_echeance,notes:p.notes,lignes,total_ht:t.ht,total_tva:t.tva,total_ttc:t.ttc}).eq("id",p.id);
  if(error){ toast(fErr(error)); return false; }
  p.lignes=lignes; const i=F.pieces.findIndex(x=>x.id===p.id); if(i>=0) F.pieces[i]=JSON.parse(JSON.stringify(Object.assign({},p,{total_ht:t.ht,total_tva:t.tva,total_ttc:t.ttc})));
  if(!silent) toast("Brouillon enregistré"); render(); return true;
}
function newPiece(type, base){
  return sb.from("pieces").insert(Object.assign({entreprise_id:EID(),type,lignes:[]},base||{})).select().single();
}

/* ---------- CARNET D'ADRESSES ---------- */
const CF = [["nom","Nom / raison sociale","text"],["adresse","Adresse","text"],["cp","Code postal","text"],["ville","Ville","text"],["siren","SIREN (9 chiffres)","text"],["tva_intra","N° TVA intracommunautaire","text"],["contact","Contact","text"],["email","E-mail de facturation","email"],["tel","Téléphone","tel"],["delai_paiement","Délai de paiement (jours)","number"]];
T.views.clients = () => {
  if(!F.ready) return off();
  const manque=[...new Set(S.courses.map(c=>(c.donneur||"").trim()).filter(Boolean))].filter(n=>!clientByName(n)).sort((a,b)=>a.localeCompare(b));
  return `<div class="bar"><h1>Carnet d'adresses</h1><button type="button" class="btn btn-accent" data-f="cnew">+ Nouveau client</button></div>
  ${manque.length?`<div class="banner" style="justify-content:flex-start"><span><b>Donneurs d'ordre sans fiche :</b></span>${manque.slice(0,12).map(n=>`<button type="button" class="btn btn-ghost btn-sm" data-f="cnew" data-nom="${esc(n)}">+ ${esc(n)}</button>`).join("")}</div>`:""}
  <div class="pan"><div class="tbl-wrap"><table><thead><tr><th>Client</th><th>Ville</th><th>SIREN</th><th>Contact</th><th>Délai de paiement</th><th>Factures</th></tr></thead><tbody>
  ${F.clients.length?F.clients.map(c=>{ const n=F.pieces.filter(p=>p.client_id===c.id&&p.type==="facture").length; const incomplet=!c.adresse||!c.siren;
    return `<tr class="click" tabindex="0" data-f="copen" data-id="${esc(c.id)}"><td><b>${esc(c.nom)}</b>${c.sous_traitant?` <span class="chip st-planifiee">Sous-traitant</span>`:""}${c.actif===false?` <span class="muted">(archivé)</span>`:""}${incomplet?`<div style="color:var(--danger);font-size:12px">Fiche à compléter (adresse, SIREN)</div>`:""}</td><td>${esc([c.cp,c.ville].filter(Boolean).join(" "))}</td><td class="num">${esc(c.siren||"")}</td><td>${esc(c.contact||"")}${c.email?`<div class="muted">${esc(c.email)}</div>`:""}</td><td>${c.delai_paiement!=null?esc(c.delai_paiement)+" jours":`<span class="muted">Par défaut</span>`}</td><td class="num">${n}</td></tr>`; }).join("")
   :`<tr><td colspan="6"><div class="empty">Aucun client. Ajoutez vos donneurs d'ordre pour pouvoir les facturer.</div></td></tr>`}</tbody></table></div></div>`;
};
function clientForm(c){
  F.clientId=c.id||null; const used=c.id && F.pieces.some(p=>p.client_id===c.id);
  openModal(`<div data-lock="keep" style="display:flex;flex-direction:column;gap:14px"><h2>${c.id?esc(c.nom):"Nouveau client"}</h2>
    <form id="cliForm" style="display:flex;flex-direction:column;gap:14px"><div class="fgrid">${CF.map(([k,l,t])=>`<label class="fld">${l}<input class="fin" type="${t}" id="cl_${k}" value="${esc(c[k]??"")}" ${k==="nom"?"required":""} ${t==="number"?'min="0" max="90"':""}></label>`).join("")}</div>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" id="cl_st" ${c.sous_traitant?"checked":""} style="width:18px;height:18px">Sous-traitant (transporteur à qui je confie des transports)</label>
    <label class="fld">Notes internes<textarea class="fin" id="cl_notes" rows="2">${esc(c.notes||"")}</textarea></label>
    <div class="row-btns">${c.id?`<button type="button" class="btn btn-danger" data-f="${used?"carch":"cdel"}" style="margin-right:auto">${used?(c.actif===false?"Réactiver":"Archiver"):"Supprimer"}</button>`:""}<button type="button" class="btn btn-ghost" data-act="close">Annuler</button><button type="submit" class="btn btn-accent">Enregistrer</button></div></form></div>`);
}
async function saveClient(){
  const o={}; CF.forEach(([k,,t])=>{ const v=$("#cl_"+k).value.trim(); o[k]= v==="" ? null : (t==="number"?Number(v):v); }); o.notes=$("#cl_notes").value.trim()||null; o.sous_traitant=$("#cl_st").checked;
  if(!o.nom){ toast("Indiquez le nom du client."); return; }
  if(o.siren){ o.siren=o.siren.replace(/\s/g,""); if(!/^\d{9}$/.test(o.siren)){ toast("Le SIREN comporte 9 chiffres (les 9 premiers du SIRET)."); return; } }
  const dup=clientByName(o.nom); if(dup && dup.id!==F.clientId){ toast("Un client porte déjà ce nom."); return; }
  const r = F.clientId ? await sb.from("clients").update(o).eq("id",F.clientId) : await sb.from("clients").insert(Object.assign({entreprise_id:EID()},o));
  if(r.error){ toast(fErr(r.error)); return; }
  closeModal(); toast("Client enregistré"); reload();
}

/* ---------- PARAMÈTRES ---------- */
const SO = [["nom","Raison sociale"],["forme","Forme juridique (SAS, SARL…)"],["capital","Capital social (ex. 10 000 €)"],["adresse","Adresse du siège"],["cp","Code postal"],["ville","Ville"],["siret","SIRET"],["rcs","RCS (ex. Pontoise 123 456 789)"],["tva_intra","N° TVA intracommunautaire"],["tel","Téléphone"],["email","E-mail"],["iban","IBAN (affiché sur les factures)"],["bic","BIC"]];
T.views.reglages = () => {
  if(!F.ready) return off();
  const so=F.param.societe, fa=F.param.facturation; const an=Number(todayIso().slice(0,4));
  const next = t => { const c=F.compteurs.find(x=>x.type===t&&x.annee===an); const pre=(fa["prefixe_"+t]||"").trim()||{facture:"F",avoir:"A",devis:"D"}[t]; return {n:(c?c.dernier:0)+1, txt:`${pre}-${an}-${String((c?c.dernier:0)+1).padStart(4,"0")}`}; };
  const inp=(pre,k,l,v,type)=>`<label class="fld">${l}<input class="fin" type="${type||"text"}" id="${pre}_${k}" value="${esc(v??"")}"></label>`;
  return `<div class="bar"><h1>Paramètres</h1></div>
  <div class="pan"><h2>Société</h2><span class="muted" style="font-size:13px">Ces informations sont imprimées sur vos devis, factures et avoirs. Le nom et le SIRET sont obligatoires pour finaliser une facture.</span>
    <div class="logo-box" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:10px 0"><div style="width:200px;height:80px;border:1px dashed var(--line,#999);border-radius:8px;display:flex;align-items:center;justify-content:center;background:#fff;overflow:hidden">${so.logo?`<img src="${esc(so.logo)}" alt="Logo" style="max-width:100%;max-height:100%;object-fit:contain">`:`<span class="muted" style="font-size:12px">Aucun logo</span>`}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><label class="btn btn-ghost" style="cursor:pointer">${so.logo?"Changer le logo":"Choisir un logo"}<input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp" hidden></label>${so.logo?`<button type="button" class="btn btn-ghost" data-f="logodel">Retirer le logo</button>`:""}</div>
      <span class="muted" style="font-size:12px;flex-basis:100%">Affiché en haut à gauche de vos devis, factures et avoirs. Enregistré dès que vous le choisissez.</span></div>
    <div class="fgrid">${SO.map(([k,l])=>inp("so",k,l,so[k])).join("")}</div><div class="row-btns"><button type="button" class="btn btn-accent" data-f="psave">Enregistrer la société</button></div></div>
  <div class="pan"><h2>Configuration de la facturation</h2>
    <div class="fgrid">${inp("fa","tva","Taux de TVA par défaut (%)",fa.tva??20,"number")}${inp("fa","delai_paiement","Délai de paiement par défaut (jours)",fa.delai_paiement??30,"number")}${inp("fa","prefixe_facture","Préfixe des factures",fa.prefixe_facture||"F")}${inp("fa","prefixe_avoir","Préfixe des avoirs",fa.prefixe_avoir||"A")}${inp("fa","prefixe_devis","Préfixe des devis",fa.prefixe_devis||"D")}${inp("fa","penalites","Pénalités de retard (texte)",fa.penalites||"au taux de trois fois le taux d'intérêt légal")}</div>
    <label class="fld">Pied de page libre (facultatif)<input class="fin" id="fa_pied" value="${esc(fa.pied||"")}"></label>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" id="fa_tva_debits" ${fa.tva_debits?"checked":""} style="width:18px;height:18px">Afficher « TVA acquittée sur les débits »</label>
    <div class="row-btns"><button type="button" class="btn btn-accent" data-f="psave">Enregistrer la facturation</button></div></div>
  <div class="pan"><h2>Catalogue de produits</h2><span class="muted" style="font-size:13px">Vos prestations habituelles (attente, immobilisation, mise à disposition, surcharge carburant…). Elles s'ajoutent en un clic dans un devis ou une facture, avec leur prix et leur TVA.</span>
    <div class="tbl-wrap"><table class="lines"><thead><tr><th style="min-width:220px">Nom du produit</th><th style="width:130px">Prix unitaire HT</th><th style="width:90px">TVA %</th><th style="width:150px">Code comptable</th><th></th></tr></thead><tbody id="prBody">${prodRows()}</tbody></table></div>
    <div class="row-btns"><button type="button" class="btn btn-ghost" data-f="pradd" style="margin-right:auto">+ Ajouter un produit</button><button type="button" class="btn btn-accent" data-f="prsave">Enregistrer le catalogue</button></div></div>
  <div class="pan"><h2>Numérotation</h2><span class="muted" style="font-size:13px">Les numéros se suivent sans trou, par type et par année. Si vous facturiez déjà avec un autre outil cette année, indiquez ici le prochain numéro pour continuer votre suite. Un numéro ne peut jamais revenir en arrière.</span>
    <div class="tbl-wrap"><table><thead><tr><th>Type</th><th>Prochain numéro</th><th>Reprendre à partir du n°</th><th></th></tr></thead><tbody>${["facture","avoir","devis"].map(t=>`<tr><td>${LAB[t].pl}</td><td><b>${esc(next(t).txt)}</b></td><td><input class="fin num" type="number" min="${next(t).n+1}" id="cp_${t}" style="max-width:140px" aria-label="Prochain numéro pour ${LAB[t].pl}"></td><td><button type="button" class="btn btn-ghost btn-sm" data-f="compteur" data-type="${t}">Appliquer</button></td></tr>`).join("")}</tbody></table></div></div>`;
};
function prodRows(){ if(!F.prods) F.prods=JSON.parse(JSON.stringify(F.param.facturation.produits||[]));
  return F.prods.length ? F.prods.map((x,i)=>`<tr><td><input class="fin" data-pr="nom" data-i="${i}" value="${esc(x.nom||"")}" aria-label="Nom du produit"></td><td><input class="fin num" type="number" step="0.01" data-pr="prix" data-i="${i}" value="${esc(x.prix??"")}" aria-label="Prix unitaire hors taxes"></td><td><input class="fin num" type="number" step="0.1" min="0" data-pr="tva" data-i="${i}" value="${esc(x.tva??"")}" placeholder="${tvaDef()}" aria-label="Taux de TVA"></td><td><input class="fin" data-pr="code" data-i="${i}" value="${esc(x.code||"")}" aria-label="Code comptable"></td><td><button type="button" class="linkbtn" data-f="prdel" data-i="${i}">Retirer</button></td></tr>`).join("")
    : `<tr><td colspan="5"><div class="empty">Aucun produit pour l'instant.</div></td></tr>`; }
async function saveProds(){ const L=(F.prods||[]).map(x=>({nom:String(x.nom||"").trim(),prix:x.prix===""||x.prix==null?null:Number(x.prix),tva:x.tva===""||x.tva==null?null:Number(x.tva),code:String(x.code||"").trim()||null})).filter(x=>x.nom);
  const {error}=await sb.from("parametres").upsert({entreprise_id:EID(),societe:F.param.societe,facturation:Object.assign({},F.param.facturation,{produits:L})},{onConflict:"entreprise_id"});
  if(error){ toast(fErr(error)); return; } F.prods=null; toast("Catalogue enregistré"); reload(); }
async function saveLogo(url){
  const societe=Object.assign({},F.param.societe); if(url) societe.logo=url; else delete societe.logo;
  const {error}=await sb.from("parametres").upsert({entreprise_id:EID(),societe,facturation:F.param.facturation},{onConflict:"entreprise_id"});
  if(error){ toast(fErr(error)); return; } toast(url?"Logo enregistré":"Logo retiré"); reload(); }
function logoReduit(file){ return new Promise((ok,ko)=>{ const r=new FileReader(); r.onerror=()=>ko(); r.onload=()=>{ const im=new Image(); im.onerror=()=>ko(); im.onload=()=>{
  const k=Math.min(1,700/im.width), w=Math.round(im.width*k), h=Math.round(im.height*k); const c=document.createElement("canvas"); c.width=w; c.height=h; const x=c.getContext("2d");
  const png=file.type==="image/png"||file.type==="image/webp"; if(!png){ x.fillStyle="#fff"; x.fillRect(0,0,w,h); } x.drawImage(im,0,h?0:0,w,h);
  ok(png?c.toDataURL("image/png"):c.toDataURL("image/jpeg",.88)); }; im.src=r.result; }; r.readAsDataURL(file); }); }
async function saveParam(){
  const societe={}; SO.forEach(([k])=>{ const v=$("#so_"+k).value.trim(); if(v) societe[k]=v; }); if(F.param.societe.logo) societe.logo=F.param.societe.logo;
  const fa={}; ["tva","delai_paiement","prefixe_facture","prefixe_avoir","prefixe_devis","penalites","pied"].forEach(k=>{ const v=$("#fa_"+k).value.trim(); if(v!=="") fa[k]=v; }); fa.tva_debits=$("#fa_tva_debits").checked; fa.produits=F.param.facturation.produits||[];
  if(fa.tva!==undefined && !(Number(fa.tva)>=0 && Number(fa.tva)<=100)){ toast("Le taux de TVA doit être compris entre 0 et 100."); return; }
  if(fa.delai_paiement!==undefined && !(Number(fa.delai_paiement)>=0 && Number(fa.delai_paiement)<=90)){ toast("Le délai de paiement doit être compris entre 0 et 90 jours."); return; }
  const {error}=await sb.from("parametres").upsert({entreprise_id:EID(),societe,facturation:fa},{onConflict:"entreprise_id"});
  if(error){ toast(fErr(error)); return; }
  toast("Paramètres enregistrés"); reload();
}

/* ---------- actions ---------- */
document.addEventListener("click", e=>{
  const a = e.target.closest && e.target.closest("a[data-grp]"); if(!a) return;
  const g = a.dataset.grp, GR = { veh:["parametres","echvehicules","echchauffeurs"], fact:["factures","afacturer","relances","avoirs"] }[g];
  T.navGrp = T.navGrp || {}; const dans = GR.includes(S.view), ouvert = T.navGrp[g]!==undefined ? T.navGrp[g] : dans;
  if(ouvert){ e.preventDefault(); T.navGrp[g]=false; render(); }
  else { T.navGrp[g]=true; if(dans){ e.preventDefault(); render(); } }
});
document.addEventListener("click", async e=>{
  const el=e.target.closest("[data-f]"); if(!el) return; const d=el.dataset, a=d.f;
  const cur=()=>F.pieces.find(x=>x.id===F.openId);
  if(a==="filtre"){ F.filtre[d.type]=d.v; render(); }
  else if(a==="open"){ openPiece(d.id); }
  else if(a==="openfact"){ closeModal(); await load(); location.hash="factures"; render(); openPiece(d.id); }
  else if(a==="factcourse"){ const c=S.courses.find(x=>x.id===d.id); if(!c) return; el.disabled=true; closeModal(); await factureTransports([c],(c.donneur||"").trim()); }
  else if(a==="mkfact"){ mkFacture(el); }
  else if(a==="new"){ const r=await newPiece(d.type); if(r.error){ toast(fErr(r.error)); return; } await load(); render(); openPiece(r.data.id); }
  else if(a==="addline"){ readDraft(); F.draft.lignes.push({designation:"",qte:1,pu:0,tva:tvaDef()}); drawEditor(); const all=document.querySelectorAll('[data-fl="designation"]'); all[all.length-1]?.focus(); }
  else if(a==="delline"){ readDraft(); F.draft.lignes.splice(Number(d.i),1); drawEditor(); }
  else if(a==="save"){ saveDraft(); }
  else if(a==="preview"){ readDraft(); const z=$("#fConfirm"); z.innerHTML = z.dataset.on==="pv" ? "" : paper(F.draft); z.dataset.on = z.innerHTML?"pv":""; if(z.innerHTML) z.scrollIntoView({block:"nearest"}); }
  else if(a==="askfin"){ readDraft(); const p=F.draft;
    if(!p.client_id){ toast(ERR.client_manquant); return; }
    if(!p.lignes.length || p.lignes.some(l=>!String(l.designation||"").trim())){ toast(ERR.lignes_manquantes); return; }
    const z=$("#fConfirm"); z.dataset.on="fin"; z.innerHTML=`<div class="banner" style="flex-direction:column;align-items:stretch"><b>Finaliser ${p.type==="devis"?"ce devis":p.type==="avoir"?"cet avoir":"cette facture"} ?</b><span>${p.type==="devis"?"Le devis reçoit son numéro et ne pourra plus être modifié.":"La pièce reçoit son numéro définitif, à la date d'aujourd'hui. Elle ne pourra plus être modifiée ni supprimée : pour la corriger, il faudra un avoir."}</span><div class="row-btns"><button type="button" class="btn btn-ghost" data-f="nofin">Pas maintenant</button><button type="button" class="btn btn-accent" data-f="dofin">Oui, finaliser</button></div></div>`; z.scrollIntoView({block:"nearest"}); }
  else if(a==="nofin"){ const z=$("#fConfirm"); z.innerHTML=""; z.dataset.on=""; }
  else if(a==="dofin"){ el.disabled=true; if(!(await saveDraft(true))){ el.disabled=false; return; }
    const id=F.draft.id; const {data,error}=await sb.rpc("finaliser_piece",{p_id:id}); if(error){ toast(fErr(error)); el.disabled=false; return; }
    toast(`Finalisée sous le numéro ${data}`); await T.loadData(); openPiece(id); }
  else if(a==="del"){ if(!el.dataset.ok){ el.dataset.ok="1"; el.textContent="Confirmer la suppression"; return; }
    const {error}=await sb.from("pieces").delete().eq("id",F.draft.id); if(error){ toast(fErr(error)); return; } closeModal(); toast("Brouillon supprimé"); reload(); }
  else if(a==="print"){ const p=cur(); if(!p) return; let z=$("#printzone"); if(!z){ z=document.createElement("div"); z.id="printzone"; document.body.appendChild(z); } z.innerHTML=paper(p); window.print(); }
  else if(a==="paid"||a==="unpaid"){ const p=cur(); const patch = a==="paid" ? {statut:"payee",paye_le:$("#fPaye").value||todayIso()} : {statut:"finalisee",paye_le:null};
    const {error}=await sb.from("pieces").update(patch).eq("id",p.id); if(error){ toast(fErr(error)); return; } toast(a==="paid"?"Facture marquée comme payée":"Paiement annulé"); await reload(); openPiece(p.id); }
  else if(a==="dstat"){ const p=cur(); const {error}=await sb.from("pieces").update({statut:d.v}).eq("id",p.id); if(error){ toast(fErr(error)); return; } await reload(); openPiece(p.id); }
  else if(a==="avoir"){ const p=cur(); const lignes=(p.lignes||[]).map(l=>({designation:l.designation,qte:-Math.abs(Number(l.qte)||0),pu:Number(l.pu)||0,tva:Number(l.tva)||0}));
    const t=totals(lignes); const r=await newPiece("avoir",{client_id:p.client_id,origine_id:p.id,lignes,total_ht:t.ht,total_tva:t.tva,total_ttc:t.ttc,notes:`Avoir sur la facture ${p.numero}`}); if(r.error){ toast(fErr(r.error)); return; }
    await load(); location.hash="avoirs"; render(); openPiece(r.data.id); toast("Avoir créé en brouillon : vérifiez les lignes puis finalisez."); }
  else if(a==="tofact"){ const p=cur(); const lignes=(p.lignes||[]).map(l=>({designation:l.designation,qte:Number(l.qte)||0,pu:Number(l.pu)||0,tva:Number(l.tva)||0})); const t=totals(lignes);
    const r=await newPiece("facture",{client_id:p.client_id,lignes,total_ht:t.ht,total_tva:t.tva,total_ttc:t.ttc,notes:`Selon devis ${p.numero}`}); if(r.error){ toast(fErr(r.error)); return; }
    await load(); location.hash="factures"; render(); openPiece(r.data.id); }
  else if(a==="relance"){ openRelance(d.client); }
  else if(a==="stconfier"){ const c=S.courses.find(x=>x.id===d.id); const v=$("#stPick").value; if(!c) return; if(!v){ toast("Choisissez un sous-traitant dans la liste."); return; } el.disabled=true; closeModal(); if(await confier(c,v)) openOrdre(c.id); }
  else if(a==="streprendre"){ if(!el.dataset.ok){ el.dataset.ok="1"; el.textContent="Confirmer : reprendre la course"; return; } const c0=S.courses.find(x=>x.id===d.id); const old=c0&&c0.sousTraitantId; const patch={sous_traitant_id:null,ordre_envoye_le:null,statut:"a_planifier"}; if(old && Array.isArray(c0.couts)) patch.couts=c0.couts.filter(l=>l.st!==old); const {error}=await sb.from("courses").update(patch).eq("id",d.id); if(error){ toast(fErr(error)); return; } closeModal(); toast("Course reprise : elle est de nouveau à planifier"); T.loadData(); }
  else if(a==="ordre"){ closeModal(); openOrdre(d.id); }
  else if(a==="oprint"){ const c=S.courses.find(x=>x.id===F.ordre.id); const st=clientById(c.sousTraitantId); let z=$("#printzone"); if(!z){ z=document.createElement("div"); z.id="printzone"; document.body.appendChild(z); } z.innerHTML=ordrePaper(c,st,$("#oPrix").value.trim()); window.print(); }
  else if(a==="ocopy"){ const t=$("#oObj").value+"\n\n"+$("#oTxt").value; try{ await navigator.clipboard.writeText(t); toast("Message copié"); }catch(err){ $("#oTxt").select(); toast("Copie impossible ici : le message est sélectionné, faites Ctrl+C."); } }
  else if(a==="omail"){ const to=$("#oMail").value.trim(); if(!to){ toast("Indiquez l'e-mail du sous-traitant."); $("#oMail").focus(); return; } location.href="mailto:"+encodeURIComponent(to)+"?subject="+encodeURIComponent($("#oObj").value)+"&body="+encodeURIComponent($("#oTxt").value); }
  else if(a==="owa"){ window.open("https://wa.me/"+d.tel+"?text="+encodeURIComponent($("#oObj").value+"\n\n"+$("#oTxt").value),"_blank","noopener"); }
  else if(a==="osave"){ el.disabled=true; if(!(await ordreEnregistrer(true))){ el.disabled=false; return; } closeModal(); toast("Ordre de transport enregistré comme envoyé"); T.loadData(); }
  else if(a==="kmsave"){ const c=S.courses.find(x=>x.id===d.id); if(!c) return; const v=$("#kmIn").value.trim(); const km=v===""?null:Number(v.replace(",",".")); if(km!=null && !(km>=0 && km<10000)){ toast("Indiquez une distance en kilomètres."); return; }
    const {error}=await sb.from("courses").update({km,km_cle:km==null?null:"manuel:"+kmCle(c)}).eq("id",c.id); if(error){ toast(fErr(error)); return; } c.km=km; c.kmCle=km==null?null:"manuel:"+kmCle(c); KM.ko.delete(c.id+kmCle(c)); toast(km==null?"Distance effacée : elle sera recalculée automatiquement":"Distance enregistrée"); }
  else if(a==="kmcalc"){ const c=S.courses.find(x=>x.id===d.id); if(!c) return; if(!kmPret(c)){ toast("Renseignez d'abord les villes d'enlèvement et de livraison, puis enregistrez."); return; } el.disabled=true; el.textContent="Calcul…";
    let km=null; try{ km=await calcKm(c); }catch(e){} el.disabled=false; el.textContent="Recalculer";
    if(km==null){ toast("Distance introuvable : vérifiez les adresses, ou saisissez-la à la main."); return; }
    const {error}=await sb.from("courses").update({km,km_cle:kmCle(c)}).eq("id",c.id); if(error){ toast(fErr(error)); return; } c.km=km; c.kmCle=kmCle(c); const i=$("#kmIn"); if(i) i.value=km; toast("Distance calculée : "+kmTxt(km)); }
  else if(a==="ctadd"){ CT.lignes.push({type:CT_TYPES[0],texte:"",montant:"",st:""}); $("#ctBox").innerHTML=coutInner(); const all=document.querySelectorAll('[data-ct="type"]'); all[all.length-1]?.focus(); }
  else if(a==="ctdel"){ CT.lignes.splice(Number(d.i),1); $("#ctBox").innerHTML=coutInner(); }
  else if(a==="ctsave"){ const c=S.courses.find(x=>x.id===CT.id); if(!c) return;
    if(CT.lignes.some(l=>String(l.montant).trim()!=="" && !(Number(l.montant)>=0))){ toast("Un montant n'est pas valide."); return; }
    el.disabled=true;
    for(const l of CT.lignes){ if(l.stnom===undefined) continue; const nom=String(l.stnom||"").trim(); if(!nom){ l.st=""; delete l.stnom; continue; }
      let x=clientByName(nom);
      if(!x){ const r=await sb.from("clients").insert({entreprise_id:EID(),nom,sous_traitant:true}).select().single(); if(r.error){ toast(fErr(r.error)); el.disabled=false; return; } x=r.data; F.clients.push(x); }
      else if(!x.sous_traitant){ const r=await sb.from("clients").update({sous_traitant:true}).eq("id",x.id); if(r.error){ toast(fErr(r.error)); el.disabled=false; return; } x.sous_traitant=true; }
      l.st=x.id; delete l.stnom; }
    const L=CT.lignes.map(l=>({libelle:l.type==="Autre"?(String(l.texte||"").trim()||"Autre"):l.type,montant:r2(Number(l.montant)||0),st:l.st||null})).filter(l=>l.montant>0 || l.st);
    const {error}=await sb.from("courses").update({couts:L}).eq("id",c.id); el.disabled=false; if(error){ toast(fErr(error)); return; }
    c.couts=L; CT.lignes=L.map(l=>({ type:CT_TYPES.includes(l.libelle)?l.libelle:"Autre", texte:CT_TYPES.includes(l.libelle)?"":l.libelle, montant:l.montant, st:l.st||"" })); $("#ctBox").innerHTML=coutInner(); toast("Coûts d'achat enregistrés"); }
  else if(a==="actmode"){ A.mode=d.v; render(); }
  else if(a==="actnav"){ if(d.v==="0") A.ref=todayIso(); else actDecale(Number(d.v)); render(); }
  else if(a==="actpick"){ A.cond=d.id; render(); window.scrollTo(0,0); }
  else if(a==="actprint"){ let z=$("#printzone"); if(!z){ z=document.createElement("div"); z.id="printzone"; document.body.appendChild(z); } const k=S.conducteurs.find(c=>c.id===A.cond);
    z.innerHTML=`<div class="paper"><h3>Activité — ${esc(k?k.nom:"tous les chauffeurs")}</h3><div>${esc(actPeriode().txt)} · ${esc(S.entreprise?.nom||"")}</div>${$("#actBody").innerHTML}</div>`; window.print(); }
  else if(a==="rcopy"){ const t=$("#rObj").value+"\n\n"+$("#rTxt").value; try{ await navigator.clipboard.writeText(t); toast("Message copié"); }catch(err){ $("#rTxt").select(); toast("Copie impossible ici : le message est sélectionné, faites Ctrl+C."); } }
  else if(a==="rmail"){ const to=$("#rMail").value.trim(); if(!to){ toast("Indiquez l'e-mail du client."); $("#rMail").focus(); return; }
    location.href="mailto:"+encodeURIComponent(to)+"?subject="+encodeURIComponent($("#rObj").value)+"&body="+encodeURIComponent($("#rTxt").value); }
  else if(a==="rsave"){ const g=retardsParClient().find(x=>x.id===F.relance.id); if(!g) return; el.disabled=true; const niv=Number($("#rNiv").value)||1;
    const res=await Promise.all(g.fact.map(p=>sb.from("pieces").update({relances:rels(p).concat([{le:todayIso(),niveau:niv}])}).eq("id",p.id)));
    const bad=res.find(r=>r.error); if(bad){ toast(fErr(bad.error)); el.disabled=false; return; }
    const mail=$("#rMail").value.trim(); const cl=clientById(g.id); if(mail && cl && !cl.email) await sb.from("clients").update({email:mail}).eq("id",cl.id);
    closeModal(); toast(`Relance enregistrée sur ${g.fact.length} facture${g.fact.length>1?"s":""}`); reload(); }
  else if(a==="cnew"){ clientForm({nom:d.nom||"",sous_traitant:d.st==="1"}); }
  else if(a==="stmode"){ B.mode=d.v; render(); }
  else if(a==="stnav"){ if(d.v==="0") B.ref=todayIso(); else actDecale(Number(d.v),B); render(); }
  else if(a==="stpick"){ B.st=d.id; render(); window.scrollTo(0,0); }
  else if(a==="stprint"){ let z=$("#printzone"); if(!z){ z=document.createElement("div"); z.id="printzone"; document.body.appendChild(z); } const k=clientById(B.st);
    z.innerHTML=`<div class="paper"><h3>Sous-traitance — ${esc(k?k.nom:"tous les sous-traitants")}</h3><div>${esc(actPeriode(B).txt)} · ${esc(S.entreprise?.nom||"")}</div>${$("#stBody").innerHTML}</div>`; window.print(); }
  else if(a==="copen"){ const c=clientById(d.id); if(c) clientForm(c); }
  else if(a==="cdel"){ if(!el.dataset.ok){ el.dataset.ok="1"; el.textContent="Confirmer la suppression"; return; } const {error}=await sb.from("clients").delete().eq("id",F.clientId); if(error){ toast(fErr(error)); return; } closeModal(); toast("Client supprimé"); reload(); }
  else if(a==="carch"){ const c=clientById(F.clientId); const {error}=await sb.from("clients").update({actif:c.actif===false}).eq("id",c.id); if(error){ toast(fErr(error)); return; } closeModal(); toast(c.actif===false?"Client réactivé":"Client archivé"); reload(); }
  else if(a==="psave"){ saveParam(); }
  else if(a==="logodel"){ saveLogo(""); }
  else if(a==="pradd"){ F.prods.push({nom:"",prix:"",tva:"",code:""}); $("#prBody").innerHTML=prodRows(); const all=document.querySelectorAll('[data-pr="nom"]'); all[all.length-1]?.focus(); }
  else if(a==="prdel"){ F.prods.splice(Number(d.i),1); $("#prBody").innerHTML=prodRows(); }
  else if(a==="prsave"){ saveProds(); }
  else if(a==="compteur"){ const v=Number($("#cp_"+d.type).value); if(!v){ toast("Indiquez le prochain numéro."); return; } const {error}=await sb.rpc("regler_compteur",{p_type:d.type,p_prochain:v}); if(error){ toast(fErr(error)); return; } toast("Numérotation mise à jour"); reload(); }
});
document.addEventListener("input", e=>{
  const ct=e.target.dataset||{}; if(ct.ct && CT.lignes[Number(ct.i)]){ CT.lignes[Number(ct.i)][ct.ct]=e.target.value; const t=$("#ctTot"); if(t) t.innerHTML=coutTot(); return; }
  if(e.target.id==="f_prix"){ const t=$("#ctTot"); if(t) t.innerHTML=coutTot(); }
  const el=e.target; if(el.dataset && el.dataset.pr && F.prods && F.prods[Number(el.dataset.i)]){ F.prods[Number(el.dataset.i)][el.dataset.pr]=el.value; return; } if(!el.dataset || !el.dataset.fl || !F.draft) return;
  const l=F.draft.lignes[Number(el.dataset.i)]; if(!l) return;
  l[el.dataset.fl] = el.dataset.fl==="designation" ? el.value : (el.value===""?"":Number(el.value));
  const c=$("#fLt"+el.dataset.i); if(c) c.textContent=money(r2((Number(l.qte)||0)*(Number(l.pu)||0)));
  const t=$("#fTot"); if(t) t.innerHTML=totHtml(totals(F.draft.lignes));
});
document.addEventListener("change", async e=>{
  const de=e.target.dataset||{};
  if(e.target.id==="logoFile"){ const f=e.target.files&&e.target.files[0]; if(!f) return; if(f.size>8*1024*1024){ toast("Image trop lourde (8 Mo maximum)."); return; }
    try{ const u=await logoReduit(f); if(u.length>600000){ toast("Logo trop détaillé : utilisez une image plus simple."); return; } await saveLogo(u); }catch(_){ toast("Image illisible."); } return; }
  if(de.ct==="type" || de.ct==="st"){ const l=CT.lignes[Number(de.i)]; if(!l) return; if(de.ct==="type") l.type=e.target.value; else if(e.target.value==="__new"){ l.st=""; l.stnom=""; } else l.st=e.target.value;
    $("#ctBox").innerHTML=coutInner(); if(l.stnom!==undefined) document.querySelector(`[data-ct="stnom"][data-i="${de.i}"]`)?.focus(); return; }
  if(e.target.id==="stSel"){ B.st=e.target.value; render(); return; }
  if(e.target.id==="oPrix" && F.ordre){ const c=S.courses.find(x=>x.id===F.ordre.id); const st=c&&clientById(c.sousTraitantId); if(st){ const m=ordreMsg(c,st,e.target.value.trim()); $("#oTxt").value=m.corps; } return; }
  if(de.ech){ const liste=S[de.ech]; const o=liste&&liste.find(x=>x.id===de.id); if(!o) return;
    if(e.target.validity&&e.target.validity.badInput) return; // saisie au clavier en cours : on attend la date complète
    if(e.target.value && !echOk(e.target.value)) return;      // année en cours de frappe (0002, 0020…) : rien n'est enregistré
    const ech=Object.assign({},o.echeances||{}); if(e.target.value) ech[de.k]=e.target.value; else delete ech[de.k];
    const {error}=await sb.from(de.ech).update({echeances:ech}).eq("id",o.id);
    if(error){ toast(/echeances/.test(error.message||"")?"Les échéances ne sont pas encore activées sur cette base.":fErr(error)); e.target.value=(o.echeances||{})[de.k]||""; return; }
    o.echeances=ech; const id=e.target.id; toast("Date enregistrée"); render(); const again=document.getElementById(id); again&&again.focus(); return; }
  if(e.target.id==="actCond"){ A.cond=e.target.value; render(); return; }
  if(e.target.id==="fAddProd" && F.draft && e.target.value!==""){ const pr=(F.param.facturation.produits||[])[Number(e.target.value)]; if(!pr) return; readDraft();
    const vide=F.draft.lignes.length===1 && !String(F.draft.lignes[0].designation||"").trim() && !Number(F.draft.lignes[0].pu); if(vide) F.draft.lignes=[];
    F.draft.lignes.push({designation:pr.nom,qte:1,pu:Number(pr.prix)||0,tva:pr.tva===""||pr.tva==null?tvaDef():Number(pr.tva)}); drawEditor(); return; }
  if(e.target.id==="rNiv" && F.relance){ const g=retardsParClient().find(x=>x.id===F.relance.id); if(g){ const m=relanceMsg(g,Number(e.target.value)); $("#rObj").value=m.objet; $("#rTxt").value=m.corps; } return; }
  if(e.target.id!=="fAddCourse" || !F.draft || !e.target.value) return;
  const c=S.courses.find(x=>x.id===e.target.value); if(!c) return;
  readDraft(); const vide=F.draft.lignes.length===1 && !String(F.draft.lignes[0].designation||"").trim() && !Number(F.draft.lignes[0].pu);
  if(vide) F.draft.lignes=[]; F.draft.lignes.push(ligneTransport(c));
  if(!F.draft.client_id){ const cl=clientByName(c.donneur); if(cl) F.draft.client_id=cl.id; }
  drawEditor();
});
document.addEventListener("submit", e=>{ if(e.target.id==="cliForm"){ e.preventDefault(); saveClient(); } });
document.addEventListener("keydown", e=>{ if(e.key==="Enter" && e.target.matches && e.target.matches("tr[data-f]")) e.target.click(); });
T.fx = { ready:()=>F.ready, clients:()=>F.clients, clientById, clientByName, newPiece, totals, tvaDef, fErr, openPiece, load };
window.addEventListener("afterprint", ()=>{ const z=$("#printzone"); if(z) z.innerHTML=""; });
})();
