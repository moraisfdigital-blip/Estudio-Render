// External script works with the production Content-Security-Policy.
try {
  document.documentElement.dataset.theme = localStorage.getItem('enby-pro.tema') === 'escuro' ? 'dark' : 'light';
} catch {
  document.documentElement.dataset.theme = 'light';
}
