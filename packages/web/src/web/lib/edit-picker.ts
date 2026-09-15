// ─── Mode « Edit » visuel de l'aperçu : script injecté DANS l'iframe ─────────
//
// [2026-09-13] Demande de l'utilisateur : « quand j'active Edit, le bouton
// devient "Exit edit", et quand je passe la souris sur un objet du site son
// contour devient bleu ; quand je clique dessus un rectangle s'ouvre où j'écris
// un prompt de modification ; à l'envoi, l'IA sait PRÉCISÉMENT quoi changer et
// va donc beaucoup plus vite. »
//
// Ce fichier ne contient QUE le code qui tourne à l'intérieur de l'iframe du
// site (même origine : /api/companies/:id/preview/... et /website). Il est
// injecté comme <script> par WebsitePreview quand le mode Edit s'active, et
// entièrement retiré quand on en sort (aucune trace : plus d'overlay, plus de
// curseur crosshair, plus d'interception de clic).
//
// Protocole (postMessage vers le parent) :
//   { type: 'velbaz-edit-ready' }
//   { type: 'velbaz-edit-pick', data: ElementPick }   ← clic sur un élément
//   { type: 'velbaz-edit-rect', rect }                ← l'élément a bougé (scroll)
//   { type: 'velbaz-edit-cancel' }                    ← Échap / clic dans le vide
// Messages reçus du parent :
//   { type: 'velbaz-edit-clear' }  → efface la sélection
//   { type: 'velbaz-edit-parent' } → élargit la sélection au bloc parent
//   { type: 'velbaz-edit-stop' }   → démonte tout
//
// La même logique d'identification d'élément que l'éditeur autonome
// (editor.tsx → IFRAME_SCRIPT_FN/getPath) est utilisée, pour que le backend
// reçoive un ciblage cohérent entre les deux éditeurs.

/** Élément choisi dans l'iframe, tel qu'il arrive au parent. */
export type ElementPick = {
  /** Chemin CSS depuis <body> — ex. `body > div#root > main > section:nth-of-type(2) > h1`. */
  tagPath: string;
  tagName: string;
  /** Texte visible, tronqué. */
  text: string;
  className: string;
  elementId: string;
  /** Position dans la fenêtre de l'iframe (= coordonnées du rectangle d'aperçu). */
  rect: { top: number; left: number; width: number; height: number };
  /** Quelques attributs utiles (href, src, alt, placeholder, type, aria-label). */
  attrs: Record<string, string>;
  /** Résumé lisible pour l'affichage dans la bulle. */
  label: string;
};

export const EDIT_PICKER_MARKER = '__velbazEditPicker';

/**
 * Source du script injecté. `accent` = couleur du contour.
 * [2026-09-13] Contour BLEU (demande utilisateur) : le bleu d'accent
 * identifie l'élément survolé / sélectionné dans la page.
 */
