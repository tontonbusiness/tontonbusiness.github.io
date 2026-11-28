/* Mobilog — assistant d'aide : bulle « Tonton », guide, réponses et signalement d'un problème */
(function(){
"use strict";
const T = window.TP; if(!T) return;
const { S, esc } = T;
const FORM_URL = "https://formspree.io/f/maeolwjl";

/* ---------- Guide ---------- */
const G = [
 { t:"Créer une course", k:"créer nouvelle course ajouter transport saisir commande", h:"Cliquez sur <b>+ Nouvelle course</b> (menu de gauche ou page Transports). Renseignez le client, l'enlèvement, la livraison, les dates et le prix. Tant qu'aucun conducteur n'est affecté, la course reste <b>À planifier</b>." },
 { t:"Importer une confirmation de commande PDF", k:"importer pdf confirmation commande fichier lecture automatique", h:"Sur la page <b>Transports</b> (ou dans le menu), cliquez sur <b>Importer une confirmation PDF</b> et choisissez le fichier. Vérifiez les informations lues, corrigez si besoin, puis enregistrez la course." },
 { t:"Affecter une course à un conducteur", k:"affecter planifier conducteur chauffeur glisser planning assigner", h:"Dans le <b>Planning</b>, les courses à planifier sont à gauche. Glissez une course sur la ligne d'un conducteur, ou cliquez dessus pour l'affecter. Elle passe alors à l'état <b>Planifiée</b>." },
 { t:"Envoyer les courses aux conducteurs", k:"envoyer conducteur chauffeur notification tout envoyer transmettre", h:"Quand des courses sont planifiées, le bouton <b>Tout envoyer</b> apparaît dans le Planning. Il transmet les courses aux conducteurs, et leur état devient <b>Envoyée au conducteur</b>." },
 { t:"Suivre l'avancement d'une course", k:"suivi avancement étapes frise statut en cours chargement livraison", h:"Chaque course affiche une frise d'étapes : arrivée à l'enlèvement, chargement, route, arrivée à la livraison, livraison. Une étape cochée est faite, le tronçon animé montre la phase en cours. Les statuts sont À planifier, Planifiée, Envoyée, En cours, Terminée ou Annulée." },
 { t:"Filtrer et exporter les courses", k:"filtrer filtre exporter export csv excel client statut recherche liste", h:"Sur <b>Transports</b>, utilisez les menus <b>Statut</b> et <b>Client</b> pour filtrer la liste. Le bouton <b>Exporter</b> télécharge la liste affichée au format CSV, que vous pouvez ouvrir dans Excel." },
 { t:"Dupliquer une course", k:"dupliquer copie copier course identique répéter", h:"Sur <b>Transports</b>, cliquez sur le menu <b>⋯</b> en bout de ligne, puis <b>Dupliquer…</b> pour créer une nouvelle course à partir d'une existante." },
 { t:"Mettre un conducteur en repos", k:"repos conducteur chauffeur indisponible absent congé", h:"Dans le <b>Planning</b>, cliquez sur <b>Mettre en repos</b> sous le nom du conducteur concerné. Il n'apparaît plus comme disponible pour la journée." },
 { t:"Alerte « chauffeur en attente »", k:"alerte attente chauffeur retard 30 minutes rouge", h:"Une alerte rouge apparaît à côté de <b>Planning</b> quand un chauffeur attend depuis plus de 30 minutes à une livraison sans avancement. Ouvrez le Planning pour voir la course concernée." },
 { t:"Facturer des transports", k:"facture facturer facturation créer facture transports terminés", h:"Menu <b>Facturation de ventes</b>, puis <b>Transports à facturer</b>. Les transports terminés sont regroupés par client. Vérifiez les prix, puis cliquez sur <b>Créer la facture</b>. Les devis, relances clients et avoirs sont dans la même rubrique." },
 { t:"Litiges, stockage, sous-traitants", k:"litige litiges stockage sous-traitant sous-traitants carnet adresses clients", h:"Ces outils sont dans la rubrique <b>Outils et gestion</b> du menu : <b>Litiges</b> (réserves et réclamations), <b>Stockage</b> (marchandises entreposées), <b>Sous-traitants</b> et <b>Carnet d'adresses</b> (vos clients)." },
 { t:"Contrôles véhicules et documents chauffeurs", k:"contrôle véhicule véhicules documents chauffeur permis échéance échéances conducteurs", h:"Dans <b>Conducteurs et véhicules</b>, les rubriques <b>Contrôles véhicules</b> et <b>Documents chauffeurs</b> listent les échéances. Un compteur rouge indique ce qui arrive à échéance." },
 { t:"Voir les chiffres de l'activité", k:"rapport rapports indicateurs chiffre affaires statistiques activité chauffeurs", h:"La rubrique <b>Rapports</b> donne une vue d'ensemble de l'activité, et <b>Activité chauffeurs</b> détaille le travail de chaque conducteur." },
 { t:"Voir l'écran du conducteur", k:"vue conducteur écran chauffeur application dream chauffeur téléphone", h:"<b>Vue conducteur</b> (menu de gauche) affiche l'écran tel que le voit le chauffeur. Les conducteurs utilisent l'application Dream Chauffeur sur leur téléphone." },
 { t:"La page ne se met pas à jour ou affiche une erreur", k:"erreur bug bloqué page ne charge pas actualiser connexion lent ancien affichage cache", h:"Essayez d'abord d'actualiser avec <b>Ctrl + Maj + R</b> (ordinateur). Sur téléphone, fermez puis rouvrez l'application. Si le problème persiste, utilisez l'onglet <b>Signaler un problème</b>." }
];
const norm = s => (s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
const STOP = new Set("le la les un une des de du et ou en au aux a ai est que qui comment je tu il on ce se sa son ses mon ma mes pour par sur dans avec sans pas ne plus mais donc car il y quoi quel quelle puis peut peux veux voir faire fait".split(" "));
function cherche(q){
  const mots = norm(q).split(/[^a-z0-9]+/).filter(m=>m.length>2 && !STOP.has(m));
  if(!mots.length) return [];
  return G.map(g=>{ const tit=norm(g.t), kw=norm(g.k+" "+g.t+" "+g.h.replace(/<[^>]+>/g,""));
    let s=0; mots.forEach(m=>{ if(tit.includes(m)) s+=3; else if(kw.includes(m)) s+=1; }); return {g,s}; })
    .filter(x=>x.s>0).sort((a,b)=>b.s-a.s).slice(0,3).map(x=>x.g);
}

/* ---------- Interface ---------- */
let ouvert=false, onglet="aide", hist=[];
const css = `
#aideBtn{position:fixed;right:max(18px,env(safe-area-inset-right,0px));bottom:max(18px,env(safe-area-inset-bottom,0px));z-index:60;width:64px;height:64px;border-radius:50%;border:3px solid #E7B53B;background:#fff;box-shadow:0 8px 24px rgba(6,18,48,.35);cursor:pointer;padding:0;display:grid;place-items:center;transition:transform .15s}
#aideBtn:hover{transform:scale(1.06)}
#aideBtn img{width:40px;height:auto;display:block}
#aideBtn .pt{position:absolute;top:-4px;right:-4px;min-width:22px;height:22px;border-radius:11px;background:#0b1d42;color:#F6D77A;font:700 14px/22px Arial,sans-serif;text-align:center;border:2px solid #fff}
#aideBtn[hidden],#aidePan[hidden]{display:none}
#aidePan{position:fixed;right:max(18px,env(safe-area-inset-right,0px));bottom:calc(max(18px,env(safe-area-inset-bottom,0px)) + 76px);z-index:61;width:min(380px,calc(100vw - 24px));height:min(560px,calc(100vh - 120px));background:var(--surface,#fff);color:var(--fg,#18212D);border:1px solid var(--line,#DCE2EA);border-radius:16px;box-shadow:0 18px 50px rgba(6,18,48,.35);display:flex;flex-direction:column;overflow:hidden}
#aidePan .ah{background:#0b1d42;color:#fff;display:flex;align-items:center;gap:10px;padding:12px 14px}
#aidePan .ah img{width:34px;height:34px;border-radius:50%;background:#fff;object-fit:contain;padding:3px;border:2px solid #E7B53B}
#aidePan .ah b{flex:1;font-size:15px}
#aidePan .ah small{display:block;font-weight:400;opacity:.8;font-size:12px}
#aidePan .ah button{background:none;border:0;color:#fff;font-size:24px;line-height:1;cursor:pointer;padding:4px 8px}
#aidePan .tabs{display:flex;border-bottom:1px solid var(--line,#DCE2EA)}
#aidePan .tabs button{flex:1;padding:10px 6px;border:0;background:none;font:600 13px Inter,Arial,sans-serif;color:var(--muted,#566170);cursor:pointer;border-bottom:3px solid transparent}
#aidePan .tabs button.on{color:var(--fg,#18212D);border-bottom-color:#E7B53B}
#aidePan .ab{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px;min-height:0}
#aidePan .msg{max-width:92%;padding:10px 12px;border-radius:12px;font-size:14px;line-height:1.5}
#aidePan .msg.bot{background:var(--surface-2,#EEF1F5);align-self:flex-start}
#aidePan .msg.me{background:#0b1d42;color:#fff;align-self:flex-end}
#aidePan .msg h4{margin:0 0 4px;font-size:14px}
#aidePan .msg + .msg.bot{margin-top:-2px}
#aidePan .af{border-top:1px solid var(--line,#DCE2EA);padding:10px;display:flex;gap:8px}
#aidePan input,#aidePan textarea{font:inherit;font-size:14px;color:inherit;background:var(--surface,#fff);border:1px solid var(--line,#DCE2EA);border-radius:10px;padding:10px;min-width:0}
#aidePan .af input{flex:1}
#aidePan .bt{background:#E7B53B;color:#2a1d00;border:0;border-radius:10px;padding:10px 14px;font:700 14px Inter,Arial,sans-serif;cursor:pointer}
#aidePan .bt:disabled{opacity:.6;cursor:default}
#aidePan .bl{background:none;border:1px solid var(--line,#DCE2EA);border-radius:999px;padding:6px 12px;font:600 13px Inter,Arial,sans-serif;color:inherit;cursor:pointer;align-self:flex-start;text-align:left}
#aidePan .bl:hover{border-color:#E7B53B}
#aidePan details{border:1px solid var(--line,#DCE2EA);border-radius:10px;padding:8px 12px;font-size:14px}
#aidePan details summary{cursor:pointer;font-weight:600}
#aidePan details p{margin:8px 0 2px;line-height:1.5}
#aidePan form{display:flex;flex-direction:column;gap:8px}
#aidePan label{font-size:13px;font-weight:600}
#aidePan .note{font-size:12px;color:var(--muted,#566170)}
@media print{#aideBtn,#aidePan{display:none!important}}
`;
function chaine(){ return (location.hash||"").replace("#","")||"indicateurs"; }
function build(){
  if(document.getElementById("aideBtn")) return;
  const st=document.createElement("style"); st.textContent=css; document.head.appendChild(st);
  const b=document.createElement("button"); b.id="aideBtn"; b.type="button"; b.hidden=true;
  b.setAttribute("aria-label","Ouvrir l'assistant d'aide"); b.setAttribute("aria-haspopup","dialog");
  b.innerHTML='<img src="tonton-aide.png" alt="" width="40" height="52">';
  b.addEventListener("click",()=>basc());
  document.body.appendChild(b);
  const p=document.createElement("div"); p.id="aidePan"; p.hidden=true; p.setAttribute("role","dialog"); p.setAttribute("aria-label","Assistant d'aide Mobilog");
  document.body.appendChild(p);
  document.addEventListener("keydown",e=>{ if(e.key==="Escape" && ouvert) basc(false); });
  p.addEventListener("click",clic); p.addEventListener("submit",soumet);
}
function basc(v){
  ouvert = (v===undefined) ? !ouvert : v;
  const p=document.getElementById("aidePan"); p.hidden=!ouvert;
  if(ouvert){ if(!hist.length) hist=[{r:"bot",html:"Bonjour, je suis <b>Tonton</b>, l'assistant de Mobilog. Posez-moi votre question, ou choisissez un sujet dans le guide. Si je ne sais pas répondre, vous pourrez signaler le problème à l'équipe."}]; dessine(); setTimeout(()=>{ const i=p.querySelector("#aideQ,#aideM"); if(i) i.focus(); },50); }
  else document.getElementById("aideBtn").focus();
}
function dessine(){
  const p=document.getElementById("aidePan");
  const tab = (id,l)=>`<button type="button" role="tab" data-ao="${id}" class="${onglet===id?"on":""}" aria-selected="${onglet===id}">${l}</button>`;
  let corps="", pied="";
  if(onglet==="aide"){
    corps = hist.map(m=>`<div class="msg ${m.r}">${m.html}</div>`).join("");
    const sug = hist.length<=1 ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${["Créer une course","Affecter un conducteur","Créer une facture","Exporter les courses"].map(s=>`<button type="button" class="bl" data-aq="${esc(s)}">${s}</button>`).join("")}</div>` : "";
    corps += sug;
    pied = `<form class="af" data-af="q"><input id="aideQ" type="text" placeholder="Votre question…" aria-label="Votre question" autocomplete="off" maxlength="200"><button class="bt" type="submit">Envoyer</button></form>`;
  } else if(onglet==="guide"){
    corps = G.map((g,i)=>`<details${i===0?"":""}><summary>${g.t}</summary><p>${g.h}</p></details>`).join("");
  } else {
    corps = `<form data-af="sig" id="aideSig"><p class="note" style="margin:0">Décrivez ce qui ne va pas. Votre message arrive directement à l'équipe Mobilog, avec le nom de votre entreprise et la page où vous étiez.</p>
      <label for="aideM">Que s'est-il passé ?</label><textarea id="aideM" rows="5" maxlength="2000" required placeholder="Ex. : en cliquant sur « Tout envoyer », rien ne se passe."></textarea>
      <label for="aideE">Votre e-mail ou téléphone (pour vous répondre)</label><input id="aideE" type="text" maxlength="120" autocomplete="off">
      <button class="bt" type="submit" id="aideSend">Envoyer le signalement</button><p class="note" id="aideSt" role="status" aria-live="polite" style="margin:0"></p></form>`;
  }
  p.innerHTML = `<div class="ah"><img src="tonton-aide.png" alt=""><b>Tonton, votre assistant<small>Aide Mobilog</small></b><button type="button" data-ao="close" aria-label="Fermer l'aide">×</button></div>
   <div class="tabs" role="tablist">${tab("aide","Poser une question")}${tab("guide","Guide")}${tab("sig","Signaler un problème")}</div>
   <div class="ab" id="aideBody">${corps}</div>${pied}`;
  const b=document.getElementById("aideBody"); if(onglet==="aide") b.scrollTop=b.scrollHeight;
}
function locale(q){
  const r=cherche(q);
  if(!r.length) hist.push({r:"bot",html:`Je n'ai pas trouvé de réponse à cette question dans le guide. Essayez avec d'autres mots, ouvrez l'onglet <b>Guide</b>, ou <button type="button" class="bl" data-ao="sig">signalez-le à l'équipe</button>.`});
  else { r.forEach(g=>hist.push({r:"bot",html:`<h4>${g.t}</h4>${g.h}`})); hist.push({r:"bot",html:`Cela répond à votre question ? Sinon, <button type="button" class="bl" data-ao="sig">signalez le problème</button>.`}); }
}
let enCours=false;
async function repond(q){
  if(enCours) return;
  hist.push({r:"me",html:esc(q)}); enCours=true;
  const att={r:"bot",html:"<i>Tonton réfléchit…</i>"}; hist.push(att); dessine();
  let ia=null;
  try{
    const msgs=hist.filter(m=>m!==att && m.t).slice(-5).map(m=>({role:m.r==="me"?"user":"assistant",content:m.t}));
    msgs.push({role:"user",content:q});
    const sb=T.sb; if(!sb||!sb.functions) throw new Error("hors-ligne");
    const {data,error}=await sb.functions.invoke("aide-assistant",{body:{messages:msgs}});
    if(error||!data||!data.reponse) throw new Error("indisponible");
    ia=String(data.reponse);
  }catch(err){ ia=null; }
  hist.splice(hist.indexOf(att),1);
  hist[hist.length-1].t=q;
  if(ia){
    hist.push({r:"bot",t:ia,html:esc(ia).replace(/\*\*([^*]+)\*\*/g,"<b>$1</b>").replace(/\n+/g,"<br>")});
    hist.push({r:"bot",html:`Cela répond à votre question ? Sinon, <button type="button" class="bl" data-ao="sig">signalez le problème</button>.`});
  } else locale(q);
  enCours=false; dessine();
}
function clic(e){
  const a=e.target.closest("[data-ao],[data-aq]"); if(!a) return;
  if(a.dataset.aq){ onglet="aide"; repond(a.dataset.aq); return; }
  const o=a.dataset.ao;
  if(o==="close"){ basc(false); return; }
  onglet=o; dessine();
}
async function soumet(e){
  e.preventDefault();
  const f=e.target.dataset.af;
  if(f==="q"){ const i=document.getElementById("aideQ"); const q=(i.value||"").trim(); if(q) repond(q); return; }
  const m=(document.getElementById("aideM").value||"").trim(), c=(document.getElementById("aideE").value||"").trim();
  const st=document.getElementById("aideSt"), bt=document.getElementById("aideSend");
  if(!m){ st.textContent="Merci de décrire le problème."; return; }
  bt.disabled=true; st.textContent="Envoi en cours…";
  const d=new FormData();
  d.append("Type","Signalement depuis Mobilog");
  d.append("Entreprise", (S.entreprise&&S.entreprise.nom)||"Non renseignée");
  d.append("Page", chaine());
  d.append("Message", m);
  d.append("Contact", c||"Non renseigné");
  d.append("Écran", window.innerWidth+"x"+window.innerHeight);
  d.append("_gotcha","");
  d.append("_subject","Signalement Mobilog - "+((S.entreprise&&S.entreprise.nom)||"entreprise"));
  try{
    const r=await fetch(FORM_URL,{method:"POST",body:d,headers:{"Accept":"application/json"}});
    if(!r.ok) throw new Error(r.status);
    document.getElementById("aideBody").innerHTML=`<div class="msg bot"><h4>Merci, c'est bien envoyé.</h4>L'équipe a reçu votre signalement et reviendra vers vous.</div>`;
  }catch(err){ bt.disabled=false; st.textContent="L'envoi n'a pas fonctionné. Réessayez, ou écrivez à contact@tontonbusiness.com."; }
}
T.aideOuvrir = o => { onglet = o==="guide"||o==="sig" ? o : "aide"; basc(true); dessine(); };
function maj(){ const b=document.getElementById("aideBtn"); if(!b) return; const ok=!!S.session && !(window.TP_MODE==="chauffeur"); b.hidden=!ok; if(!ok && ouvert) basc(false); }
function init(){ build(); maj(); setInterval(maj,1500); }
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init); else init();
})();
