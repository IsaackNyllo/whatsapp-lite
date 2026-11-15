// Ferramentas MCP de leitura (texto). O Rust chama window.__wlMcp(id, tool, args).
// Só lê: nunca envia, marca como lida, abre conversa ou altera nada.
(() => {
  const DEFAULT_LIMIT = 1500, MAX_LIMIT = 10000;
  // Tipos sem conteúdo útil: ficam de fora (decisão: ignorar, não virar [evento]).
  const SKIP = new Set(['e2e_notification', 'gp2', 'notification_template', 'call_log', 'revoked',
    'ciphertext', 'album', 'pinned_message', 'message_history_notice', 'template_button_reply', 'protocol']);
  const C = () => require('WAWebCollections');
  const pad = n => String(n).padStart(2, '0');
  const dia = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const hora = s => { const d = new Date(s * 1000); return dia(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const chatName = c => c.name || c.formattedTitle || (c.id && c.id.user) || '';
  const dur = s => { s = Math.round(+s || 0); return Math.floor(s / 60) + ':' + pad(s % 60); };

  function parseDia(v, fim) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
    const d = m && new Date(+m[1], +m[2] - 1, +m[3]);
    if (!d || d.getMonth() !== +m[2] - 1) throw new Error('Data inválida: "' + v + '". Use o formato AAAA-MM-DD.');
    return Math.floor(d.getTime() / 1000) + (fim ? 86400 : 0); // fim = início do dia seguinte (exclusivo)
  }

  // Igual (3) > começa com (2) > contém (1). Vários no melhor nível = ambíguo.
  function acharConversa(nome) {
    const q = norm(nome);
    if (!q) throw new Error('Informe o nome da conversa.');
    const lista = C().Chat.getModelsArray();
    let melhor = 0, achados = [];
    for (const c of lista) {
      const n = norm(chatName(c));
      const nivel = n === q ? 3 : n.startsWith(q) ? 2 : n.includes(q) ? 1 : 0;
      if (nivel > melhor) { melhor = nivel; achados = []; }
      if (nivel && nivel === melhor) achados.push(c);
    }
    if (!achados.length) throw new Error('Conversa não encontrada: ' + nome);
    if (achados.length > 1) throw new Error('Mais de uma conversa casa com "' + nome + '": ' +
      achados.slice(0, 5).map(chatName).join(', ') + '. Use um nome mais completo.');
    return achados[0];
  }

  function nomeContato(wid) {
    if (!wid) return '?';
    const ct = C().Contact.get(wid);
    return (ct && (ct.name || ct.pushname || ct.verifiedName || ct.formattedName)) || wid.user || '?';
  }

  const isMe = m => !!(m.id && m.id.fromMe);
  const ultimaAtividade = c => c.t || 0;

  function texto(m) {
    const cap = m.caption ? ': ' + m.caption : '';
    switch (m.type) {
      case 'chat': return m.body || '';
      case 'sticker': return '[figurinha]';
      case 'image': return '[imagem' + cap + ']';
      case 'video': case 'ptv': return '[vídeo' + cap + ']';
      case 'ptt': case 'audio': return '[áudio' + (m.duration ? ' ' + dur(m.duration) : '') + ']';
      case 'document': return '[documento' + (m.filename ? ': ' + m.filename : '') + (m.caption ? ' - ' + m.caption : '') + ']';
      case 'location': return '[localização]';
      case 'vcard': case 'multi_vcard': return '[contato' + (m.vcardFormattedName ? ': ' + m.vcardFormattedName : '') + ']';
      case 'poll_creation': return '[enquete' + (m.pollName ? ': ' + m.pollName : '') + ']';
      default: return m.type === 'interactive' && m.caption ? '[mensagem interativa: ' + m.caption + ']' : '[' + m.type + ']';
    }
  }

  async function listar_conversas({ filtro, limite = 50 } = {}) {
    limite = Math.max(1, Math.min(+limite || 50, 1000));
    let lista = C().Chat.getModelsArray();
    if (filtro) {
      const q = norm(filtro);
      const nv = c => { const n = norm(chatName(c)); return n === q ? 3 : n.startsWith(q) ? 2 : n.includes(q) ? 1 : 0; };
      lista = lista.filter(c => nv(c)).sort((a, b) => nv(b) - nv(a) || ultimaAtividade(b) - ultimaAtividade(a));
    } else lista = lista.slice().sort((a, b) => ultimaAtividade(b) - ultimaAtividade(a));
    const conversas = lista.slice(0, limite).map(c => {
      const o = { nome: chatName(c), grupo: c.id.server === 'g.us', arquivada: !!c.archive,
        naoLidas: Math.max(0, c.unreadCount || 0), ultimaAtividade: c.t ? hora(c.t) : null };
      const l = c.msgs && c.msgs.last && c.msgs.last();
      if (l && SKIP.has(l.type) === false) {
        const t = texto(l);
        o.ultima = { autor: isMe(l) ? 'Você' : (o.grupo ? nomeContato(l.author) : o.nome), texto: t.slice(0, 100) };
      }
      return o;
    });
    return { total: lista.length, conversas };
  }

  async function ler_mensagens({ conversa, desde, ate, limite = DEFAULT_LIMIT } = {}) {
    if (!conversa) throw new Error('Informe o nome da conversa.');
    limite = Math.max(1, Math.min(Math.floor(+limite) || DEFAULT_LIMIT, MAX_LIMIT));
    const t0 = desde ? parseDia(desde, false) : null;
    const t1 = ate ? parseDia(ate, true) : null;
    if (t0 !== null && t1 !== null && t0 >= t1) throw new Error('"desde" é depois de "ate".');
    const chat = acharConversa(conversa);
    const nome = chatName(chat), grupo = chat.id.server === 'g.us';
    const F = require('WAWebDBMessageFindLocal');
    const last = chat.msgs.last();
    const vistos = new Set(), novas = []; // novas: da mais recente para a mais antiga
    let oldest = null, anchor = last && last.id;
    let lote = last ? [last] : [];
    const key = m => m.id._serialized || String(m.id);
    while (last) {
      for (const m of lote) {
        vistos.add(key(m));
        if (oldest === null || m.t < oldest) oldest = m.t;
        if (SKIP.has(m.type) || (t1 !== null && m.t >= t1) || (t0 !== null && m.t < t0)) continue;
        novas.push(m);
      }
      if ((t0 !== null && oldest < t0) || novas.length > limite) break;
      const r = await F.msgFindBefore({ anchor, count: 100 });
      const page = (r && r.messages) || [];
      // só a página vazia indica o fim; página menor que count não quer dizer que acabou
      if (!page.length) break;
      // a página vem em ordem crescente: a primeira é a mais antiga. Escolher pela menor hora repete mensagens.
      anchor = page[0].id;
      lote = page.filter(m => !vistos.has(key(m)));
    }
    const uniq = novas.sort((a, b) => b.t - a.t);
    const cortado = uniq.length > limite;
    const sel = uniq.slice(0, limite).reverse();
    const mensagens = sel.map(m => ({
      hora: hora(m.t),
      autor: isMe(m) ? 'Você' : (grupo ? nomeContato(m.author || m.from) : nome),
      texto: texto(m),
    }));
    const payload = {
      conversa: nome, grupo,
      periodo: { desde: desde || null, ate: ate || null },
      total: mensagens.length, cortado,
      maisAntigaDisponivel: oldest ? dia(new Date(oldest * 1000)) : null, // mais antiga que o histórico carregado alcançou
      mensagens,
    };
    if (avisar) try {
      window.__TAURI_INTERNALS__.invoke('bubble_message', { chat: 'IA leu ' + nome, text: payload.total + ' mensagens', avatar: null }).catch(() => {});
    } catch (e) {}
    return payload;
  }

  // "Avisar quando uma IA ler" (configuração do app); vem em cada chamada do Rust
  let avisar = true;

  const TOOLS = { listar_conversas, ler_mensagens };
  window.__wlMcpRun = async (tool, args) => {
    const f = TOOLS[tool];
    if (!f) throw new Error('Ferramenta desconhecida: ' + tool);
    return f(args || {});
  };
  window.__wlMcp = async (id, tool, args, notify) => {
    avisar = notify !== false;
    const inv = (p) => { try { return window.__TAURI_INTERNALS__.invoke('mcp_result', p); } catch (e) {} };
    try {
      const r = await window.__wlMcpRun(tool, args);
      await inv({ id, result: JSON.stringify(r) });
    } catch (e) {
      await inv({ id, error: String((e && e.message) || e) });
    }
  };
})();
