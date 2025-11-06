// UI helpers
export function $(sel, root=document){ return root.querySelector(sel); }
export function $all(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

export function showSection(id){
  $all('.tab-content').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  $all('.tab').forEach(t=>t.classList.remove('active'));
  const tab = document.querySelector(`.tab[data-tab="${id}"]`);
  if(tab) tab.classList.add('active');
}

export function bindTabs(){
  $all('.tab').forEach(btn=>{
    btn.addEventListener('click', ()=> showSection(btn.dataset.tab));
  });
}

export function setUserInfo(html){ $('#user-info').innerHTML = html; }

export function notify(type, text){
  const box = $('#save-message');
  box.innerHTML = `<div class="message ${type}">${text}</div>`;
  setTimeout(()=>{ box.innerHTML = ''; }, 5000);
}

// Simple modal
const modal = $('#modal');
$('#modal-close').addEventListener('click', () => modal.classList.remove('open'));

export function openModal(title, bodyHtml){
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  modal.classList.add('open');
}
