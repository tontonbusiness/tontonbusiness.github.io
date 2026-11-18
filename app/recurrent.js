/* Mobilog — courses récurrentes (navettes quotidiennes créées automatiquement) et duplication de course — Tonton Business */
(function(){
"use strict";
const T = window.TP; if(!T) return;
const { S, sb, $, esc, toast, openModal, closeModal, render, EID, isStaff, todayIso, addDays } = T;
const R = T.R = { ready:false, list:[], busy:false, edit:null };

const JOURS = [[1,"Lun"],[2,"Mar"],[3,"Mer"],[4,"Jeu"],[5,"Ven"],[6,"Sam"],[7,"Dim"]];
/* champs copiés d'une course vers un modèle (camelCase côté course, snake_case côté base) */
const CHAMPS = ["donneur","ref","prix","contact","enlNom","enlAdresse","enlCp","enlVille","enlHeure","enlHeureFin","livNom","livAdresse","livCp","livVille","livHeure","livHeureFin","palettes","colis","poids","metres","marchandise","instructions"];
/* un modèle ne copie pas les quantités : elles changent chaque jour et se saisissent sur la course */
const MCH = CHAMPS.filter(k=>!["palettes","colis","poids","metres"].includes(k));
const snake = k => k.replace(/[A-Z]/g, m=>"_"+m.toLowerCase());
const camel = k => k.replace(/_([a-z])/g, (_,m)=>m.toUpperCase());
const hm = v => v ? String(v).slice(0,5) : "";
const dow = iso => { const d=new Date(iso+"T12:00:00").getDay(); return d===0?7:d; };
const jourLib = j => (JOURS.find(x=>x[0]===j)||[0,""])[1];
const jrs = a => { a=(a||[]).slice().sort((x,y)=>x-y); if(a.join()==="1,2,3,4,5") return "Lun → Ven"; return a.map(jourLib).join(" "); };
const shortDay = iso => new Date(iso+"T12:00:00").toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
const trajet = m => `${m.enl_ville||m.enl_nom||"?"} → ${m.liv_ville||m.liv_nom||"?"}`;
const money = n => (n==null||n==="")?"—":(Number(n)||0).toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})+" €";
const rErr = e => { const m=(e&&e.message)||""; if(/(courses_modeles|modele_id|modele_date)/.test(m) && /(does not exist|schema cache|relation|column)/i.test(m)) return "Les courses récurrentes ne sont pas encore activées sur cette base."; return T.errMsg(e); };

/* ---------- chargement + création automatique ---------- */
async function load(){
  const {data,error}=await sb.from("courses_modeles").select("*").eq("entreprise_id",EID()).order("nom");
  if(error){ R.ready=false; R.list=[]; return; }
  R.ready=true; R.list=data||[];
  setTimeout(generer,300);
}
T.onData.push(load);

/* Les courses du jour et du lendemain (ou du lundi suivant si demain tombe un week-end) existent dès l'ouverture de Mobilog. */
function horizon(){ let h=addDays(todayIso(),1); while(dow(h)>5) h=addDays(h,1); return h; }
async function generer(){
  if(R.busy || !R.ready || !isStaff() || !S.mem) return;
  const today=todayIso(), hor=horizon(); let rows=[]; const maj=[];
  for(const m of R.list){
    if(!m.actif) continue;
    const debut = m.genere_jusqu_au && m.genere_jusqu_au>=today ? addDays(m.genere_jusqu_au,1) : today;
    for(let d=debut; d<=hor; d=addDays(d,1)){
      if(!(m.jours||[]).includes(dow(d))) continue;
      const row={ entreprise_id:EID(), statut:"a_planifier", source:"recurrente", modele_id:m.id, modele_date:d, enl_date:d, liv_date:addDays(d,m.liv_decalage||0) };
      MCH.forEach(k=>{ const v=m[snake(k)]; row[snake(k)] = v===""?null:v; });
      rows.push(row);
    }
    if(!m.genere_jusqu_au || m.genere_jusqu_au<hor) maj.push(m.id);
  }
  if(!rows.length && !maj.length) return;
  R.busy=true;
  try{
    if(rows.length){
      const r=await sb.from("courses").upsert(rows,{onConflict:"modele_id,modele_date",ignoreDuplicates:true});
      if(r.error){ toast(rErr(r.error)); return; } }
    if(maj.length){ const u=await sb.from("courses_modeles").update({genere_jusqu_au:hor}).in("id",maj); if(u.error){ toast(rErr(u.error)); return; }
      maj.forEach(id=>{ const m=R.list.find(x=>x.id===id); if(m) m.genere_jusqu_au=hor; }); }
    if(rows.length){ toast(rows.length>1?`${rows.length} courses récurrentes créées`:"1 course récurrente créée"); await T.loadData(); }
  } finally { R.busy=false; }
}

