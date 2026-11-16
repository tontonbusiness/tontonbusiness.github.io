/* Mobilog — litiges (réclamations clients, avec pièces jointes, suivi et avoir) — Tonton Business */
(function(){
"use strict";
const T = window.TP; if(!T) return;
const { S, sb, $, esc, toast, openModal, closeModal, render, EID, frDate, todayIso } = T;
const L = T.L = { ready:false, err:"", list:[], filtre:"actifs", q:"", draft:null, orig:null, up:false };

/* ---------- aides ---------- */
const money = n => (Number(n)||0).toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})+" €";
const d2 = s => s ? frDate(String(s).slice(0,10),{day:"2-digit",month:"2-digit",year:"numeric"}) : "";
const dh = t => t ? new Date(t).toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"}) : "";
const TYPES = { abime:"Marchandise abîmée", manquant:"Marchandise manquante", retard:"Retard de livraison", refuse:"Livraison refusée", adresse:"Erreur d'adresse", facturation:"Litige de facturation", autre:"Autre" };
const STAT = { ouvert:["Ouvert","st-envoyee"], en_cours:["En cours de traitement","st-en_cours"], resolu:["Résolu","st-terminee"], rejete:["Rejeté","st-annulee"] };
const IMP = { a_determiner:"À déterminer", nous:"À notre charge", chauffeur:"Chauffeur", sous_traitant:"Sous-traitant", client:"Client (réclamation non fondée)", tiers:"Tiers / autre transporteur" };
const actif = l => l.statut==="ouvert" || l.statut==="en_cours";
const enRetard = l => actif(l) && !!l.echeance && l.echeance < todayIso();
const clients = () => (T.fx && T.fx.ready()) ? T.fx.clients() : [];
const norm = s => String(s||"").trim().toLowerCase().replace(/\s+/g," ");
const courseDe = l => l.course_id ? S.courses.find(c=>c.id===l.course_id) : null;
const trajet = c => c ? `${c.enlVille||"?"} → ${c.livVille||"?"}` : "";
const uuid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,ch=>{ const r=Math.random()*16|0; return (ch==="x"?r:(r&3|8)).toString(16); });
const lErr = e => { const m=(e&&e.message)||""; if(/litiges/.test(m) && /(does not exist|schema cache|relation)/i.test(m)) return "La rubrique Litiges n'est pas encore activée sur cette base."; return T.errMsg(e); };
const off = () => `<div class="bar"><h1>Litiges</h1></div><div class="pan"><b>La rubrique Litiges n'est pas encore activée sur cette base.</b><span class="muted">${esc(L.err||"La mise à jour de la base de données n'a pas encore été appliquée.")}</span></div>`;

/* ---------- chargement ---------- */
async function load(){
  const {data,error}=await sb.from("litiges").select("*").eq("entreprise_id",EID()).order("created_at",{ascending:false}).limit(1000);
  if(error){ L.ready=false; L.err=""; L.list=[]; return; }
  L.ready=true; L.list=data||[];
}
T.onData.push(load);
async function reload(){ await load(); render(); }

/* compteur du menu : litiges à traiter, en rouge s'il y en a en retard de réponse */
T.litigesN = () => { if(!L.ready) return ""; const n=L.list.filter(actif).length; if(!n) return ""; const hot=L.list.some(enRetard);
  return `<span class="cnt ${hot?"hot":""}">${n}</span>`; };

