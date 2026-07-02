/**
 * validation/run_validation.js
 * PDOS Validation Suite Runner. Executes correctness, performance, memory delta,
 * database consistency, and coordinate mapping projection tests.
 */

process.env.USE_TEST_DB = 'true';

const fs = require('fs');
const path = require('path');
const { getDB } = require('../algo/db');
const { runSwingValidation } = require('./swings/swing_validator');
const { runLiquidityValidation } = require('./liquidity/liquidity_validator');
const { runRegistryValidation } = require('./liquidity/registry_validator');
const { runDealingRangeValidation } = require('./dealing_ranges/range_validator');

const { runPerformanceCheck } = require('./performance/perf_validator');
const { runDBConsistencyCheck } = require('./database/db_consistency_validator');
const { runRenderingCheck } = require('./rendering/render_validator');
const { runPDMatrixValidation } = require('./pd_matrix/matrix_validator');

async function main() {
  const args = process.argv.slice(2);
  const runArgIdx = args.indexOf('--run');
  const runId = (runArgIdx !== -1 && args[runArgIdx + 1]) ? args[runArgIdx + 1] : 'run_dev';
  const verbose = args.includes('--verbose');

  console.log("==================================================");
  console.log("     PDOS PRICE ENGINE FOUNDATION VALIDATOR       ");
  console.log(`     Target Run: ${runId}`);
  console.log("==================================================\n");

  const db = getDB();

  // 1. Correctness Checks
  console.log("--- 1. Correctness Verification ---");
  const sessionsDir = path.join(__dirname, 'benchmark_sessions');
  const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));

  let correctnessPassed = true;
  const correctnessReports = {};

  for (const file of files) {
    const filePath = path.join(sessionsDir, file);
    const benchmark = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log(`Running correctness checks against: ${file} (${benchmark.symbol})`);

    const swingRes = runSwingValidation(db, benchmark, runId, verbose);
    console.log(`  - Swing pivot counts: ${swingRes.passed ? '🟢 PASSED' : '🔴 FAILED'}`);
    if (!swingRes.passed) {
      correctnessPassed = false;
      swingRes.errors.forEach(e => console.log(`    ⚠️  ${e}`));
    }

    const liqRes = runLiquidityValidation(db, benchmark, runId, verbose);
    console.log(`  - Equal clusters touches: ${liqRes.passed ? '🟢 PASSED' : '🔴 FAILED'}`);
    if (!liqRes.passed) {
      correctnessPassed = false;
      liqRes.errors.forEach(e => console.log(`    ⚠️  ${e}`));
    }

    const regRes = runRegistryValidation(db, benchmark, runId, verbose);
    console.log(`  - Liquidity Registry Foundation: ${regRes.passed ? '🟢 PASSED' : '🔴 FAILED'}`);
    if (!regRes.passed) {
      correctnessPassed = false;
      regRes.errors.forEach(e => console.log(`    ⚠️  ${e}`));
    }

    const rangeRes = runDealingRangeValidation(db, benchmark, runId, verbose);
    console.log(`  - Dealing range premium/discount: ${rangeRes.passed ? '🟢 PASSED' : '🔴 FAILED'}`);
    if (!rangeRes.passed) {
      correctnessPassed = false;
      rangeRes.errors.forEach(e => console.log(`    ⚠️  ${e}`));
    }

    const matrixRes = runPDMatrixValidation(db, benchmark, runId, verbose);
    console.log(`  - PD Array Matrix: ${matrixRes.passed ? '🟢 PASSED' : '🔴 FAILED'}`);
    if (!matrixRes.passed) {
      correctnessPassed = false;
      matrixRes.errors.forEach(e => console.log(`    ⚠️  ${e}`));
    }

    correctnessReports[file] = {
      swings: { passed: swingRes.passed, errors: swingRes.errors },
      liquidity: { passed: liqRes.passed, errors: liqRes.errors },
      registry: { passed: regRes.passed, errors: regRes.errors },
      dealingRanges: { passed: rangeRes.passed, errors: rangeRes.errors },
      pdMatrix: { passed: matrixRes.passed, errors: matrixRes.errors }
    };
  }

  // 2. Performance & Memory Checks
  console.log("\n--- 2. Performance & Memory Verification ---");
  const perfRes = runPerformanceCheck();
  console.log(`  - Throughput Speed: ${perfRes.barsPerSecond.toFixed(0)} bars/sec (${perfRes.timeMs}ms)`);
  console.log(`  - Memory Heap Delta: ${perfRes.heapDeltaMb.toFixed(2)} MB`);
  const perfPassed = perfRes.passed;
  console.log(`  - Status: ${perfPassed ? '🟢 PASSED' : '🔴 FAILED'}`);

  // 3. Database Consistency Checks
  console.log("\n--- 3. Database Integrity & Constraints ---");
  const dbRes = runDBConsistencyCheck(db);
  console.log(`  - Integrity & Generic Relations Check: ${dbRes.passed ? '🟢 PASSED' : '🔴 FAILED'}`);
  if (!dbRes.passed) {
    dbRes.errors.forEach(e => console.log(`    ⚠️  ${e}`));
  }

  // 4. Rendering Projection Checks
  console.log("\n--- 4. Canvas Rendering Projection ---");
  const renderRes = runRenderingCheck();
  console.log(`  - Coordinate Translation Check: ${renderRes.passed ? '🟢 PASSED' : '🔴 FAILED'}`);
  if (!renderRes.passed) {
    renderRes.errors.forEach(e => console.log(`    ⚠️  ${e}`));
  }

  const allPassed = correctnessPassed && perfPassed && dbRes.passed && renderRes.passed;

  // Compile and save report
  const allResults = {
    run_id: runId,
    timestamp: new Date().toISOString(),
    correctness: correctnessReports,
    performance: perfRes,
    dbConsistency: { passed: dbRes.passed, errors: dbRes.errors },
    rendering: { passed: renderRes.passed, errors: renderRes.errors },
    passed: allPassed
  };

  const today = new Date().toISOString().split('T')[0];
  const reportDir = path.join(__dirname, 'reports', today);
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `run_${runId}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(allResults, null, 2), 'utf8');
  console.log(`\n[REPORT] Saved run validation report to: ${reportPath}`);

  console.log("\n==================================================");
  if (allPassed) {
    console.log("   🎉 SUCCESS: ALL FOUNDATION SUITES PASSED   ");
    console.log("==================================================");
    process.exit(0);
  } else {
    console.log("   ❌ FAILURE: DISCREPANCIES DETECTED        ");
    console.log("==================================================");
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