/* ---------- bloc sur la fiche d'une course ---------- */
T.recBloc = c => {
  if(!c || !c.id || c.statut==="annulee") return "";
  const m = c.modeleId && R.list.find(x=>x.id===c.modeleId);
  return `<div class="banner" style="justify-content:flex-start;flex-wrap:wrap;gap:8px">
    <span><b>Courses répétitives :</b> ${m?`course créée par le modèle « ${esc(m.nom)} »`:"dupliquez cette course ou créez-la automatiquement chaque jour"}</span>
    <button type="button" class="btn btn-ghost btn-sm" data-r="dup" data-id="${esc(c.id)}">Dupliquer…</button>
    ${R.ready && !m?`<button type="button" class="btn btn-navy btn-sm" data-r="rec" data-id="${esc(c.id)}">Rendre récurrente</button>`:""}</div>`; };

/* ---------- duplication ---------- */
function joursProposes(){ const out=[]; let d=addDays(todayIso(),1); while(out.length<10){ if(dow(d)<=5) out.push(d); d=addDays(d,1); } return out; }
function ouvrirDup(id){
  const c=S.courses.find(x=>x.id===id); if(!c) return;
  const jours=joursProposes(); R.edit={type:"dup",id};
  openModal(`<h2>Dupliquer la course</h2>
    <p class="muted">${esc(c.donneur||"Course")} · ${esc(c.enlVille||"?")} → ${esc(c.livVille||"?")}. Le chauffeur, la référence et le suivi ne sont pas copiés : les nouvelles courses arrivent dans « À planifier ».</p>
    <div style="display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow:auto" id="recDays">
      ${jours.map((d,i)=>`<label style="display:flex;gap:10px;align-items:center"><input type="checkbox" value="${d}" ${i===0?"checked":""} style="width:20px;height:20px"> ${esc(shortDay(d))}</label>`).join("")}</div>
    <div class="row-btns"><button type="button" class="btn btn-ghost" data-act="close">Annuler</button><button type="button" class="btn btn-accent" data-r="dupgo">Dupliquer</button></div>`);
}
async function faireDup(){
  const c=S.courses.find(x=>x.id===(R.edit&&R.edit.id)); if(!c) return;
  const dates=[...document.querySelectorAll("#recDays input:checked")].map(i=>i.value);
  if(!dates.length){ toast("Cochez au moins un jour."); return; }
  const dec = c.enlDate&&c.livDate ? Math.max(0,Math.round((new Date(c.livDate+"T12:00:00")-new Date(c.enlDate+"T12:00:00"))/86400000)) : 0;
  const rows=dates.map(d=>{ const row={ entreprise_id:EID(), statut:"a_planifier", source:"duplication", enl_date:d, liv_date:addDays(d,dec) };
    CHAMPS.forEach(k=>{ if(k==="ref") return; const v=c[k]; row[snake(k)] = (v===""||v===undefined)?null:v; }); return row; });
  const r=await sb.from("courses").insert(rows);
  if(r.error){ toast(rErr(r.error)); return; }
  closeModal(); toast(rows.length>1?`${rows.length} courses créées dans « À planifier »`:"Course créée dans « À planifier »"); await T.loadData();
}

