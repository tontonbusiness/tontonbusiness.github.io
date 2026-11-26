/* Mobilog — BL / CMR et documents d'une course en PDF (un document, toute la course, ou toute une facture) — Tonton Business
   Tout se fait dans le navigateur : les photos d'origine ne sont ni modifiées ni recadrées. */
(function(){
"use strict";
const T = window.TP; if(!T) return;
const { S, sb, toast, frDate } = T;

const LIB = { src:"https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js",
  sri:"sha384-weMABwrltA6jWR8DDe9Jp5blk+tZQh7ugpCsF3JwSA53WZM9/14PjS5LAJNHNjAI" };
let libP=null;
const chargerLib = () => window.PDFLib ? Promise.resolve(window.PDFLib) : (libP = libP || new Promise((ok,ko)=>{
  const s=document.createElement("script"); s.src=LIB.src; s.integrity=LIB.sri; s.crossOrigin="anonymous";
  s.onload=()=>ok(window.PDFLib); s.onerror=()=>{ libP=null; ko(new Error("pdf_lib")); }; document.head.appendChild(s); }));

const TYPES = { bl:"BL / CMR", signature:"Signature du destinataire", reserve:"Photo de la réserve", confirmation:"Confirmation client" };
const ORDRE = { bl:1, signature:2, reserve:3, confirmation:4 };
const A4 = [595.28, 841.89];
// la police standard des PDF ne connaît que l'alphabet latin courant : on remplace le reste
const txt = s => String(s||"").replace(/[→]/g,"->").replace(/[’‘]/g,"'").replace(/[“”«»]/g,'"').replace(/[–—]/g,"-").replace(/[^\x20-\x7E -ÿ]/g,"");
const jj = iso => iso ? frDate(String(iso).slice(0,10),{day:"2-digit",month:"2-digit",year:"numeric"}) : "";
const propre = s => String(s||"").normalize("NFC").replace(/[\\/:*?"<>|#%{}~&]+/g," ").replace(/\s+/g," ").trim().slice(0,80);
const nomCourse = c => [c.ref, c.donneur, jj(c.enlDate||c.enl_date).replace(/\//g,"-")].filter(Boolean).map(propre).join(" - ") || "course";

async function telecharger(path){
  const {data,error}=await sb.storage.from("documents").download(path);
  if(error) throw error; return data;
}
// photo -> JPEG raisonnable (orientation du téléphone respectée), sans recadrage
async function enJpeg(blob){
  let img;
  try{ img=await createImageBitmap(blob,{imageOrientation:"from-image"}); }
  catch(e){ img=await new Promise((ok,ko)=>{ const i=new Image(); i.onload=()=>ok(i); i.onerror=()=>ko(new Error("image_illisible")); i.src=URL.createObjectURL(blob); }); }
  const w0=img.width, h0=img.height, k=Math.min(1, 2400/Math.max(w0,h0));
  const cv=document.createElement("canvas"); cv.width=Math.round(w0*k); cv.height=Math.round(h0*k);
  const g=cv.getContext("2d"); g.fillStyle="#fff"; g.fillRect(0,0,cv.width,cv.height); g.drawImage(img,0,0,cv.width,cv.height);
  const out=await new Promise(ok=>cv.toBlob(ok,"image/jpeg",0.88));
  return { bytes:new Uint8Array(await out.arrayBuffer()), w:cv.width, h:cv.height };
}
async function estPdf(blob){ const t=new Uint8Array(await blob.slice(0,5).arrayBuffer()); return String.fromCharCode(...t)==="%PDF-"; }

// ajoute un document (photo ou PDF) au PDF en cours, avec une légende discrète en bas de page
async function ajouter(L, pdf, police, blob, legende){
  if(await estPdf(blob)){
    try{ const src=await L.PDFDocument.load(await blob.arrayBuffer(),{ignoreEncryption:true});
      const pages=await pdf.copyPages(src, src.getPageIndices()); pages.forEach(p=>pdf.addPage(p)); return; }
    catch(e){ const p=pdf.addPage(A4); p.drawText(txt("Document PDF illisible : "+legende),{x:40,y:A4[1]-60,size:12,font:police}); return; }
  }
  const im=await enJpeg(blob); const jpg=await pdf.embedJpg(im.bytes);
  const pay = im.w>im.h; const [W,H]= pay?[A4[1],A4[0]]:A4; const page=pdf.addPage([W,H]);
  const m=18, bas=26, k=Math.min((W-2*m)/im.w,(H-m-bas)/im.h), w=im.w*k, h=im.h*k;
  page.drawImage(jpg,{x:(W-w)/2, y:bas+(H-m-bas-h)/2, width:w, height:h});
  page.drawText(txt(legende),{x:m,y:9,size:8,font:police});
}
function enregistrer(octets, nom){
  const url=URL.createObjectURL(new Blob([octets],{type:"application/pdf"}));
  const a=document.createElement("a"); a.href=url; a.download=propre(nom)+".pdf"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function nouveau(titre){ const L=await chargerLib(); const pdf=await L.PDFDocument.create(); pdf.setTitle(txt(titre)); pdf.setCreator("Mobilog"); pdf.setProducer("Mobilog"); const police=await pdf.embedFont(L.StandardFonts.Helvetica); const gras=await pdf.embedFont(L.StandardFonts.HelveticaBold); return {L,pdf,police,gras}; }
const legendeDoc = (c,d) => [TYPES[d.type]||"Document", c.ref?"Réf. "+c.ref:"", c.donneur, (c.enlVille||c.enl_ville||"?")+" -> "+(c.livVille||c.liv_ville||"?"), jj(c.livDate||c.liv_date||c.enlDate||c.enl_date)].filter(Boolean).join(" · ");
const docsTries = c => (c.docs||[]).filter(d=>d&&d.path).slice().sort((a,b)=>(ORDRE[a.type]||9)-(ORDRE[b.type]||9));

// 1. un seul document
async function unDoc(cid, path){
  const c=S.courses.find(x=>x.id===cid)||{}; const d=(c.docs||[]).find(x=>x.path===path)||{path,type:"bl"};
  const {L,pdf,police}=await nouveau(TYPES[d.type]||"Document");
  await ajouter(L,pdf,police,await telecharger(path),legendeDoc(c,d));
  enregistrer(await pdf.save(), (d.type==="bl"?"CMR":(TYPES[d.type]||"Document"))+" "+nomCourse(c));
}
// 2. tous les documents de la course
async function toutCourse(cid){
  const c=S.courses.find(x=>x.id===cid); if(!c) return; const L0=docsTries(c); if(!L0.length){ toast("Aucun document sur cette course."); return; }
  const {L,pdf,police}=await nouveau("Documents "+nomCourse(c)); let ko=0;
  for(const d of L0){ try{ await ajouter(L,pdf,police,await telecharger(d.path),legendeDoc(c,d)); }catch(e){ ko++; } }
  if(!pdf.getPageCount()){ toast("Les documents n'ont pas pu être récupérés. Réessayez."); return; }
  enregistrer(await pdf.save(), "Documents "+nomCourse(c));
  if(ko) toast(ko+" document"+(ko>1?"s n'ont":" n'a")+" pas pu être ajouté"+(ko>1?"s":"")+".");
}
// 3. tous les BL / CMR d'une facture, dans l'ordre des lignes, avec une page récapitulative
async function toutFacture(pid){
  const F=T.F; const p=F&&F.pieces.find(x=>x.id===pid); if(!p) return;
  const ids=[...new Set((p.lignes||[]).map(l=>l.course_id).filter(Boolean))]; if(!ids.length){ toast("Cette facture ne contient aucun transport."); return; }
  const {data,error}=await sb.from("courses").select("id,ref,donneur,enl_ville,liv_ville,enl_date,liv_date,docs").in("id",ids);
  if(error){ toast(T.errMsg(error)); return; }
  const parId=Object.fromEntries((data||[]).map(c=>[c.id,{...c,enlDate:c.enl_date,livDate:c.liv_date,enlVille:c.enl_ville,livVille:c.liv_ville}]));
  const client=(F.clients.find(x=>x.id===p.client_id)||{}).nom||"";
  const {L,pdf,police,gras}=await nouveau("CMR facture "+(p.numero||""));
  const recap=pdf.addPage(A4); let y=A4[1]-60;
  recap.drawText(txt("BL / CMR de la facture "+(p.numero||"(brouillon)")),{x:40,y,size:16,font:gras}); y-=20;
  recap.drawText(txt([client, p.date_emission?"du "+jj(p.date_emission):""].filter(Boolean).join(" · ")),{x:40,y,size:11,font:police}); y-=28;
  let manque=0, ko=0; const lignes=[];
  for(const id of ids){
    const c=parId[id]; if(!c){ lignes.push("Transport introuvable"); manque++; continue; }
    const bl=docsTries(c).filter(d=>d.type==="bl"||d.type==="signature");
    const desc=[jj(c.enlDate), (c.enlVille||"?")+" -> "+(c.livVille||"?"), c.ref?"Réf. "+c.ref:""].filter(Boolean).join("  ");
    if(!bl.some(d=>d.type==="bl")){ manque++; lignes.push(desc+"   -   CMR MANQUANT"); }
    else lignes.push(desc+"   -   page "+(pdf.getPageCount()+1));
    for(const d of bl){ try{ await ajouter(L,pdf,police,await telecharger(d.path),legendeDoc(c,d)); }catch(e){ ko++; } }
  }
  lignes.forEach(t=>{ if(y<50) return; recap.drawText(txt(t),{x:40,y,size:10,font:/MANQUANT/.test(t)?gras:police}); y-=15; });
  if(lignes.length*15>A4[1]-150) recap.drawText(txt("(liste tronquée)"),{x:40,y:36,size:9,font:police});
  enregistrer(await pdf.save(), "CMR facture "+(p.numero||"brouillon")+(client?" - "+client:""));
  if(manque||ko) toast([manque?manque+" transport"+(manque>1?"s":"")+" sans CMR":"", ko?ko+" document"+(ko>1?"s":"")+" non récupéré"+(ko>1?"s":""):""].filter(Boolean).join(" · ")+" (voir la 1re page).");
}

document.addEventListener("click", async e=>{
  const el=e.target.closest("[data-pdf],[data-pdfall],[data-pdffact]"); if(!el || el.disabled) return;
  e.preventDefault(); const d=el.dataset; const avant=el.textContent; el.disabled=true; el.textContent="Préparation du PDF…";
  try{
    if(d.pdffact) await toutFacture(d.pdffact);
    else if(d.pdfall) await toutCourse(d.pdfall);
    else await unDoc(d.cid, d.pdf);
  }catch(err){ console.error(err); toast(err&&err.message==="pdf_lib" ? "Le module PDF n'a pas pu se charger. Vérifiez la connexion et réessayez." : "Le PDF n'a pas pu être créé. Réessayez."); }
  finally{ el.disabled=false; el.textContent=avant; }
});
})();
