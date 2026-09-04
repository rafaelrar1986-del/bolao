// admin/adminUtils.js
// Utilitários puros do painel administrativo.

export function withFlag(name, flagEmoji) {
  const f = typeof flagEmoji === 'function' ? flagEmoji(name) : '';
  return f ? `${f} ${name}` : name;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function knockoutDisplayLabel(label) {
  const value = String(label ?? '').trim();
  const normalized = value.toLowerCase();
  const aliases = {
    'round of 16': 'Oitavas de final',
    'round of 8': 'Quartas de final',
    quarterfinal: 'Quartas de final',
    quarterfinals: 'Quartas de final',
    semifinal: 'Semifinal',
    semifinals: 'Semifinal',
    final: 'Final'
  };
  return aliases[normalized] || value;
}
