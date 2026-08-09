// Auto-attach the CSRF token (from the <meta name="csrf-token"> rendered by
// partials/header.ejs) to every same-origin state-changing request:
//  - native form submits (hidden _csrf input; query string for multipart,
//    because the server checks the token before multer parses the body)
//  - programmatic form.submit() calls
//  - fetch() with POST/PUT/PATCH/DELETE (X-CSRF-Token header)
(function () {
  var meta = document.querySelector('meta[name="csrf-token"]');
  if (!meta || !meta.content) return;
  var token = meta.content;
  var SAFE = /^(GET|HEAD|OPTIONS)$/i;

  function sameOrigin(url) {
    try { return new URL(url, location.href).origin === location.origin; }
    catch (e) { return false; }
  }

  function addToForm(form) {
    if (!form || !form.tagName || form.tagName !== 'FORM') return;
    if (SAFE.test(form.getAttribute('method') || 'GET')) return;
    var action = form.getAttribute('action') || location.href;
    if (!sameOrigin(action)) return;
    if ((form.enctype || '').toLowerCase() === 'multipart/form-data') {
      var url = new URL(action, location.href);
      url.searchParams.set('_csrf', token);
      form.action = url.href;
    } else if (!form.querySelector('input[name="_csrf"]')) {
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = '_csrf';
      input.value = token;
      form.appendChild(input);
    }
  }

  // Covers user-triggered submits (capture phase, before any other handler)
  document.addEventListener('submit', function (e) { addToForm(e.target); }, true);

  // Covers programmatic form.submit(), which does not fire a submit event
  var nativeSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    addToForm(this);
    return nativeSubmit.apply(this, arguments);
  };

  var nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      var url = (typeof input === 'string') ? input : ((input && input.url) || '');
      var method = (init && init.method) || (input && input.method) || 'GET';
      if (!SAFE.test(method) && sameOrigin(url)) {
        init = init || {};
        var headers = new Headers(init.headers || (input && input.headers) || undefined);
        headers.set('X-CSRF-Token', token);
        init.headers = headers;
      }
    } catch (e) { /* fall through to the unmodified call */ }
    return nativeFetch.call(this, input, init);
  };
})();
