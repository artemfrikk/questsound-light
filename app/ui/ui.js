// The window: draws the bridge's status as the main process reports it (window.qsl comes from preload.cjs).
// Every text from outside (module names, errors, the log) goes in as text, never as HTML.
const ICONS = {
  bulb: '<path d="M3 12h1m8-9v1m8 8h1M5.6 5.6l.7.7m12.1-.7-.7.7"/><path d="M9 16a5 5 0 1 1 6 0 3.5 3.5 0 0 0-1 3 2 2 0 0 1-4 0 3.5 3.5 0 0 0-1-3"/><path d="M9.7 17h4.6"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M5 6v.01M5 12v.01M5 18v.01"/>',
  power: '<path d="M7 6a7.75 7.75 0 1 0 10 0"/><path d="M12 4v8"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  external: '<path d="M12 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/><path d="M11 13l9-9M15 4h5v5"/>',
  link: '<path d="M9 15l6-6"/><path d="M11 6l.46-.54a5 5 0 0 1 7.07 7.07l-.53.47M13 18l-.4.54a5.07 5.07 0 0 1-7.12 0 4.97 4.97 0 0 1 0-7.07L6 11"/>',
  unlink: '<path d="M17 22v-2M9 15l6-6M11 6l.46-.54a5 5 0 0 1 7.07 7.07l-.53.47M13 18l-.4.54a5.07 5.07 0 0 1-7.12 0 4.97 4.97 0 0 1 0-7.07L6 11M20 17h2M2 7h2M7 2v2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
const svg = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;
const $ = id => document.getElementById(id);
function el(tag, attrs, ...kids) {
  attrs ||= {};
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v); }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
const ic = n => { const s = el('span', { class: 'ic' }); s.innerHTML = svg(n); return s; };
const lamps = n => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'лампа' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'лампы' : 'ламп');
for (const s of document.querySelectorAll('[data-ic]')) s.innerHTML = svg(s.dataset.ic);

let status = null, confirmUnpair = false, copied = null;

function codeBlock(code, err) {
  if (!code) return el('p', { class: 'muted small' }, err ? 'Не удалось получить код: ' + err + '. Повторяю…' : 'Получаю код…');
  const btn = el('button', { class: 'btn primary' + (copied === code ? ' done' : ''), onclick: async () => {
    await qsl.copy(code); copied = code; draw(); setTimeout(() => { if (copied === code) { copied = null; draw(); } }, 2500);
  } }, ic(copied === code ? 'check' : 'copy'), copied === code ? 'Скопировано' : 'Скопировать код');
  return el('div', null,
    el('div', { class: 'code', 'aria-label': 'Код ' + code }, [...code].map(c => el('span', null, c))),
    el('div', { class: 'row' }, btn, el('span', { class: 'muted small' }, 'Код сменится сам через 9 минут')));
}

function linkCard() {
  const s = status, box = $('link');
  box.replaceChildren();
  if (!s) return;
  if (!s.linked) {
    box.append(el('h2', null, ic('link'), 'Подключите мост к сайту'),
      el('ol', { class: 'steps' },
        el('li', null, el('div', null, 'Откройте ', el('b', null, 'questsound.ru'), ' → вкладку ', el('b', null, '«Освещение»'),
          el('div', { class: 'row mt' }, el('button', { class: 'btn sm', onclick: () => qsl.openSite() }, ic('external'), 'Открыть сайт')))),
        el('li', null, el('div', null, 'Введите этот код и нажмите «Подключить»', codeBlock(s.code, s.codeError)))));
    return;
  }
  box.append(el('div', { class: 'linked' },
    el('span', { class: 'big' }, ic('check')),
    el('div', null, el('b', null, 'Подключено к сайту'),
      el('div', { class: 'muted small' }, 'Свет меняется вместе с игрой. Окно можно закрыть: мост продолжит работать в значке рядом с часами.'))));
  const extra = el('div', { class: 'extra' });
  if (s.code) extra.append(el('div', { class: 'small muted' }, 'Код для ещё одного браузера:'), codeBlock(s.code));
  else if (!confirmUnpair) extra.append(el('div', { class: 'row' },
    el('button', { class: 'btn sm', onclick: () => qsl.newCode() }, ic('plus'), 'Подключить ещё браузер'),
    el('button', { class: 'btn sm ghost danger', onclick: () => { confirmUnpair = true; draw(); } }, ic('unlink'), 'Отвязать')));
  if (confirmUnpair) extra.append(el('div', { class: 'confirm' },
    el('div', { class: 'small' }, 'Сайт перестанет управлять светом, а мост сразу покажет новый код. Настройки ламп сохранятся.'),
    el('div', { class: 'row mt' },
      el('button', { class: 'btn sm danger', onclick: () => { confirmUnpair = false; qsl.unpair(); } }, 'Отвязать'),
      el('button', { class: 'btn sm ghost', onclick: () => { confirmUnpair = false; draw(); } }, 'Отмена'))));
  box.append(extra);
}

function statusCard() {
  const s = status, box = $('status');
  const [cls, title, sub] = !s ? ['wait', 'Запуск…', '']
    : s.replaced ? ['bad', 'Мост запущен ещё где-то', 'Этим ключом пользуется другая копия. Попробую снова через минуту.']
    : !s.online ? ['wait', 'Подключаюсь к серверу…', 'Проверьте интернет. Мост повторяет попытки сам.']
    : ['on', 'На связи с сервером', s.server.replace(/^https?:\/\//, '')];
  box.className = 'card status ' + cls;
  $('st-title').textContent = title; $('st-sub').textContent = sub;
}

function modsCard() {
  const box = $('mods'), list = status?.modules || [];
  box.replaceChildren(...(list.length ? list.map(m => el('div', { class: 'mod' },
    el('span', { class: 'nm' }, m.name),
    m.ok ? el('span', { class: m.failing ? 'err' : 'ok' }, m.failing ? `${lamps(m.lamps)}, ошибок: ${m.failing}` : '● ' + lamps(m.lamps))
      : el('span', { class: 'err' }, m.error || 'ошибка')))
    : [el('div', { class: 'empty' }, status?.linked ? 'Подключений пока нет. Настройте лампы на сайте: «Освещение» → «Подключения».' : 'После подключения к сайту настройте там свои лампы: Яндекс, Home Assistant, Yeelight и другие.')]));
}

function draw() { statusCard(); linkCard(); modsCard(); $('ver').textContent = status ? 'Версия ' + status.version : ''; }

(async () => {
  const init = await qsl.get();
  status = init.status;
  $('log').textContent = init.logs.join('\n');
  const auto = $('auto');
  auto.checked = init.autostart; auto.disabled = !init.canAutostart;
  if (!init.canAutostart) $('auto-note').textContent = 'Доступно, когда мост запущен из файла AppImage';
  auto.addEventListener('change', async () => { auto.checked = await qsl.setAutostart(auto.checked); });
  $('quit').addEventListener('click', () => qsl.quit());
  qsl.onStatus(s => { status = s; draw(); });
  qsl.onLog(line => { const p = $('log'); p.textContent += (p.textContent ? '\n' : '') + line; p.scrollTop = p.scrollHeight; });
  draw();
})();
