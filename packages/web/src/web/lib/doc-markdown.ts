// ─── Markdown <-> HTML pour l'aperçu éditable des fichiers du chat ──────────
//
// [2026-09-10] Les fichiers déposés par l'IA dans le chat (balises [FILE:…])
// s'ouvrent dans le rectangle de preview, MIS EN FORME et éditables. Il faut
// donc les deux sens :
//   markdownToHtml : source stockée -> HTML affiché dans le contentEditable
//   htmlToMarkdown : HTML édité par l'utilisateur -> source réenregistrée
//
// Volontairement sans dépendance : aucune lib markdown n'est installée dans le
// dépôt et on n'en ajoute pas. Couvre ce que l'IA produit réellement : titres,
// gras/italique/code, listes, tableaux, citations, blocs de code, séparateurs.
// Ce qui n'est pas reconnu reste du texte, jamais perdu.

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return out;
}

export function markdownToHtml(md: string): string {
  const lines = (md || '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let para: string[] = [];

  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    if (/^\s*```/.test(raw)) {
      if (inCode) { out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`); codeBuf = []; inCode = false; }
      else { flushPara(); closeList(); inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }

    // Tableau : en-tête + ligne de tirets + corps.
    if (/^\s*\|/.test(raw) && /^\s*\|?[\s:|-]+\|/.test(lines[i + 1] || '')) {
      flushPara(); closeList();
      const cells = (r: string) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      out.push('<table><thead><tr>' + cells(raw).map((h) => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>');
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        out.push('<tr>' + cells(lines[i]).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>');
        i++;
      }
      i--;
      out.push('</tbody></table>');
      continue;
    }

    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) { flushPara(); closeList(); out.push('<hr />'); continue; }

    const q = raw.match(/^\s*>\s?(.*)$/);
    if (q) { flushPara(); closeList(); out.push(`<blockquote>${inline(q[1])}</blockquote>`); continue; }

    const ul = raw.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    const ol = raw.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      flushPara();
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }

    if (raw.trim() === '') { flushPara(); closeList(); continue; }
    para.push(raw.trim());
  }
  if (inCode) out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  flushPara();
  closeList();
  return out.join('\n');
}

// ── Sens inverse : le DOM édité redevient du Markdown ───────────────────────

function inlineMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').replace(/\s+/g, ' ');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const kids = () => Array.from(el.childNodes).map(inlineMd).join('');
  switch (el.tagName) {
    case 'BR': return '\n';
    case 'STRONG': case 'B': {
      const t = kids().trim();
      return t ? `**${t}**` : '';
    }
    case 'EM': case 'I': {
      const t = kids().trim();
      return t ? `*${t}*` : '';
    }
    case 'CODE': {
      const t = kids().trim();
      return t ? `\`${t}\`` : '';
    }
    case 'A': {
      const t = kids().trim();
      const href = el.getAttribute('href') || '';
      return href && t ? `[${t}](${href})` : t;
    }
    default: return kids();
  }
}

/** Convertit le contenu d'un élément (le contentEditable) en Markdown. */
export function htmlToMarkdown(root: HTMLElement): string {
  const out: string[] = [];

  const walk = (el: Element) => {
    const tag = el.tagName;

    if (/^H[1-6]$/.test(tag)) {
      const t = inlineMd(el).trim();
      if (t) out.push(`${'#'.repeat(Number(tag[1]))} ${t}`, '');
      return;
    }
    if (tag === 'HR') { out.push('---', ''); return; }
    if (tag === 'PRE') {
      out.push('```', (el.textContent || '').replace(/\n$/, ''), '```', '');
      return;
    }
    if (tag === 'BLOCKQUOTE') {
      const t = inlineMd(el).trim();
      if (t) out.push(...t.split('\n').map((l) => `> ${l}`), '');
      return;
    }
    if (tag === 'UL' || tag === 'OL') {
      let n = 1;
      for (const li of Array.from(el.children)) {
        if (li.tagName !== 'LI') continue;
        const t = inlineMd(li).trim();
        if (!t) continue;
        out.push(tag === 'OL' ? `${n++}. ${t}` : `- ${t}`);
      }
      out.push('');
      return;
    }
    if (tag === 'TABLE') {
      const rows = Array.from(el.querySelectorAll('tr'));
      if (!rows.length) return;
      const cellsOf = (tr: Element) => Array.from(tr.children).map((c) => inlineMd(c).trim().replace(/\|/g, '\\|'));
      const head = cellsOf(rows[0]);
      out.push(`| ${head.join(' | ')} |`);
      out.push(`| ${head.map(() => '---').join(' | ')} |`);
      for (const tr of rows.slice(1)) out.push(`| ${cellsOf(tr).join(' | ')} |`);
      out.push('');
      return;
    }
    if (tag === 'P' || tag === 'DIV') {
      // Un DIV peut être un conteneur produit par le navigateur pendant la
      // frappe : s'il contient des blocs, on descend au lieu de l'aplatir.
      const hasBlock = Array.from(el.children).some((c) =>
        /^(H[1-6]|P|DIV|UL|OL|TABLE|PRE|BLOCKQUOTE|HR)$/.test(c.tagName));
      if (tag === 'DIV' && hasBlock) { for (const c of Array.from(el.children)) walk(c); return; }
      const t = inlineMd(el).trim();
      if (t) out.push(t, '');
      return;
    }
    // Élément inconnu : on récupère au moins son texte.
    const t = inlineMd(el).trim();
    if (t) out.push(t, '');
  };

  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) walk(child as Element);
    else if (child.nodeType === Node.TEXT_NODE) {
      const t = (child.textContent || '').trim();
      if (t) out.push(t, '');
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
