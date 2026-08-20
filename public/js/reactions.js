// Reaction chips on award cards. One delegated listener in the CAPTURE
// phase: it runs before the card's inline flip handler (so a tap on 👏
// never flips the card) and it works on lightbox clones, which lose any
// per-element listeners when the card node is cloned.
(function () {
  var busy = false;

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.reaction-btn');
    if (!btn) return;
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    busy = true;

    var bar = btn.closest('.reaction-bar');
    var awardId = bar.getAttribute('data-award-id');
    var type = btn.getAttribute('data-type');

    fetch('/api/award/' + awardId + '/react', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: type })
    }).then(function (res) {
      if (!res.ok) throw new Error('react failed: ' + res.status);
      return res.json();
    }).then(function (data) {
      // Update every rendering of this award (grid card + lightbox clone).
      document.querySelectorAll('.reaction-bar[data-award-id="' + awardId + '"]').forEach(function (b) {
        var tb = b.querySelector('.reaction-btn[data-type="' + type + '"]');
        if (!tb) return;
        tb.classList.toggle('mine', data.mine);
        tb.querySelector('.rx-count').textContent = data.count || '';
        if (data.mine) {
          tb.classList.remove('rx-pop');
          void tb.offsetWidth; // restart the pop animation
          tb.classList.add('rx-pop');
        }
      });
    }).catch(function () { /* leave the chip as it was */ })
      .finally(function () { busy = false; });
  }, true);
})();
