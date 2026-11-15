// Bolinha flutuante. Recebe do Rust: wlMessage({chat, text, avatar}) e wlUnread(n).
'use strict';

const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
const $ = (id) => document.getElementById(id);

// tamanhos da janela em cada estado
const SIZE = { ball: [76, 76], card: [340, 104], reply: [340, 138], opts: [300, 340] };
const DEFAULTS = { color: '#ffffff', count: true, preview: true, sound: true, seconds: 5 };

// as opções ficam no settings.json do app (a tela "WhatsApp Lite" também muda)
let opts = { ...DEFAULTS };

let unread = 0;
let cardChat = null;
let hideTimer = null;

// perto da borda direita a janela cresce para a esquerda (classe .left) e a bolinha não sai do lugar
let shift = 0;

function resize(state) {
    const [width, height] = SIZE[state];
    const ball = SIZE.ball[0];
    let x = window.screenX;
    if (state === 'ball') {
        x += shift;
        shift = 0;
    } else if (!shift && x + width > (screen.availLeft || 0) + screen.availWidth) {
        shift = width - ball;
        x -= shift;
    } else if (shift) {
        // outro estado aberto já virado: mantém a bolinha no mesmo ponto
        x += shift - (width - ball);
        shift = width - ball;
    }
    document.body.classList.toggle('left', shift > 0);
    const y = window.screenY;
    invoke('plugin:window|set_position', { label: 'bubble', value: { Logical: { x, y } } });
    invoke('plugin:window|set_size', { label: 'bubble', value: { Logical: { width, height } } });
}

function apply() {
    document.documentElement.style.setProperty('--color', opts.color);
    $('badge').textContent = unread > 99 ? '99+' : String(unread);
    $('badge').classList.toggle('on', opts.count && unread > 0);
}

window.wlUnread = (n) => { unread = n; apply(); };

// som de aviso: dois tons curtos, gerados aqui mesmo (sem arquivo)
let audio = null;
function ding() {
    try {
        audio = audio || new AudioContext();
        if (audio.state === 'suspended') audio.resume();
        const t0 = audio.currentTime;
        [880, 1175].forEach((freq, i) => {
            const osc = audio.createOscillator();
            const gain = audio.createGain();
            const t = t0 + i * 0.13;
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
            osc.connect(gain).connect(audio.destination);
            osc.start(t);
            osc.stop(t + 0.25);
        });
    } catch {}
}

window.wlMessage = ({ chat, text, avatar }) => {
    if (opts.sound) ding();
    if (!opts.preview || $('opts').classList.contains('on')) return;
    // não atropela uma resposta sendo escrita
    if ($('card').matches('.on.replying')) return;
    cardChat = chat;
    $('name').textContent = chat;
    $('msg').textContent = text;
    if (avatar) $('avatar').src = avatar; else $('avatar').removeAttribute('src');
    $('card').classList.add('on');
    resize('card');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideCard, opts.seconds * 1000);
};

function hideCard() {
    $('card').classList.remove('on', 'replying');
    $('answer').value = '';
    if (!$('opts').classList.contains('on')) resize('ball');
}

// clique abre a janela; arrastar (mais de 4 px) move a bolinha
let down = null;
$('ball').addEventListener('mousedown', (e) => { if (e.button === 0) down = [e.screenX, e.screenY]; });
window.addEventListener('mousemove', (e) => {
    if (down && Math.hypot(e.screenX - down[0], e.screenY - down[1]) > 4) {
        down = null;
        invoke('plugin:window|start_dragging', { label: 'bubble' });
    }
});
$('ball').addEventListener('mouseup', (e) => {
    if (e.button !== 0 || !down) return;
    down = null;
    hideCard();
    invoke('bubble_open', { chat: null });
});

$('card').addEventListener('click', (e) => {
    if (e.target === $('reply') || e.target === $('answer')) return;
    const chat = cardChat;
    hideCard();
    if (e.target !== $('close')) invoke('bubble_open', { chat });
});

// Responder: vira um campo; Enter envia, Esc cancela
$('reply').addEventListener('click', () => {
    clearTimeout(hideTimer);
    $('card').classList.add('replying');
    resize('reply');
    $('answer').focus();
});
$('answer').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideCard();
    if (e.key !== 'Enter' || !$('answer').value.trim()) return;
    invoke('bubble_reply', { chat: cardChat, text: $('answer').value });
    hideCard();
});

// opções no botão direito; gravadas no app
const form = $('opts');
const PRESETS = ['#ffffff', '#25d366', '#53bdeb', '#ffd279', '#ff7a7a', '#c9a7ff'];
$('swatches').innerHTML = PRESETS.map((c) =>
    `<button class="sw" style="--s:${c}" data-c="${c}" aria-pressed="false" aria-label="Cor ${c}"></button>`).join('');

function save() {
    invoke('bubble_opts_set', { opts });
    apply();
    paintOpts();
}
// o app manda as opções quando a tela de configurações muda alguma
window.wlOpts = (o) => { opts = { ...DEFAULTS, ...o }; apply(); paintOpts(); };
function paintOpts() {
    form.style.setProperty('--thumb', opts.color);
    $('hue').style.setProperty('--thumb', opts.color);
    const hue = /^hsl\((\d+)/.exec(opts.color);
    if (hue) $('hue').value = hue[1];
    form.querySelectorAll('.sw').forEach((b) => b.setAttribute('aria-pressed', b.dataset.c === opts.color));
    form.querySelectorAll('.switch').forEach((b) => b.setAttribute('aria-checked', !!opts[b.dataset.k]));
    $('secBox').classList.toggle('dim', !opts.preview);
    $('sec').value = opts.seconds;
    $('sec').style.setProperty('--p', ((opts.seconds - 1) / 59 * 100) + '%');
    $('secVal').textContent = opts.seconds + ' s';
}
$('swatches').addEventListener('click', (e) => {
    const b = e.target.closest('.sw');
    if (b) { opts.color = b.dataset.c; save(); }
});
$('hue').addEventListener('input', (e) => { opts.color = `hsl(${e.target.value} 90% 60%)`; save(); });
form.querySelectorAll('.switch').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.k;
    opts[k] = !opts[k];
    if (k === 'sound' && opts.sound) ding();
    save();
}));
$('sec').addEventListener('input', (e) => { opts.seconds = Math.min(60, Math.max(1, parseInt(e.target.value, 10) || DEFAULTS.seconds)); save(); });

$('ball').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    paintOpts();
    $('card').classList.remove('on');
    form.classList.add('on');
    resize('opts');
});
$('done').addEventListener('click', () => { form.classList.remove('on'); resize('ball'); });

apply();

// migração: opções antigas no localStorage desta janela vão para o app uma vez
invoke('bubble_opts_get').then(({ saved, opts: fromApp }) => {
    let old = null;
    try { old = JSON.parse(localStorage.getItem('wl-bubble')); } catch {}
    if (!saved && old) { opts = { ...DEFAULTS, ...old }; save(); return; }
    window.wlOpts(fromApp);
    // o app já tem as opções: a cópia antiga não serve mais
    try { localStorage.removeItem('wl-bubble'); } catch {}
}).catch(() => {});

invoke('bubble_ready');
