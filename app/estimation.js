/* Mobilog — estimation de prix : point A → point B, km routiers aller × 2 (retour à vide) × tarif de la grille — Tonton Business */
(function(){
"use strict";
const T = window.TP; if(!T) return;
const { S, sb, $, esc, toast, render, EID } = T;

/* ---------- grille tarifaire HT : enregistrée uniquement dans les paramètres de l'entreprise (jamais dans ce fichier,
   qui est public) et lisible seulement par l'exploitation ---------- */
const VEH = [["v20","20 m³"],["t12","12 T"],["t14","14 T"],["t19","19 T"],["semi","Semi 44 T"]];
const PREST = [["km","Prix au km","/km"],["exp","Express","/km"],["jour","Forfait journée",""],["heure","Heure supplémentaire",""]];
const VIDE = { km:null, exp:null, jour:null, heure:null };
const E = T.E = { a:{adr:"",cp:"",ville:""}, b:{adr:"",cp:"",ville:""}, veh:"semi", express:false, heures:"", client:"",
  res:null, calc:false, err:"", grille:false, perime:false };

const money = n => (Number(n)||0).toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})+" €";
const num = s => { const v=Number(String(s??"").replace(",",".").replace(/\s/g,"")); return isFinite(v)?v:null; };
const r2 = x => Math.round((Number(x)||0)*100)/100;
const tarifs = () => { const p=(T.fx&&T.fx.ready()&&T.fx.param())||{}; const t=(p.facturation&&p.facturation.tarifs)||{};
  const out={}; VEH.forEach(([k])=>{ const o=t[k]||{}; out[k]=Object.assign({},VIDE,o);
    // ancienne grille (longue distance / urgent) : reprise si la nouvelle n'est pas encore remplie
    if(out[k].km==null && o.ld!=null) out[k].km=o.ld; if(out[k].exp==null && o.urg!=null) out[k].exp=o.urg; }); return out; };
const grilleVide = () => { const t=tarifs(); return VEH.every(([v])=>t[v].km==null); };
const prestFinale = () => E.express ? "exp" : "km";
const lieuTxt = p => [p.adr, [p.cp,p.ville].filter(Boolean).join(" ")].filter(Boolean).join(", ");
const vehLib = k => (VEH.find(v=>v[0]===k)||["",""])[1];
const prestLib = k => (PREST.find(p=>p[0]===k)||["",""])[1];

function calcul(){
  if(!E.res) return null; const g=tarifs()[E.veh]; const pr=prestFinale();
  const kmFact=r2(E.res.km*2), pu=Number(g[pr])||0, hs=Math.max(0,num(E.heures)||0);
  const prixKm=r2(kmFact*pu), prixH=r2(hs*(Number(g.heure)||0));
  return { pr, kmFact, pu, hs, prixKm, prixH, total:r2(prixKm+prixH), jour:Number(g.jour)||0, heure:Number(g.heure)||0, manque:g[pr]==null };
}

/* ---------- itinéraire (mêmes services IGN que le calcul des distances des transports) ---------- */
async function itineraire(){
  const G=T.geo; if(!G) throw new Error("module_distance");
  const [a,b]=await Promise.all([G.geocoder(E.a.adr,E.a.cp,E.a.ville), G.geocoder(E.b.adr,E.b.cp,E.b.ville)]);
  if(!a) return { err:"Point A introuvable : vérifiez la ville et le code postal." };
  if(!b) return { err:"Point B introuvable : vérifiez la ville et le code postal." };
  const u=new URL("https://data.geopf.fr/navigation/itineraire"); u.searchParams.set("resource","bdtopo-osrm"); u.searchParams.set("profile","car"); u.searchParams.set("optimization","fastest");
  u.searchParams.set("start",a.join(",")); u.searchParams.set("end",b.join(",")); u.searchParams.set("getSteps","false"); u.searchParams.set("geometryFormat","geojson");
  const r=await fetch(u); if(!r.ok) throw new Error("itineraire "+r.status); const j=await r.json(); const d=Number(j.distance); if(!(d>=0)) return { err:"Trajet routier introuvable entre ces deux points." };
  const km=Math.round((j.distanceUnit==="kilometer"?d:d/1000)*10)/10;
  const ligne=(j.geometry&&j.geometry.coordinates||[]).map(p=>[p[1],p[0]]);
  return { km, duree:Number(j.duration)||null, dureeUnit:j.timeUnit, a:[a[1],a[0]], b:[b[1],b[0]], ligne:ligne.length?ligne:[[a[1],a[0]],[b[1],b[0]]] };
}
const dureeTxt = r => { if(!r.duree) return ""; let mn = r.dureeUnit==="hour" ? r.duree*60 : r.dureeUnit==="second" ? r.duree/60 : r.duree; mn=Math.round(mn); const h=Math.floor(mn/60), m=mn%60; return h ? `${h} h ${String(m).padStart(2,"0")}` : `${m} min`; };

