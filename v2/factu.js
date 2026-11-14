/* Tonton Planning — facturation de ventes, devis, carnet d'adresses, paramètres — Tonton Business */
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
function chip(p){ const m={ brouillon:["Brouillon","st-a_planifier"], finalisee:[p.type==="avoir"?"Émis":"À encaisser","st-envoyee"], payee:["Payée","st-terminee"], envoye:["Envoyé","st-envoyee"], accepte:["Accepté","st-terminee"], refuse:["Refusé","st-annulee"] }[p.statut]||[p.statut,""];
  return enRetard(p) ? `<span class="chip late">En retard</span>` : `<span class="chip ${m[1]}">${m[0]}</span>`; }
const numero = p => p.numero || "Brouillon";
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
  const cnt = st => S.courses.filter(c=>c.statut===st).length;
  const L = (v,label,extra) => `<a href="#${v}" class="${S.view===v?"on":""}">${label}${extra||""}</a>`;
  const sub = (st,label,n,hot) => `<a href="#courses" class="sub" data-fst="${st}">${label}<span class="cnt ${hot&&n?"hot":""}">${n}</span></a>`;
  const subv = (v,label,n,hot) => `<a href="#${v}" class="sub" ${S.view===v?'style="color:var(--side-fg);font-weight:700"':""}>${label}${n===undefined?"":`<span class="cnt ${hot&&n?"hot":""}">${n}</span>`}</a>`;
  const nb = (t,st) => F.pieces.filter(p=>p.type===t && (!st||p.statut===st)).length;
  return `<span class="grp">EXPLOITATION</span>`+L("planning","Planning")+L("courses","Transports")+
    sub("a_planifier","À planifier",cnt("a_planifier"),true)+sub("planifiee","Planifiés",cnt("planifiee"))+sub("envoyee","Envoyés",cnt("envoyee"))+
    sub("en_cours","En cours",cnt("en_cours"))+sub("terminee","Terminés",cnt("terminee"))+L("conducteur","Vue conducteur")+
    `<span class="grp">FACTURATION</span>`+L("devis","Devis")+L("factures","Facturation de ventes")+
    subv("afacturer","À facturer",F.ready?aFact().length:0,true)+subv("factures","Factures",nb("facture"))+subv("avoirs","Avoirs",nb("avoir"))+
    `<span class="grp">OUTILS ET GESTION</span>`+L("indicateurs","Rapports")+L("clients","Carnet d'adresses")+L("parametres","Conducteurs et véhicules")+L("reglages","Paramètres");
};

