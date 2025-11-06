// UI helpers
export const $ = (sel, ctx=document) => ctx.querySelector(sel);
export const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));

export function setActiveTab(name){
  $$('.tab').forEach(t=>t.classList.remove('active'));
  $(`.tab[data-tab="${name}"]`)?.classList.add('active');
  $$('.tab-content').forEach(c=>c.classList.remove('active'));
  $(`#${name}`)?.classList.add('active');
}

export function toast(type, text, timeout=3500){
  const wrap = document.getElementById('global-messages');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = text;
  wrap.appendChild(el);
  setTimeout(()=>el.remove(), timeout);
}

export function confirmDialog(msg){
  return window.confirm(msg);
}

export function createModal(id, title, innerHTML){
  const modal = document.createElement('div');
  modal.className = 'modal active';
  modal.id = id;
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3 class="modal-title">${title}</h3>
        <button class="close-modal" data-close>&times;</button>
      </div>
      <div class="modal-body">${innerHTML}</div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e)=>{
    if(e.target.dataset.close !== undefined || e.target === modal){ modal.remove(); }
  });
  return modal;
}
