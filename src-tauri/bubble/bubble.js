// Bolinha flutuante. Recebe do Rust: wlMessage({chat, text, avatar}) e wlUnread(n).
'use strict';

const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
const $ = (id) => document.getElementById(id);

// tamanhos da janela em cada estado
const SIZE = { ball: [76, 76], card: [340, 104], reply: [340, 138], opts: [300, 200] };
const DEFAULTS = { color: '#ffffff', count: true, preview: true, seconds: 5 };

let opts = { ...DEFAULTS };
try { opts = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('wl-bubble') || '{}') }; } catch {}

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

window.wlMessage = ({ chat, text, avatar }) => {
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

// opções no botão direito; ficam salvas nesta janela
const form = $('opts');
$('ball').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    form.color.value = opts.color;
    form.count.checked = opts.count;
    form.preview.checked = opts.preview;
    form.seconds.value = opts.seconds;
    $('card').classList.remove('on');
    form.classList.add('on');
    resize('opts');
});
form.addEventListener('input', () => {
    opts = {
        color: form.color.value,
        count: form.count.checked,
        preview: form.preview.checked,
        seconds: Math.min(60, Math.max(1, parseInt(form.seconds.value, 10) || DEFAULTS.seconds)),
    };
    try { localStorage.setItem('wl-bubble', JSON.stringify(opts)); } catch {}
    apply();
});
$('done').addEventListener('click', () => { form.classList.remove('on'); resize('ball'); });

apply();
