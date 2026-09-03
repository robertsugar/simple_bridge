// Negy szimulalt jatekos vegigjatszik egy teljes partit a szerver ellen.
// Futtatas: npm test (a szervert maga inditja el a TEST_PORT/8010-es porton,
// hogy ne utkozzon egy esetleg futo elo szerverrel)
const { spawn } = require('child_process');
const path = require('path');
const ioc = require('socket.io-client');

const PORT = process.env.TEST_PORT || '8010';
const URL = 'http://localhost:' + PORT;
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

const serverProc = spawn('node', [path.join(__dirname, '..', 'server.js')],
    { stdio: 'pipe', env: Object.assign({}, process.env, { PORT: PORT }) });
serverProc.stdout.on('data', d => {
    if (d.toString().includes('started on ' + PORT)) run().catch(err => finish(err));
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
    // Terv (oszto: Anna, szek 0): Cili (szek 2) mondja eloszor a kort, Anna emel,
    // igy a bridzs szabaly szerint Cili lesz a felvevo es Anna terit.
    let releaseBidding;
    const biddingGate = new Promise(res => { releaseBidding = res; });
    const bidScript = [
        { type: 'bid', level: 1, denom: 'C' },  // Anna: 1 treff
        { type: 'passz' },                      // Bela
        { type: 'bid', level: 1, denom: 'H' },  // Cili: 1 kor (eloszor a nemet)
        { type: 'passz' },                      // Denes
        { type: 'bid', level: 2, denom: 'H' },  // Anna: 2 kor (emeles)
        { type: 'kontra' },                     // Bela
        { type: 'rekontra' },                   // Cili
        { type: 'passz' }, { type: 'passz' }, { type: 'passz' } // Denes, Anna, Bela
    ];
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
    let botsPlay = true;
    let cardsPlayed = 0;
    let firstLeadSeat = null;

    // Fuggetlen utes-gyoztes ellenorzes: a teszt maga is kiszamolja adu
    // figyelembevetelevel, hogy kinek kellett vinnie az utest.
    const RANKS = '23456789TJQKA';
    let curTrump = null;
    let mirrorTrick = [];
    let winnerMismatches = 0;
    socks[0].on('contract', c => { curTrump = c.denom === 'N' ? null : c.denom; });
    socks[0].on('deal', () => { mirrorTrick = []; });
    socks[0].on('cardPlayed', d => { cardsPlayed++; mirrorTrick.push(d); });
    socks[0].on('trickDone', d => {
        let win = mirrorTrick[0];
        mirrorTrick.forEach(t => {
            const tTrump = curTrump !== null && t.card[0] === curTrump;
            const wTrump = curTrump !== null && win.card[0] === curTrump;
            if (tTrump && !wTrump) win = t;
            else if (tTrump === wTrump && t.card[0] === win.card[0] &&
                RANKS.indexOf(t.card[1]) > RANKS.indexOf(win.card[1])) win = t;
        });
        if (win.seat !== d.winnerSeat) winnerMismatches++;
        mirrorTrick = [];
    });
    socks.forEach(s => {
        s.on('playTurn', (data) => {
            if (!botsPlay) return;
            if (firstLeadSeat === null) firstLeadSeat = data.actingSeat;
            setTimeout(() => s.emit('playcard', data.legal[0]), 2);
        });
    });

    console.log('2. Ulesrend valasztas es parti inditasa...');
    // Anna nyomja meg a Jatek inditasat: o lesz Eszak, es o valaszt
    const seatSetupP = waitFor(socks[0], 'seatSetup');
    socks[0].emit('ujparti');
    const setup = await seatSetupP;
    assert(setup.names.length === 3 && setup.names.includes('Bela') &&
        setup.names.includes('Cili') && setup.names.includes('Denes'),
        'az indito megkapja a masik harom nevet: ' + setup.names.join(', '));
    // Partner (Del): Cili, Kelet: Bela -> ulesrend: Anna=0/E, Bela=1/K, Cili=2/D, Denes=3/NY
    socks[0].emit('seatChoice', {
        partner: setup.names.indexOf('Cili'),
        kelet: setup.names.indexOf('Bela')
    });
    const hands = {};
    for (let i = 0; i < 4; i++) {
        const d = await deals[i];
        hands[d.seat] = d.cards;
        assert(d.cards.length === 13, NAMES[i] + ' 13 lapot kapott (szek: ' + d.seat + ')');
        assert(d.seat === i, NAMES[i] + ' a valasztott szeken ul (' + i + ')');
    }
    const all = Object.values(hands).flat();
    assert(new Set(all).size === 52, 'mind az 52 lap kulonbozo');
    // Tobb seatSetup mar nem johet: az ulesrend megvan
    socks.forEach(s => s.on('seatSetup', () => {
        failed = true;
        console.error('  FAIL: ujboli seatSetup erkezett, pedig az ulesrend mar megvan');
    }));

    console.log('3. Teritek proba...');
    const teritettP = waitFor(socks[1], 'teritett');
    socks[2].emit('teritek');
    const ter = await teritettP;
    assert(ter.name === 'Cili' && ter.cards.length === 13, 'teritett lapok mindenkinek latszanak');

    console.log('4. Licitalas: 1C, 1H, 2H, kontra, rekontra, majd harom passz...');
    releaseBidding();
    const contract = await contractP;
    assert(bidIdx === 10, 'tiz licitlepes tortent (' + bidIdx + ')');
    assert(bidLog[1].opts.highest && bidLog[1].opts.highest.level === 1 && bidLog[1].opts.highest.denom === 'C',
        'a soron levo latja az aktualis legmagasabb licitet');
    assert(bidLog[5].opts.kontra === true, 'kontra engedelyezett volt a licit utan az ellenfelnek');
    assert(bidLog[5].opts.rekontra === false, 'rekontra nem volt engedelyezett kontra elott');
    assert(bidLog[6].opts.rekontra === true, 'rekontra engedelyezett volt a kontra utan a felvevo oldalnak');
    assert(contract.level === 2 && contract.denom === 'H', 'a szerzodes 2 kor');
    assert(contract.kontraLevel === 2, 'a szerzodes rekontrazott');
    assert(contract.declarerSeat === 2, 'a felvevo Cili, aki eloszor mondta a kort (nem Anna, aki utoljara licitalt)');
    assert(contract.dummySeat === 0, 'az asztal Anna, a felvevo partnere');
    console.log('  Felvevo: ' + contract.declarerName + ', asztal: ' + contract.dummyName);

    const dummyHand = await dummyHandP;
    assert(dummyHand.cards.length === 13, 'az asztal 13 teritett lapja latszik');

    console.log('5. Lejatszas: 13 utes...');
    const over = await gameOverP;
    assert(firstLeadSeat === (contract.declarerSeat + 1) % 4, 'a felvevo utani jatekos hivott eloszor');
    assert(cardsPlayed === 52, 'mind az 52 lap kijatszasra kerult (' + cardsPlayed + ')');
    assert(over.tricks[0] + over.tricks[1] === 13, 'osszesen 13 utes: ' +
        over.pairNames[0] + ' ' + over.tricks[0] + ' - ' + over.tricks[1] + ' ' + over.pairNames[1]);
    assert(winnerMismatches === 0, 'minden utest a szabalyok szerinti gyoztes vitt (adu: kor)');
    assert(over.needed === 8 && over.diff === over.declTricks - 8 && over.declTricks === over.tricks[0],
        'gameOver: bemondas adatok (kellett: ' + over.needed + ', vitt: ' + over.declTricks + ', eredmeny: ' + over.diff + ')');

    console.log('6. Uj parti a jatek vege utan...');
    const redeal = waitFor(socks[2], 'deal');
    bidScript.push({ type: 'passz' }, { type: 'passz' }, { type: 'passz' }, { type: 'passz' }); // a masodik partit mindenki eldobja
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
    // a harmadik parti 3SZ, es auto fejezi be
    bidScript.push({ type: 'bid', level: 3, denom: 'N' }, { type: 'passz' }, { type: 'passz' }, { type: 'passz' });
    botsPlay = false;
    socks[0].emit('ujparti');
    const d3 = await redeal2;
    assert(d3.cards.length === 13, 'korpassz utan is indithato uj parti');

    console.log('8. Auto befejezes: a szerver jatssza vegig a partit...');
    const contract3 = await waitFor(socks[0], 'contract', 10000);
    const gameOver3P = waitFor(socks[1], 'gameOver', 60000);
    socks[2].emit('autofinish');
    const over3 = await gameOver3P;
    assert(over3.tricks[0] + over3.tricks[1] === 13, 'auto befejezes: mind a 13 utes lement (felvevo: ' +
        contract3.declarerName + ', szerzodes: ' + contract3.level + contract3.denom +
        ', eredmeny: ' + over3.tricks[0] + '-' + over3.tricks[1] + ')');
    assert(winnerMismatches === 0, 'szanzaduban is a szabalyok szerinti gyoztes vitt minden utest');

    console.log(failed ? '\nVANNAK HIBAK!' : '\nMinden proba sikeres.');
    socks.forEach(s => s.close());
    finish();
}
