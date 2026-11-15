/* Lightweight, on-page feature demo. No video, GIF, webcam, API calls or account data. */
(() => {
  const host = document.getElementById('loginFeaturePreview');
  if (!host) return;
  const scenes = ['see', 'find', 'do', 'memory'];
  const sceneNodes = [...host.querySelectorAll('[data-preview-scene]')];
  const tabs = [...host.querySelectorAll('[data-preview-tab]')];
  const caption = document.getElementById('previewCaption');
  const captions = ['01 / 04 · IDENTIFY COLORS', '02 / 04 · FIND A SHADE', '03 / 04 · FOLLOW COLOR TASKS', '04 / 04 · SAVED COLORS'];
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  const duration = 4800;
  let active = 0;
  let ticker = null;
  let jobs = [];
  const later = (fn, delay) => { const id = window.setTimeout(fn, delay); jobs.push(id); };
  const clearJobs = () => { for (const id of jobs) window.clearTimeout(id); jobs = []; };

  function animateFeature(mode, node) {
    if (mode === 'see') {
      later(() => node.classList.add('is-ready'), reduceMotion ? 0 : 650);
    } else if (mode === 'find') {
      const query = document.getElementById('previewFindQuery');
      const status = document.getElementById('previewFindStatus');
      query.textContent = '';
      status.textContent = 'Looking for a match...';
      const word = 'lavender';
      for (let i = 1; i <= word.length; i++) {
        later(() => { if (node.classList.contains('is-active')) query.textContent = word.slice(0,i); }, reduceMotion ? 0 : (300 + i * 115));
      }
      later(() => {
        if (!node.classList.contains('is-active')) return;
        node.classList.add('is-found');
        status.textContent = 'Match found in view';
      }, reduceMotion ? 0 : 2200);
    } else if (mode === 'do') {
      const n = document.getElementById('previewDoCounter');
      const idx = document.getElementById('previewDoIndex');
      const task = document.getElementById('previewDoTask');
      const hint = document.getElementById('previewDoHint');
      const fill = document.getElementById('previewDoFill');
      n.textContent = 'STEP 1 OF 3'; idx.textContent = '1'; task.textContent = 'Pick up the yellow pencil.';
      hint.textContent = 'Look for the bright yellow pencil on the desk.'; fill.style.width = '33.33%';
      later(() => {
        if (!node.classList.contains('is-active')) return;
        n.textContent = 'STEP 2 OF 3'; idx.textContent = '2'; task.textContent = 'Place it in the pencil cup.';
        hint.textContent = 'Follow the highlighted yellow object.'; fill.style.width = '66.67%';
      }, reduceMotion ? 0 : 2300);
    }
  }

  function activate(index) {
    active = index;
    clearJobs();
    sceneNodes.forEach((node, i) => {
      const isActive = i === index;
      node.classList.toggle('is-active', isActive);
      node.classList.remove('is-ready', 'is-found');
      node.setAttribute('aria-hidden', String(!isActive));
    });
    tabs.forEach((tab, i) => {
      tab.classList.toggle('is-active', i === index);
      tab.setAttribute('aria-pressed', String(i === index));
    });
    caption.textContent = captions[index];
    animateFeature(scenes[index], sceneNodes[index]);
  }
  function stop() { if (ticker !== null) { clearInterval(ticker); ticker = null; } }
  function start() {
    stop();
    if (!reduceMotion && !document.hidden) ticker = window.setInterval(() => activate((active + 1) % scenes.length), duration);
  }
  tabs.forEach((tab, i) => tab.addEventListener('click', () => { activate(i); start(); }));
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
  activate(0);
  start();
})();
