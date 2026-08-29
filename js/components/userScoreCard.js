export function renderUserScoreCard({
  container,
  user,
  position = null,
  accuracy = null,
  editableAvatar = false,
  onAvatarChange = null
}) {
  if (!container || !user) return;

  /**
   * Função auxiliar para gerar o Donut SVG
   * Mantém o gráfico sincronizado com o percentual
   */
  const renderDonut = (percent, colorClass) => {
    const radius = 15;
    const circumference = 2 * Math.PI * radius; // Aprox 94.24
    const validPercent = percent !== null ? Math.min(Math.max(percent, 0), 100) : 0;
    const offset = circumference - (validPercent / 100) * circumference;
    
    return `
      <div class="accuracy-donut-container">
        <svg width="34" height="34" viewBox="0 0 40 40">
          <circle 
            cx="20" cy="20" r="${radius}" 
            fill="transparent" 
            stroke="rgba(255,255,255,0.05)" 
            stroke-width="4"
          />
          <circle 
            class="donut-fill ${colorClass}" 
            cx="20" cy="20" r="${radius}" 
            fill="transparent" 
            stroke-width="4" 
            stroke-dasharray="${circumference}" 
            stroke-dashoffset="${offset}" 
            stroke-linecap="round"
            transform="rotate(-90 20 20)"
            style="transition: stroke-dashoffset 0.5s ease-out"
          />
        </svg>
      </div>
    `;
  };

  container.innerHTML = `
    <div class="profile-premium-card">

      <div class="profile-premium-header">
        <div class="profile-user-left">
          <div class="profile-avatar-ring ${editableAvatar ? 'profile-avatar-editable' : ''}">
            ${
              user.avatar
                ? `<img
                    class="profile-avatar-image"
                    src="${user.avatar}"
                    alt="Foto de perfil"
                    loading="lazy"
                  />`
                : `<div class="profile-avatar-letter">
                    ${(user.name || '?').charAt(0).toUpperCase()}
                  </div>`
            }
            ${
              editableAvatar
                ? `
                  <button
                    type="button"
                    class="profile-avatar-edit-button"
                    aria-label="Alterar foto de perfil"
                    title="Alterar foto de perfil"
                  >📷</button>
                  <input
                    type="file"
                    class="profile-avatar-file-input"
                    accept="image/*"
                    hidden
                  />
                `
                : ''
            }
          </div>

          <div class="profile-user-meta">
            <div class="profile-user-name">
              ${user.name}
            </div>
            ${
              position !== null
                ? `<div class="profile-rank-badge">#${position}</div>`
                : ''
            }
          </div>
        </div>

        <div class="profile-total-side">
          <div class="profile-total-points">${user.points ?? 0}</div>
          <div class="profile-total-label">PONTOS TOTAIS</div>
        </div>
      </div>

      ${
        user.breakdown
          ? `
            <div class="profile-breakdown-grid">
              <div class="profile-stat-box">
                <div class="profile-stat-value">${user.breakdown.groups ?? 0}</div>
                <div class="profile-stat-label">Grupos</div>
                <div class="profile-stat-icon">👥</div>
              </div>

              <div class="profile-stat-divider"></div>

              <div class="profile-stat-box">
                <div class="profile-stat-value">${user.breakdown.knockout ?? 0}</div>
                <div class="profile-stat-label">Mata-mata</div>
                <div class="profile-stat-icon">⚔️</div>
              </div>

              <div class="profile-stat-divider"></div>

              <div class="profile-stat-box">
                <div class="profile-stat-value">${user.breakdown.podium ?? 0}</div>
                <div class="profile-stat-label">Pódio</div>
                <div class="profile-stat-icon">🏆</div>
              </div>

              ${(user.breakdown.bonus > 0) ? `
                <div class="profile-stat-divider"></div>
                <div class="profile-stat-box">
                  <div class="profile-stat-value">${user.breakdown.bonus}</div>
                  <div class="profile-stat-label">Bônus</div>
                  <div class="profile-stat-icon">🎁</div>
                </div>
              ` : ''}

              ${(user.breakdown.extras > 0) ? `
                <div class="profile-stat-divider"></div>
                <div class="profile-stat-box">
                  <div class="profile-stat-value">${user.breakdown.extras}</div>
                  <div class="profile-stat-label">Extras</div>
                  <div class="profile-stat-icon">✨</div>
                </div>
              ` : ''}
            </div>
          `
          : ''
      }

      ${
        accuracy
          ? `
            <div class="profile-accuracy-wrapper">
              <div class="profile-accuracy-title">APROVEITAMENTO</div>

              <div class="profile-accuracy-grid">
                
                <div class="accuracy-card">
                  <div class="accuracy-text-group">
                    <div class="accuracy-value blue">
                      ${accuracy.group !== null ? `${accuracy.group}%` : '—'}
                    </div>
                    <div class="accuracy-sub">Grupos</div>
                  </div>
                  ${renderDonut(accuracy.group, 'blue')}
                </div>

                <div class="accuracy-divider"></div>

                <div class="accuracy-card">
                  <div class="accuracy-text-group">
                    <div class="accuracy-value purple">
                      ${accuracy.knockout !== null ? `${accuracy.knockout}%` : '—'}
                    </div>
                    <div class="accuracy-sub">Mata-mata</div>
                  </div>
                  ${renderDonut(accuracy.knockout, 'purple')}
                </div>

              </div>
            </div>
          `
          : ''
      }

    </div>
  `;

  if (editableAvatar && typeof onAvatarChange === 'function') {
    const avatarRing = container.querySelector('.profile-avatar-editable');
    const editButton = container.querySelector('.profile-avatar-edit-button');
    const fileInput = container.querySelector('.profile-avatar-file-input');

    if (editButton && fileInput) {
      editButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        fileInput.click();
      });

      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;

        editButton.disabled = true;
        try {
          await onAvatarChange(file);
        } finally {
          editButton.disabled = false;
        }
      });
    }

    if (avatarRing) {
      avatarRing.setAttribute('role', 'button');
      avatarRing.setAttribute('tabindex', '0');
      avatarRing.setAttribute('aria-label', 'Alterar foto de perfil');
      avatarRing.addEventListener('click', (event) => {
        if (event.target === editButton || event.target === fileInput) return;
        fileInput?.click();
      });
      avatarRing.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          fileInput?.click();
        }
      });
    }
  }
}