import { rankingState } from './state.js';
import { getRankingMeta, getCriterionValue, animateNumber } from './helpers.js';
import { initUserProfile } from '../userProfile.js?v=1.06';

export function applyAnimations() {
    document.querySelectorAll('.is-me').forEach(el => el.classList.add('ranking-me-glow'));
    document.querySelectorAll('.ranking-move.up, .ranking-move.down').forEach(el => {
        el.classList.remove('ranking-move-hidden');
        el.classList.add('ranking-move-animate');
    });
    document.querySelectorAll('.points-value').forEach((el, i) => {
        const target = Number(el.dataset.target);
        if (i < 40) animateNumber(el, target);
        else el.textContent = target;
    });
}

export function attachMobileCardEvents(entries, mobileRoot) {
    mobileRoot.querySelectorAll('.pts-neon').forEach((el, idx) => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();

            const item = el.closest('.ranking-item');
            const existing = item.querySelector('.user-score-card');

            if (existing) {
                existing.remove();
                return;
            }

            mobileRoot.querySelectorAll('.user-score-card').forEach(c => c.remove());

            const entry = entries[idx];
            const n = (v) => Number(v || 0);

            // Classificação dos grupos: soma por grupo a partir do breakdown
            // real calculado pelo backend. Não usa extrasPoints.
            const qualificationByGroup = new Map();
            (Array.isArray(entry.groupQualificationBreakdown)
                ? entry.groupQualificationBreakdown
                : []
            ).forEach(row => {
                const group = String(row.group || '').trim();
                if (!group) return;
                qualificationByGroup.set(
                    group,
                    n(qualificationByGroup.get(group)) + n(row.points)
                );
            });

            const groupDetails = [
                { label: 'Partidas', points: n(entry.groupMatchPoints) },
                { label: 'Classificação', points: n(entry.groupQualificationPoints), key: 'qualification' }
            ];

            const knockoutDetails = [
                { label: 'Partidas', points: n(entry.knockoutMatchPoints) },
                { label: 'Classificados', points: n(entry.knockoutQualifierPoints) }
            ];

            const podiumDetails = Array.isArray(entry.podiumBreakdown)
                ? entry.podiumBreakdown.map((value, index) => ({
                    label: `${index + 1}º lugar`,
                    points: n(value)
                }))
                : [];

            const extrasDetails = [
                { label: 'Artilheiro', points: n(entry.topScorerPoints) },
                { label: 'Melhor Ataque', points: n(entry.bestAttackPoints) },
                { label: 'Pior Defesa', points: n(entry.worstDefensePoints) },
                { label: 'Zebra', points: n(entry.upsetPoints) }
            ].filter(detail => detail.points > 0);

            const categories = [
                {
                    key: 'groups',
                    label: 'Grupos',
                    points: n(entry.groupPhasePoints),
                    details: groupDetails
                },
                {
                    key: 'knockout',
                    label: 'Mata-mata',
                    points: n(entry.knockoutPoints),
                    details: knockoutDetails
                },
                {
                    key: 'podium',
                    label: 'Pódio',
                    points: n(entry.podiumPoints),
                    details: podiumDetails
                },
                ...(n(entry.extrasPoints) > 0 ? [{
                    key: 'extras',
                    label: 'Extras',
                    points: n(entry.extrasPoints),
                    details: extrasDetails
                }] : [])
            ].filter(category => category.points > 0);

            const rankingMeta = getRankingMeta(
                window.__RANKING_LAST_RESPONSE__ || {},
                entries
            );
            const tieBreakers = Array.isArray(rankingMeta?.tieBreakers)
                ? rankingMeta.tieBreakers
                : [];

            const tieBreakdown = tieBreakers.length ? `
                <div class="user-score-tiebreak-section">
                    <div class="user-score-tiebreak-title">Desempate</div>
                    <div class="user-score-tiebreak-grid">
                        ${tieBreakers.map((key, index) => {
                            const meta = RANKING_CRITERIA_META[key] || {
                                label: key,
                                icon: '•',
                                tone: 'cyan'
                            };
                            const value = getCriterionValue(entry, key);
                            return `
                                <div class="user-score-tiebreak-item ${meta.tone}">
                                    <span>${meta.icon}</span>
                                    <div>
                                        <small>${index + 1}º ${meta.label}</small>
                                        <strong>${value == null ? '0' : value} pts</strong>
                                    </div>
                                </div>`;
                        }).join('')}
                    </div>
                </div>` : '';

            const renderSubdetails = (category) => {
                const details = category.details || [];
                if (!details.length) return '';

                return `
                    <div class="user-score-subdetails" data-parent="${category.key}" hidden>
                        ${details.map((detail, detailIndex) => {
                            const hasChildren =
                                category.key === 'groups' &&
                                detail.key === 'qualification' &&
                                qualificationByGroup.size > 0;

                            return `
                                <div class="user-score-detail-row ${hasChildren ? 'has-children' : ''}"
                                     data-detail="${category.key}-${detailIndex}">
                                    <button type="button"
                                            class="user-score-detail-toggle"
                                            ${hasChildren ? '' : 'disabled'}>
                                        <span>${detail.label}</span>
                                        <strong>${detail.points}</strong>
                                        ${hasChildren ? '<span class="user-score-chevron">›</span>' : ''}
                                    </button>
                                    ${hasChildren ? `
                                        <div class="user-score-group-details" hidden>
                                            ${[...qualificationByGroup.entries()].map(([group, points]) => `
                                                <div class="user-score-group-row">
                                                    <span>${group}</span>
                                                    <strong>${points}</strong>
                                                </div>
                                            `).join('')}
                                        </div>
                                    ` : ''}
                                </div>`;
                        }).join('')}
                    </div>`;
            };

            const card = document.createElement('div');
            card.className = 'user-score-card';
            card.innerHTML = `
                ${tieBreakdown}
                <div class="user-score-breakdown">
                    ${categories.map((category, categoryIndex) => `
                        <div class="user-score-category" data-category="${category.key}">
                            <button type="button" class="user-score-category-toggle">
                                <span class="user-score-category-main">
                                    <strong>${category.points}</strong>
                                    <span>${category.label}</span>
                                </span>
                                <span class="user-score-chevron">›</span>
                            </button>
                            ${renderSubdetails(category)}
                        </div>
                    `).join('')}
                </div>
            `;

            // Primeiro nível: Grupos / Mata-mata / Pódio / Extras.
            card.querySelectorAll('.user-score-category-toggle').forEach(button => {
                button.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    const category = button.closest('.user-score-category');
                    const details = category?.querySelector('.user-score-subdetails');
                    if (!details) return;

                    const opening = details.hidden;
                    details.hidden = !opening;
                    category.classList.toggle('is-open', opening);
                });
            });

            // Segundo nível: Classificação dos grupos.
            card.querySelectorAll('.user-score-detail-toggle').forEach(button => {
                if (button.disabled) return;
                button.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    const row = button.closest('.user-score-detail-row');
                    const groups = row?.querySelector('.user-score-group-details');
                    if (!groups) return;

                    const opening = groups.hidden;
                    groups.hidden = !opening;
                    row.classList.toggle('is-open', opening);
                });
            });

            item.appendChild(card);
        });
    });
}
export function attachUserLinkEvents() {
    document.querySelectorAll('.ranking-user-link').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const userId = link.dataset.userId;
            if (!userId) return;
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            const tab = document.getElementById('user-profile');
            if (tab) {
                tab.classList.add('active');
                requestAnimationFrame(() => initUserProfile(userId));
            }
        });
    });
}

