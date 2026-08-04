const { fetchWithCache } = require('./fetch_cache');

async function test() {
  console.log("Run 1: should fetch from network");
  await fetchWithCache('https://rainbowdance.com/results/2026', 'rainbow', 2026, 'event_list');
  
  console.log("Run 2: should hit cache");
  await fetchWithCache('https://rainbowdance.com/results/2026', 'rainbow', 2026, 'event_list');
}

test().catch(console.error);