/* ---------- page « Litiges » ---------- */
T.views.litiges = () => {
  if(!L.ready) return off();
  const act=L.list.filter(actif), ret=act.filter(enRetard);
  const reclame=act.reduce((s,l)=>s+(Number(l.montant)||0),0);
  const accorde=L.list.filter(l=>l.statut==="resolu").reduce((s,l)=>s+(Number(l.montant_accorde)||0),0);
  const f=L.filtre, q=norm(L.q);
  const rows=L.list.filter(l=> f==="tous" ? true : f==="actifs" ? actif(l) : l.statut===f).filter(l=>{ if(!q) return true; const c=courseDe(l);
    return norm([l.client_nom,l.description,l.decision,TYPES[l.type],c&&c.ref,c&&trajet(c)].join(" ")).includes(q); });
  const sts=[["actifs","À traiter"],["resolu","Résolus"],["rejete","Rejetés"],["tous","Tous"]];
  return `<div class="bar"><h1>Litiges</h1><button type="button" class="btn btn-accent" data-l="new">+ Nouveau litige</button></div>
  <div class="kpis"><div class="kpi ${act.length?"warn":""}"><small>Litiges à traiter</small><b class="num">${act.length}</b></div>
    <div class="kpi ${ret.length?"bad":""}"><small>Réponse en retard</small><b class="num">${ret.length}</b></div>
    <div class="kpi"><small>Montant réclamé en cours</small><b class="num">${money(reclame)}</b></div>
    <div class="kpi"><small>Accordé aux clients (résolus)</small><b class="num">${money(accorde)}</b></div></div>
  <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
    <div class="seg" role="group" aria-label="Filtre" style="flex-wrap:wrap">${sts.map(([k,l])=>`<button type="button" class="${f===k?"on":""}" data-l="filtre" data-v="${k}">${l}</button>`).join("")}</div>
    <input class="fin" id="lQ" type="search" placeholder="Rechercher : client, trajet, référence…" value="${esc(L.q)}" style="max-width:340px" aria-label="Rechercher un litige"></div>
  <div class="pan">${rows.length?`<div class="tbl-wrap"><table><thead><tr><th>Date des faits</th><th>Client</th><th>Transport</th><th>Type</th><th style="text-align:right">Réclamé HT</th><th>Réponse avant le</th><th>Statut</th></tr></thead><tbody>${rows.map(l=>{ const c=courseDe(l); const st=STAT[l.statut]||[l.statut,""];
      return `<tr class="click" tabindex="0" data-l="open" data-id="${esc(l.id)}"><td class="num">${d2(l.date_faits)}</td><td><b>${esc(l.client_nom||(c&&c.donneur)||"—")}</b></td>
      <td>${c?`${esc(trajet(c))}${c.ref?`<div class="muted">Réf. ${esc(c.ref)}</div>`:""}`:`<span class="muted">—</span>`}</td><td>${esc(TYPES[l.type]||l.type)}</td>
      <td class="num" style="text-align:right">${l.montant!=null&&l.montant!==""?money(l.montant):"—"}</td>
      <td class="num">${l.echeance?(enRetard(l)?`<span class="chip late">${d2(l.echeance)}</span>`:d2(l.echeance)):"—"}</td><td><span class="chip ${st[1]}">${esc(st[0])}</span></td></tr>`; }).join("")}</tbody></table></div>`
    :`<div class="empty">${L.list.length?"Aucun litige ne correspond à ce filtre.":"Aucun litige pour le moment. Quand un client conteste un transport (marchandise abîmée, retard, refus…), ouvrez un litige pour garder les preuves et suivre la réponse."}</div>`}</div>`;
};
T.after.litiges = () => { const q=$("#lQ"); if(!q) return;
  q.addEventListener("input",()=>{ L.q=q.value; const pos=q.selectionStart; render(); const n=$("#lQ"); if(n){ n.focus(); try{ n.setSelectionRange(pos,pos); }catch(e){} } }); };

/* ---------- bloc sur la fiche d'un transport ---------- */
T.litigeBloc = c => { if(!L.ready || c.statut==="annulee") return "";
  const mine=L.list.filter(l=>l.course_id===c.id);
  return `<div class="banner" style="justify-content:flex-start"><span><b>Litiges :</b> ${mine.length?mine.map(l=>`<button type="button" class="linkbtn" data-l="open" data-id="${esc(l.id)}">${esc(TYPES[l.type]||"Litige")} (${esc((STAT[l.statut]||[l.statut])[0].toLowerCase())})</button>`).join(" · "):"aucun"}</span>
    <button type="button" class="btn btn-ghost btn-sm" data-l="new" data-course="${esc(c.id)}">Ouvrir un litige</button></div>`; };

/* ---------- fiche d'un litige ---------- */
function blank(preset){ return Object.assign({ id:uuid(), isNew:true, course_id:null, client_id:null, client_nom:"", conducteur_id:null, sous_traitant_id:null, type:"abime", statut:"ouvert",
  imputation:"a_determiner", date_faits:todayIso(), echeance:"", montant:"", montant_accorde:"", description:"", decision:"", pieces:[], historique:[], avoir_id:null }, preset||{}); }
function fromCourse(D, c){ if(!c) return; D.course_id=c.id; if(!D.client_nom) D.client_nom=c.donneur||""; if(c.enlDate && D.isNew) D.date_faits=c.livDate||c.enlDate;
  if(!D.conducteur_id) D.conducteur_id=c.conducteurId||null; if(!D.sous_traitant_id) D.sous_traitant_id=c.sousTraitantId||null; }
