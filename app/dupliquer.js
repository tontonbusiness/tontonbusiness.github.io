/* Mobilog — duplication d'une course sur un ou plusieurs jours — Tonton Business */
(function(){
"use strict";
const T = window.TP; if(!T) return;
const { S, sb, $, toast, openModal, closeModal, esc, EID, todayIso, addDays } = T;
let cible=null;

/* champs copiés d'une course (camelCase côté course, snake_case côté base) */
const CHAMPS = ["donneur","prix","contact","enlNom","enlAdresse","enlCp","enlVille","enlHeure","enlHeureFin","livNom","livAdresse","livCp","livVille","livHeure","livHeureFin","palettes","colis","poids","metres","marchandise","instructions"];
const snake = k => k.replace(/[A-Z]/g, m=>"_"+m.toLowerCase());
const dow = iso => { const d=new Date(iso+"T12:00:00").getDay(); return d===0?7:d; };
const jourLong = iso => new Date(iso+"T12:00:00").toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});

/* bloc affiché en haut de la fiche d'une course existante */
T.recBloc = c => (!c || !c.id || c.statut==="annulee") ? "" :
  `<div class="banner" style="justify-content:flex-start;flex-wrap:wrap;gap:8px"><span>Même course sur d'autres jours ?</span>
   <button type="button" class="btn btn-ghost btn-sm" data-r="dup" data-id="${esc(c.id)}">Dupliquer…</button></div>`;

function joursProposes(){ const out=[]; let d=addDays(todayIso(),1); while(out.length<10){ if(dow(d)<=5) out.push(d); d=addDays(d,1); } return out; }
const ligneJour = (d,coche) => `<label style="display:flex;gap:10px;align-items:center"><input type="checkbox" value="${d}" ${coche?"checked":""} style="width:20px;height:20px"> ${esc(jourLong(d))}</label>`;
function ajouterDate(){ const inp=$("#dupAutre"), box=$("#recDays"); const d=inp&&inp.value; if(!d){ toast("Choisissez une date dans le calendrier."); return; }
  const ex=box.querySelector(`input[value="${d}"]`); if(ex){ ex.checked=true; inp.value=""; return; }
  const apres=[...box.querySelectorAll("input")].find(i=>i.value>d); const tmp=document.createElement("div"); tmp.innerHTML=ligneJour(d,true);
  box.insertBefore(tmp.firstElementChild, apres?apres.closest("label"):null); inp.value=""; }
function ouvrirDup(id){
  const c=S.courses.find(x=>x.id===id); if(!c) return; cible=id;
  openModal(`<h2>Dupliquer la course</h2>
    <p class="muted">${esc(c.donneur||"Course")} · ${esc(c.enlVille||"?")} → ${esc(c.livVille||"?")}. Le chauffeur, la référence et le suivi ne sont pas copiés : les nouvelles courses arrivent dans « À planifier ».</p>
    <div style="display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow:auto" id="recDays">
      ${joursProposes().map((d,i)=>ligneJour(d,i===0)).join("")}</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label for="dupAutre" style="font-weight:600">Autre date :</label>
      <input type="date" id="dupAutre" class="fin" style="width:auto"><button type="button" class="btn btn-ghost btn-sm" data-r="dupadd">Ajouter</button></div>
    <div class="row-btns"><button type="button" class="btn btn-ghost" data-act="close">Annuler</button><button type="button" class="btn btn-accent" data-r="dupgo">Dupliquer</button></div>`);
}
async function faireDup(){
  const c=S.courses.find(x=>x.id===cible); if(!c) return;
  const dates=[...document.querySelectorAll("#recDays input:checked")].map(i=>i.value);
  if(!dates.length){ toast("Cochez au moins un jour."); return; }
  const dec = c.enlDate&&c.livDate ? Math.max(0,Math.round((new Date(c.livDate+"T12:00:00")-new Date(c.enlDate+"T12:00:00"))/86400000)) : 0;
  const rows=dates.map(d=>{ const row={ entreprise_id:EID(), statut:"a_planifier", source:"duplication", enl_date:d, liv_date:addDays(d,dec) };
    CHAMPS.forEach(k=>{ const v=c[k]; row[snake(k)] = (v===""||v===undefined)?null:v; });
    if(Array.isArray(c.commandes) && c.commandes.length) row.commandes=c.commandes; return row; });
  const r=await sb.from("courses").insert(rows);
  if(r.error){ toast(T.errMsg(r.error)); return; }
  closeModal(); toast(rows.length>1?`${rows.length} courses créées dans « À planifier »`:"Course créée dans « À planifier »"); await T.loadData();
}
document.addEventListener("click", async e=>{
  const el=e.target.closest("[data-r]"); if(!el) return;
  if(el.dataset.r==="dup") ouvrirDup(el.dataset.id);
  else if(el.dataset.r==="dupgo") await faireDup();
  else if(el.dataset.r==="dupadd") ajouterDate();
});
})();
