/* ============================================================
   reveal.js — word-by-word "being written" reveal for handwritten
   elements (.zi-sidenote, .zi-prose-section blockquote p).

   On DOM ready: each target's text is split into <span class="zi-word">
   tokens with a `--i` custom property carrying the word index. The
   raw whitespace nodes are preserved so wrapping behaves normally.

   On viewport entry: the target gets `.zi-revealed`, and CSS fades
   the words in sequentially via `transition-delay: calc(var(--i) * 65ms)`.
   ============================================================ */
(function () {
  var SELECTOR = '.zi-prose-section .zi-sidenote, .zi-prose-section blockquote p';

  function splitWords(el) {
    if (el.dataset.split === '1') return;
    var text = el.textContent;
    if (!text || !text.trim()) return;
    el.textContent = '';
    var parts = text.split(/(\s+)/);
    var idx = 0;
    parts.forEach(function (part) {
      if (!part) return;
      if (/^\s+$/.test(part)) {
        el.appendChild(document.createTextNode(part));
      } else {
        var span = document.createElement('span');
        span.className = 'zi-word';
        span.style.setProperty('--i', idx);
        span.textContent = part;
        el.appendChild(span);
        idx += 1;
      }
    });
    el.dataset.split = '1';
  }

  function init() {
    var targets = document.querySelectorAll(SELECTOR);
    if (!targets.length) return;
    targets.forEach(splitWords);

    if (!('IntersectionObserver' in window)) {
      targets.forEach(function (el) { el.classList.add('zi-revealed'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('zi-revealed');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.2, rootMargin: '0px 0px -10% 0px' });
    targets.forEach(function (el) { io.observe(el); });
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
