import { API_BASE_URL } from './config.js';
import { toast } from './ui.js';

export async function initNewsWall() {
  const token = localStorage.getItem('token');
  const container = document.getElementById('newsWall');
  if (!container || !token) return;

  try {
    const res = await fetch(`${API_BASE_URL}/api/news`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) return;

    const news = await res.json();
    container.innerHTML = '';

    news.forEach(n => {
      const el = document.createElement('div');
      el.className = 'news-item';

      const reactionsHtml = (n.reactions || [])
        .map(r => `
          <button 
            class="news-reaction"
            data-id="${n.id}"
            data-emoji="${r.emoji}">
            ${r.emoji} ${r.count}
          </button>
        `)
        .join('');

      el.innerHTML = `
        <div class="news-text">
          <strong>${n.user.name}:</strong> ${n.text}
        </div>
        <div class="news-reactions">
          ${reactionsHtml}
          <button class="news-reaction add" 
            data-id="${n.id}" data-emoji="😂">😂</button>
          <button class="news-reaction add" 
            data-id="${n.id}" data-emoji="🔥">🔥</button>
          <button class="news-reaction add" 
            data-id="${n.id}" data-emoji="👀">👀</button>
        </div>
      `;

      container.appendChild(el);
    });

    wireReactions(container, token);

  } catch (err) {
    console.error('Erro no mural:', err);
  }
}

function wireReactions(container, token) {
  container.querySelectorAll('.news-reaction').forEach(btn => {
    btn.onclick = async () => {
      const messageId = btn.dataset.id;
      const emoji = btn.dataset.emoji;

      try {
        const res = await fetch(
          `${API_BASE_URL}/api/news/${messageId}/react`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ emoji })
          }
        );

        if (!res.ok) throw new Error();

        // 🔄 recarrega mural
        initNewsWall();

      } catch {
        toast('Erro ao reagir', 'error');
      }
    };
  });
}

