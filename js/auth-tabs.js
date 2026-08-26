// js/auth-tabs.js
export function initAuthTabs() {
  const tabs = document.querySelectorAll('.auth-tab');
  const contents = document.querySelectorAll('.auth-tab-content');

  if (!tabs.length || !contents.length) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.target;

      // remove active de tudo
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));

      // ativa aba clicada
      tab.classList.add('active');

      // ativa conteúdo correto
      const content = document.getElementById(`tab-${target}`);
      if (content) {
        content.classList.add('active');
      }
    });
  });

  // estado inicial seguro
  tabs[0].classList.add('active');
  contents[0].classList.add('active');
}