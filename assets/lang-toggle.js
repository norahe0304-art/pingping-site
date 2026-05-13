/* ============================================================
   lang-toggle.js — bilingual diary view switcher

   Looks for <span lang="en"> inside .zi-prose. If present, shows
   the segmented control and lets the reader pick zh / en / both.
   Sets data-lang-mode on the article; CSS in zi.css handles
   the actual show/hide.
   ============================================================ */
(function () {
  function init() {
    var article = document.querySelector('article[data-lang]');
    if (!article) return;
    var hasEn = article.querySelector('.zi-prose [lang="en"]');
    var toggle = article.querySelector('.zi-lang-toggle');
    if (!hasEn || !toggle) {
      if (toggle) toggle.style.display = 'none';
      return;
    }

    toggle.style.display = 'inline-flex';

    var stored = null;
    try { stored = localStorage.getItem('pingping:lang') } catch (e) {}
    var initial = stored === 'zh' || stored === 'en' || stored === 'both' ? stored : 'zh';
    setMode(initial);

    toggle.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-lang]');
      if (!btn) return;
      setMode(btn.dataset.lang);
    });

    function setMode(mode) {
      article.dataset.langMode = mode;
      toggle.querySelectorAll('button').forEach(function (b) {
        b.setAttribute('aria-pressed', b.dataset.lang === mode ? 'true' : 'false');
      });
      try { localStorage.setItem('pingping:lang', mode) } catch (e) {}
    }
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
