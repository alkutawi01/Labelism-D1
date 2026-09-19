// Labelism UI runtime: the few interactive pieces every page shares, so no page
// falls back to the browser's native alert()/confirm()/prompt() (which look
// different on every device and cannot be styled or tested reliably).
//
//   UI.confirm({ title, message, confirmLabel, cancelLabel, tone })  -> Promise<boolean>
//   UI.alert({ title, message })                                     -> Promise<void>
//   UI.prompt({ title, message, label, value, confirmLabel })        -> Promise<string|null>
//   UI.toast(message, tone)        tone: 'ok' | 'error' | 'warn' | undefined
//   UI.busy(button, promiseOrFn)   shows a spinner on the button until it settles
//   UI.esc(text)                   HTML-escape for template strings
//
// Everything is plain DOM and uses the design-system classes in style.css.
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function openDialog({ title, message, actions, field, tone }) {
    return new Promise((resolve) => {
      const previouslyFocused = document.activeElement;
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      const id = 'dlg-' + Math.random().toString(36).slice(2, 8);
      backdrop.innerHTML = `
        <div class="modal ${tone === 'danger' ? 'is-danger' : ''}" role="dialog" aria-modal="true" aria-labelledby="${id}-t" aria-describedby="${id}-b">
          <h2 class="modal-title" id="${id}-t">${esc(title || '')}</h2>
          <div class="modal-body" id="${id}-b">${esc(message || '')}${field ? `
            <label class="field" for="${id}-f">${esc(field.label || '')}
              <input id="${id}-f" type="text" value="${esc(field.value || '')}" autocomplete="off">
            </label>` : ''}</div>
          <div class="modal-actions">${actions.map((a, i) => `<button type="button" class="btn ${a.className}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>
        </div>`;
      document.body.appendChild(backdrop);
      const input = backdrop.querySelector('input');
      const buttons = [...backdrop.querySelectorAll('button')];
      const primary = buttons.find((b) => b.dataset.i === String(actions.findIndex((a) => a.primary)));

      function close(result) {
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
        resolve(result);
      }
      function choose(i) { const a = actions[i]; close(a.value === 'input' ? input.value : a.value); }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(actions.find((a) => a.cancel)?.value ?? null); }
        else if (e.key === 'Enter' && document.activeElement && document.activeElement.tagName !== 'BUTTON') { e.preventDefault(); primary && primary.click(); }
        else if (e.key === 'Tab') { // keep focus inside the dialog
          const focusables = [...backdrop.querySelectorAll('input, button')];
          const first = focusables[0]; const last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      document.addEventListener('keydown', onKey, true);
      buttons.forEach((b) => b.addEventListener('click', () => choose(Number(b.dataset.i))));
      backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(actions.find((a) => a.cancel)?.value ?? null); });
      (input || primary || buttons[0]).focus();
      if (input) input.select();
    });
  }

  const UI = {
    esc,

    confirm({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone } = {}) {
      return openDialog({
        title, message, tone,
        actions: [
          { label: cancelLabel, className: 'btn-secondary', value: false, cancel: true },
          { label: confirmLabel, className: tone === 'danger' ? 'btn-danger-solid' : 'btn-primary', value: true, primary: true },
        ],
      });
    },

    alert({ title = 'Notice', message = '', okLabel = 'OK' } = {}) {
      return openDialog({ title, message, actions: [{ label: okLabel, className: 'btn-primary', value: undefined, primary: true, cancel: true }] });
    },

    prompt({ title = '', message = '', label = '', value = '', confirmLabel = 'OK', cancelLabel = 'Cancel' } = {}) {
      return openDialog({
        title, message, field: { label, value },
        actions: [
          { label: cancelLabel, className: 'btn-secondary', value: null, cancel: true },
          { label: confirmLabel, className: 'btn-primary', value: 'input', primary: true },
        ],
      });
    },

    toast(message, tone) {
      let stack = document.querySelector('.toast-stack');
      if (!stack) {
        stack = document.createElement('div');
        stack.className = 'toast-stack';
        stack.setAttribute('role', 'status');
        stack.setAttribute('aria-live', 'polite');
        document.body.appendChild(stack);
      }
      const t = document.createElement('div');
      t.className = 'toast' + (tone ? ' ' + tone : '');
      t.textContent = message;
      stack.appendChild(t);
      setTimeout(() => { t.remove(); }, tone === 'error' ? 8000 : 4000);
    },

    // Disable a button and show a spinner until the work finishes.
    async busy(button, work) {
      button.disabled = true;
      button.classList.add('is-loading');
      try { return await (typeof work === 'function' ? work() : work); }
      finally { button.disabled = false; button.classList.remove('is-loading'); }
    },
  };

  window.UI = UI;
})();
