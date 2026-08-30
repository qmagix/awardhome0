// Shared promise-based confirm modal + toast — the site-wide replacement for
// alert()/confirm() on manage surfaces. Vanilla, self-injecting: include the
// script and call uiConfirm({title, message, confirmLabel}) / toast(msg, isError).
(function () {
  function ensureConfirmDom() {
    if (document.getElementById('uiConfirmModal')) return;
    const modal = document.createElement('div');
    modal.id = 'uiConfirmModal';
    modal.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.65); z-index:2000; align-items:center; justify-content:center;';
    modal.innerHTML =
      '<div class="card glass-card" style="max-width:440px; width:calc(100% - 2rem); padding:1.75rem;">' +
      '<h3 id="uiConfirmTitle" style="margin:0 0 0.75rem 0; color:white;"></h3>' +
      '<p id="uiConfirmMessage" style="color:var(--text-muted); margin:0 0 1.5rem 0; line-height:1.55; white-space:pre-line;"></p>' +
      '<div style="display:flex; justify-content:flex-end; gap:0.75rem;">' +
      '<button id="uiConfirmCancel" class="btn" style="background:rgba(255,255,255,0.1); color:white;">Cancel</button>' +
      '<button id="uiConfirmOk" class="btn" style="background:var(--primary); color:#0a0a0a; font-weight:600;"></button>' +
      '</div></div>';
    document.body.appendChild(modal);
  }

  function ensureToastDom() {
    if (document.getElementById('uiToast')) return;
    const el = document.createElement('div');
    el.id = 'uiToast';
    // pointer-events:none — the toast sits at bottom-center over the same
    // band as floating action buttons (e.g. the roster's Compare & Merge at
    // bottom-right); with pointer events it silently swallowed their clicks
    // for its 4s lifetime. Nothing in a toast is interactive.
    el.style.cssText = 'display:none; pointer-events:none; position:fixed; bottom:2rem; left:50%; transform:translateX(-50%); z-index:2100; background:rgba(15,23,42,0.96); border:1px solid rgba(255,255,255,0.2); border-radius:8px; padding:0.8rem 1.4rem; color:white; max-width:min(90vw, 480px); box-shadow:0 10px 30px rgba(0,0,0,0.5);';
    document.body.appendChild(el);
  }

  window.uiConfirm = function ({ title, message, confirmLabel = 'Confirm' }) {
    ensureConfirmDom();
    return new Promise((resolve) => {
      const modal = document.getElementById('uiConfirmModal');
      document.getElementById('uiConfirmTitle').textContent = title;
      document.getElementById('uiConfirmMessage').textContent = message;
      const ok = document.getElementById('uiConfirmOk');
      const cancel = document.getElementById('uiConfirmCancel');
      ok.textContent = confirmLabel;
      const done = (v) => { modal.style.display = 'none'; ok.onclick = cancel.onclick = modal.onclick = null; resolve(v); };
      ok.onclick = () => done(true);
      cancel.onclick = () => done(false);
      modal.onclick = (e) => { if (e.target === modal) done(false); };
      modal.style.display = 'flex';
    });
  };

  let toastTimer = null;
  window.toast = function (msg, isError) {
    ensureToastDom();
    const el = document.getElementById('uiToast');
    el.textContent = msg;
    el.style.borderColor = isError ? 'rgba(239, 68, 68, 0.6)' : 'rgba(16, 185, 129, 0.6)';
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = 'none'; }, 4000);
  };
})();
