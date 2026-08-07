// Negy szimulalt jatekos vegigjatszik egy teljes partit a szerver ellen.
// Futtatas: npm test (a szervert maga inditja el a 8000-es porton)
const { spawn } = require('child_process');
const path = require('path');
const ioc = require('socket.io-client');

const URL = 'http://localhost:8000';
const NAMES = ['Anna', 'Bela', 'Cili', 'Denes'];

let failed = false;
function assert(cond, msg) {
    if (cond) {
        console.log('  OK: ' + msg);
    }
    else {
        failed = true;
        console.error('  FAIL: ' + msg);
    }
}

const serverProc = spawn('node', [path.join(__dirname, '..', 'server.js')], { stdio: 'pipe' });
serverProc.stdout.on('data', d => {
    if (d.toString().includes('started on 8000')) run().catch(err => finish(err));
});
serverProc.on('error', err => finish(err));

function finish(err) {
    if (err) {
        console.error('HIBA:', err.message || err);
        failed = true;
    }
    serverProc.kill();
    process.exit(failed ? 1 : 0);
}

function connectPlayer(name) {
    return new Promise((resolve, reject) => {
        const sock = ioc(URL, { transports: ['websocket'] });
        sock.on('connect', () => {
            sock.emit('name', name);
            resolve(sock);
        });
        sock.on('connect_error', reject);
    });
}

function waitFor(sock, event, timeoutMs) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout: ' + event)), timeoutMs || 5000);
        sock.once(event, data => { clearTimeout(t); resolve(data); });
    });
}

async function run() {
    console.log('1. Negy jatekos belep...');
    const socks = [];
    for (const n of NAMES) {
        socks.push(await connectPlayer(n));
    }
    await waitFor(socks[0], 'canstart');
    assert(true, 'canstart megjott negy jatekos utan');

    // Minden figyelot es botot a parti inditasa ELOTT allitunk be,
    // hogy egyetlen esemeny se vesszen el.
    const deals = socks.map(s => waitFor(s, 'deal'));
    const contractP = waitFor(socks[0], 'contract', 10000);
    const dummyHandP = waitFor(socks[0], 'dummyHand', 10000);
    const gameOverP = waitFor(socks[3], 'gameOver', 30000);

    // Licit botok: a valaszokat addig visszatartjuk, amig a teljes kezekre
    // vonatkozo ellenorzesek le nem futnak.
    let releaseBidding;
    const biddingGate = new Promise(res => { releaseBidding = res; });
    const bidScript = ['licit', 'kontra', 'rekontra', 'passz', 'passz', 'passz'];
    let bidIdx = 0;
    const bidLog = [];
    socks.forEach(s => {
        s.on('bidTurn', (opts) => {
            const action = bidScript[bidIdx];
            if (action === undefined) return;
            bidIdx++;
            bidLog.push({ action: action, opts: opts });
            biddingGate.then(() => s.emit('bid', action));
        });
    });

    // Lejatszo botok: mindig az elso szabalyos lapot teszik.
    let cardsPlayed = 0;
    let firstLeadSeat = null;
    socks[0].on('cardPlayed', () => cardsPlayed++);
    socks.forEach(s => {
        s.on('playTurn', (data) => {
            if (firstLeadSeat === null) firstLeadSeat = data.actingSeat;
            setTimeout(() => s.emit('playcard', data.legal[0]), 2);
        });
    });

    console.log('2. Parti inditasa...');
    socks[0].emit('ujparti');
    const hands = {};
    for (let i = 0; i < 4; i++) {
        const d = await deals[i];
        hands[d.seat] = d.cards;
        assert(d.cards.length === 13, NAMES[i] + ' 13 lapot kapott (szek: ' + d.seat + ')');
    }
    const all = Object.values(hands).flat();
    assert(new Set(all).size === 52, 'mind az 52 lap kulonbozo');

    console.log('3. Teritek proba...');
    const teritettP = waitFor(socks[1], 'teritett');
    socks[2].emit('teritek');
    const ter = await teritettP;
    assert(ter.name === 'Cili' && ter.cards.length === 13, 'teritett lapok mindenkinek latszanak');

    console.log('4. Licitalas: licit, kontra, rekontra, majd korpassz...');
    releaseBidding();
    const contract = await contractP;
    assert(bidIdx === 6, 'hat licitlepes tortent (' + bidIdx + ')');
    assert(bidLog[1].opts.kontra === true, 'kontra engedelyezett volt a licit utan az ellenfelnek');
    assert(bidLog[2].opts.rekontra === true, 'rekontra engedelyezett volt a kontra utan');
    assert(contract.kontraLevel === 2, 'a szerzodes rekontrazott');
    assert((contract.declarerSeat + 2) % 4 === contract.dummySeat, 'az asztal a felvevo partnere');
    console.log('  Felvevo: ' + contract.declarerName + ', asztal: ' + contract.dummyName);

    const dummyHand = await dummyHandP;
    assert(dummyHand.cards.length === 13, 'az asztal 13 teritett lapja latszik');

    console.log('5. Lejatszas: 13 utes...');
    const over = await gameOverP;
    assert(firstLeadSeat === (contract.declarerSeat + 1) % 4, 'a felvevo utani jatekos hivott eloszor');
    assert(cardsPlayed === 52, 'mind az 52 lap kijatszasra kerult (' + cardsPlayed + ')');
    assert(over.tricks[0] + over.tricks[1] === 13, 'osszesen 13 utes: ' +
        over.pairNames[0] + ' ' + over.tricks[0] + ' - ' + over.tricks[1] + ' ' + over.pairNames[1]);

    console.log('6. Uj parti a jatek vege utan...');
    const redeal = waitFor(socks[2], 'deal');
    bidScript.push('passz', 'passz', 'passz', 'passz'); // a masodik partit mindenki eldobja
    socks[1].emit('ujparti');
    const d2 = await redeal;
    assert(d2.cards.length === 13, 'ujraosztas is mukodik');

    console.log('7. Korpassz: mindenki passzol...');
    const allPassMsg = new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('timeout: korpassz uzenet')), 5000);
        socks[0].on('message', (text) => {
            if (String(text).includes('Mindenki passzolt')) { clearTimeout(t); res(); }
        });
    });
    await allPassMsg;
    assert(true, 'korpassz utan a szerver jelzett es nem allt le');

    // A szerver meg el: meg egy osztas
    const redeal2 = waitFor(socks[3], 'deal');
    socks[0].emit('ujparti');
    const d3 = await redeal2;
    assert(d3.cards.length === 13, 'korpassz utan is indithato uj parti');

    console.log(failed ? '\nVANNAK HIBAK!' : '\nMinden proba sikeres.');
    socks.forEach(s => s.close());
    finish();
}
