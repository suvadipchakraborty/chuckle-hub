/* The Chuckle Hub: vanilla ES modules, zero build, zero API keys. */

const APP_URL = 'https://chuckle-hub.suvadipchakraborty.workers.dev/';
const FAV_KEY = 'chuckleHub.favorites.v1';
const TIMEOUT_MS = 7000;

/* ---------- 1. API router ---------- */

const text = (v) => String(v ?? '').trim();

async function getJson(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Every source returns the same shape: { type: 'single' | 'twopart', text1, text2 } */
const normalizers = {
  jokeapi(d) {
    if (d.error) throw new Error('JokeAPI error');
    if (d.type === 'single') return { type: 'single', text1: text(d.joke), text2: null };
    if (d.type === 'twopart') return { type: 'twopart', text1: text(d.setup), text2: text(d.delivery) };
    throw new Error('Unknown JokeAPI type');
  },
  dad(d) {
    if (!d.joke) throw new Error('Empty dad joke');
    return { type: 'single', text1: text(d.joke), text2: null };
  },
  official(d) {
    if (!d.setup || !d.punchline) throw new Error('Bad official joke');
    return { type: 'twopart', text1: text(d.setup), text2: text(d.punchline) };
  },
};

const SOURCES = [
  { name: 'JokeAPI', fetch: async () => normalizers.jokeapi(await getJson('https://v2.jokeapi.dev/joke/Any?safe-mode')) },
  { name: 'icanhazdadjoke', fetch: async () => normalizers.dad(await getJson('https://icanhazdadjoke.com/', { headers: { Accept: 'application/json' } })) },
  { name: 'Official Joke API', fetch: async () => normalizers.official(await getJson('https://official-joke-api.appspot.com/random_joke')) },
];

const OFFLINE_JOKES = [
  { type: 'twopart', text1: 'Why did the scarecrow win an award?', text2: 'He was outstanding in his field.' },
  { type: 'single', text1: "I'm reading a book about anti-gravity. It's impossible to put down." },
  { type: 'twopart', text1: 'What do you call a fake noodle?', text2: 'An impasta.' },
  { type: 'single', text1: 'I told my suitcase there will be no vacation this year. Now I\'m dealing with emotional baggage.' },
];

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

let lastText = '';

/** Picks a random API; if it fails, falls back through the others; last resort is a built-in joke. */
async function fetchJoke() {
  for (const source of shuffle(SOURCES)) {
    try {
      const joke = await source.fetch();
      if (!joke.text1) continue;
      if (joke.text1 === lastText) continue; // skip an immediate repeat, try another source
      return { ...joke, source: source.name };
    } catch (err) {
      console.warn(`${source.name} failed, trying next`, err);
    }
  }
  const pool = OFFLINE_JOKES.filter((j) => j.text1 !== lastText);
  const joke = pool[Math.floor(Math.random() * pool.length)];
  return { text2: null, ...joke, source: 'Chuckle Hub vault' };
}

/* ---------- 2. State + DOM ---------- */

const $ = (id) => document.getElementById(id);
const el = {
  card: $('card'), loading: $('loading'), joke: $('joke'), text1: $('text1'), text2: $('text2'),
  reveal: $('revealBtn'), source: $('source'), fab: $('fab'), like: $('likeBtn'), share: $('shareBtn'),
  favsBtn: $('favsBtn'), favCount: $('favCount'), dialog: $('favDialog'), favList: $('favList'),
  favEmpty: $('favEmpty'), closeFavs: $('closeFavs'), install: $('installBtn'), toast: $('toast'),
};

let current = null;

const jokeId = (j) => `${j.text1}||${j.text2 ?? ''}`;

function showLoading() {
  el.card.setAttribute('aria-busy', 'true');
  el.joke.hidden = true;
  el.loading.hidden = false;
  el.source.textContent = '';
  el.fab.disabled = true;
}

function renderJoke(joke) {
  current = joke;
  lastText = joke.text1;
  el.text1.textContent = joke.text1;
  el.text1.classList.toggle('single', joke.type === 'single');
  el.text2.hidden = true;
  el.text2.textContent = joke.text2 ?? '';
  el.reveal.hidden = joke.type !== 'twopart';
  el.reveal.disabled = false;
  el.source.textContent = `via ${joke.source}`;
  el.loading.hidden = true;
  el.joke.hidden = false;
  el.card.setAttribute('aria-busy', 'false');
  el.card.classList.remove('pop'); void el.card.offsetWidth; el.card.classList.add('pop');
  el.fab.disabled = false;
  syncLike();
}

async function nextJoke() {
  showLoading();
  const [joke] = await Promise.all([fetchJoke(), new Promise((r) => setTimeout(r, 500))]); // keep the loader visible briefly
  renderJoke(joke);
}

function revealPunchline() {
  if (!current || current.type !== 'twopart') return;
  el.reveal.hidden = true;
  el.text2.hidden = false;
  const r = el.text2.getBoundingClientRect();
  confetti.burst(r.left + r.width / 2, r.top + r.height / 2, 90);
  el.text2.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ---------- 3. Favorites (localStorage) ---------- */

function loadFavs() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch { return []; }
}
function saveFavs(list) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch { toast('Could not save. Is storage blocked?'); }
}

