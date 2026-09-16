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
    { stdio: 'pipe', env: Object.assign({}, process.env, { PORT: PORT, BOT_DELAY_MS: '25' }) });
serverProc.stdout.on('data', d => {
    if (d.toString().includes('started on ' + PORT)) run().catch(err => finish(err));
});
serverProc.on('error', err => finish(err));
serverProc.stderr.on('data', d => console.error('[SZERVER HIBA]', d.toString()));
serverProc.on('exit', c => { if (c !== null && c !== 0) console.error('[SZERVER LEALLT] kod:', c); });

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
    // Mindenki leul a valasztott helyere: Anna=0/É, Bela=1/K, Cili=2/D, Denes=3/NY
    let seatsNow = [null, null, null, null];
    socks[0].on('seats', x => { seatsNow = x; });
    socks.forEach((s, i) => s.emit('sit', i));
    await new Promise((res, rej) => {
        const t0 = Date.now();
        const iv = setInterval(() => {
            if (seatsNow.every(x => x !== null)) { clearInterval(iv); res(); }
            else if (Date.now() - t0 > 5000) { clearInterval(iv); rej(new Error('nem ult le mindenki')); }
        }, 50);
    });
    assert(seatsNow[0].name === 'Anna' && seatsNow[1].name === 'Bela' &&
        seatsNow[2].name === 'Cili' && seatsNow[3].name === 'Denes',
        'mindenki a valasztott helyen ul (É:' + seatsNow[0].name + ' K:' + seatsNow[1].name +
        ' D:' + seatsNow[2].name + ' NY:' + seatsNow[3].name + ')');

    // Minden figyelot es botot a parti inditasa ELOTT allitunk be,
    // hogy egyetlen esemeny se vesszen el.
    const deals = socks.map(s => waitFor(s, 'deal'));
    const contractP = waitFor(socks[0], 'contract', 10000);
    const dummyHandP = waitFor(socks[0], 'dummyHand', 10000);
    const partnerHandP = waitFor(socks[0], 'partnerHand', 10000); // az 1. partiban Anna az asztal
    const gameOverP = waitFor(socks[3], 'gameOver', 30000);
    let dummyRevealAt = -1; // hany kijatszott lap utan terult az asztal

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
    const attachBidBot = (s) => { // az ujracsatlakozo socketekre is fel kell tenni
        s.on('bidTurn', (opts) => {
            const action = bidScript[bidIdx];
            if (action === undefined) return;
            bidIdx++;
            bidLog.push({ action: action, opts: opts });
            biddingGate.then(() => s.emit('bid', action));
        });
    };
    socks.forEach(attachBidBot);

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
    socks[0].once('dummyHand', () => { dummyRevealAt = cardsPlayed; });
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
    const attachPlayBot = (s) => { // az ujracsatlakozo socketekre is fel kell tenni
        s.on('playTurn', (data) => {
            if (!botsPlay) return;
            if (firstLeadSeat === null) firstLeadSeat = data.actingSeat;
            setTimeout(() => s.emit('playcard', data.legal[0]), 2);
        });
    };
    socks.forEach(attachPlayBot);

    console.log('1b. Uzenetkuldes...');
    const chatP = waitFor(socks[3], 'chat');
    socks[0].emit('chat', 'Szia mindenki!');
    const chatMsg = await chatP;
    assert(chatMsg.name === 'Anna' && chatMsg.text === 'Szia mindenki!',
        'az uzenet nevvel egyutt mindenkihez eljut');

    console.log('2. Parti inditasa...');
    socks[0].emit('ujparti');
    const hands = {};
    for (let i = 0; i < 4; i++) {
        const d = await deals[i];
        hands[d.seat] = d.cards;
        assert(d.cards.length === 13, NAMES[i] + ' 13 lapot kapott (szek: ' + d.seat + ')');
        assert(d.seat === i, NAMES[i] + ' a valasztott szeken ul (' + i + ')');
    }
    const all = Object.values(hands).flat();
    assert(new Set(all).size === 52, 'mind az 52 lap kulonbozo');

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
    assert(dummyRevealAt === 1, 'az asztal pontosan az elso kihivott lap utan terult le (' + dummyRevealAt + ')');
    const partnerHand = await partnerHandP;
    assert(partnerHand.seat === 2 && partnerHand.cards.length === 13,
        'az asztal (Anna) latja a felvevo (Cili) 13 lapjat');

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

    console.log('9. Visszacsatlakozas: Cili kiesik, majd ugyanazzal a nevvel visszater...');
    socks[2].close();
    await new Promise(r => setTimeout(r, 300));
    const cili2 = await connectPlayer('Cili'); // connectPlayer kuldi a nevet
    const redeal3 = waitFor(cili2, 'deal', 5000);
    const reover = waitFor(cili2, 'gameOver', 5000);
    const d4 = await redeal3;
    assert(d4.seat === 2, 'Cili visszakapta a regi szeket (2)');
    assert(Array.isArray(d4.counts) && d4.counts.every(c => c === 0), 'a lapszamok szinkronban vannak (parti vege: 0)');
    const ro = await reover;
    assert(ro.tricks[0] + ro.tricks[1] === 13, 'a parti eredmenyet is visszakapta');
    socks[2] = cili2;
    attachBidBot(cili2);
    attachPlayBot(cili2);

    console.log('10. Szek atvetele: Bela uj kapcsolattal ter vissza, mielott a regi lebomlana...');
    const oldBela = socks[1];
    const oldDisconnected = new Promise(res => oldBela.once('disconnect', res));
    const bela2 = await connectPlayer('Bela'); // a regi kapcsolat meg nyitva van!
    const redeal4 = await waitFor(bela2, 'deal', 5000);
    assert(redeal4.seat === 1, 'Bela az uj kapcsolattal is a regi szeket kapta (1), nem lett nezelodo');
    await oldDisconnected;
    assert(true, 'a szerver lebontotta a regi, arva kapcsolatot');
    socks[1] = bela2;
    attachBidBot(bela2);
    attachPlayBot(bela2);

    console.log('11. Visszavonas, majd bejelentes: minden utest viszek...');
    // Uj parti (oszto: Denes), Denes 1 kort mond es o lesz a felvevo
    bidScript.push({ type: 'bid', level: 1, denom: 'H' }, { type: 'passz' }, { type: 'passz' }, { type: 'passz' });
    let lastUndoActor = -1;
    socks[0].on('undoState', d => { lastUndoActor = d.actor; });
    const deal5 = waitFor(socks[0], 'deal');
    const contract5P = waitFor(socks[3], 'contract', 10000);
    const leadTurnP = waitFor(socks[0], 'playTurn', 10000); // Anna hiv
    // Az ellenfelek (Anna es Cili) elfogadjak a bejelentest
    [socks[0], socks[2]].forEach(s => s.once('claimAsk', () => s.emit('claimAnswer', true)));
    socks[0].emit('ujparti');
    await deal5;
    const contract5 = await contract5P;
    assert(contract5.declarerSeat === 3 && contract5.dummySeat === 1, 'Denes a felvevo, Bela az asztal');

    // Visszavonas: Anna kijatszik egy lapot, majd visszavonja
    const lead = await leadTurnP;
    const played1 = waitFor(socks[1], 'cardPlayed', 5000);
    socks[0].emit('playcard', lead.legal[0]);
    await played1;
    await new Promise(r => setTimeout(r, 150));
    assert(lastUndoActor === 0, 'a lapot kijatszo Anna vonhatja vissza (aktor: ' + lastUndoActor + ')');
    const undoResync = waitFor(socks[1], 'deal', 5000); // visszavonas utan mindenki ujraszinkronizal
    socks[0].emit('undo');
    const ur = await undoResync;
    assert(ur.counts && ur.counts.every(c => c === 13), 'a visszavont lap visszakerult a kezbe');
    await new Promise(r => setTimeout(r, 150));
    assert(lastUndoActor === 2, 'most az elozo lepes gazdaja (Cili passza) vonhato vissza (aktor: ' + lastUndoActor + ')');
    // a varakozok csak most, hogy a resync-bol erkezo regi gameOver-t ne kapjak el
    const claimAskP = waitFor(socks[1], 'claimAsk', 10000);
    const gameOver5P = waitFor(socks[1], 'gameOver', 10000);
    const revealP = waitFor(socks[2], 'reveal', 10000);
    socks[3].emit('claim'); // a felvevo bejelenti
    const ask = await claimAskP;
    assert(ask.claimerName === 'Denes' && ask.needed.length === 2 &&
        ask.needed.includes(0) && ask.needed.includes(2),
        'mindket ellenfelnek (Anna, Cili) el kell fogadnia');
    const over5 = await gameOver5P;
    assert(over5.tricks[1] === 13 && over5.tricks[0] === 0 && over5.made === true,
        'elfogadva: a bejelento vonala vitte mind a 13 utest (' + over5.tricks + ')');
    const rev = await revealP;
    assert(rev.hands.length === 4 && rev.hands.every(h => h.length === 13),
        'a parti vegen mindenki eredeti 13 lapja lathato');
    assert(Array.isArray(rev.tricksHist) && rev.tricksHist.length === 0,
        'az uteslista is megjott (' + rev.tricksHist.length + ' lejatszott utes)');

    console.log('12. Robot jatekos: Denes helyere bot ul, es vegigmegy egy parti...');
    socks[3].emit('leave'); // Denes felall (vege fazisban szabad)
    await new Promise((res, rej) => {
        const t0 = Date.now();
        const iv = setInterval(() => {
            if (seatsNow[3] === null) { clearInterval(iv); res(); }
            else if (Date.now() - t0 > 5000) { clearInterval(iv); rej(new Error('nem urult ki a szek')); }
        }, 50);
    });
    socks[0].emit('addBot', 3);
    await new Promise((res, rej) => {
        const t0 = Date.now();
        const iv = setInterval(() => {
            if (seatsNow[3] !== null && seatsNow[3].bot) { clearInterval(iv); res(); }
            else if (Date.now() - t0 > 5000) { clearInterval(iv); rej(new Error('nem ult le a bot')); }
        }, 50);
    });
    assert(true, 'a bot leult Denes helyere (' + seatsNow[3].name + ')');
    botsPlay = true; // az emberek automatikusan jatszanak
    bidScript.push({ type: 'passz' }, { type: 'passz' }, { type: 'passz' },
        { type: 'passz' }, { type: 'passz' }, { type: 'passz' });
    let botActed = false;
    socks[0].on('bidMade', b => { if (b.seat === 3) botActed = true; });
    const botGameDone = new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('timeout: bot parti')), 30000);
        socks[2].once('gameOver', () => { clearTimeout(t); res('lejatszva'); });
        socks[0].on('message', (m) => {
            if (String(m).includes('Mindenki passzolt')) { clearTimeout(t); res('korpassz'); }
        });
    });
    socks[0].emit('ujparti');
    const outcome = await botGameDone;
    assert(botActed, 'a bot licitalt vagy passzolt a soran');
    assert(true, 'a bot-os parti lement (' + outcome + ')');

    console.log('13. Nezelodo: bot elkuldese, visszaultetese, majd inditas 4 bottal...');
    const nezo = await connectPlayer('Nezo');
    const waitSeats = (cond, mit) => new Promise((res, rej) => {
        const t0 = Date.now();
        const iv = setInterval(() => {
            if (cond()) { clearInterval(iv); res(); }
            else if (Date.now() - t0 > 5000) { clearInterval(iv); rej(new Error('timeout: ' + mit)); }
        }, 50);
    });
    nezo.emit('kick', 3); // nezelodo elkuldi a botot
    await waitSeats(() => seatsNow[3] === null, 'bot elkuldese nezelodokent');
    assert(true, 'nezelodo elkuldte a botot');
    nezo.emit('addBot', 3); // es vissza is ulteti
    await waitSeats(() => seatsNow[3] !== null && seatsNow[3].bot, 'bot visszaultetese');
    assert(true, 'nezelodo visszaultette a botot');
    // A harom ember felall (vege fazisban szabad), a helyukre botok ulnek
    [socks[0], socks[1], socks[2]].forEach(s => s.emit('stand'));
    await waitSeats(() => [0, 1, 2].every(i => seatsNow[i] === null), 'emberek felallasa');
    [0, 1, 2].forEach(i => nezo.emit('addBot', i));
    await waitSeats(() => seatsNow.every(x => x !== null && x.bot), 'negy bot leultetese');
    assert(true, 'mind a negy helyen bot ul');
    const botGame2Done = new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('timeout: 4 botos parti')), 30000);
        nezo.once('gameOver', () => { clearTimeout(t); res('lejatszva'); });
        nezo.on('message', (m) => {
            if (String(m).includes('Mindenki passzolt')) { clearTimeout(t); res('korpassz'); }
        });
    });
    const nezoDeal = waitFor(nezo, 'deal', 5000);
    nezo.emit('ujparti'); // nezelodo indit, mert negy bot ul
    const nd = await nezoDeal;
    assert(nd.seat === -1, 'a nezelodo inditasara elindult a parti (nezelodo osztast kapott)');
    const outcome2 = await botGame2Done;
    assert(true, 'a negy bot vegigjatszotta a partit (' + outcome2 + ')');

    console.log(failed ? '\nVANNAK HIBAK!' : '\nMinden proba sikeres.');
    socks.forEach(s => s.close());
    finish();
}
