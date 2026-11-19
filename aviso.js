// Lógica pura (sem Electron) de "quais leads são novos". Testável: node teste-aviso.js
// leads: [{id, created_at, ...}] em qualquer ordem. visto: {ultimo: ISO|null, ids: [..]}
function decide(leads, visto) {
  const v = { ultimo: visto && visto.ultimo || null, ids: (visto && visto.ids) || [] };
  const ordenados = [...leads].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (!v.ultimo) {                       // primeira leitura: só marca o que já existe, não avisa
    const ultimo = ordenados.length ? ordenados[ordenados.length - 1].created_at : new Date().toISOString();
    return { novos: [], visto: { ultimo, ids: ordenados.slice(-50).map(l => l.id) } };
  }
  const novos = ordenados.filter(l => String(l.created_at) > v.ultimo && !v.ids.includes(l.id));
  if (!novos.length) return { novos: [], visto: v };
  const ultimo = novos[novos.length - 1].created_at;
  const ids = [...v.ids, ...novos.map(l => l.id)].slice(-200);
  return { novos, visto: { ultimo, ids } };
}
function texto(novos) {
  if (novos.length === 1) {
    const l = novos[0];
    const imovel = l.property && l.property.title ? ' · ' + l.property.title : '';
    return { titulo: 'Novo lead', corpo: (l.name || 'Sem nome') + (l.source ? ' — ' + l.source : '') + imovel };
  }
  return { titulo: novos.length + ' novos leads', corpo: novos.slice(-3).map(l => l.name || 'Sem nome').join(', ') + (novos.length > 3 ? '…' : '') };
}
module.exports = { decide, texto };
