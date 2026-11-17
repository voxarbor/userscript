// Runs a built userscript with stubbed GM_* (the server never answers), presses its main button and reports
// what it mounted, what it asked the server for and how the button looks then.
(async (source) => {
  const asked = [], errors = [];
  globalThis.GM_getValue = (k, d) => (k === 'settings' ? { server: 'http://127.0.0.1:9', token: 't' } : d);
  globalThis.GM_setValue = () => {};
  globalThis.GM_registerMenuCommand = () => {};
  globalThis.GM_xmlhttpRequest = (o) => {
    asked.push(o.method + ' ' + o.url.replace(/^https?:\/\/[^/]+/, '').replace(/[?&]t=[\d.]+/, '') + (o.data ? ' ' + Object.keys(JSON.parse(o.data)).sort().join(',') : ''));
    setTimeout(() => o.onerror && o.onerror({}), 10);
  };
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  const before = new Set(Array.from(document.querySelectorAll('button')));
  try { (0, eval)(source); } catch (e) { errors.push(String(e)); }
  await new Promise((r) => setTimeout(r, 2000));
  const mine = Array.from(document.querySelectorAll('button')).filter((e) => !before.has(e) && /VoxArbor|озвуч|UK/i.test((e.title || '') + (e.textContent || '') + (e.getAttribute('aria-label') || '')));
  const say = (b) => (b.textContent || '').trim().slice(0, 12) + ' | ' + (b.title || '') + ' | ' + b.style.color;
  const mounted = mine.map(say);
  const main = mine.find((b) => /UK/.test(b.textContent || '')) || mine[0];
  if (main) main.click();
  await new Promise((r) => setTimeout(r, 4000));
  return { errors, mounted, afterClick: mine.map(say), asked: Array.from(new Set(asked)).slice(0, 8) };
})