export function editPickerScript(accent = '#2f7dff'): string {
  return `(function(){
  if (window.${EDIT_PICKER_MARKER}) { try { window.${EDIT_PICKER_MARKER}.ping(); } catch(e){} return; }
  var ACCENT = ${JSON.stringify(accent)};
  var doc = document;
  var hostBody = doc.body || doc.documentElement;
  if (!hostBody) return;

  function post(msg){ try { window.parent.postMessage(msg, '*'); } catch(e){} }

  // ── Curseur + neutralisation des interactions du site ────────────────────
  var style = doc.createElement('style');
  style.setAttribute('data-velbaz-edit','1');
  style.textContent = '*{cursor:crosshair !important}[data-velbaz-ov]{cursor:default !important}';
  (doc.head || hostBody).appendChild(style);

  // ── Overlays (contour survol + contour sélection + étiquette) ────────────
  function mkOv(solid){
    var d = doc.createElement('div');
    d.setAttribute('data-velbaz-ov','1');
    d.style.cssText = 'position:fixed;display:none;pointer-events:none;z-index:2147483600;'
      + 'border:2px ' + (solid ? 'solid ' : 'dashed ') + ACCENT + ';border-radius:4px;'
      + 'background:' + (solid ? 'rgba(47,125,255,0.14)' : 'rgba(47,125,255,0.07)') + ';'
      + 'box-shadow:0 0 0 1px rgba(0,0,0,0.35);'
      + 'transition:top .05s linear,left .05s linear,width .05s linear,height .05s linear;';
    hostBody.appendChild(d);
    return d;
  }
  var hoverOv = mkOv(false);
  var selOv = mkOv(true);

  var tag = doc.createElement('div');
  tag.setAttribute('data-velbaz-ov','1');
  tag.style.cssText = 'position:fixed;display:none;pointer-events:none;z-index:2147483601;'
    + 'padding:2px 7px;border-radius:6px;background:#2f7dff;color:#fff;'
    + 'border:1px solid rgba(255,255,255,0.18);'
    + 'font:600 11px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;'
    + 'letter-spacing:.2px;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.35);';
  hostBody.appendChild(tag);

  function place(ov, r){
    ov.style.top = r.top + 'px'; ov.style.left = r.left + 'px';
    ov.style.width = r.width + 'px'; ov.style.height = r.height + 'px';
    ov.style.display = (r.width > 0 && r.height > 0) ? 'block' : 'none';
  }

  // ── Identification de l'élément ──────────────────────────────────────────
  function isOv(el){ return !!(el && el.nodeType === 1 && el.getAttribute && el.getAttribute('data-velbaz-ov')); }
  function pickable(el){
    return !!(el && el.nodeType === 1 && !isOv(el) && el !== doc.body && el !== doc.documentElement);
  }
  function getPath(el){
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && parts.length < 12) {
      var sel = node.tagName.toLowerCase();
      if (node.id) { sel += '#' + node.id; parts.unshift(sel); break; }
      var p = node.parentElement;
      if (p) {
        var same = [], kids = p.children;
        for (var i = 0; i < kids.length; i++) if (kids[i].tagName === node.tagName) same.push(kids[i]);
        if (same.length > 1) sel += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(sel);
      if (!p || p === doc.body) { parts.unshift('body'); break; }
      node = p;
    }
    return parts.join(' > ');
  }
  function textOf(el){
    var t = (el.innerText || el.textContent || '').replace(/\\s+/g,' ').trim();
    return t.length > 140 ? t.slice(0,140) + '…' : t;
  }
  function attrsOf(el){
    var out = {};
    ['href','src','alt','placeholder','type','aria-label','name','value'].forEach(function(k){
      try { var v = el.getAttribute(k); if (v) out[k] = String(v).slice(0,180); } catch(e){}
    });
    return out;
  }
  function labelOf(el){
    var n = el.tagName.toLowerCase();
    var cls = (el.className && typeof el.className === 'string') ? el.className.trim().split(/\\s+/).slice(0,2).join('.') : '';
    var t = textOf(el);
    var base = '<' + n + '>' + (cls ? ' .' + cls : '');
    return t ? base + ' — ' + (t.length > 42 ? t.slice(0,42) + '…' : t) : base;
  }
  function payload(el){
    var r = el.getBoundingClientRect();
    return {
      tagPath: getPath(el),
      tagName: el.tagName.toLowerCase(),
      text: textOf(el),
      className: (el.className && typeof el.className === 'string') ? el.className : '',
      elementId: el.id || '',
      rect: { top: r.top, left: r.left, width: r.width, height: r.height },
      attrs: attrsOf(el),
      label: labelOf(el)
    };
  }

  // ── Survol ───────────────────────────────────────────────────────────────
  var hoverEl = null, selEl = null, lastRectKey = '';
  function onMove(e){
    var el = e.target;
    if (!pickable(el)) { hoverEl = null; hoverOv.style.display = 'none'; tag.style.display = 'none'; return; }
    if (el === selEl) { hoverEl = null; hoverOv.style.display = 'none'; tag.style.display = 'none'; return; }
    if (el === hoverEl) return;
    hoverEl = el;
    var r = el.getBoundingClientRect();
    place(hoverOv, r);
    tag.textContent = labelOf(el);
    tag.style.display = 'block';
    var th = tag.offsetHeight || 18;
    tag.style.top = Math.max(2, r.top - th - 5) + 'px';
    tag.style.left = Math.max(2, Math.min(r.left, (window.innerWidth || 0) - (tag.offsetWidth || 60) - 4)) + 'px';
  }
  function onLeave(){ hoverEl = null; hoverOv.style.display = 'none'; tag.style.display = 'none'; }

  // ── Clic = sélection (et on bloque tout ce que le site aurait fait) ──────
  function swallow(e){ e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); }
  function onClick(e){
    swallow(e);
    var el = e.target;
    if (!pickable(el)) { selEl = null; selOv.style.display = 'none'; post({ type:'velbaz-edit-cancel' }); return; }
    select(el);
  }
  function select(el){
    selEl = el;
    lastRectKey = '';
    hoverEl = null; hoverOv.style.display = 'none'; tag.style.display = 'none';
    place(selOv, el.getBoundingClientRect());
    post({ type:'velbaz-edit-pick', data: payload(el) });
  }
  function selectParent(){
    if (!selEl) return;
    var p = selEl.parentElement;
    if (!pickable(p)) return;
    select(p);
  }
  function onKey(e){
    if (e.key === 'Escape') { clearSel(); post({ type:'velbaz-edit-cancel' }); }
  }
  function clearSel(){ selEl = null; selOv.style.display = 'none'; }

  // ── Suivi du scroll / redimensionnement ──────────────────────────────────
  function sync(){
    if (hoverEl && doc.contains(hoverEl)) place(hoverOv, hoverEl.getBoundingClientRect()); else { hoverOv.style.display='none'; tag.style.display='none'; }
    if (selEl) {
      if (!doc.contains(selEl)) { clearSel(); post({ type:'velbaz-edit-cancel' }); return; }
      var r = selEl.getBoundingClientRect();
      place(selOv, r);
      // On ne prévient le parent que si la bulle doit vraiment bouger
      // (sinon on le ferait 2,5 fois par seconde pour rien).
      var k = Math.round(r.top) + ':' + Math.round(r.left) + ':' + Math.round(r.width) + ':' + Math.round(r.height);
      if (k !== lastRectKey) {
        lastRectKey = k;
        post({ type:'velbaz-edit-rect', rect: { top:r.top, left:r.left, width:r.width, height:r.height } });
      }
    }
  }

  var opts = true; // capture
  doc.addEventListener('mousemove', onMove, opts);
  doc.addEventListener('mouseleave', onLeave, opts);
  doc.addEventListener('click', onClick, opts);
  doc.addEventListener('mousedown', swallow, opts);
  doc.addEventListener('mouseup', swallow, opts);
  doc.addEventListener('submit', swallow, opts);
  doc.addEventListener('keydown', onKey, opts);
  window.addEventListener('scroll', sync, true);
  window.addEventListener('resize', sync, true);
  var syncTimer = setInterval(sync, 400);

  function onParentMsg(e){
    var d = e && e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'velbaz-edit-clear') clearSel();
    else if (d.type === 'velbaz-edit-parent') selectParent();
    else if (d.type === 'velbaz-edit-stop') stop();
  }
  window.addEventListener('message', onParentMsg);

  function stop(){
    try { clearInterval(syncTimer); } catch(e){}
    doc.removeEventListener('mousemove', onMove, opts);
    doc.removeEventListener('mouseleave', onLeave, opts);
    doc.removeEventListener('click', onClick, opts);
    doc.removeEventListener('mousedown', swallow, opts);
    doc.removeEventListener('mouseup', swallow, opts);
    doc.removeEventListener('submit', swallow, opts);
    doc.removeEventListener('keydown', onKey, opts);
    window.removeEventListener('scroll', sync, true);
    window.removeEventListener('resize', sync, true);
    window.removeEventListener('message', onParentMsg);
    [hoverOv, selOv, tag, style].forEach(function(n){ try { n.parentNode && n.parentNode.removeChild(n); } catch(e){} });
    try {
      var leftovers = doc.querySelectorAll('[data-velbaz-ov],style[data-velbaz-edit]');
      for (var i = 0; i < leftovers.length; i++) leftovers[i].parentNode.removeChild(leftovers[i]);
    } catch(e){}
    try { delete window.${EDIT_PICKER_MARKER}; } catch(e){ window.${EDIT_PICKER_MARKER} = null; }
  }

  window.${EDIT_PICKER_MARKER} = { stop: stop, clear: clearSel, parent: selectParent, ping: function(){}, sync: sync };
  post({ type:'velbaz-edit-ready' });
})();`;
}

