// Check Routine Dancers card interactions (preview/apply/sync/invite/
// complete/submissions). Delegated at document level so it also drives
// cards fetched into the All Routines popup. Requires ui_dialogs.js.
(function () {
  // Per-card base URL: cards carry data-studio-id so this script works
  // on the Check page AND inside the All Routines popup.
  const baseFor = (el) => '/manage/studio/' + el.closest('.gd-card').dataset.studioId + '/group-dancers';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Ticked events scope this round of assignment (absent checkboxes = all)
  function checkedEventIds(card) {
    const boxes = [...card.querySelectorAll('.gd-event')];
    if (!boxes.length) return undefined;
    return boxes.filter(b => b.checked).map(b => parseInt(b.value, 10));
  }

  document.addEventListener('click', async (e) => {
    const card = e.target.closest('.gd-card');
    if (!card) return;
    const ctx = { routine: card.dataset.routine, year: card.dataset.year };

    if (e.target.classList.contains('gd-preview')) {
      const names = card.querySelector('.gd-names').value;
      if (!names.trim()) return;
      const event_ids = checkedEventIds(card);
      if (event_ids && event_ids.length === 0) { toast('Tick at least one event for this round.', true); return; }
      e.target.disabled = true;
      try {
        const res = await fetch(baseFor(card) + '/preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...ctx, names, event_ids })
        });
        const data = await res.json();
        if (!res.ok) { toast(data.error || 'Preview failed', true); return; }
        renderPreview(card, data);
      } finally { e.target.disabled = false; }
    }

    if (e.target.classList.contains('gd-apply')) {
      const rows = [...card.querySelectorAll('.gd-row')];
      const entries = rows.map(row => {
        const picked = row.querySelector('input[type=radio]:checked');
        if (picked) return { name: row.dataset.name, dancer_id: picked.value };
        const sameBox = row.querySelector('.gd-same');
        if (sameBox && !sameBox.checked) return { name: row.dataset.name, dancer_id: 'new' };
        return { name: row.dataset.name, dancer_id: row.dataset.dancerId };
      }).filter(en => en.dancer_id);
      const unresolved = rows.length - entries.length;
      if (unresolved > 0) { toast('Please choose an option for every highlighted name first.', true); return; }
      if (!entries.length) return;
      const event_ids = checkedEventIds(card);
      if (event_ids && event_ids.length === 0) { toast('Tick at least one event for this round.', true); return; }
      e.target.disabled = true;
      try {
        const res = await fetch(baseFor(card) + '/apply', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...ctx, entries, event_ids })
        });
        const data = await res.json();
        if (!res.ok) { toast(data.error || 'Save failed', true); return; }
        location.reload();
      } finally { e.target.disabled = false; }
    }

    if (e.target.classList.contains('gd-sync')) {
      const event_ids = checkedEventIds(card);
      if (event_ids && event_ids.length === 0) { toast('Tick at least one event to sync.', true); return; }
      const ok = await uiConfirm({
        title: 'Sync cast across ticked events?',
        message: 'Every dancer already listed on this routine at any ticked event will be added to its awards at all ticked events.\n\nAdditions only — nobody is removed, and dancers you removed earlier stay removed.',
        confirmLabel: 'Sync dancers',
      });
      if (!ok) return;
      e.target.disabled = true;
      try {
        const res = await fetch(baseFor(card) + '/sync', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...ctx, event_ids })
        });
        const data = await res.json();
        if (!res.ok) { toast(data.error || 'Sync failed', true); return; }
        toast(`Synced: ${data.linked} link${data.linked === 1 ? '' : 's'} added across ${data.awardCount} awards.`
          + (data.skippedRemoved ? ' Previously-removed dancers were left removed.' : ''));
        setTimeout(() => location.reload(), 900);
      } finally { e.target.disabled = false; }
    }

    if (e.target.classList.contains('gd-complete')) {
      const ok = await uiConfirm({
        title: 'Mark this routine complete?',
        message: 'It leaves the check list (and the sidebar count). Nothing else changes — you can undo from "Show all routines" or the All Routines page.',
        confirmLabel: 'Mark complete',
      });
      if (!ok) return;
      const res = await fetch(baseFor(card) + '/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ctx)
      });
      if (res.ok) { toast('Marked complete.'); setTimeout(() => location.reload(), 700); }
      else toast('Could not save — please try again.', true);
    }

    if (e.target.classList.contains('gd-uncomplete')) {
      const res = await fetch(baseFor(card) + '/uncomplete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ctx)
      });
      if (res.ok) location.reload(); else toast('Could not undo — please try again.', true);
    }

    if (e.target.classList.contains('gd-invite')) {
      const modal = document.getElementById('castInviteModal');
      document.getElementById('castInviteRoutine').textContent =
        'For "' + ctx.routine + '" (' + ctx.year + ') — they\'ll see this routine and nothing else.';
      document.getElementById('castInviteEmail').value = '';
      document.getElementById('castInviteNote').value = '';
      const result = document.getElementById('castInviteResult');
      result.style.display = 'none'; result.textContent = '';
      const send = document.getElementById('castInviteSend');
      send.disabled = false;
      send.onclick = async () => {
        const email = document.getElementById('castInviteEmail').value.trim();
        if (!email) { toast('Enter their email address first.', true); return; }
        send.disabled = true;
        try {
          const res = await fetch(baseFor(card) + '/invite', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...ctx, email, note: document.getElementById('castInviteNote').value.trim() })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) { toast(data.error || 'Could not send — please try again.', true); send.disabled = false; return; }
          result.textContent = 'Sent! You can also share the link directly: ' + data.link;
          result.style.display = 'block';
          toast('Invitation sent.');
          setTimeout(() => location.reload(), 2500);
        } catch (err) { toast('Could not send — please try again.', true); send.disabled = false; }
      };
      modal.style.display = 'flex';
    }

    if (e.target.classList.contains('gd-invite-revoke')) {
      const res = await fetch(baseFor(card) + '/invite/' + e.target.dataset.inviteId + '/revoke', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      if (res.ok) location.reload(); else toast('Could not withdraw — please try again.', true);
    }

    if (e.target.classList.contains('gd-sub-load')) {
      // Fill the entry form with the helper's names, scoped to their event
      const names = decodeURIComponent(e.target.dataset.names);
      const evId = e.target.dataset.eventId;
      const details = card.querySelector('details');
      if (details) details.open = true;
      card.querySelector('.gd-names').value = names;
      const boxes = card.querySelectorAll('.gd-event');
      if (boxes.length) boxes.forEach(b => { b.checked = (b.value === evId); });
      toast('Names loaded — Preview, then Confirm & Save.');
    }

    if (e.target.classList.contains('gd-sub-decide')) {
      const action = e.target.dataset.action;
      if (action === 'dismissed') {
        const ok = await uiConfirm({ title: 'Dismiss these names?', message: 'The submission is set aside without saving anything. The helper is not notified.', confirmLabel: 'Dismiss' });
        if (!ok) return;
      }
      const res = await fetch(baseFor(card) + '/submission/' + e.target.dataset.sid, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (res.ok) location.reload(); else toast('Could not update — please try again.', true);
    }

    if (e.target.classList.contains('gd-remove')) {
      const chip = e.target.closest('.gd-chip');
      const ok = await uiConfirm({
        title: 'Remove dancer from this routine?',
        message: 'This removes them from every award of this routine across all its events. To take them off just one event\'s awards, re-enter the cast per event using the event checkboxes instead.',
        confirmLabel: 'Remove',
      });
      if (!ok) return;
      const res = await fetch(baseFor(card) + '/remove', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...ctx, dancer_id: e.target.dataset.dancerId })
      });
      if (res.ok) chip.remove(); else toast('Remove failed', true);
    }
  });

  // Private dancer tags save on blur/change; green flash confirms
  document.addEventListener('change', async (e) => {
    if (!e.target.classList.contains('gd-tag')) return;
    const input = e.target;
    try {
      const res = await fetch('/manage/studio/' + input.closest('.gd-card').dataset.studioId + '/roster/' + input.dataset.dancerId + '/label', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: input.value })
      });
      input.style.borderColor = res.ok ? 'rgba(52,211,153,0.8)' : 'rgba(248,113,113,0.8)';
      setTimeout(() => { input.style.borderColor = 'rgba(255,255,255,0.15)'; }, 1200);
    } catch (err) { input.style.borderColor = 'rgba(248,113,113,0.8)'; }
  });

  function renderPreview(card, data) {
    const box = card.querySelector('.gd-result');
    const rid = Math.floor(Math.random() * 1e9);
    let html = '<div style="border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 0.75rem; background: rgba(0,0,0,0.25);">';
    html += '<div style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 0.5rem;">This will apply to <strong>' + data.awardCount + '</strong> award' + (data.awardCount === 1 ? '' : 's') + ' of this routine:</div>';
    data.results.forEach((r, i) => {
      if (r.status === 'matched') {
        const c = r.candidates[0];
        html += '<div class="gd-row" data-name="' + esc(r.input) + '" data-dancer-id="' + c.id + '" style="padding: 0.3rem 0; font-size: 0.92rem;">'
          + '✅ <strong>' + esc(c.name) + '</strong>' + (c.label ? ' <span style="color: var(--text-muted); font-size: 0.82rem;">🏷 ' + esc(c.label) + '</span>' : '')
          + '<label style="display: block; margin: 0.15rem 0 0 1.4rem; cursor: pointer; color: var(--text-muted);">'
          + '<input type="checkbox" class="gd-same" checked> '
          + 'Same dancer as the ' + esc(c.name) + (c.label ? ' "' + esc(c.label) + '"' : '') + ' on your roster (' + c.award_count + ' awards' + (c.years && c.years !== '–' ? ', ' + c.years : '') + ')'
          + ' <span style="font-size: 0.82rem;">— uncheck if this is a different dancer with the same name (creates a separate record)</span></label>'
          + (c.recent_routines ? '<div style="color: var(--text-muted); font-size: 0.82rem; margin-left: 1.4rem;">Their recent routines: ' + esc(c.recent_routines) + '</div>' : '')
          + '</div>';
      } else if (r.status === 'new') {
        html += '<div class="gd-row" data-name="' + esc(r.input) + '" data-dancer-id="new" style="padding: 0.3rem 0; font-size: 0.92rem;">'
          + '➕ <strong>' + esc(r.input) + '</strong> <span style="color: var(--text-muted);">— new dancer, will be created and added to your roster</span></div>';
      } else {
        html += '<div class="gd-row" data-name="' + esc(r.input) + '" style="padding: 0.4rem 0.5rem; font-size: 0.92rem; background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.35); border-radius: 6px; margin: 0.25rem 0;">'
          + '⚠️ <strong>' + esc(r.input) + '</strong> <span style="color: var(--text-muted);">— more than one dancer with this name is on your roster. Which one danced this routine?</span>';
        r.candidates.forEach(c => {
          html += '<div style="margin: 0.35rem 0 0 1.4rem;">'
            + '<label style="cursor: pointer;">'
            + '<input type="radio" name="gd-pick-' + rid + '-' + i + '" value="' + c.id + '"> '
            + esc(c.name) + (c.label ? ' <strong style="color: var(--primary);">🏷 ' + esc(c.label) + '</strong>' : '')
            + ' <span style="color: var(--text-muted);">(' + c.award_count + ' awards' + (c.years && c.years !== '–' ? ', ' + c.years : '') + (c.graduation_year ? ', grad ' + c.graduation_year : '') + ')</span></label>'
            + (c.recent_routines ? '<div style="color: var(--text-muted); font-size: 0.82rem; margin-left: 1.3rem;">Their recent routines: ' + esc(c.recent_routines) + '</div>' : '')
            + '<div style="margin-left: 1.3rem; margin-top: 0.2rem;"><input type="text" class="gd-tag" data-dancer-id="' + c.id + '" value="' + esc(c.label || '') + '" placeholder="private tag, e.g. Senior Mia" maxlength="40"'
            + ' style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; color: white; padding: 0.2rem 0.5rem; font-size: 0.8rem; width: 200px;">'
            + ' <span style="color: var(--text-muted); font-size: 0.75rem;">saves when you click away — only your studio tools show it</span></div>'
            + '</div>';
        });
        html += '<label style="display: block; margin: 0.25rem 0 0 1.4rem; cursor: pointer;">'
          + '<input type="radio" name="gd-pick-' + rid + '-' + i + '" value="new"> '
          + 'None of these — a different dancer with the same name (creates a new record)</label></div>';
      }
    });
    html += '<button type="button" class="btn gd-apply" style="margin-top: 0.75rem; background: var(--primary); color: #0a0a0a; border: none; padding: 0.5rem 1.4rem; font-weight: 600;">Confirm &amp; Save</button>';
    html += '</div>';
    box.innerHTML = html;
  }
})();
