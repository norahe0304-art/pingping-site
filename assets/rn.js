/* ============================================================
   rn.js — declarative rough-notation hook
   Add data-rn="<type>" to any inline element to get a hand-drawn
   annotation. Triggers when the element scrolls into view.

   Types: underline · circle · highlight · box · strike-through
          crossed-off · bracket
   Optional attrs:
     data-rn-color    (default #E89A2A — hand-drawn ink amber, matches --accent)
     data-rn-stroke   (default 1.5)
     data-rn-padding  (default 4)
     data-rn-delay    (ms before showing, default 0)

   Depends on global `RoughNotation` (loaded from CDN).
   ============================================================ */
(function () {
  function init() {
    if (typeof RoughNotation === 'undefined') return;
    var els = document.querySelectorAll('[data-rn]');
    els.forEach(function (el) {
      var type = el.dataset.rn || 'underline';
      var color = el.dataset.rnColor || '#E89A2A';
      var stroke = parseFloat(el.dataset.rnStroke || '1.5');
      var padding = el.dataset.rnPadding ? parseFloat(el.dataset.rnPadding) : 4;
      var delay = parseInt(el.dataset.rnDelay || '0', 10);

      var ann = RoughNotation.annotate(el, {
        type: type,
        color: color,
        strokeWidth: stroke,
        padding: padding,
        animationDuration: 700,
        // Atlas uses 2-iteration "back-and-forth" stroke for ALL types —
        // gives the hand-drawn double-line / oval feel.
        iterations: 2,
      });

      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            setTimeout(function () { ann.show(); }, 200 + delay);
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0.45 });
      io.observe(el);
    });
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
