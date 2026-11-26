/* Mobilog — essai gratuit : bandeau « Essai gratuit : X jours restants », puis lecture seule quand l'essai est terminé
   (le blocage réel est fait par la base ; ce fichier ne fait qu'informer) — Tonton Business */
(function(){
"use strict";
const T = window.TP; if(!T) return;
const { S, esc } = T;
const CONTACT = "contact@tontonbusiness.com";
const auj = () => { const d=new Date(); const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(d); return p; };
const jours = fin => Math.round((Date.parse(fin+"T12:00:00Z")-Date.parse(auj()+"T12:00:00Z"))/864e5);
const dateFr = iso => new Date(iso+"T12:00:00").toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"});

function etat(){
  const e=S.entreprise; if(!e || !e.abonnement || e.abonnement==="actif") return null;
  if(e.abonnement==="suspendu") return { fini:true, txt:`<b>Accès suspendu.</b> Vos données sont conservées et consultables, mais rien ne peut être modifié. Contactez <a href="mailto:${CONTACT}" style="color:inherit">${CONTACT}</a>.` };
  if(!e.essai_fin) return null;
  const n=jours(e.essai_fin);
  if(n<0) return { fini:true, txt:`<b>Votre essai gratuit est terminé</b> depuis le ${esc(dateFr(e.essai_fin))}. Vos données sont conservées et consultables, mais rien ne peut plus être créé ni modifié. Pour continuer avec Mobilog : <a href="mailto:${CONTACT}?subject=${encodeURIComponent("Abonnement Mobilog — "+(e.nom||""))}" style="color:inherit">${CONTACT}</a>.` };
  const reste = n===0 ? "dernier jour aujourd'hui" : n===1 ? "il reste 1 jour" : `il reste ${n} jours`;
  return { fini:false, urgent:n<=5, txt:`<b>Essai gratuit</b> — ${reste} (jusqu'au ${esc(dateFr(e.essai_fin))} inclus). Pour continuer ensuite : <a href="mailto:${CONTACT}?subject=${encodeURIComponent("Abonnement Mobilog — "+(e.nom||""))}" style="color:inherit">${CONTACT}</a>.` };
}
function bandeau(){
  const ex=document.getElementById("essaiBar"); const s=T.isStaff() ? etat() : null;
  if(!s){ if(ex) ex.remove(); return; }
  const b=ex||document.createElement("div"); b.id="essaiBar"; b.setAttribute("role", s.fini?"alert":"status");
  b.style.cssText=`position:sticky;top:0;z-index:50;padding:8px 14px;font-size:13px;text-align:center;line-height:1.45;${s.fini?"background:#C0392B;color:#fff":s.urgent?"background:#F5B942;color:#1B2230":"background:#E8EEF6;color:#1F3A5F"}`;
  b.innerHTML=s.txt;
  if(!ex) document.body.insertBefore(b, document.body.firstChild);
}
T.onData.push(bandeau);
T.essaiFini = () => { const s=etat(); return !!(s && s.fini); };
})();
