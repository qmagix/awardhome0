// Push notifications (mobile design v2 §13, development plan M7).
//
// THE RULE, and it is a product rule rather than a technical one: push is for
// DECISIONS AND QUESTIONS ONLY. A reviewer confirmed an award, rejected one,
// or asked the family something. Nothing else — no "come back and see your
// trophy case", no weekly digests, no re-engagement.
//
// That restraint is the reason this module is thin and has no scheduling, no
// campaign concept and no segments: there is nothing to schedule. If a future
// feature wants an engagement ping, it should have to add the machinery and
// argue for it, rather than find it already sitting here.
//
// Sending is best-effort everywhere. A notification that fails must never roll
// back the decision it was announcing — the award is published either way, and
// the family will see it in the app.
const { openAuthDb } = require('./mobileAuth');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Expo's token shape. Checked before sending because a malformed token is a
// guaranteed rejection, and a rejected batch costs a round trip for every
// other device in it.
const isExpoToken = (t) => typeof t === 'string' && /^Expo(nent)?PushToken\[[^\]]+\]$/.test(t);

async function devicesForUser(userId) {
  try {
    const adb = await openAuthDb();
    const rows = await adb.all(
      'SELECT id, token, platform FROM push_devices WHERE user_id = ? AND disabled_at IS NULL',
      [userId]);
    return rows.filter(r => isExpoToken(r.token));
  } catch (e) {
    return [];
  }
}

// A device that Expo reports as unregistered is gone — the app was deleted, or
// the token rotated. Disabling it stops us retrying forever, and stops the
// disabled row counting as "this family has push".
async function disableDevice(id, reason) {
  try {
    const adb = await openAuthDb();
    await adb.run("UPDATE push_devices SET disabled_at = datetime('now') WHERE id = ?", [id]);
    console.log(`[push] disabled device ${id}: ${reason}`);
  } catch (e) { /* nothing useful to do */ }
}

/**
 * Send one notification to every live device of one household.
 *
 * `data` rides along so the app can deep-link to the thing that changed rather
 * than dumping the family on a home screen to go find it.
 */
async function notifyUser(userId, { title, body, data = {} }) {
  if (process.env.ENABLE_PUSH !== 'true') {
    console.log(`[push] (disabled) would notify user ${userId}: ${title} — ${body}`);
    return { sent: 0, skipped: true };
  }
  const devices = await devicesForUser(userId);
  if (!devices.length) return { sent: 0 };

  const messages = devices.map(d => ({
    to: d.token,
    title,
    body,
    data,
    sound: 'default',
    // Decisions and questions are worth a banner; nothing here is urgent
    // enough to justify a time-sensitive interruption.
    priority: 'default',
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip, deflate' },
      body: JSON.stringify(messages),
    });
    const payload = await res.json();
    const tickets = Array.isArray(payload.data) ? payload.data : [];
    let sent = 0;
    tickets.forEach((t, i) => {
      if (t.status === 'ok') { sent++; return; }
      const device = devices[i];
      if (device && t.details && t.details.error === 'DeviceNotRegistered') {
        void disableDevice(device.id, 'DeviceNotRegistered');
      } else {
        console.error('[push] ticket error:', JSON.stringify(t));
      }
    });
    return { sent };
  } catch (e) {
    console.error('[push] send failed:', e.message);
    return { sent: 0, error: e.message };
  }
}

// ---- The three things worth a notification ---------------------------------

function submissionAccepted(userId, { routine, dancerName, submissionId }) {
  return notifyUser(userId, {
    title: 'Award confirmed',
    body: `${routine} is now on ${dancerName}'s trophy case.`,
    data: { type: 'submission_accepted', submissionId },
  });
}

function submissionRejected(userId, { routine, note, submissionId }) {
  return notifyUser(userId, {
    title: 'Award not added',
    // The reviewer's own words when there are any: "not added" with no reason
    // is the kind of notification that makes people distrust a product.
    body: note ? `${routine}: ${note}` : `${routine} wasn't added. Open the app for details.`,
    data: { type: 'submission_rejected', submissionId },
  });
}

function submissionNeedsInfo(userId, { routine, note, submissionId }) {
  return notifyUser(userId, {
    title: 'A question about your award',
    body: note ? `${routine}: ${note}` : `Someone has a question about ${routine}.`,
    data: { type: 'submission_needs_info', submissionId },
  });
}

module.exports = {
  isExpoToken, devicesForUser, notifyUser,
  submissionAccepted, submissionRejected, submissionNeedsInfo,
};
