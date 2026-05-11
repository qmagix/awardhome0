const { initDb } = require('./database');
const assert = require('assert');

async function runTest() {
  console.log("Starting Dancer Claims Integration Test...");
  const db = await initDb();

  try {
    // 1. Setup Test Data
    console.log("Setting up test data...");
    const testEmail = `test_user_${Date.now()}@example.com`;
    const userResult = await db.run("INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)", [testEmail, 'hashedpassword', 'user']);
    const userId = userResult.lastID;

    const testDancerUniqueId = `DNC-TEST-${Date.now()}`;
    const dancerResult = await db.run("INSERT INTO dancers (unique_id, name) VALUES (?, ?)", [testDancerUniqueId, 'Test Dancer']);
    const dancerId = dancerResult.lastID;

    // Verify initial state
    const initialDancer = await db.get("SELECT is_claimed, claimed_by_user_id FROM dancers WHERE id = ?", [dancerId]);
    assert.strictEqual(initialDancer.is_claimed, 0, "Dancer should initially be unclaimed");
    assert.strictEqual(initialDancer.claimed_by_user_id, null, "Dancer should initially have no owner");

    // 2. Simulate User Submitting a Claim
    console.log("Simulating user submitting a claim...");
    const claimResult = await db.run(
      "INSERT INTO dancer_claims (user_id, dancer_id, proof_text, status) VALUES (?, ?, ?, ?)", 
      [userId, dancerId, "I am the parent.", "pending"]
    );
    const claimId = claimResult.lastID;

    // Verify claim exists in pending state
    const pendingClaim = await db.get("SELECT status FROM dancer_claims WHERE id = ?", [claimId]);
    assert.strictEqual(pendingClaim.status, 'pending', "Claim should be in pending status");

    // 3. Simulate Admin Approving the Claim (Mirroring server.js logic)
    console.log("Simulating admin approving the claim...");
    await db.run('UPDATE dancers SET is_claimed = 1, claimed_by_user_id = ? WHERE id = ?', [userId, dancerId]);
    await db.run('UPDATE dancer_claims SET status = "approved" WHERE id = ?', [claimId]);
    
    const user = await db.get('SELECT role FROM users WHERE id = ?', [userId]);
    if (user && user.role === 'user') {
      await db.run('UPDATE users SET role = "dancer_owner" WHERE id = ?', [userId]);
    }

    // 4. Verify Final State
    console.log("Verifying final state...");
    const finalDancer = await db.get("SELECT is_claimed, claimed_by_user_id FROM dancers WHERE id = ?", [dancerId]);
    assert.strictEqual(finalDancer.is_claimed, 1, "Dancer should be marked as claimed");
    assert.strictEqual(finalDancer.claimed_by_user_id, userId, "Dancer should be linked to the correct user ID");

    const finalClaim = await db.get("SELECT status FROM dancer_claims WHERE id = ?", [claimId]);
    assert.strictEqual(finalClaim.status, 'approved', "Claim should be marked as approved");

    const finalUser = await db.get("SELECT role FROM users WHERE id = ?", [userId]);
    assert.strictEqual(finalUser.role, 'dancer_owner', "User role should be upgraded to dancer_owner");

    console.log("✅ All tests passed successfully!");

    // 5. Cleanup
    console.log("Cleaning up test data...");
    await db.run("DELETE FROM dancer_claims WHERE id = ?", [claimId]);
    await db.run("DELETE FROM dancers WHERE id = ?", [dancerId]);
    await db.run("DELETE FROM users WHERE id = ?", [userId]);

  } catch (error) {
    console.error("❌ Test Failed:", error);
  }
}

runTest();
