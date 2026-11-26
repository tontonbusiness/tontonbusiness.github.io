/* Mobilog — aide à la saisie des adresses : code postal → commune, début d'adresse → adresses proposées
   Sources officielles et gratuites : geo.api.gouv.fr (communes) et Géoplateforme IGN (adresses).
   Fonctionne sur la fiche course (enlèvement / livraison) et sur « Estimer un prix » (points A et B). */
(function(){
"use strict";
const T = window.TP; if(!T) return;
const { esc } = T;

// retrouve les 3 champs (adresse, code postal, ville) du même bloc
function groupe(el){
  if(!el || el.tagName!=="INPUT") return null;
  let m=/^f_(enl|liv)(Adresse|Cp|Ville)$/.exec(el.id||"");
  if(m){ const p=m[1]; const g={ adr:document.getElementById("f_"+p+"Adresse"), cp:document.getElementById("f_"+p+"Cp"), ville:document.getElementById("f_"+p+"Ville") };
    return g.adr&&g.cp&&g.ville ? Object.assign(g,{role:{Adresse:"adr",Cp:"cp",Ville:"ville"}[m[2]]}) : null; }
  m=/^([ab])\.(adr|cp|ville)$/.exec((el.dataset&&el.dataset.e)||"");
  if(m){ const q=k=>document.querySelector(`[data-e="${m[1]}.${k}"]`); const g={ adr:q("adr"), cp:q("cp"), ville:q("ville") };
    return g.adr&&g.cp&&g.ville ? Object.assign(g,{role:m[2]}) : null; }
  return null;
}
const poser = (el,v) => { if(!el || el.value===v) return; el.value=v; el.dispatchEvent(new Event("input",{bubbles:true})); el.dispatchEvent(new Event("change",{bubbles:true})); };
const cp5 = s => /^\d{5}$/.test(String(s||"").trim()) ? String(s).trim() : "";

/* ---------- liste de propositions (une seule à la fois, sous le champ) ---------- */
let box=null, cible=null, items=[], actif=-1, choix=null;
function liste(){ if(box) return box;
  box=document.createElement("div"); box.id="adrSug"; box.setAttribute("role","listbox");
  box.style.cssText="position:fixed;z-index:10000;display:none;background:var(--surface,#fff);color:inherit;border:1px solid var(--line,#ccc);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);overflow:hidden;max-height:260px;overflow-y:auto";
  box.addEventListener("mousedown",e=>{ e.preventDefault(); const b=e.target.closest("[data-i]"); if(b) valider(Number(b.dataset.i)); });
  document.body.appendChild(box); return box; }
function montrer(el, props, onChoix){
  const b=liste(); cible=el; items=props; choix=onChoix; actif=-1;
  if(!props.length){ cacher(); return; }
  b.innerHTML=props.map((p,i)=>`<button type="button" role="option" data-i="${i}" style="display:block;width:100%;text-align:left;padding:9px 12px;border:0;border-bottom:1px solid var(--line,#eee);background:transparent;color:inherit;font:inherit;font-size:14px;cursor:pointer">${p.html}</button>`).join("");
  const r=el.getBoundingClientRect(), w=Math.min(Math.max(r.width,260), window.innerWidth-8);
  b.style.width=w+"px"; b.style.left=Math.max(4, Math.min(r.left, window.innerWidth-w-4))+"px"; b.style.top=(r.bottom+4)+"px"; b.style.display="block";
  el.setAttribute("aria-expanded","true");
}
function cacher(){ if(box) box.style.display="none"; if(cible) cible.removeAttribute("aria-expanded"); cible=null; items=[]; actif=-1; }
function surligner(i){ if(!box) return; actif=i; [...box.children].forEach((c,k)=>{ c.style.background = k===i ? "var(--surface-2,#eef)" : "transparent"; c.setAttribute("aria-selected",k===i?"true":"false"); }); }
function valider(i){ const p=items[i]; const f=choix; cacher(); if(p && f) f(p); }

/* ---------- requêtes (la dernière frappe gagne) ---------- */
let seq=0, minuteur=null; const cache=new Map();
async function communes(cp){ const k="c"+cp; if(cache.has(k)) return cache.get(k);
  const r=await fetch("https://geo.api.gouv.fr/communes?codePostal="+cp+"&fields=nom&format=json"); if(!r.ok) return [];
  const L=(await r.json()).map(c=>c.nom).sort((a,b)=>a.localeCompare(b,"fr")); cache.set(k,L); return L; }
async function adresses(q,cp){ const k="a"+q+"|"+cp; if(cache.has(k)) return cache.get(k);
  const u=new URL("https://data.geopf.fr/geocodage/search"); u.searchParams.set("q",q); u.searchParams.set("autocomplete","1"); u.searchParams.set("index","address"); u.searchParams.set("limit","5");
  if(cp) u.searchParams.set("postcode",cp);
  const r=await fetch(u); if(!r.ok) return [];
  const L=((await r.json()).features||[]).map(f=>f.properties).filter(p=>p && p.postcode && p.city)
    .map(p=>({ rue: p.type==="municipality" ? "" : (p.name||""), cp:p.postcode, ville:p.city, label:p.label }));
  cache.set(k,L); return L; }

async function surCodePostal(g){
  const cp=cp5(g.cp.value); if(!cp){ if(cible===g.cp) cacher(); return; }
  const n=++seq; let L=[]; try{ L=await communes(cp); }catch(e){ return; } if(n!==seq) return;
  if(cp5(g.cp.value)!==cp) return; // le code postal a changé entre-temps
  if(!L.length) { cacher(); return; } // code CEDEX ou inconnu : on laisse saisir la ville
  const deja=String(g.ville.value||"").trim();
  // une seule commune : remplie même si l'on est déjà passé au champ suivant
  if(L.length===1){ if(!deja) poser(g.ville,L[0]); cacher(); return; }
  if(deja && L.some(v=>v.toLowerCase()===deja.toLowerCase())){ cacher(); return; }
  // plusieurs communes : la liste s'affiche sous le champ où l'on se trouve (code postal ou ville)
  const ici = document.activeElement===g.cp ? g.cp : document.activeElement===g.ville ? g.ville : null; if(!ici) return;
  montrer(ici, L.map(v=>({ v, html:`${esc(v)} <span style="opacity:.6">${cp}</span>` })), p=>{ poser(g.ville,p.v); g.ville.focus(); });
}
async function surAdresse(g){
  const q=String(g.adr.value||"").trim(); if(q.length<4 || /\b(?:BP|CS|TSA|CEDEX)\b/i.test(q)){ if(cible===g.adr) cacher(); return; }
  const cp=cp5(g.cp.value); const n=++seq; let L=[]; try{ L=await adresses(q,cp); }catch(e){ return; }
  if(n!==seq || document.activeElement!==g.adr) return;
  montrer(g.adr, L.map(a=>Object.assign(a,{ html:`${esc(a.rue||a.ville)}<br><span style="opacity:.65;font-size:12px">${esc(a.cp+" "+a.ville)}</span>` })), a=>{ if(a.rue) poser(g.adr,a.rue); poser(g.cp,a.cp); poser(g.ville,a.ville); });
}

document.addEventListener("input", e=>{ const g=groupe(e.target); if(!g || !e.isTrusted) return;
  clearTimeout(minuteur);
  if(g.role==="cp") minuteur=setTimeout(()=>surCodePostal(g),150);
  else if(g.role==="adr") minuteur=setTimeout(()=>surAdresse(g),280);
  else if(cible && cible!==g.ville) cacher();
  else if(g.role==="ville" && cible===g.ville && String(g.ville.value||"").trim()) cacher(); });
// en arrivant dans une ville vide alors que le code postal est rempli : on propose les communes
document.addEventListener("focusin", e=>{ const g=groupe(e.target); if(g && g.role==="ville" && !String(g.ville.value||"").trim() && cp5(g.cp.value)) surCodePostal(g); });
document.addEventListener("keydown", e=>{ if(!cible || e.target!==cible || !items.length) return;
  if(e.key==="ArrowDown"){ e.preventDefault(); surligner((actif+1)%items.length); }
  else if(e.key==="ArrowUp"){ e.preventDefault(); surligner((actif-1+items.length)%items.length); }
  else if(e.key==="Enter" && actif>=0){ e.preventDefault(); e.stopImmediatePropagation(); valider(actif); }
  else if(e.key==="Escape"){ e.preventDefault(); cacher(); } }, true);
document.addEventListener("focusout", e=>{ if(e.target===cible) setTimeout(()=>{ if(document.activeElement!==cible) cacher(); },120); });
window.addEventListener("resize", cacher);
document.addEventListener("scroll", e=>{ if(cible && box && !box.contains(e.target)) cacher(); }, true);
})();
