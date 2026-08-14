// Flipbook back-stack navigation for award cards (cardDesign 'flipbook').
// Shared by the public dancer page and the WYSIWYG card editor; functions
// are global so cards' inline handlers (and lightbox clones) keep working.
// Pages exist only when their gated content does; nav renders only for 2+
// pages. Wrap-around paging: next from the last page returns to page 1.
function tcbShow(book, idx) {
  const pages = book.querySelectorAll('.tcb-page');
  idx = ((idx % pages.length) + pages.length) % pages.length;
  pages.forEach((p, i) => {
    const on = i === idx;
    p.classList.toggle('active', on);
    // Entry fade only on a real page turn (card is flipped & visible
    // here, so the animation actually ticks — see styles.css note);
    // remove + reflow restarts it when revisiting a page.
    p.classList.remove('tcb-entering');
    if (on) { void p.offsetWidth; p.classList.add('tcb-entering'); }
  });
  book.querySelectorAll('.tcb-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
}
function tcbCurrent(book) {
  return Array.from(book.querySelectorAll('.tcb-page')).findIndex(p => p.classList.contains('active'));
}
function tcbNav(el, dir) {
  const book = el.closest('.trophy-card-back');
  tcbShow(book, tcbCurrent(book) + dir);
}
function tcbGo(dot, idx) {
  tcbShow(dot.closest('.trophy-card-back'), idx);
}
function tcbNavKey(card, dir) {
  const book = card.querySelector('.trophy-card-back.tcb-book');
  if (book && book.querySelectorAll('.tcb-page').length > 1) tcbShow(book, tcbCurrent(book) + dir);
}
// Horizontal swipe on a flipped flipbook card pages instead of flipping;
// dataset.swiped tells the card's click handler to swallow the click some
// browsers still fire after a swipe.
(function () {
  let tcbTouch = null;
  document.addEventListener('touchstart', function (e) {
    const card = e.target.closest('.flip-card.flipbook.flipped');
    tcbTouch = card ? { card, x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (!tcbTouch) return;
    const dx = e.changedTouches[0].clientX - tcbTouch.x;
    const dy = e.changedTouches[0].clientY - tcbTouch.y;
    const card = tcbTouch.card;
    tcbTouch = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const book = card.querySelector('.trophy-card-back.tcb-book');
      if (book && book.querySelectorAll('.tcb-page').length > 1) {
        tcbShow(book, tcbCurrent(book) + (dx < 0 ? 1 : -1));
        card.dataset.swiped = '1';
        setTimeout(() => { delete card.dataset.swiped; }, 400);
      }
    }
  }, { passive: true });
})();
