
export function qs(sel, root=document){ return root.querySelector(sel); }
export function qsa(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }
export function show(el){ el.style.display='block'; }
export function hide(el){ el.style.display='none'; }
export function setActiveTab(id){
  qsa('.tab').forEach(t=>t.classList.remove('active'));
  qsa('.tab-content').forEach(c=>c.classList.remove('active'));
  const btn = qs(`.tab[data-tab="${id}"]`);
  const panel = qs(`#${id}`);
  if(btn) btn.classList.add('active');
  if(panel) panel.classList.add('active');
}
export function toast(container, type, text){
  if(!container) return;
  container.innerHTML = `<div class="card message ${type}">${text}</div>`;
  setTimeout(()=>{ container.innerHTML=''; }, 5000);
}
export function openModal(title, html){
  const modal = qs('#modal'); const body = qs('#modal-body'); const h = qs('#modal-title');
  h.textContent = title; body.innerHTML = html; modal.classList.add('active');
}
export function closeModal(){ qs('#modal').classList.remove('active'); qs('#modal-body').innerHTML=''; }
export function paginate(total, page, pageSize){
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const items = [];
  for(let p=1;p<=pages;p++){ items.push({p, active: p===page}); }
  return items;
}
