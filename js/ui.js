// js/ui.js
(function(){
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  function setActiveTab(name){
    $$('.tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===name));
    $$('.tab-content').forEach(c=>c.classList.toggle('active', c.id===name));
  }

  function showMessage(targetId, type, text, timeout=4000){
    const target = document.getElementById(targetId);
    if(!target) return;
    const div = document.createElement('div');
    div.className = `msg ${type}`;
    div.style.marginTop = '8px';
    div.style.padding = '10px';
    div.style.borderRadius = '8px';
    div.style.border = '1px solid var(--border)';
    div.style.background = type==='error' ? '#fdecea' : type==='success' ? '#e8f5e9' : '#e3f2fd';
    div.textContent = text;
    target.appendChild(div);
    setTimeout(()=>div.remove(), timeout);
  }

  // Modal
  const modal = $('#modal');
  const modalTitle = $('#modal-title');
  const modalBody = $('#modal-body');
  $('#modal-close').addEventListener('click', ()=> modal.classList.remove('open'));

  function openModal(title, content){
    modalTitle.textContent = title;
    modalBody.innerHTML = '';
    if(typeof content === 'string'){ modalBody.innerHTML = content; }
    else { modalBody.appendChild(content); }
    modal.classList.add('open');
  }

  function closeModal(){ modal.classList.remove('open'); }

  window.UI = { $, $$, setActiveTab, showMessage, openModal, closeModal };
})();
