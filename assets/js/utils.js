
// utils.js (module)
export const qs = (sel, root=document) => root.querySelector(sel);
export const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

export function show(el) { el.style.display = ''; }
export function hide(el) { el.style.display = 'none'; }
export function html(el, h) { el.innerHTML = h; }
export function escapeHtml(s='') {
  return s.replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m]));
}
export function paginate({page, pages, onPage}) {
  const container = qs('#all-bets-pagination');
  if (!container) return;
  const btn = (p,label,active=false)=>`<button class="page-btn ${active?'active':''}" data-page="${p}">${label}</button>`;
  let h = '';
  if (page>1) h += btn(page-1,'«');
  h += btn(1,'1', page===1);
  if (page>3) h += '<span class="page-info">…</span>';
  for (let p=Math.max(2,page-1); p<=Math.min(pages-1,page+1); p++) {
    h += btn(p,String(p), p===page);
  }
  if (page<pages-2) h += '<span class="page-info">…</span>';
  if (pages>1) h += btn(pages,String(pages), page===pages);
  if (page<pages) h += btn(page+1,'»');
  container.innerHTML = h;
  qsa('.page-btn', container).forEach(b=>b.addEventListener('click', ()=> onPage(Number(b.dataset.page))));
}
export function timeago(d){
  try{ const dt=new Date(d); return dt.toLocaleString('pt-BR'); }catch(e){ return ''; }
}