/* ---------- écran ---------- */
const champ = (p,k,lab,ph,w) => `<label class="fld" style="${w?"grid-column:1/-1":""}">${lab}<input class="fin" data-e="${p}.${k}" value="${esc(E[p][k])}" placeholder="${esc(ph||"")}" autocomplete="off"></label>`;
const bloc = (p,titre) => `<div class="pan" style="flex:1;min-width:260px"><h2 style="margin:0">${titre}</h2>
  <div style="display:grid;grid-template-columns:120px 1fr;gap:8px">${champ(p,"adr","Adresse (facultatif)","12 rue …",true)}${champ(p,"cp","Code postal","95500")}${champ(p,"ville","Ville","Gonesse")}</div></div>`;

T.views.estimation = () => {
  if(!T.isStaff()) return `<div class="empty">Rubrique réservée à l'exploitation.</div>`;
  if(grilleVide() && !E.grille) E.grille=true;
  const t=tarifs(), c=calcul(), clients=(T.fx&&T.fx.ready()?T.fx.clients():[]).filter(x=>!x.sous_traitant).sort((x,y)=>x.nom.localeCompare(y.nom));
  const vehBtns = VEH.map(([k,l])=>`<button type="button" class="btn btn-sm ${E.veh===k?"btn-navy":"btn-ghost"}" data-est="veh" data-v="${k}" aria-pressed="${E.veh===k}">${l}</button>`).join("");
  const resultat = E.calc ? `<div class="pan"><div class="empty">Calcul de l'itinéraire…</div></div>`
    : E.err ? `<div class="pan"><div class="alert">${esc(E.err)}</div></div>`
    : (E.res && c && c.manque) ? `<div class="pan"><div class="alert">Trajet aller : ${E.res.km.toLocaleString("fr-FR")} km. Le tarif « ${esc(prestLib(c.pr))} » du ${esc(vehLib(E.veh))} n'est pas renseigné dans la grille ci-dessous.</div></div>`
    : (E.res && c) ? `<div class="pan">
      <div class="bar" style="align-items:flex-start"><div style="flex:1;min-width:220px">
        <div id="estPerime" class="alert" style="margin-bottom:8px" ${E.perime?"":"hidden"}>Les adresses ont changé : cliquez à nouveau sur « Calculer le prix ».</div>
        <h2 style="margin:0 0 6px">Prix estimé : <span class="num" style="font-size:28px">${money(c.total)}</span> HT</h2>
        <div style="font-size:14px;line-height:1.7">
          Trajet aller : <b class="num">${E.res.km.toLocaleString("fr-FR")} km</b>${dureeTxt(E.res)?` · environ ${dureeTxt(E.res)} de route`:""}<br>
          Aller + retour à vide : <b class="num">${c.kmFact.toLocaleString("fr-FR")} km</b> × ${money(c.pu)} (${esc(vehLib(E.veh))}${c.pr==="exp"?", Express":""}) = <b class="num">${money(c.prixKm)}</b><br>
          ${c.hs?`Heures supplémentaires : ${c.hs.toLocaleString("fr-FR")} h × ${money(c.heure)} = <b class="num">${money(c.prixH)}</b><br>`:""}
          ${c.jour?`<span class="muted">Pour comparer : forfait journée ${esc(vehLib(E.veh))} = ${money(c.jour)} HT.</span>`:""}
        </div></div>
        <div class="row-btns" style="flex-direction:column;align-items:stretch;min-width:220px">
          <button type="button" class="btn btn-accent" data-est="course">Créer la course</button>
          <button type="button" class="btn btn-ghost" data-est="devis">Créer un devis</button>
          <button type="button" class="btn btn-ghost btn-sm" data-est="copier">Copier le détail</button>
        </div></div>
      <div id="estCarte" style="height:280px;border-radius:12px;border:1px solid var(--line);overflow:hidden;background:var(--surface-2)" role="img" aria-label="Carte du trajet entre le point A et le point B"></div></div>` : "";
  const grille = `<div class="pan"><div class="bar"><h2 style="margin:0;flex:1">Grille tarifaire HT</h2>${grilleVide()?"":`<button type="button" class="btn btn-ghost btn-sm" data-est="grille">${E.grille?"Fermer sans enregistrer":"Modifier la grille"}</button>`}</div>
    <div class="tbl-wrap"><table><thead><tr><th>Prestation</th>${VEH.map(v=>`<th style="text-align:right">${v[1]}</th>`).join("")}</tr></thead><tbody>
    ${PREST.map(([p,l,u])=>`<tr><td>${l}${u?` <span class="muted">${u}</span>`:""}</td>${VEH.map(([v])=>`<td style="text-align:right">${E.grille?`<input class="fin num" style="width:84px;text-align:right" inputmode="decimal" data-g="${v}.${p}" value="${t[v][p]==null?"":esc(String(t[v][p]).replace(".",","))}" placeholder="—" aria-label="${esc(l)} ${esc(vehLib(v))}">`:(t[v][p]==null?`<span class="muted">—</span>`:`<span class="num">${money(t[v][p])}</span>`)}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div>
    ${E.grille?`<div class="bar" style="gap:10px"><span style="flex:1"></span><button type="button" class="btn btn-accent" data-est="gsave">Enregistrer la grille</button></div>`
      :`<span class="muted" style="font-size:13px">${grilleVide()?"<b>Renseignez votre grille pour obtenir des prix.</b> ":""}Prix = km aller × 2 (retour à vide) × prix au km du véhicule, ou tarif Express si la case est cochée. La grille n'est visible que par l'exploitation.</span>`}</div>`;
  return `<div class="bar"><h1>Estimer un prix</h1><span class="muted">Un client appelle : point A, point B, et le prix tout de suite.</span></div>
  <div style="display:flex;gap:12px;flex-wrap:wrap">${bloc("a","Point A · enlèvement")}${bloc("b","Point B · livraison")}</div>
  <div class="pan"><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><b style="margin-right:6px">Véhicule</b>${vehBtns}</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <label style="display:flex;gap:8px;align-items:center;font-weight:600;min-height:40px"><input type="checkbox" data-e="express" ${E.express?"checked":""} style="width:20px;height:20px"> Express</label>
      <label class="fld">Heures supplémentaires<input class="fin num" style="width:110px" inputmode="decimal" data-e="heures" value="${esc(E.heures)}" placeholder="0"></label>
      <label class="fld" style="min-width:220px;flex:1">Client (facultatif)<input class="fin" data-e="client" list="estClients" value="${esc(E.client)}" placeholder="Nom du client"><datalist id="estClients">${clients.map(x=>`<option value="${esc(x.nom)}">`).join("")}</datalist></label>
      <button type="button" class="btn btn-accent" data-est="calc" style="min-width:160px">Calculer le prix</button>
    </div></div>
  ${resultat}${grille}`;
};

T.after.estimation = () => { if(E.res && !E.calc && !E.err) dessiner(); };
async function dessiner(){
  const el=$("#estCarte"); if(!el || !E.res) return;
  try{ await T.geo.chargerLeaflet(); }catch(e){ el.innerHTML=`<span class="muted" style="display:block;padding:12px">Carte indisponible.</span>`; return; }
  if(!el.isConnected) return; const L=window.L; const r=E.res;
  const map=L.map(el,{scrollWheelZoom:false});
  L.tileLayer("https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",{maxZoom:18,attribution:"© IGN – Géoplateforme"}).addTo(map);
  const trace=L.polyline(r.ligne,{color:"#1F3A5F",weight:5,opacity:.85}).addTo(map);
  L.circleMarker(r.a,{radius:8,color:"#fff",weight:2,fillColor:"#2E7D32",fillOpacity:1}).addTo(map).bindTooltip("A · "+(E.a.ville||"enlèvement"),{permanent:true,direction:"top"});
  L.circleMarker(r.b,{radius:8,color:"#fff",weight:2,fillColor:"#E67E22",fillOpacity:1}).addTo(map).bindTooltip("B · "+(E.b.ville||"livraison"),{permanent:true,direction:"top"});
  map.fitBounds(trace.getBounds(),{padding:[30,30]});
}

/* ---------- saisie (gardée en mémoire : l'écran peut se redessiner à tout moment) ---------- */
document.addEventListener("input", e=>{ const k=e.target.dataset && e.target.dataset.e; if(!k || S.view!=="estimation") return;
  if(k==="express") return;
  if(k.includes(".")){ const [p,f]=k.split("."); E[p][f]=e.target.value;
    // lieu modifié après un calcul : on le signale sans redessiner l'écran (le curseur reste dans le champ)
    if(E.res && !E.perime){ E.perime=true; const m=$("#estPerime"); if(m) m.hidden=false; } }
  else E[k]=e.target.value; });
document.addEventListener("change", e=>{ const k=e.target.dataset && e.target.dataset.e; if(!k || S.view!=="estimation") return;
  if(k==="express"){ E.express=e.target.checked; render(); }
  else if(k==="heures"){ E.heures=e.target.value; render(); }
  });
document.addEventListener("keydown", e=>{ if(e.key==="Enter" && S.view==="estimation" && e.target.dataset && e.target.dataset.e && e.target.tagName==="INPUT"){ e.preventDefault(); lancer(); } });

async function lancer(){
  if(!(E.a.ville||E.a.cp) || !(E.b.ville||E.b.cp)){ toast("Indiquez au moins la ville (ou le code postal) des points A et B."); return; }
  E.calc=true; E.err=""; E.res=null; E.perime=false; render();
  try{ const r=await itineraire(); if(r.err){ E.err=r.err; } else E.res=r; }
  catch(err){ console.error(err); E.err="Le service de calcul d'itinéraire ne répond pas. Réessayez dans un instant."; }
  E.calc=false; render();
}
function detail(c){
  return `Estimation ${vehLib(E.veh)}${c.pr==="exp"?" — Express":""}\n${lieuTxt(E.a)} → ${lieuTxt(E.b)}\nTrajet aller ${E.res.km.toLocaleString("fr-FR")} km, aller + retour ${c.kmFact.toLocaleString("fr-FR")} km × ${money(c.pu)} = ${money(c.prixKm)}`+
    (c.hs?`\nHeures supplémentaires : ${c.hs} h × ${money(c.heure)} = ${money(c.prixH)}`:"")+`\nTotal : ${money(c.total)} HT`;
}
async function enregistrerGrille(){
  const t=tarifs(); const nouv={}; VEH.forEach(([v])=>{ nouv[v]=Object.assign({},t[v]); });
  let ko=false;
  document.querySelectorAll("[data-g]").forEach(i=>{ const k=i.dataset.g; const vide=String(i.value).trim()===""; const v=vide?null:num(i.value);
    if(!vide && (v==null || v<0)){ ko=true; i.setAttribute("aria-invalid","true"); return; }
    const [vh,p]=k.split("."); nouv[vh][p]=v; });
  VEH.forEach(([v])=>{ delete nouv[v].ld; delete nouv[v].reg; delete nouv[v].idf; delete nouv[v].urg; });
  if(ko){ toast("Une valeur de la grille n'est pas un nombre valable."); return; }
  const p=T.fx.param(); const fa=Object.assign({},p.facturation||{},{tarifs:nouv});
  const {error}=await sb.from("parametres").upsert({entreprise_id:EID(),societe:p.societe||{},facturation:fa},{onConflict:"entreprise_id"});
  if(error){ toast(T.errMsg(error)); return; }
  p.facturation=fa; E.grille=false; toast("Grille tarifaire enregistrée"); render();
}

document.addEventListener("click", async e=>{
  const el=e.target.closest("[data-est]"); if(!el || S.view!=="estimation") return; const a=el.dataset.est;
  if(a==="veh"){ E.veh=el.dataset.v; render(); }
  else if(a==="calc"){ lancer(); }
  else if(a==="grille"){ E.grille=!E.grille; render(); }
  else if(a==="gsave"){ el.disabled=true; await enregistrerGrille(); el.disabled=false; }
  else if(a==="copier"){ const c=calcul(); if(!c) return; try{ await navigator.clipboard.writeText(detail(c)); toast("Détail copié"); }catch(err){ toast("Copie impossible sur ce navigateur."); } }
  else if(a==="course"){ const c=calcul(); if(!c) return;
    if(E.perime){ toast("Les adresses ont changé : recalculez le prix d'abord."); return; }
    T.newCourse({ donneur:E.client||"", prix:c.total, enlAdresse:E.a.adr, enlCp:E.a.cp, enlVille:E.a.ville, livAdresse:E.b.adr, livCp:E.b.cp, livVille:E.b.ville,
    }); }
  else if(a==="devis"){ const c=calcul(); if(!c || !T.fx) return; if(E.perime){ toast("Les adresses ont changé : recalculez le prix d'abord."); return; } el.disabled=true;
    const cl=T.fx.clientByName ? T.fx.clientByName(E.client) : null;
    const lignes=[{ designation:`Transport ${vehLib(E.veh)} ${lieuTxt(E.a)} → ${lieuTxt(E.b)} (${c.pr==="exp"?"Express, ":""}${c.kmFact.toLocaleString("fr-FR")} km aller + retour)`, qte:1, pu:c.prixKm, tva:T.fx.tvaDef() }];
    if(c.hs) lignes.push({ designation:`Heures supplémentaires ${vehLib(E.veh)}`, qte:c.hs, pu:c.heure, tva:T.fx.tvaDef() });
    const r=await T.fx.newPiece("devis",{ client_id:cl?cl.id:null, lignes });
    el.disabled=false; if(r.error){ toast(T.fx.fErr(r.error)); return; }
    await T.fx.load(); location.hash="devis"; render(); T.fx.openPiece(r.data.id);
    if(!cl && E.client) toast(`« ${E.client} » n'est pas dans le carnet d'adresses : choisissez le client dans le devis.`); }
});
})();
