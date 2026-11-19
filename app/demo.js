/* Mobilog — entreprise de démonstration : bandeau « Version de démonstration » + bouton de réinitialisation */
(function(){
"use strict";
const T = window.TP; if(!T) return;
const DEMO_ID = "de000000-0000-4000-8000-000000000001";
const { S, sb, $, toast, openModal, closeModal } = T;
const estDemo = () => S.entreprise && S.entreprise.id === DEMO_ID;
function bandeau(){
  const ex = document.getElementById("demoBar");
  if(!estDemo()){ if(ex) ex.remove(); return; }
  if(ex) return;
  const b = document.createElement("div"); b.id = "demoBar";
  b.style.cssText = "position:sticky;top:0;z-index:50;background:#F5B942;color:#1B2230;padding:8px 14px;font-size:13px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap";
  b.innerHTML = `<b>Version de démonstration</b><span>Données fictives — rien ici n'est réel.</span><button type="button" data-demo="ask" style="border:1px solid #1B2230;background:#fff;color:#1B2230;border-radius:8px;padding:4px 10px;cursor:pointer">Réinitialiser la démo</button>`;
  document.body.insertBefore(b, document.body.firstChild);
}
T.onData.push(bandeau);
document.addEventListener("click", async e=>{
  const el = e.target.closest("[data-demo]"); if(!el) return;
  if(el.dataset.demo === "ask"){
    openModal(`<h2>Réinitialiser la démo ?</h2><p class="muted">Tout ce qui a été saisi dans la démo sera effacé et remplacé par les exemples de départ. Aucune vraie entreprise n'est concernée.</p>
      <div class="row-btns"><button type="button" class="btn btn-ghost" data-act="close">Annuler</button><button type="button" class="btn btn-accent" data-demo="go">Réinitialiser</button></div>`);
  } else if(el.dataset.demo === "go"){
    el.disabled = true;
    const r = await sb.rpc("demo_reset");
    if(r.error){ toast(T.errMsg(r.error)); el.disabled = false; return; }
    closeModal(); toast("Démo réinitialisée"); await T.loadData();
  }
});
})();