function openLitige(id, preset){
  const src = id ? L.list.find(x=>x.id===id) : null; if(id && !src) return;
  L.draft = src ? Object.assign({}, src, { isNew:false, pieces:(src.pieces||[]).slice(), historique:(src.historique||[]).slice(),
      montant: src.montant??"", montant_accorde: src.montant_accorde??"", echeance: src.echeance||"", description: src.description||"", decision: src.decision||"", client_nom: src.client_nom||"" })
    : blank(preset);
  if(!src && preset && preset.course_id) fromCourse(L.draft, S.courses.find(x=>x.id===preset.course_id));
  L.orig = { statut:L.draft.statut, montant_accorde:String(L.draft.montant_accorde), decision:L.draft.decision };
  drawLitige();
}
const opt = (v,label,cur) => `<option value="${esc(v)}" ${String(cur??"")===String(v)?"selected":""}>${esc(label)}</option>`;
function courseOptions(D){
  const list=S.courses.filter(c=>c.statut!=="annulee").slice().sort((a,b)=>String(b.enlDate||"").localeCompare(String(a.enlDate||""))).slice(0,400);
  if(D.course_id && !list.some(c=>c.id===D.course_id)){ const c=S.courses.find(x=>x.id===D.course_id); if(c) list.unshift(c); }
  return opt("","— Aucun transport lié —",D.course_id||"")+list.map(c=>opt(c.id,`${d2(c.enlDate)} · ${c.donneur||"?"} · ${trajet(c)}${c.ref?" · "+c.ref:""}`,D.course_id)).join("");
}
const piecesHtml = D => D.pieces.length ? `<ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px">${D.pieces.map((p,i)=>`<li><button type="button" class="linkbtn" data-doc="${esc(p.path)}">${esc(p.nom||"Pièce jointe")}</button> <span class="muted">${esc(dh(p.le))}</span> <button type="button" class="linkbtn" style="color:var(--danger)" data-l="pdel" data-i="${i}" aria-label="Retirer cette pièce">Retirer</button></li>`).join("")}</ul>` : `<span class="muted">Aucune pièce jointe pour l'instant. Ajoutez les photos de la marchandise, le bon de livraison, le courrier ou le mail du client.</span>`;
const histoHtml = D => D.historique.length ? `<ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px">${D.historique.slice().reverse().map(h=>`<li><span class="muted">${esc(dh(h.le))}${h.par?" · "+esc(h.par):""}</span><br>${esc(h.texte)}</li>`).join("")}</ul>` : `<span class="muted">Pas encore d'historique.</span>`;
function drawLitige(){
  const D=L.draft; const cons=S.conducteurs.slice().sort((a,b)=>String(a.nom).localeCompare(String(b.nom)));
  const sts=clients().filter(c=>c.sous_traitant).sort((a,b)=>String(a.nom).localeCompare(String(b.nom)));
  const peutAvoir = !D.isNew && D.statut==="resolu" && !D.avoir_id && Number(D.montant_accorde)>0 && D.imputation!=="client" && T.fx && T.fx.ready();
  openModal(`<div data-lock="keep" style="display:flex;flex-direction:column;gap:14px"><h2>${D.isNew?"Nouveau litige":"Litige · "+esc(D.client_nom||"client")}</h2>
  <div class="fgrid">
    <label class="fld wide">Transport concerné<select class="fin" id="lt_course">${courseOptions(D)}</select></label>
    <label class="fld">Client qui réclame<input class="fin" id="lt_client" list="lt_clients" value="${esc(D.client_nom)}" autocomplete="off" required><datalist id="lt_clients">${clients().map(c=>`<option value="${esc(c.nom)}">`).join("")}</datalist></label>
    <label class="fld">Type de litige<select class="fin" id="lt_type">${Object.keys(TYPES).map(k=>opt(k,TYPES[k],D.type)).join("")}</select></label>
    <label class="fld">Date des faits<input class="fin" type="date" id="lt_date" value="${esc(D.date_faits)}"></label>
    <label class="fld">Montant réclamé (€ HT)<input class="fin num" type="number" min="0" step="0.01" id="lt_montant" value="${esc(D.montant)}"></label>
    <label class="fld">Répondre au client avant le<input class="fin" type="date" id="lt_echeance" value="${esc(D.echeance)}"></label></div>
  <label class="fld">Ce qui s'est passé<textarea class="fin" id="lt_desc" rows="3" placeholder="Ex. : 2 palettes reçues avec des cartons écrasés, signalé par le client le jour de la livraison.">${esc(D.description)}</textarea></label>
  <div class="pan"><h2>Pièces jointes</h2><div id="ltPieces">${piecesHtml(D)}</div>
    <label class="btn btn-ghost" style="position:relative;align-self:flex-start"><span id="ltUpLbl">Ajouter des photos ou des documents</span><input type="file" accept="image/*,application/pdf" multiple class="hidden-file" id="lFile"></label></div>
  <div class="pan"><h2>Suivi et décision</h2><div class="fgrid">
    <label class="fld">Statut<select class="fin" id="lt_statut">${Object.keys(STAT).map(k=>opt(k,STAT[k][0],D.statut)).join("")}</select></label>
    <label class="fld">Responsabilité<select class="fin" id="lt_imp">${Object.keys(IMP).map(k=>opt(k,IMP[k],D.imputation)).join("")}</select></label>
    <label class="fld">Chauffeur concerné<select class="fin" id="lt_cond">${opt("","—",D.conducteur_id||"")}${cons.map(c=>opt(c.id,c.nom,D.conducteur_id)).join("")}</select></label>
    <label class="fld">Sous-traitant concerné<select class="fin" id="lt_st">${opt("","—",D.sous_traitant_id||"")}${sts.map(c=>opt(c.id,c.nom,D.sous_traitant_id)).join("")}</select></label>
    <label class="fld">Montant accordé au client (€ HT)<input class="fin num" type="number" min="0" step="0.01" id="lt_accorde" value="${esc(D.montant_accorde)}"></label></div>
    <label class="fld">Réponse ou décision<textarea class="fin" id="lt_decision" rows="2" placeholder="Ex. : geste commercial de 150 € accordé, avoir à émettre.">${esc(D.decision)}</textarea></label>
    ${D.avoir_id?`<div class="banner"><span><b>Un avoir a été créé pour ce litige.</b> Retrouvez-le dans Facturation → Avoirs.</span></div>`:""}
    ${peutAvoir?`<div class="banner"><span>Litige résolu avec ${money(D.montant_accorde)} accordés : vous pouvez en faire un avoir.</span><button type="button" class="btn btn-navy btn-sm" data-l="avoir">Créer l'avoir au client</button></div>`:""}</div>
  ${D.isNew?"":`<div class="pan"><h2>Historique</h2><div style="display:flex;gap:8px;flex-wrap:wrap"><input class="fin" id="lNote" placeholder="Ajouter une note (appel du client, réponse envoyée…)" style="flex:1;min-width:200px"><button type="button" class="btn btn-ghost" data-l="note">Ajouter</button></div><div id="ltHisto">${histoHtml(D)}</div></div>`}
  <div class="row-btns">${D.isNew?"":`<button type="button" class="btn btn-danger" data-l="del" style="margin-right:auto">Supprimer</button>`}<button type="button" class="btn btn-ghost" data-act="close">Fermer</button><button type="button" class="btn btn-accent" data-l="save">Enregistrer</button></div></div>`);
}
function readForm(){ const D=L.draft; if(!D || !$("#lt_client")) return D;
  D.course_id=$("#lt_course").value||null; D.client_nom=$("#lt_client").value.trim(); D.type=$("#lt_type").value; D.date_faits=$("#lt_date").value; D.montant=$("#lt_montant").value; D.echeance=$("#lt_echeance").value;
  D.description=$("#lt_desc").value.trim(); D.statut=$("#lt_statut").value; D.imputation=$("#lt_imp").value; D.conducteur_id=$("#lt_cond").value||null; D.sous_traitant_id=$("#lt_st").value||null;
  D.montant_accorde=$("#lt_accorde").value; D.decision=$("#lt_decision").value.trim(); return D; }
const num = v => (v===""||v==null) ? null : Number(String(v).replace(",","."));
const note = (D,texte) => D.historique.push({ le:new Date().toISOString(), texte, par:(S.session&&S.session.user&&S.session.user.email)||"" });
async function enregistrer(silencieux){
  const D=readForm(); if(!D) return false;
  if(!D.client_nom){ toast("Indiquez le client qui réclame."); $("#lt_client")&&$("#lt_client").focus(); return false; }
  if(!D.date_faits){ toast("Indiquez la date des faits."); return false; }
  const m=num(D.montant), a=num(D.montant_accorde);
  if((m!=null && !(m>=0)) || (a!=null && !(a>=0))){ toast("Un montant n'est pas valide."); return false; }
  if(D.isNew) note(D,"Litige ouvert : "+TYPES[D.type].toLowerCase()+(m?" · "+money(m)+" réclamés":""));
  else { if(D.statut!==L.orig.statut) note(D,`Statut : ${STAT[L.orig.statut][0]} → ${STAT[D.statut][0]}`);
    if(String(D.montant_accorde)!==L.orig.montant_accorde && a!=null) note(D,`Montant accordé : ${money(a)}`);
    if(D.decision && D.decision!==L.orig.decision) note(D,"Décision : "+D.decision.slice(0,200)); }
  const cl=clients().find(c=>norm(c.nom)===norm(D.client_nom));
  const row={ course_id:D.course_id, client_id:cl?cl.id:null, client_nom:D.client_nom, conducteur_id:D.conducteur_id, sous_traitant_id:D.sous_traitant_id, type:D.type, statut:D.statut, imputation:D.imputation,
    date_faits:D.date_faits, echeance:D.echeance||null, montant:m, montant_accorde:a, description:D.description||null, decision:D.decision||null, pieces:D.pieces, historique:D.historique };
  const r = D.isNew ? await sb.from("litiges").insert(Object.assign({id:D.id,entreprise_id:EID()},row)) : await sb.from("litiges").update(row).eq("id",D.id);
  if(r.error){ toast(lErr(r.error)); return false; }
  D.isNew=false; L.orig={ statut:D.statut, montant_accorde:String(D.montant_accorde), decision:D.decision };
  await load(); if(!silencieux){ closeModal(); toast("Litige enregistré"); render(); } return true;
}

/* ---------- pièces jointes ---------- */
const MAXP = 12;
function reduire(file){ return new Promise(res=>{
  if(!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size<900*1024){ res(file); return; }
  const url=URL.createObjectURL(file); const img=new Image();
  img.onload=()=>{ try{ const k=Math.min(1,1800/Math.max(img.width,img.height)); const cv=document.createElement("canvas"); cv.width=Math.round(img.width*k); cv.height=Math.round(img.height*k);
      cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height); URL.revokeObjectURL(url);
      cv.toBlob(b=>res(b&&b.size<file.size?b:file),"image/jpeg",.82); }catch(e){ URL.revokeObjectURL(url); res(file); } };
  img.onerror=()=>{ URL.revokeObjectURL(url); res(file); }; img.src=url; }); }
async function ajouterPieces(files){
  const D=L.draft; if(!D || L.up) return; readForm(); L.up=true; const lbl=$("#ltUpLbl"); let ok=0;
  for(const f of files){
    if(D.pieces.length>=MAXP){ toast(`${MAXP} pièces au maximum par litige.`); break; }
    if(f.size>9*1024*1024){ toast(`« ${f.name} » dépasse 9 Mo.`); continue; }
    if(lbl) lbl.textContent="Envoi en cours…";
    const blob=await reduire(f); const jpg = blob!==f; const nom=(jpg?f.name.replace(/\.[^.]+$/,"")+".jpg":f.name);
    const path=`${EID()}/litiges/${D.id}/${Date.now()}-${nom.replace(/[^\w.\-]+/g,"_").slice(-80)}`;
    const up=await sb.storage.from("documents").upload(path,blob,{contentType:jpg?"image/jpeg":(f.type||"application/octet-stream"),upsert:false});
    if(up.error){ toast("Envoi impossible : "+T.errMsg(up.error)); continue; }
    D.pieces.push({ path, nom:nom.slice(0,120), le:new Date().toISOString() }); ok++;
  }
  L.up=false; if(lbl) lbl.textContent="Ajouter des photos ou des documents";
  const z=$("#ltPieces"); if(z) z.innerHTML=piecesHtml(D);
  if(ok && !D.isNew){ const r=await sb.from("litiges").update({pieces:D.pieces}).eq("id",D.id); if(r.error) toast(lErr(r.error)); else { const l=L.list.find(x=>x.id===D.id); if(l) l.pieces=D.pieces.slice(); } }
  if(ok) toast(ok>1?`${ok} pièces ajoutées`:"Pièce ajoutée");
}

/* ---------- avoir au client ---------- */
async function creerAvoir(){
  const D=readForm(); const fx=T.fx; if(!D||!fx||!fx.ready()){ toast("La facturation n'est pas activée sur cette base."); return; }
  const cl = D.client_nom ? fx.clientByName(D.client_nom) : null;
  if(!cl){ toast("Ce client n'est pas dans le Carnet d'adresses : ajoutez-le avec le même nom, puis recommencez."); return; }
  const m=num(D.montant_accorde); if(!(m>0)){ toast("Indiquez le montant accordé au client."); return; }
  if(!(await enregistrer(true))) return;
  const c=courseDe(D);
  const lignes=[{ designation:`Avoir — ${TYPES[D.type].toLowerCase()}`+(c?` — transport ${trajet(c)} du ${d2(c.enlDate)}${c.ref?" — Réf. "+c.ref:""}`:""), qte:-1, pu:m, tva:fx.tvaDef() }];
  const t=fx.totals(lignes);
  const r=await fx.newPiece("avoir",{client_id:cl.id,lignes,total_ht:t.ht,total_tva:t.tva,total_ttc:t.ttc,notes:`Litige du ${d2(D.date_faits)}`});
  if(r.error){ toast(fx.fErr(r.error)); return; }
  const u=await sb.from("litiges").update({avoir_id:r.data.id,historique:D.historique.concat([{le:new Date().toISOString(),texte:"Avoir créé en brouillon : "+money(m)+" HT",par:(S.session&&S.session.user&&S.session.user.email)||""}])}).eq("id",D.id);
  if(u.error) toast(lErr(u.error));
  closeModal(); await fx.load(); await load(); location.hash="avoirs"; render(); fx.openPiece(r.data.id); toast("Avoir créé en brouillon : vérifiez les lignes puis finalisez.");
}

/* ---------- actions ---------- */
document.addEventListener("click", async e=>{
  const el=e.target.closest("[data-l]"); if(!el) return; const a=el.dataset.l;
  if(a==="new"){ closeModal(); openLitige(null, el.dataset.course?{course_id:el.dataset.course}:null); }
  else if(a==="open"){ closeModal(); openLitige(el.dataset.id); }
  else if(a==="filtre"){ L.filtre=el.dataset.v; render(); }
  else if(a==="save"){ el.disabled=true; if(!(await enregistrer(false))) el.disabled=false; }
  else if(a==="pdel"){ const D=L.draft; if(!D) return; readForm(); D.pieces.splice(Number(el.dataset.i),1); const z=$("#ltPieces"); if(z) z.innerHTML=piecesHtml(D);
    if(!D.isNew){ const r=await sb.from("litiges").update({pieces:D.pieces}).eq("id",D.id); if(r.error) toast(lErr(r.error)); else { const l=L.list.find(x=>x.id===D.id); if(l) l.pieces=D.pieces.slice(); } } }
  else if(a==="note"){ const D=L.draft; const i=$("#lNote"); if(!D||!i) return; const t=i.value.trim(); if(!t){ i.focus(); return; }
    readForm(); note(D,t); const r=await sb.from("litiges").update({historique:D.historique}).eq("id",D.id); if(r.error){ D.historique.pop(); toast(lErr(r.error)); return; }
    const l=L.list.find(x=>x.id===D.id); if(l) l.historique=D.historique.slice(); i.value=""; $("#ltHisto").innerHTML=histoHtml(D); toast("Note ajoutée"); }
  else if(a==="avoir"){ el.disabled=true; await creerAvoir(); el.disabled=false; }
  else if(a==="del"){ if(!el.dataset.ok){ el.dataset.ok="1"; el.textContent="Confirmer la suppression"; return; }
    const {error}=await sb.from("litiges").delete().eq("id",L.draft.id); if(error){ toast(lErr(error)); return; } closeModal(); toast("Litige supprimé"); reload(); }
});
document.addEventListener("change", e=>{
  if(e.target.id==="lFile"){ const fs=[...(e.target.files||[])]; e.target.value=""; if(fs.length) ajouterPieces(fs); return; }
  if(e.target.id==="lt_course" && L.draft){ const D=readForm(); const c=S.courses.find(x=>x.id===e.target.value); if(c){ D.client_nom=c.donneur||D.client_nom; D.conducteur_id=c.conducteurId||D.conducteur_id; D.sous_traitant_id=c.sousTraitantId||D.sous_traitant_id;
      if(D.isNew && (c.livDate||c.enlDate)) D.date_faits=c.livDate||c.enlDate; drawLitige(); } }
});
document.addEventListener("keydown", e=>{ if(e.key==="Enter" && e.target.matches && e.target.matches("tr[data-l]")) e.target.click(); });
})();
