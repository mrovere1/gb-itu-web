// Roda antes da interface: se a página estiver dentro de outro site (iframe), ela permanece oculta.
if (window.top === window.self) {
  document.documentElement.classList.add('ok');
}