function syncLike() {
  const liked = !!current && loadFavs().some((f) => f.id === jokeId(current));
  el.like.setAttribute('aria-pressed', String(liked));
  el.like.setAttribute('aria-label', liked ? 'Remove from favorites' : 'Save to favorites');
  const n = loadFavs().length;
  el.favCount.textContent = n;
  el.favCount.hidden = n === 0;
}

function toggleLike() {
  if (!current) return;
  const id = jokeId(current);
  const favs = loadFavs();
  const i = favs.findIndex((f) => f.id === id);
  if (i >= 0) {
    favs.splice(i, 1);
    toast('Removed from favorites');
  } else {
    favs.unshift({ id, type: current.type, text1: current.text1, text2: current.text2, savedAt: Date.now() });
    const r = el.like.getBoundingClientRect();
    confetti.burst(r.left + r.width / 2, r.top + r.height / 2, 60);
    toast('Saved to favorites');
  }
  saveFavs(favs);
  syncLike();
}

function renderFavs() {
  const favs = loadFavs();
  el.favList.replaceChildren();
  el.favEmpty.hidden = favs.length > 0;
  for (const f of favs) {
    const li = document.createElement('li');
    li.className = 'fav-item';
    const a = document.createElement('p'); a.className = 'a'; a.textContent = f.text1;
    li.append(a);
    if (f.text2) { const b = document.createElement('p'); b.textContent = f.text2; li.append(b); }
    const row = document.createElement('div'); row.className = 'row';
    const share = document.createElement('button'); share.type = 'button'; share.textContent = 'Share';
    share.addEventListener('click', () => shareJoke(f));
    const del = document.createElement('button'); del.type = 'button'; del.textContent = 'Remove';
    del.addEventListener('click', () => {
      saveFavs(loadFavs().filter((x) => x.id !== f.id));
      renderFavs(); syncLike();
    });
    row.append(share, del); li.append(row);
    el.favList.append(li);
  }
}

/* ---------- 4. Sharing ---------- */

async function shareJoke(joke = current) {
  if (!joke) return;
  // Two-part jokes only share the setup, so the recipient has to visit for the punchline.
  const body = joke.type === 'twopart'
    ? `${joke.text1}\n\nFind out the punchline at: ${APP_URL}`
    : `${joke.text1}\n\n${APP_URL}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'The Chuckle Hub', text: body });
    } else {
      await navigator.clipboard.writeText(body);
      toast('Copied. Paste it anywhere to share.');
    }
  } catch (err) {
    if (err.name !== 'AbortError') toast('Sharing is not available here');
  }
}

/* ---------- 5. PWA install ---------- */

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
window.addEventListener('appinstalled', () => { deferredPrompt = null; el.install.hidden = true; toast('Installed. Welcome home!'); });

el.install.addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  } else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
    toast('Tap Share, then "Add to Home Screen"');
  } else {
    toast('Use your browser menu and choose "Install app"');
  }
});
if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) el.install.hidden = true;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW failed', e)));
}

/* ---------- 6. Confetti ---------- */

const confetti = (() => {
  const canvas = $('confetti');
  const ctx = canvas.getContext('2d');
  const colors = ['#FFD84D', '#FF7A66', '#FFB88A', '#8EE3C8', '#7FB5FF', '#FFFFFF'];
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let parts = [], raf = null, dpr = 1;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener('resize', resize); resize();

  function frame() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter((p) => p.life > 0 && p.y < innerHeight + 20);
    for (const p of parts) {
      p.vy += 0.22; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= 1;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = Math.min(1, p.life / 30);
      ctx.fillStyle = p.color;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, 7); ctx.fill(); }
      else ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6);
      ctx.restore();
    }
    raf = parts.length ? requestAnimationFrame(frame) : null;
    if (!raf) ctx.clearRect(0, 0, innerWidth, innerHeight);
  }

  function burst(x, y, count = 80) {
    if (reduce.matches) return;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2, speed = 4 + Math.random() * 9;
      parts.push({
        x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 6,
        size: 6 + Math.random() * 8, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
        color: colors[(Math.random() * colors.length) | 0], round: Math.random() < 0.3, life: 90 + Math.random() * 60,
      });
    }
    if (!raf) raf = requestAnimationFrame(frame);
  }
  return { burst };
})();

/* ---------- 7. Toast + wiring ---------- */

let toastTimer;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2400);
}

el.fab.addEventListener('click', nextJoke);
el.reveal.addEventListener('click', revealPunchline);
el.like.addEventListener('click', toggleLike);
el.share.addEventListener('click', () => shareJoke());
el.favsBtn.addEventListener('click', () => { renderFavs(); el.dialog.showModal(); });
el.closeFavs.addEventListener('click', () => el.dialog.close());
el.dialog.addEventListener('click', (e) => { if (e.target === el.dialog) el.dialog.close(); });
el.dialog.addEventListener('close', syncLike);

syncLike();
nextJoke();
