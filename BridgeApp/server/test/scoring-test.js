// A Chicago pontozas tiszta fuggvenyeinek probaja ismert (szabvanyos) ertekekkel.
// Futtatas: npm test
const { vulnerability, dealScore } = require('../scoring');

let failed = false;
function eq(got, want, msg) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log((ok ? '  OK: ' : '  FAIL: ') + msg + ' = ' + JSON.stringify(got) + (ok ? '' : ' (vart: ' + JSON.stringify(want) + ')'));
    if (!ok) failed = true;
}

console.log('Szkorhelyzet (oszto: 0=É, 1=K, 2=D, 3=NY):');
eq(vulnerability(1, 0), [false, false], '1. leosztas, É oszt: altalanos mans');
eq(vulnerability(2, 1), [false, true], '2. leosztas, K oszt: K-NY');
eq(vulnerability(3, 2), [true, false], '3. leosztas, D oszt: É-D');
eq(vulnerability(4, 3), [true, true], '4. leosztas, NY oszt: altalanos bell');

console.log('Teljesitett felvetel:');
eq(dealScore(1, 'N', 0, false, 7), 90, '1SZ= mansban');
eq(dealScore(1, 'N', 0, false, 8), 120, '1SZ+1 mansban');
eq(dealScore(2, 'S', 0, false, 8), 110, '2♠= mansban');
eq(dealScore(3, 'H', 0, false, 9), 140, '3♥= mansban');
eq(dealScore(3, 'N', 0, false, 9), 400, '3SZ= mansban');
eq(dealScore(3, 'N', 0, true, 9), 600, '3SZ= bellben');
eq(dealScore(4, 'S', 0, false, 10), 420, '4♠= mansban');
eq(dealScore(4, 'S', 0, false, 11), 450, '4♠+1 mansban');
eq(dealScore(4, 'S', 0, true, 10), 620, '4♠= bellben');
eq(dealScore(5, 'C', 0, false, 11), 400, '5♣= mansban');
eq(dealScore(6, 'S', 0, true, 12), 1430, '6♠= bellben');
eq(dealScore(6, 'N', 0, false, 12), 990, '6SZ= mansban');
eq(dealScore(7, 'N', 0, true, 13), 2220, '7SZ= bellben');

console.log('Kontra / rekontra teljesitve:');
eq(dealScore(1, 'S', 1, false, 7), 160, '1♠X= mansban');
eq(dealScore(1, 'S', 1, false, 8), 260, '1♠X+1 mansban');
eq(dealScore(1, 'S', 1, true, 8), 360, '1♠X+1 bellben');
eq(dealScore(2, 'H', 1, false, 8), 470, '2♥X= mansban');
eq(dealScore(1, 'S', 2, false, 7), 520, '1♠XX= mansban');
eq(dealScore(3, 'N', 1, true, 9), 750, '3SZX= bellben');

console.log('Bukas:');
eq(dealScore(4, 'S', 0, false, 9), -50, '4♠-1 mansban');
eq(dealScore(4, 'S', 0, true, 8), -200, '4♠-2 bellben');
eq([1, 2, 3, 4].map(d => dealScore(4, 'S', 1, false, 10 - d)), [-100, -300, -500, -800], '4♠X -1..-4 mansban');
eq([1, 2, 3, 4].map(d => dealScore(4, 'S', 1, true, 10 - d)), [-200, -500, -800, -1100], '4♠X -1..-4 bellben');
eq(dealScore(4, 'S', 2, false, 8), -600, '4♠XX-2 mansban');
eq(dealScore(4, 'S', 2, true, 9), -400, '4♠XX-1 bellben');

console.log(failed ? 'VANNAK HIBAK!' : 'Pontozas proba sikeres.');
process.exit(failed ? 1 : 0);