/**
 * Construit l'instruction envoyée au backend. Le ciblage exact (fichier de la
 * page + sélecteur DOM + texte visible) permet à `project-edit` de sauter
 * l'étape de planification de l'IA et d'aller droit au bon fichier.
 */
export function buildEditInstruction(pick: ElementPick, prompt: string, pageSlug: string): string {
  const attrs = Object.entries(pick.attrs).map(([k, v]) => `  - ${k}="${v}"`).join('\n');
  return [
    'ÉDITION VISUELLE CIBLÉE — l\'utilisateur a cliqué sur un élément précis de l\'aperçu.',
    '',
    'ÉLÉMENT CIBLE (ne touche à RIEN d\'autre) :',
    `  - page affichée : /${pageSlug === 'index' ? '' : pageSlug}`,
    `  - sélecteur DOM : ${pick.tagPath}`,
    `  - balise : <${pick.tagName}>`,
    pick.elementId ? `  - id : #${pick.elementId}` : '',
    pick.className ? `  - class : ${pick.className}` : '',
    pick.text ? `  - texte visible : "${pick.text}"` : '',
    attrs ? `  - attributs :\n${attrs}` : '',
    '',
    'MODIFICATION DEMANDÉE :',
    prompt.trim(),
    '',
    // Le fichier exact est résolu côté serveur (chemin DOM + texte visible →
    // fichier qui rend vraiment l'élément, y compris un composant partagé
    // Header/Footer). On ne nomme donc JAMAIS un fichier ici : dire « le
    // fichier de la page » faisait éditer la page alors que l'élément venait du
    // Header, et le modèle écrivait son raisonnement dans le fichier.
    'Contraintes : modifie uniquement le code source qui produit cet élément. Si l\'élément vient d\'un composant partagé (header, nav, footer, layout), c\'est ce composant qu\'il faut modifier, pas la page. Aucune refonte, aucun autre fichier, aucun autre élément : le reste du rendu doit rester identique au pixel.',
  ].filter(Boolean).join('\n');
}
