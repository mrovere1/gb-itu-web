// Rede de segurança do carregamento: roda como script clássico, antes dos módulos.
// Se o SDK ou um módulo não carregar (rede, proxy, cache misturado), a pessoa vê uma tela de erro
// com "Recarregar" em vez de ficar presa em "Carregando…" para sempre.
(function () {
  var shown = false;

  function paint() {
    var boot = document.getElementById('view-boot');
    var error = document.getElementById('view-boot-error');
    if (boot) boot.hidden = true;
    if (error) error.hidden = false;
  }

  function show() {
    if (shown || window.__gbBooted) return;
    shown = true;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint);
    else paint();
  }

  window.__gbBootOk = function () { window.__gbBooted = true; };
  window.__gbBootFail = show;

  window.addEventListener('error', function () { if (!window.__gbBooted) show(); });
  window.setTimeout(show, 12000);

  document.addEventListener('DOMContentLoaded', function () {
    var button = document.getElementById('boot-reload');
    if (button) button.addEventListener('click', function () { window.location.reload(); });
  });
})();
