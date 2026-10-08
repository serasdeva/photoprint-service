(function () {
  try {
    var stored = localStorage.getItem('theme');
    var legacy = localStorage.getItem('site-theme');
    var theme = stored || (legacy === 'dark' ? 'dark' : null);
    if (!theme) {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
  } catch (error) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