/* ---------- À FACTURER ---------- */
T.views.afacturer = () => {
  if(!F.ready) return off();
  const L=aFact(); const groups={}; L.forEach(c=>{ const k=(c.donneur||"Sans client").trim(); (groups[k]=groups[k]||[]).push(c); });
  const names=Object.keys(groups).sort((a,b)=>a.localeCompare(b));
  const tot=L.reduce((s,c)=>s+(Number(c.prix)||0),0);
  return `<div class="bar"><h1>À facturer</h1></div>
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
async function mkFacture(el){
  const ids=[...document.querySelectorAll(`[data-fsel="${el.dataset.g}"]:checked`)].map(x=>x.value);
  const cs=S.courses.filter(c=>ids.includes(c.id)).sort((a,b)=>(a.enlDate||"").localeCompare(b.enlDate||""));
  if(!cs.length){ toast("Cochez au moins un transport."); return; }
  el.disabled=true;
  let cl=clientByName(el.dataset.donneur);
  if(!cl){ const r=await sb.from("clients").insert({entreprise_id:EID(),nom:el.dataset.donneur}).select().single(); if(r.error){ toast(fErr(r.error)); el.disabled=false; return; } cl=r.data; }
  const tva=tvaDef();
  const lignes=cs.map(c=>({ designation:`Transport ${c.enlVille||"?"} → ${c.livVille||"?"} du ${d2(c.enlDate)}${c.ref?" — Réf. "+c.ref:""}`, qte:1, pu:Number(c.prix)||0, tva, course_id:c.id }));
  const t=totals(lignes);
  const r=await sb.from("pieces").insert({entreprise_id:EID(),type:"facture",client_id:cl.id,lignes,total_ht:t.ht,total_tva:t.tva,total_ttc:t.ttc}).select().single();
  if(r.error){ toast(fErr(r.error)); el.disabled=false; return; }
  await load(); location.hash="factures"; render(); openPiece(r.data.id);
}

/* ---------- LISTES : factures, avoirs, devis ---------- */
function listView(type){
  if(!F.ready) return off();
  const lab=LAB[type]; const all=F.pieces.filter(p=>p.type===type); const f=F.filtre[type];
  const sts = type==="facture" ? [["tous","Toutes"],["brouillon","Brouillons"],["finalisee","À encaisser"],["retard","En retard"],["payee","Payées"]]
            : type==="devis" ? [["tous","Tous"],["brouillon","Brouillons"],["envoye","Envoyés"],["accepte","Acceptés"],["refuse","Refusés"]] : [["tous","Tous"],["brouillon","Brouillons"],["finalisee","Émis"]];
  const L=all.filter(p=> f==="tous" ? true : f==="retard" ? enRetard(p) : p.statut===f);
  const sum=(arr,k)=>arr.reduce((s,p)=>s+Number(p[k]||0),0);
  const mois=todayIso().slice(0,7);
  const kpis = type==="facture" ? `<div class="kpis">
      <a class="kpi" href="#afacturer" style="text-decoration:none;color:inherit"><small>À facturer</small><b class="num">${aFact().length}</b></a>
      <div class="kpi"><small>Brouillons</small><b class="num">${all.filter(p=>p.statut==="brouillon").length}</b></div>
      <div class="kpi"><small>À encaisser (TTC)</small><b class="num">${money(sum(all.filter(p=>p.statut==="finalisee"),"total_ttc"))}</b></div>
      <div class="kpi ${all.some(enRetard)?"bad":""}"><small>En retard (TTC)</small><b class="num">${money(sum(all.filter(enRetard),"total_ttc"))}</b></div>
      <div class="kpi"><small>Encaissé ce mois (TTC)</small><b class="num">${money(sum(all.filter(p=>p.statut==="payee"&&String(p.paye_le||"").slice(0,7)===mois),"total_ttc"))}</b></div></div>` : "";
  return `<div class="bar"><h1>${lab.pl}</h1>${type==="facture"?`<a class="btn btn-ghost" href="#afacturer">Facturer des transports</a>`:""}${lab.neuf?`<button type="button" class="btn btn-accent" data-f="new" data-type="${type}">+ ${lab.neuf}</button>`:""}</div>
  ${kpis}
  <div class="seg" role="group" aria-label="Filtre" style="align-self:flex-start;flex-wrap:wrap">${sts.map(([k,l])=>`<button type="button" class="${f===k?"on":""}" data-f="filtre" data-type="${type}" data-v="${k}">${l}</button>`).join("")}</div>
  <div class="pan"><div class="tbl-wrap"><table><thead><tr><th>Numéro</th><th>Client</th><th>Date</th>${type==="avoir"?"<th>Facture d'origine</th>":`<th>${type==="devis"?"Valable jusqu'au":"Échéance"}</th>`}<th style="text-align:right">Total HT</th><th style="text-align:right">Total TTC</th><th>Statut</th></tr></thead><tbody>
  ${L.length?L.map(p=>{ const cn=(p.client&&p.client.nom)||clientById(p.client_id)?.nom||"—"; const t=p.statut==="brouillon"?totals(p.lignes):{ht:p.total_ht,ttc:p.total_ttc};
    return `<tr class="click" tabindex="0" data-f="open" data-id="${esc(p.id)}"><td><b>${esc(numero(p))}</b></td><td>${esc(cn)}</td><td class="num">${d2(p.date_emission||p.created_at)}</td>
    <td class="num">${type==="avoir"?esc(F.pieces.find(x=>x.id===p.origine_id)?.numero||"—"):d2(p.date_echeance)}</td><td class="num" style="text-align:right">${money(t.ht)}</td><td class="num" style="text-align:right">${money(t.ttc)}</td><td>${chip(p)}</td></tr>`; }).join("")
   :`<tr><td colspan="7"><div class="empty">${all.length?"Aucune pièce pour ce filtre.":type==="avoir"?"Aucun avoir. Un avoir se crée depuis une facture finalisée, pour l'annuler ou la corriger.":type==="facture"?"Aucune facture pour l'instant. Commencez par « Facturer des transports ».":"Aucun devis pour l'instant."}</div></td></tr>`}
  </tbody></table></div></div>`;
}
T.views.factures = () => listView("facture");
T.views.avoirs = () => listView("avoir");
T.views.devis = () => listView("devis");

/* ---------- le document (aperçu écran + impression) ---------- */
function paper(p){
  const fin = p.statut!=="brouillon";
  const em = fin ? (p.emetteur||{}) : F.param.societe; const me = fin ? (p.mentions||{}) : F.param.facturation;
  const cl = fin ? (p.client||{}) : (clientById(p.client_id)||{});
  const t = totals(p.lignes); if(fin){ t.ht=Number(p.total_ht); t.tva=Number(p.total_tva); t.ttc=Number(p.total_ttc); }
  const orig = p.origine_id ? F.pieces.find(x=>x.id===p.origine_id) : null;
  const li = (a,b) => b ? `<div>${a?`<small>${a} : </small>`:""}${esc(b)}</div>` : "";
  return `<div class="paper">${fin?"":`<div class="wm">BROUILLON</div>`}
    <div class="two-col"><div><b style="font-size:17px">${esc(em.nom||"Votre société")}</b>${li("",[em.forme,em.capital?"au capital de "+em.capital:""].filter(Boolean).join(" "))}${li("",em.adresse)}${li("",[em.cp,em.ville].filter(Boolean).join(" "))}${li("SIRET",em.siret)}${li("RCS",em.rcs)}${li("TVA",em.tva_intra)}${li("Tél.",em.tel)}${li("",em.email)}</div>
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
    ${p.lignes.map((l,i)=>`<tr><td><input class="fin" data-fl="designation" data-i="${i}" value="${esc(l.designation||"")}" aria-label="Désignation"></td>
      <td><input class="fin num" type="number" step="0.01" data-fl="qte" data-i="${i}" value="${esc(l.qte??"")}" aria-label="Quantité"></td>
      <td><input class="fin num" type="number" step="0.01" data-fl="pu" data-i="${i}" value="${esc(l.pu??"")}" aria-label="Prix unitaire hors taxes"></td>
      <td><input class="fin num" type="number" step="0.1" min="0" data-fl="tva" data-i="${i}" value="${esc(l.tva??"")}" aria-label="Taux de TVA"></td>
      <td class="num" style="text-align:right" id="fLt${i}">${money(r2((Number(l.qte)||0)*(Number(l.pu)||0)))}</td>
      <td><button type="button" class="linkbtn" data-f="delline" data-i="${i}">Retirer</button></td></tr>`).join("")}</tbody></table></div>
    <div class="bar"><button type="button" class="btn btn-ghost btn-sm" data-f="addline">+ Ajouter une ligne</button><span style="flex:1"></span><div class="tot" id="fTot">${totHtml(t)}</div></div>
    <label class="fld">Texte libre sur le document (facultatif)<textarea class="fin" id="fNotes" rows="2">${esc(p.notes||"")}</textarea></label>
    <div id="fConfirm"></div>
    <div class="row-btns"><button type="button" class="btn btn-danger" data-f="del" style="margin-right:auto">Supprimer le brouillon</button><button type="button" class="btn btn-ghost" data-act="close">Fermer</button><button type="button" class="btn btn-ghost" data-f="preview">Aperçu</button><button type="button" class="btn btn-navy" data-f="save">Enregistrer</button><button type="button" class="btn btn-accent" data-f="askfin">Finaliser</button></div></div>`);
}
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
    return `<tr class="click" tabindex="0" data-f="copen" data-id="${esc(c.id)}"><td><b>${esc(c.nom)}</b>${c.actif===false?` <span class="muted">(archivé)</span>`:""}${incomplet?`<div style="color:var(--danger);font-size:12px">Fiche à compléter (adresse, SIREN)</div>`:""}</td><td>${esc([c.cp,c.ville].filter(Boolean).join(" "))}</td><td class="num">${esc(c.siren||"")}</td><td>${esc(c.contact||"")}${c.email?`<div class="muted">${esc(c.email)}</div>`:""}</td><td>${c.delai_paiement!=null?esc(c.delai_paiement)+" jours":`<span class="muted">Par défaut</span>`}</td><td class="num">${n}</td></tr>`; }).join("")
   :`<tr><td colspan="6"><div class="empty">Aucun client. Ajoutez vos donneurs d'ordre pour pouvoir les facturer.</div></td></tr>`}</tbody></table></div></div>`;
};
function clientForm(c){
  F.clientId=c.id||null; const used=c.id && F.pieces.some(p=>p.client_id===c.id);
  openModal(`<div data-lock="keep" style="display:flex;flex-direction:column;gap:14px"><h2>${c.id?esc(c.nom):"Nouveau client"}</h2>
    <form id="cliForm" style="display:flex;flex-direction:column;gap:14px"><div class="fgrid">${CF.map(([k,l,t])=>`<label class="fld">${l}<input class="fin" type="${t}" id="cl_${k}" value="${esc(c[k]??"")}" ${k==="nom"?"required":""} ${t==="number"?'min="0" max="90"':""}></label>`).join("")}</div>
    <label class="fld">Notes internes<textarea class="fin" id="cl_notes" rows="2">${esc(c.notes||"")}</textarea></label>
    <div class="row-btns">${c.id?`<button type="button" class="btn btn-danger" data-f="${used?"carch":"cdel"}" style="margin-right:auto">${used?(c.actif===false?"Réactiver":"Archiver"):"Supprimer"}</button>`:""}<button type="button" class="btn btn-ghost" data-act="close">Annuler</button><button type="submit" class="btn btn-accent">Enregistrer</button></div></form></div>`);
}
async function saveClient(){
  const o={}; CF.forEach(([k,,t])=>{ const v=$("#cl_"+k).value.trim(); o[k]= v==="" ? null : (t==="number"?Number(v):v); }); o.notes=$("#cl_notes").value.trim()||null;
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
    <div class="fgrid">${SO.map(([k,l])=>inp("so",k,l,so[k])).join("")}</div><div class="row-btns"><button type="button" class="btn btn-accent" data-f="psave">Enregistrer la société</button></div></div>
  <div class="pan"><h2>Configuration de la facturation</h2>
    <div class="fgrid">${inp("fa","tva","Taux de TVA par défaut (%)",fa.tva??20,"number")}${inp("fa","delai_paiement","Délai de paiement par défaut (jours)",fa.delai_paiement??30,"number")}${inp("fa","prefixe_facture","Préfixe des factures",fa.prefixe_facture||"F")}${inp("fa","prefixe_avoir","Préfixe des avoirs",fa.prefixe_avoir||"A")}${inp("fa","prefixe_devis","Préfixe des devis",fa.prefixe_devis||"D")}${inp("fa","penalites","Pénalités de retard (texte)",fa.penalites||"au taux de trois fois le taux d'intérêt légal")}</div>
    <label class="fld">Pied de page libre (facultatif)<input class="fin" id="fa_pied" value="${esc(fa.pied||"")}"></label>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" id="fa_tva_debits" ${fa.tva_debits?"checked":""} style="width:18px;height:18px">Afficher « TVA acquittée sur les débits »</label>
    <div class="row-btns"><button type="button" class="btn btn-accent" data-f="psave">Enregistrer la facturation</button></div></div>
  <div class="pan"><h2>Numérotation</h2><span class="muted" style="font-size:13px">Les numéros se suivent sans trou, par type et par année. Si vous facturiez déjà avec un autre outil cette année, indiquez ici le prochain numéro pour continuer votre suite. Un numéro ne peut jamais revenir en arrière.</span>
    <div class="tbl-wrap"><table><thead><tr><th>Type</th><th>Prochain numéro</th><th>Reprendre à partir du n°</th><th></th></tr></thead><tbody>${["facture","avoir","devis"].map(t=>`<tr><td>${LAB[t].pl}</td><td><b>${esc(next(t).txt)}</b></td><td><input class="fin num" type="number" min="${next(t).n+1}" id="cp_${t}" style="max-width:140px" aria-label="Prochain numéro pour ${LAB[t].pl}"></td><td><button type="button" class="btn btn-ghost btn-sm" data-f="compteur" data-type="${t}">Appliquer</button></td></tr>`).join("")}</tbody></table></div></div>`;
};
async function saveParam(){
  const societe={}; SO.forEach(([k])=>{ const v=$("#so_"+k).value.trim(); if(v) societe[k]=v; });
  const fa={}; ["tva","delai_paiement","prefixe_facture","prefixe_avoir","prefixe_devis","penalites","pied"].forEach(k=>{ const v=$("#fa_"+k).value.trim(); if(v!=="") fa[k]=v; }); fa.tva_debits=$("#fa_tva_debits").checked;
  if(fa.tva!==undefined && !(Number(fa.tva)>=0 && Number(fa.tva)<=100)){ toast("Le taux de TVA doit être compris entre 0 et 100."); return; }
  if(fa.delai_paiement!==undefined && !(Number(fa.delai_paiement)>=0 && Number(fa.delai_paiement)<=90)){ toast("Le délai de paiement doit être compris entre 0 et 90 jours."); return; }
  const {error}=await sb.from("parametres").upsert({entreprise_id:EID(),societe,facturation:fa},{onConflict:"entreprise_id"});
  if(error){ toast(fErr(error)); return; }
  toast("Paramètres enregistrés"); reload();
}

/* ---------- actions ---------- */
document.addEventListener("click", async e=>{
  const el=e.target.closest("[data-f]"); if(!el) return; const d=el.dataset, a=d.f;
  const cur=()=>F.pieces.find(x=>x.id===F.openId);
  if(a==="filtre"){ F.filtre[d.type]=d.v; render(); }
  else if(a==="open"){ openPiece(d.id); }
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
  else if(a==="cnew"){ clientForm({nom:d.nom||""}); }
  else if(a==="copen"){ const c=clientById(d.id); if(c) clientForm(c); }
  else if(a==="cdel"){ if(!el.dataset.ok){ el.dataset.ok="1"; el.textContent="Confirmer la suppression"; return; } const {error}=await sb.from("clients").delete().eq("id",F.clientId); if(error){ toast(fErr(error)); return; } closeModal(); toast("Client supprimé"); reload(); }
  else if(a==="carch"){ const c=clientById(F.clientId); const {error}=await sb.from("clients").update({actif:c.actif===false}).eq("id",c.id); if(error){ toast(fErr(error)); return; } closeModal(); toast(c.actif===false?"Client réactivé":"Client archivé"); reload(); }
  else if(a==="psave"){ saveParam(); }
  else if(a==="compteur"){ const v=Number($("#cp_"+d.type).value); if(!v){ toast("Indiquez le prochain numéro."); return; } const {error}=await sb.rpc("regler_compteur",{p_type:d.type,p_prochain:v}); if(error){ toast(fErr(error)); return; } toast("Numérotation mise à jour"); reload(); }
});
document.addEventListener("input", e=>{
  const el=e.target; if(!el.dataset || !el.dataset.fl || !F.draft) return;
  const l=F.draft.lignes[Number(el.dataset.i)]; if(!l) return;
  l[el.dataset.fl] = el.dataset.fl==="designation" ? el.value : (el.value===""?"":Number(el.value));
  const c=$("#fLt"+el.dataset.i); if(c) c.textContent=money(r2((Number(l.qte)||0)*(Number(l.pu)||0)));
  const t=$("#fTot"); if(t) t.innerHTML=totHtml(totals(F.draft.lignes));
});
document.addEventListener("submit", e=>{ if(e.target.id==="cliForm"){ e.preventDefault(); saveClient(); } });
document.addEventListener("keydown", e=>{ if(e.key==="Enter" && e.target.matches && e.target.matches("tr[data-f]")) e.target.click(); });
window.addEventListener("afterprint", ()=>{ const z=$("#printzone"); if(z) z.innerHTML=""; });
})();
