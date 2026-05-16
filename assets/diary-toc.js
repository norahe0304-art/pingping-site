/* ============================================================
   diary-toc.js — scroll-spy for the diary aggregator page

   Highlights the current entry in the left TOC, draws a rough-notation
   circle around the active chapter number (Atlas-style), and updates
   the top-right pill label as the reader scrolls.
   ============================================================ */
(function () {
  // ----------------------------------------------------------
  // Rough-notation circle for the ACTIVE TOC chapter number.
  // Single live annotation that gets torn down + recreated on every
  // active change. Avoids stale SVGs left behind on previous items.
  // ----------------------------------------------------------
  var ACCENT = '#F45397';
  var activeCircle = null;

  function tearDownCircle() {
    if (activeCircle) {
      try { activeCircle.remove(); } catch (e) {}
      activeCircle = null;
    }
  }

  function drawCircleOn(link) {
    tearDownCircle();
    if (typeof RoughNotation === 'undefined') return;
    var num = link && link.querySelector('.zi-toc-num');
    if (!num) return;
    // read the active entry's --rn-color so the TOC ring matches its accent
    var targetId = link.getAttribute('data-target');
    var section = targetId ? document.getElementById(targetId) : null;
    var color = ACCENT;
    if (section) {
      var v = getComputedStyle(section).getPropertyValue('--rn-color');
      if (v && v.trim()) color = v.trim();
    }
    activeCircle = RoughNotation.annotate(num, {
      type: 'circle',
      color: color,
      strokeWidth: 1.5,
      padding: 5,
      animationDuration: 450,
      iterations: 2,
    });
    activeCircle.show();
  }

  function init() {
    var sections = Array.from(document.querySelectorAll('.zi-section'));
    var tocLinks = Array.from(document.querySelectorAll('.zi-toc-item'));
    if (!sections.length || !tocLinks.length) return;

    var pillLabel = document.getElementById('zi-pill-label');
    var current = null;

    function setActive(id) {
      if (id === current) return;
      current = id;
      tocLinks.forEach(function (a) {
        a.classList.toggle('active', a.dataset.target === id);
      });
      // single circle on the active item; torn down before redraw
      var activeLink = tocLinks.find(function (a) { return a.dataset.target === id; });
      drawCircleOn(activeLink);
      if (pillLabel) {
        var date = id.replace('entry-', '').replace(/-/g, '.');
        pillLabel.textContent = 'DIARY · ' + date;
      }
      // keep active toc item in view
      var active = tocLinks.find(function (a) { return a.dataset.target === id; });
      if (active && active.scrollIntoView) {
        var li = active.parentElement;
        var sidebar = active.closest('.zi-toc');
        if (sidebar && li) {
          var liRect = li.getBoundingClientRect();
          var sbRect = sidebar.getBoundingClientRect();
          if (liRect.top < sbRect.top + 80 || liRect.bottom > sbRect.bottom - 80) {
            li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      }
    }

    var io = new IntersectionObserver(function (entries) {
      // pick the entry whose top is closest above the chosen line
      var visible = entries.filter(function (e) { return e.isIntersecting; });
      if (visible.length) {
        visible.sort(function (a, b) {
          return a.boundingClientRect.top - b.boundingClientRect.top;
        });
        setActive(visible[0].target.id);
      }
    }, {
      rootMargin: '-30% 0px -55% 0px',
      threshold: 0,
    });

    sections.forEach(function (s) { io.observe(s); });

    // kick off: circle the latest entry on first paint so the page doesn't
    // load with a blank TOC. Defer slightly so rough-notation can measure
    // the .zi-toc-num element after layout settles.
    var first = tocLinks[0];
    if (first && first.dataset.target) {
      setTimeout(function () { setActive(first.dataset.target); }, 60);
    }

    // smooth-scroll on TOC click; offset for sticky nav
    tocLinks.forEach(function (a) {
      a.addEventListener('click', function (ev) {
        var id = a.dataset.target;
        var target = document.getElementById(id);
        if (!target) return;
        ev.preventDefault();
        var top = target.getBoundingClientRect().top + window.pageYOffset - 64;
        window.scrollTo({ top: top, behavior: 'smooth' });
        history.replaceState(null, '', '#' + id);
        setActive(id);
      });
    });
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
