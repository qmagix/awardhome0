// Smoke test: boots the server on a test port and checks that public pages
// respond and admin endpoints reject anonymous requests.
// Run with: npm run smoke
const { spawn } = require('child_process');

const PORT = process.env.SMOKE_PORT || 3997;
const BASE = `http://localhost:${PORT}`;

const CHECKS = [
  // [method, path, expected status(es), description]
  ['GET', '/', [200], 'homepage'],
  ['GET', '/studios', [200], 'studios list'],
  ['GET', '/login', [200], 'login page'],
  ['GET', '/register', [200], 'register page'],
  ['GET', '/faq/dancer', [200], 'dancer FAQ'],
  ['GET', '/verify-email?token=bogus', [400], 'bogus verification token rejected'],
  ['POST', '/api/merge/studios', [403], 'anonymous studio merge blocked'],
  ['POST', '/api/merge/dancers', [403], 'anonymous dancer merge blocked'],
  ['POST', '/api/reject-merge/studios', [403], 'anonymous reject-merge blocked'],
  ['POST', '/api/studios/1/investigate', [403], 'anonymous investigate blocked'],
  ['POST', '/api/studios/1/feature', [403], 'anonymous feature blocked'],
  ['GET', '/admin/compare/studios', [403], 'anonymous compare blocked'],
  ['POST', '/admin/backfill-dancers/1', [403], 'anonymous backfill blocked'],
  ['GET', '/admin', [403], 'anonymous admin dashboard blocked'],
  ['GET', '/admin/users', [403], 'anonymous user management blocked'],
  ['PUT', '/api/studio/ai-summary/1', [302], 'anonymous ai-summary edit redirected to login'],
  ['POST', '/resend-verification', [200], 'resend-verification responds'],
];

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(BASE + '/', { redirect: 'manual' });
      return;
    } catch {
      await new Promise(r => setTimeout(r, 250));
    }
  }
  throw new Error('Server did not start within ' + timeoutMs + 'ms');
}

async function main() {
  const server = spawn('node', ['server.js'], {
    cwd: __dirname + '/..',
    env: {
      ...process.env,
      PORT: String(PORT),
      EMAIL_PROVIDER: '',          // never send real email from the smoke test
      ENABLE_NIGHTLY_BACKUPS: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', d => { serverLog += d; });
  server.stderr.on('data', d => { serverLog += d; });

  let failures = 0;
  try {
    await waitForServer();
    for (const [method, path, expected, desc] of CHECKS) {
      let status;
      try {
        const res = await fetch(BASE + path, {
          method,
          redirect: 'manual',
          headers: { 'Content-Type': 'application/json' },
          body: method === 'GET' ? undefined : '{}',
        });
        status = res.status;
      } catch (e) {
        status = 'ERR: ' + e.message;
      }
      const ok = expected.includes(status);
      if (!ok) failures++;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${method.padEnd(4)} ${path}  -> ${status} (expected ${expected.join('/')})  ${desc}`);
    }
  } catch (e) {
    failures++;
    console.error('FATAL:', e.message);
    console.error('--- server output ---\n' + serverLog);
  } finally {
    server.kill();
  }

  console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} smoke check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
