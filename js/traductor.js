(function () {
  var caja = document.createElement('div');
  caja.className = 'gtranslate_wrapper';
  document.body.appendChild(caja);

  window.gtranslateSettings = {
    default_language: 'en',
    detect_browser_language: true,
    native_language_names: true,
    wrapper_selector: '.gtranslate_wrapper'
  };

  var s = document.createElement('script');
  s.src = 'https://cdn.gtranslate.net/widgets/latest/float.js';
  s.defer = true;
  document.body.appendChild(s);
})();