/* ---------- création d'un modèle depuis une course ---------- */
function ouvrirRec(id){
  const c=S.courses.find(x=>x.id===id); if(!c) return;
  R.edit={type:"rec",id};
  openModal(`<h2>Rendre cette course récurrente</h2>
    <p class="muted">Mobilog créera automatiquement cette course chaque jour choisi, avec les mêmes adresses, heures et prix. <b>Le chauffeur et les quantités (palettes, colis, poids) ne sont pas copiés</b> : la course arrive dans « À planifier » et vous l'affectez comme d'habitude.</p>
    <label class="fld">Nom du modèle<input id="rcNom" value="${esc((c.donneur||"Course")+" — "+(c.enlVille||"?")+" → "+(c.livVille||"?"))}"></label>
    <div><b>Jours de la semaine</b><div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px">${JOURS.map(([n,l])=>`<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" class="rcJ" value="${n}" ${n<=5?"checked":""} style="width:20px;height:20px">${l}</label>`).join("")}</div></div>
    <div class="row-btns"><button type="button" class="btn btn-ghost" data-act="close">Annuler</button><button type="button" class="btn btn-accent" data-r="recgo">Créer le modèle</button></div>`);
}
async function faireRec(){
  const c=S.courses.find(x=>x.id===(R.edit&&R.edit.id)); if(!c) return;
  const nom=$("#rcNom").value.trim(); const jours=[...document.querySelectorAll(".rcJ:checked")].map(i=>Number(i.value));
  if(!nom){ toast("Donnez un nom au modèle."); return; } if(!jours.length){ toast("Choisissez au moins un jour."); return; }
  const dec = c.enlDate&&c.livDate ? Math.max(0,Math.min(7,Math.round((new Date(c.livDate+"T12:00:00")-new Date(c.enlDate+"T12:00:00"))/86400000))) : 0;
  const row={ entreprise_id:EID(), nom, jours, actif:true, liv_decalage:dec, genere_jusqu_au: (c.enlDate && c.enlDate>todayIso()) ? c.enlDate : todayIso() };
  MCH.forEach(k=>{ const v=c[k]; row[snake(k)] = (v===""||v===undefined)?null:v; });
  const r=await sb.from("courses_modeles").insert(row);
  if(r.error){ toast(rErr(r.error)); return; }
  closeModal(); toast("Modèle créé : les prochaines courses se créeront toute seules"); await T.loadData();
}

/* ---------- page « Courses récurrentes » ---------- */
const off = () => `<div class="bar"><h1>Courses récurrentes</h1></div><div class="pan"><b>Les courses récurrentes ne sont pas encore activées sur cette base.</b><span class="muted">La mise à jour de la base de données n'a pas encore été appliquée.</span></div>`;
T.views.recurrentes = () => {
  if(!R.ready) return off();
  const rows=R.list;
  return `<div class="bar"><h1>Courses récurrentes</h1></div>
  <div class="banner"><span>Une course qui se répète chaque jour (navette, tournée fixe) se crée <b>automatiquement</b> dans « À planifier ». Pour en ajouter une : ouvrez une course existante puis cliquez sur <b>Rendre récurrente</b>. Les courses se créent à l'ouverture de Mobilog, pour aujourd'hui et pour le prochain jour ouvré.</span></div>
  <div class="pan">${rows.length?`<div class="tbl-wrap"><table><thead><tr><th>Modèle</th><th>Trajet</th><th>Jours</th><th>Heures</th><th style="text-align:right">Prix HT</th><th>État</th><th></th></tr></thead><tbody>
  ${rows.map(m=>`<tr><td><b>${esc(m.nom)}</b><div class="muted">${esc(m.donneur||"")}</div></td><td>${esc(trajet(m))}</td><td>${esc(jrs(m.jours))}</td>
    <td class="num">${esc(hm(m.enl_heure)||"—")} → ${esc(hm(m.liv_heure)||"—")}</td><td class="num" style="text-align:right">${money(m.prix)}</td>
    <td>${m.actif?`<span class="chip st-terminee">Actif</span>`:`<span class="chip st-annulee">En pause</span>`}</td>
    <td style="white-space:nowrap"><button type="button" class="btn btn-ghost btn-sm" data-r="edit" data-id="${esc(m.id)}">Modifier</button>
      <button type="button" class="btn btn-ghost btn-sm" data-r="toggle" data-id="${esc(m.id)}">${m.actif?"Mettre en pause":"Réactiver"}</button></td></tr>`).join("")}</tbody></table></div>`
    :`<div class="empty">Aucun modèle pour l'instant. Ouvrez une course (par exemple la navette de chaque jour) et cliquez sur « Rendre récurrente ».</div>`}</div>`;
};

function ouvrirEdit(id){
  const m=R.list.find(x=>x.id===id); if(!m) return; R.edit={type:"edit",id};
  const f=(k,l,t,w)=>`<label class="fld ${w?"wide":""}">${l}<input id="rm_${k}" type="${t||"text"}" ${t==="number"?'step="any" inputmode="decimal"':""} value="${esc(t==="time"?hm(m[k]):(m[k]??""))}"></label>`;
  openModal(`<h2>Modifier le modèle</h2>
    <p class="muted">Les changements s'appliquent aux <b>prochaines</b> courses créées. Les courses déjà créées ne bougent pas.</p>
    <form id="rmForm" style="display:flex;flex-direction:column;gap:12px">
    ${f("nom","Nom du modèle","text",1)}
    <div><b>Jours de la semaine</b><div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px">${JOURS.map(([n,l])=>`<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" class="rmJ" value="${n}" ${(m.jours||[]).includes(n)?"checked":""} style="width:20px;height:20px">${l}</label>`).join("")}</div></div>
    <fieldset><legend>Donneur d'ordre</legend>${f("donneur","Donneur d'ordre")}${f("prix","Prix HT (€)","number")}${f("contact","Contact / téléphone")}</fieldset>
    <fieldset><legend>Enlèvement</legend>${f("enl_nom","Site")}${f("enl_adresse","Adresse","text",1)}${f("enl_cp","Code postal")}${f("enl_ville","Ville")}${f("enl_heure","Heure","time")}${f("enl_heure_fin","Jusqu'à","time")}</fieldset>
    <fieldset><legend>Livraison</legend>${f("liv_nom","Site")}${f("liv_adresse","Adresse","text",1)}${f("liv_cp","Code postal")}${f("liv_ville","Ville")}${f("liv_heure","Heure","time")}${f("liv_heure_fin","Jusqu'à","time")}</fieldset>
    <fieldset><legend>Consignes</legend>${f("marchandise","Marchandise","text",1)}${f("instructions","Instructions pour le conducteur","text",1)}</fieldset>
    <div class="row-btns"><button type="button" class="btn btn-danger" data-r="del" style="margin-right:auto">Supprimer le modèle</button><button type="button" class="btn btn-ghost" data-act="close">Annuler</button><button type="submit" class="btn btn-accent">Enregistrer</button></div></form>`);
  $("#rmForm").addEventListener("submit",async e=>{ e.preventDefault();
    const jours=[...document.querySelectorAll(".rmJ:checked")].map(i=>Number(i.value)); const nom=$("#rm_nom").value.trim();
    if(!nom||!jours.length){ toast("Un nom et au moins un jour sont nécessaires."); return; }
    const o={ nom, jours };
    ["donneur","prix","contact","enl_nom","enl_adresse","enl_cp","enl_ville","enl_heure","enl_heure_fin","liv_nom","liv_adresse","liv_cp","liv_ville","liv_heure","liv_heure_fin","marchandise","instructions"].forEach(k=>{
      let v=$("#rm_"+k).value.trim(); if(k==="prix") v = v===""?null:Number(v.replace(",",".")); o[k]=v===""?null:v; });
    const r=await sb.from("courses_modeles").update(o).eq("id",id);
    if(r.error){ toast(rErr(r.error)); return; }
    closeModal(); toast("Modèle enregistré"); await T.loadData(); });
}

/* ---------- actions ---------- */
document.addEventListener("click", async e=>{
  const el=e.target.closest("[data-r]"); if(!el) return; const a=el.dataset.r, id=el.dataset.id;
  if(a==="dup") ouvrirDup(id);
  else if(a==="dupgo") await faireDup();
  else if(a==="rec") ouvrirRec(id);
  else if(a==="recgo") await faireRec();
  else if(a==="edit") ouvrirEdit(id);
  else if(a==="toggle"){ const m=R.list.find(x=>x.id===id); if(!m) return;
    const r=await sb.from("courses_modeles").update({actif:!m.actif}).eq("id",id);
    if(r.error){ toast(rErr(r.error)); return; } toast(m.actif?"Modèle mis en pause":"Modèle réactivé"); await T.loadData(); }
  else if(a==="del"){
    if(!el.dataset.sure){ el.dataset.sure="1"; el.textContent="Confirmer la suppression"; return; }
    const r=await sb.from("courses_modeles").delete().eq("id",R.edit&&R.edit.id);
    if(r.error){ toast(rErr(r.error)); return; } closeModal(); toast("Modèle supprimé (les courses déjà créées sont conservées)"); await T.loadData(); }
});
})();
