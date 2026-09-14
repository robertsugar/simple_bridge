const http = require('http');
const express = require('express');
const socketio = require('socket.io');

const app = express();

const clientPath = `${__dirname}/../client`;
console.log(`Serving static from ${clientPath}`);

app.use(express.static(clientPath));

const server = http.createServer(app);
const io = socketio(server);

// Kartya kodok: elso karakter a szin (S,H,D,C), masodik az ertek (2-9,T,J,Q,K,A)
const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const DECK = [];
SUITS.forEach(s => RANKS.forEach(r => DECK.push(s + r)));

const SUIT_NAMES = { S: 'pikk', H: 'kőr', D: 'káró', C: 'treff' };
const RANK_NAMES = { T: '10', J: 'bubi', Q: 'dáma', K: 'király', A: 'ász' };

function cardName(card) { // pl. "SA" -> "pikk asz"
    const r = RANK_NAMES[card[1]] || card[1];
    return SUIT_NAMES[card[0]] + ' ' + r;
}

// Negy fix ules (0:É 1:K 2:D 3:NY); a belepok nezelodokent indulnak,
// es maguk ulnek le egy ures helyre
let players = [null, null, null, null]; // {sock, name, connected} vagy null
let spectators = [];   // {sock, name} - a nem ulo belepok

// Licit nemek emelkedo sorrendben: treff, karo, kor, pikk, szanzadu
const DENOMS = ['C', 'D', 'H', 'S', 'N'];
const DENOM_SYMBOLS = { C: '&clubs;', D: '<span style="color:darkred">&diams;</span>', H: '<span style="color:darkred">&hearts;</span>', S: '&spades;', N: 'SZ' };

function bidText(level, denom) { // pl. "2&hearts;"
    return level + DENOM_SYMBOLS[denom];
}

// Jatek allapot
let phase = 'varakozas';   // varakozas | licit | jatek | vege
let dealer = 0;            // oszto, korbe jar
let hands = [[], [], [], []];
let turn = 0;              // kinek a szeke kovetkezik
let highestBid = null;     // {level, denom, seat} - az eddigi legmagasabb licit
let firstDenom = {};       // "oldal+nem" -> szek: ki mondta eloszor az adott nemet az oldalon
let kontraLevel = 0;       // 0: nincs, 1: kontra, 2: rekontra
let passCount = 0;         // egymas utani passzok szama
let contract = null;       // {level, denom} - a vegleges szerzodes
let trump = null;          // adu szin, szanzadunal null
let declarer = null;
let dummy = null;          // a felvevo partnere, teritett lapokkal
let currentTrick = [];     // {seat, card}
let tricks = [0, 0];       // [0]: 0-2 szekpar utesei, [1]: 1-3 szekpar utesei
let trickCount = 0;
let autoTimer = null;      // auto befejezes idozito
let gameNo = 0;            // hanyadik parti
let currentDealer = 0;     // az eppen futo parti osztoja (ujracsatlakozashoz)
let bidsLog = [];          // a parti licitmenete (ujracsatlakozashoz)
let lastGameOver = null;   // az utolso parti eredmenye (ujracsatlakozashoz)
let lastDealAt = 0;        // dupla inditas elleni vedelem
let initialHands = [];     // a kiosztott kezek (parti vegi felfedeshez)
let trickHistory = [];     // {cards: [{seat, card}...], winnerSeat} minden uteshez
let lastReveal = null;     // a parti vegi felfedes (ujracsatlakozashoz)
let claimPending = null;   // {seat, needed: [szekek], accepted: [szekek]}
let history = [];          // visszavonashoz: {snap, actor} minden akcio elott

function shuffle(arr) {
    var ctr = arr.length, temp, index;
    while (ctr > 0) {
        index = Math.floor(Math.random() * ctr);
        ctr--;
        temp = arr[ctr];
        arr[ctr] = arr[index];
        arr[index] = temp;
    }
    return arr;
}

function pairName(side) { // 0: 0-2 szekpar, 1: 1-3 szekpar
    const a = players[side] ? players[side].name : '?';
    const b = players[side + 2] ? players[side + 2].name : '?';
    return a + ' & ' + b;
}

const SEAT_NAMES = ['É', 'K', 'D', 'NY'];

function seatsFull() {
    return players.every(p => p !== null);
}

function sendSeats() { // ulesek allapota minden kliensnek
    io.emit('seats', players.map(p => p === null ? null : { name: p.name, connected: p.connected }));
}

function sendPlist() { // jatekos lista kikuldese, jelolve kinek a kore van
    const rows = [];
    players.forEach((p, i) => {
        if (p === null) return;
        let n = SEAT_NAMES[i] + ': ' + p.name;
        if (!p.connected) n = n + ' (megszakadt)';
        if (phase === 'jatek' || phase === 'vege') {
            if (i === declarer) n = '<span style="color:darkred;font-weight:bold">' + n + ' (felvevő)</span>';
            if (i === dummy) n = '<span style="color:darkgreen;font-weight:bold">' + n + ' (asztal)</span>';
        }
        if ((phase === 'licit' || phase === 'jatek') && i === turn) n = '&gt; ' + n;
        rows.push(n);
    });
    spectators.forEach(s => rows.push(s.name + ' (nézelődő)'));
    io.emit('plist', rows.join('<br/>'));
}

function kontraText() {
    return kontraLevel === 1 ? ' (kontra)' : (kontraLevel === 2 ? ' (rekontra)' : '');
}

function broadcastState() { // allapotsor minden kliensnek
    let text = '';
    if (phase === 'varakozas') text = 'Várakozás játékosokra...';
    if (phase === 'licit') {
        text = 'Licit';
        if (highestBid !== null) {
            text += ' - állás: ' + bidText(highestBid.level, highestBid.denom) + kontraText() +
                ' (' + players[highestBid.seat].name + ')';
        }
        text += ' - ' + players[turn].name + ' jön';
    }
    if (phase === 'vege' && declarer === null) text = 'Mindenki passzolt, nincs játék.';
    if ((phase === 'jatek' || phase === 'vege') && declarer !== null) {
        text = 'Bemondás: ' + bidText(contract.level, contract.denom) + kontraText() +
            ' - Felvevő: ' + players[declarer].name + ' | Ütések - ' +
            pairName(0) + ': ' + tricks[0] + ' | ' + pairName(1) + ': ' + tricks[1];
        if (phase === 'jatek') text += ' | ' + players[turn].name + ' jön';
    }
    io.emit('state', text);
}

function legalCards(seat) { // kovesd a szint, ha tudod
    const hand = hands[seat];
    if (currentTrick.length === 0) return hand.slice();
    const leadSuit = currentTrick[0].card[0];
    const followers = hand.filter(c => c[0] === leadSuit);
    return followers.length > 0 ? followers : hand.slice();
}

function promptBid() {
    const canKontra = highestBid !== null && kontraLevel === 0 && (turn % 2) !== (highestBid.seat % 2);
    const canRekontra = kontraLevel === 1 && (turn % 2) === (highestBid.seat % 2);
    players[turn].sock.emit('bidTurn', {
        highest: highestBid === null ? null : { level: highestBid.level, denom: highestBid.denom },
        kontra: canKontra,
        rekontra: canRekontra
    });
    io.emit('turn', turn);
    sendUndoState();
    sendPlist();
    broadcastState();
}

function promptPlay() {
    const acting = turn;
    const controller = (acting === dummy) ? declarer : acting; // a felvevo jatszik az asztal lapjaibol is
    players[controller].sock.emit('playTurn', {
        actingSeat: acting,
        fromDummy: acting === dummy,
        legal: legalCards(acting)
    });
    io.emit('turn', turn);
    sendUndoState();
    sendPlist();
    broadcastState();
}

function startPlay() {
    phase = 'jatek';
    contract = { level: highestBid.level, denom: highestBid.denom };
    trump = contract.denom === 'N' ? null : contract.denom;
    // A felvevo az, aki a nyertes oldalon eloszor mondta a szerzodes nemet
    declarer = firstDenom[(highestBid.seat % 2) + contract.denom];
    dummy = (declarer + 2) % 4;
    turn = (declarer + 1) % 4; // a felvevo utani ellenfel indul
    currentTrick = [];
    tricks = [0, 0];
    trickCount = 0;
    io.emit('message', '--- Bemondás: ' + bidText(contract.level, contract.denom) + kontraText() +
        ', ' + players[declarer].name + ' a felvevő, ' + players[dummy].name +
        ' teríti a lapjait, ' + players[turn].name + ' indul ---');
    io.emit('contract', {
        level: contract.level,
        denom: contract.denom,
        declarerSeat: declarer,
        declarerName: players[declarer].name,
        dummySeat: dummy,
        dummyName: players[dummy].name,
        kontraLevel: kontraLevel
    });
    promptPlay(); // az asztal csak az elso kihivott lap utan terul le
}

function doPlayCard(acting, card) { // ervenyesitett lap kijatszasa es a jatek leptetese
    pushHistory(acting === dummy ? declarer : acting); // a visszavonashoz
    hands[acting] = hands[acting].filter(c => c !== card);
    currentTrick.push({ seat: acting, card: card });
    io.emit('cardPlayed', { seat: acting, name: players[acting].name, card: card });
    if (trickCount === 0 && currentTrick.length === 1) { // az elso kihivas utan terul az asztal
        io.emit('dummyHand', { seat: dummy, name: players[dummy].name, cards: hands[dummy] });
        players[dummy].sock.emit('partnerHand', { seat: declarer, cards: hands[declarer] });
    }
    if (acting === dummy) {
        io.emit('dummyHand', { seat: dummy, name: players[dummy].name, cards: hands[dummy] });
    }
    if (acting === declarer) { // az asztal latja a felvevo lapjait
        players[dummy].sock.emit('partnerHand', { seat: declarer, cards: hands[declarer] });
    }
    if (currentTrick.length === 4) {
        resolveTrick();
    }
    else {
        turn = (turn + 1) % 4;
        promptPlay();
    }
}

function stopAuto() {
    if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
    }
}

function beats(card, win) { // eluti-e a card az eddigi nyertes lapot (adu figyelembevetelevel)
    if (trump !== null) {
        const cardTrump = card[0] === trump;
        const winTrump = win[0] === trump;
        if (cardTrump && !winTrump) return true;
        if (!cardTrump && winTrump) return false;
    }
    return card[0] === win[0] && RANKS.indexOf(card[1]) > RANKS.indexOf(win[1]);
}

// Visszavonas: minden akcio (licit vagy lapkijatszas) elott pillanatkep
function pushHistory(actor) {
    history.push({
        actor: actor,
        snap: JSON.parse(JSON.stringify({
            phase: phase, turn: turn, highestBid: highestBid, firstDenom: firstDenom,
            kontraLevel: kontraLevel, passCount: passCount, contract: contract,
            trump: trump, declarer: declarer, dummy: dummy, hands: hands,
            currentTrick: currentTrick, tricks: tricks, trickCount: trickCount,
            trickHistory: trickHistory, bidsLog: bidsLog
        }))
    });
}

function sendUndoState() { // csak az utolso akcio gazdaja vonhat vissza
    const actor = (history.length > 0 && (phase === 'licit' || phase === 'jatek') && claimPending === null)
        ? history[history.length - 1].actor : -1;
    io.emit('undoState', { actor: actor });
}

function resyncAll() { // teljes ujraszinkronizalas mindenkinek (visszavonas utan)
    players.forEach((p, i) => { if (p !== null) resync(i, p.sock); });
    spectators.forEach(s => resync(-1, s.sock));
}

function finishGame() { // parti vege: eredmeny + minden lap es az utesek felfedese
    phase = 'vege';
    const declSide = declarer % 2;
    const needed = 6 + contract.level;
    const result = tricks[declSide] >= needed
        ? 'teljesítette a bemondást (' + tricks[declSide] + ' ütés, kellett: ' + needed + ')'
        : 'elbukta a bemondást (' + tricks[declSide] + ' ütés, kellett: ' + needed + ')';
    io.emit('message', '=== Vége a partinak! ' + players[declarer].name + ' ' +
        bidText(contract.level, contract.denom) + kontraText() + ': ' + result + '. ' +
        pairName(declSide) + ': ' + tricks[declSide] + ' ütés, ' +
        pairName(1 - declSide) + ': ' + tricks[1 - declSide] + ' ütés ===');
    lastGameOver = {
        tricks: tricks,
        pairNames: [pairName(0), pairName(1)],
        made: tricks[declSide] >= needed,
        level: contract.level,
        denom: contract.denom,
        kontraLevel: kontraLevel,
        declarerName: players[declarer].name,
        declTricks: tricks[declSide],
        needed: needed,
        diff: tricks[declSide] - needed
    };
    lastReveal = { hands: initialHands, tricksHist: trickHistory };
    io.emit('reveal', lastReveal);
    io.emit('gameOver', lastGameOver);
    io.emit('turn', -1);
    sendUndoState(); // vege: nincs tobb visszavonas
    sendPlist();
    broadcastState();
}

function resolveTrick() {
    let winner = currentTrick[0];
    currentTrick.forEach(t => {
        if (beats(t.card, winner.card)) {
            winner = t;
        }
    });
    tricks[winner.seat % 2]++;
    trickCount++;
    trickHistory.push({ cards: currentTrick.slice(), winnerSeat: winner.seat });
    io.emit('message', players[winner.seat].name + ' vitte az ütést (' +
        currentTrick.map(t => cardName(t.card)).join(', ') + ')');
    io.emit('trickDone', {
        winnerSeat: winner.seat,
        winnerName: players[winner.seat].name,
        tricks: tricks,
        pairNames: [pairName(0), pairName(1)]
    });
    currentTrick = [];
    if (trickCount === 13) {
        finishGame();
    }
    else {
        turn = winner.seat;
        promptPlay();
    }
}

function newGame() {
    stopAuto();
    phase = 'licit';
    highestBid = null;
    firstDenom = {};
    contract = null;
    trump = null;
    kontraLevel = 0;
    passCount = 0;
    declarer = null;
    dummy = null;
    currentTrick = [];
    tricks = [0, 0];
    trickCount = 0;
    bidsLog = [];
    history = [];
    lastGameOver = null;
    lastReveal = null;
    trickHistory = [];
    claimPending = null;
    lastDealAt = Date.now();
    gameNo++;
    currentDealer = dealer;
    const deck = shuffle(DECK.slice());
    const names = players.map(p => p === null ? '?' : p.name);
    for (let i = 0; i < 4; i++) {
        hands[i] = deck.slice(i * 13, i * 13 + 13);
        players[i].sock.emit('deal', { seat: i, cards: hands[i], dealer: dealer, names: names, gameNo: gameNo });
    }
    initialHands = hands.map(h => h.slice()); // a parti vegi felfedeshez
    spectators.forEach(s => s.sock.emit('deal', { seat: -1, cards: [], dealer: dealer, names: names, gameNo: gameNo }));
    turn = dealer;
    io.emit('message', '--- Új parti, ' + players[dealer].name + ' kezdi a licitet ---');
    dealer = (dealer + 1) % 4;
    promptBid();
}

// Ujracsatlakozo jatekosnak a teljes jatekallas ujrakuldese
function resync(seat, sock) {
    if (gameNo === 0) return;
    const names = players.map(p => p === null ? '?' : p.name);
    const sendCounts = hands.map(h => h.length);
    currentTrick.forEach(t => sendCounts[t.seat]++); // az asztalon levo lapokat ujra "kijatsszuk"
    sock.emit('deal', {
        seat: seat, cards: seat >= 0 ? hands[seat] : [], dealer: currentDealer, names: names,
        gameNo: gameNo, counts: sendCounts, tricks: tricks
    });
    bidsLog.forEach(b => sock.emit('bidMade', b));
    if (declarer !== null && (phase === 'jatek' || phase === 'vege')) {
        sock.emit('contract', {
            level: contract.level,
            denom: contract.denom,
            declarerSeat: declarer,
            declarerName: players[declarer].name,
            dummySeat: dummy,
            dummyName: players[dummy].name,
            kontraLevel: kontraLevel
        });
        const revealed = trickCount > 0 || currentTrick.length > 0; // volt-e mar kihivas
        if (revealed) {
            sock.emit('dummyHand', { seat: dummy, name: players[dummy].name, cards: hands[dummy] });
            if (seat === dummy) {
                sock.emit('partnerHand', { seat: declarer, cards: hands[declarer] });
            }
        }
        currentTrick.forEach(t => sock.emit('cardPlayed', { seat: t.seat, name: players[t.seat].name, card: t.card }));
    }
    if (phase === 'licit') promptBid();       // a soron levo ujra megkapja a lehetosegeit
    else if (phase === 'jatek') {
        promptPlay();
        if (claimPending !== null) {
            sock.emit('claimAsk', {
                claimerSeat: claimPending.seat,
                claimerName: players[claimPending.seat].name,
                needed: claimPending.needed
            });
        }
    }
    else if (phase === 'vege' && lastGameOver !== null) {
        if (lastReveal !== null) sock.emit('reveal', lastReveal);
        sock.emit('gameOver', lastGameOver);
    }
}

function announceBid(seat, text) { // licitlepes kikuldese es naplozasa
    const b = { seat: seat, text: text };
    bidsLog.push(b);
    io.emit('bidMade', b);
}

function seatOf(sock) {
    return players.findIndex(p => p !== null && p.sock === sock);
}

function dropPlayer(sock) {
    const seat = seatOf(sock);
    if (seat >= 0) {
        const name = players[seat].name;
        if (phase !== 'varakozas') {
            // Jatek kozben a hely megmarad: ugyanazzal a nevvel visszaulhet,
            // vagy a tobbiek kidobhatjak es mas ulhet a helyere
            players[seat].connected = false;
            io.emit('message', name + ' kapcsolata megszakadt - ugyanazzal a névvel belépve folytathatja.');
            if (phase === 'licit' || phase === 'jatek') {
                io.emit('playerLeft', { seat: seat, name: name });
            }
        }
        else {
            players[seat] = null; // a lobbyban a hely felszabadul
            io.emit('message', name + ' kilépett.');
        }
    }
    else {
        spectators = spectators.filter(s => s.sock !== sock);
    }
    sendSeats();
    sendPlist();
    broadcastState();
}

const BOOT = String(Date.now()); // szerver-inditas azonosito: a kliens ebbol veszi eszre a frissitest

io.on('connection', (sock) => {
    console.log('Someone connected');
    sock.emit('hello', BOOT);

    sock.on('name', (text) => {
        const name = String(text).substring(0, 20).trim();
        if (!name) return;
        if (seatOf(sock) >= 0) return; // ez a kapcsolat mar jatekos
        // Visszacsatlakozas: az azonos nevu jatekos atveszi a regi szeket,
        // akkor is, ha a regi kapcsolat szetesese meg nem ert be a szerverre
        // (ujratolteskor az uj kapcsolat gyakran megelozi a regi lebontasat)
        const back = players.findIndex(p => p !== null && p.name === name);
        if (back >= 0) {
            spectators = spectators.filter(s => s.sock !== sock); // ha kozben nezelodo lett
            const old = players[back].sock;
            players[back].sock = sock;
            players[back].connected = true;
            if (old && old !== sock && old.connected) {
                old.disconnect(true); // a regi, arva kapcsolat bontasa
            }
            console.log('Visszatert ' + name + ' ID: ' + sock.id);
            io.emit('message', name + ' visszatért.');
            resync(back, sock);
            sendSeats();
            sendPlist();
            broadcastState();
            return;
        }
        if (spectators.some(s => s.sock === sock)) return; // mar bent van
        spectators.push({ sock: sock, name: name }); // mindenki nezelodokent indul, aztan leul
        console.log('Belepett ' + name + ' ID: ' + sock.id);
        io.emit('message', name + ' belépett.');
        sendSeats();
        sendPlist();
        broadcastState();
        if (gameNo > 0 && phase !== 'varakozas') resync(-1, sock); // futo jatek nezelodokent
    });

    //
    // Leules egy ures helyre / felallas / megszakadt jatekos kidobasa
    //
    sock.on('sit', (s) => {
        if (!Number.isInteger(s) || s < 0 || s > 3) return;
        if (players[s] !== null) return; // foglalt
        if (seatOf(sock) >= 0) return;   // mar ul valahol
        const spec = spectators.find(x => x.sock === sock);
        if (!spec) return;
        spectators = spectators.filter(x => x.sock !== sock);
        players[s] = { sock: sock, name: spec.name, connected: true };
        io.emit('message', spec.name + ' leült (' + SEAT_NAMES[s] + ').');
        sendSeats();
        sendPlist();
        broadcastState();
        if (phase !== 'varakozas') resync(s, sock); // jatek kozben beulve atveszi a helyet
    });

    sock.on('stand', () => {
        const seat = seatOf(sock);
        if (seat < 0) return;
        if (phase === 'licit' || phase === 'jatek') {
            sock.emit('message', 'Játék közben nem lehet felállni.');
            return;
        }
        const name = players[seat].name;
        players[seat] = null;
        spectators.push({ sock: sock, name: name });
        io.emit('message', name + ' felállt.');
        sendSeats();
        sendPlist();
        broadcastState();
    });

    sock.on('kick', (s) => {
        if (!Number.isInteger(s) || s < 0 || s > 3) return;
        if (seatOf(sock) < 0) return; // csak ulo jatekos dobhat ki
        if (players[s] === null || players[s].connected) return; // csak megszakadt jatekost
        const name = players[s].name;
        players[s] = null;
        io.emit('message', name + ' helyét felszabadították - bárki leülhet oda.');
        sendSeats();
        sendPlist();
        broadcastState();
    });

    sock.on('message', (text) => {
        io.emit('message', text);
    });

    sock.on('chat', (text) => { // uzenet a jatekosok lapja alatti dobozbol, mindenki latja
        const t = String(text).substring(0, 200).trim();
        if (!t) return;
        const seat = seatOf(sock);
        const spec = spectators.find(s => s.sock === sock);
        const name = seat >= 0 ? players[seat].name : (spec ? spec.name : null);
        if (!name) return;
        io.emit('chat', { name: name, text: t });
    });

    sock.on('ujparti', () => {
        if (!seatsFull()) {
            sock.emit('message', 'Négy leült játékos kell az indításhoz.');
            return;
        }
        if (seatOf(sock) < 0) {
            sock.emit('message', 'Új partit csak leült játékos indíthat.');
            return;
        }
        if (phase === 'licit' && Date.now() - lastDealAt < 3000) return; // dupla kattintas vedelem
        newGame();
    });

    //
    // Licitalas: passz / szintes licit (1C..7N) / kontra / rekontra
    //
    sock.on('bid', (b) => {
        if (phase !== 'licit') return;
        const seat = seatOf(sock);
        if (seat !== turn) return;
        if (!b || typeof b !== 'object') return;
        const name = players[seat].name;

        if (b.type === 'bid') {
            const level = b.level;
            const denom = b.denom;
            if (!Number.isInteger(level) || level < 1 || level > 7 || !DENOMS.includes(denom)) return;
            if (highestBid !== null) { // csak magasabb licit mondhato
                if (level < highestBid.level) return;
                if (level === highestBid.level && DENOMS.indexOf(denom) <= DENOMS.indexOf(highestBid.denom)) return;
            }
            pushHistory(seat);
            highestBid = { level: level, denom: denom, seat: seat };
            if (firstDenom[(seat % 2) + denom] === undefined) { // ki mondta eloszor a nemet az oldalon
                firstDenom[(seat % 2) + denom] = seat;
            }
            kontraLevel = 0;
            passCount = 0;
            io.emit('message', name + ': ' + bidText(level, denom));
            announceBid(seat, bidText(level, denom));
        }
        else if (b.type === 'kontra') {
            if (highestBid === null || kontraLevel !== 0 || (seat % 2) === (highestBid.seat % 2)) return;
            pushHistory(seat);
            kontraLevel = 1;
            passCount = 0;
            io.emit('message', name + ': Kontra');
            announceBid(seat, 'Kontra');
        }
        else if (b.type === 'rekontra') {
            if (kontraLevel !== 1 || (seat % 2) !== (highestBid.seat % 2)) return;
            pushHistory(seat);
            kontraLevel = 2;
            passCount = 0;
            io.emit('message', name + ': Rekontra');
            announceBid(seat, 'Rekontra');
        }
        else if (b.type === 'passz') {
            pushHistory(seat);
            passCount++;
            io.emit('message', name + ': Passz');
            announceBid(seat, 'Passz');
            if (highestBid !== null && passCount === 3) { // harom passz a licit utan
                startPlay();
                return;
            }
            if (highestBid === null && passCount === 4) { // mindenki passzolt
                phase = 'vege';
                io.emit('message', 'Mindenki passzolt, nincs jatek. Inditsatok uj partit!');
                io.emit('turn', -1);
                sendPlist();
                broadcastState();
                return;
            }
        }
        else {
            return;
        }
        turn = (turn + 1) % 4;
        promptBid();
    });

    //
    // Kartya kijatszasa (sajat kezbol vagy a felvevo az asztal lapjaibol)
    //
    sock.on('playcard', (card) => {
        if (phase !== 'jatek' || claimPending !== null) return;
        const seat = seatOf(sock);
        const acting = turn;
        const controller = (acting === dummy) ? declarer : acting;
        if (seat !== controller) return;
        if (!legalCards(acting).includes(card)) return;
        doPlayCard(acting, card);
    });

    //
    // Auto befejezes: a szerver vegigjatssza a hatralevo uteseket
    //
    sock.on('autofinish', () => {
        if (phase !== 'jatek' || autoTimer) return;
        const seat = seatOf(sock);
        if (seat < 0) return;
        io.emit('message', players[seat].name + ' kérésére a parti automatikusan befejeződik...');
        autoTimer = setInterval(() => {
            if (phase !== 'jatek') {
                clearInterval(autoTimer);
                autoTimer = null;
                return;
            }
            if (claimPending !== null) return; // bejelentes alatt szunetel
            doPlayCard(turn, legalCards(turn)[0]);
        }, 700);
    });

    //
    // Utolso akcio (licit vagy lapkijatszas) visszavonasa - csak az
    // vonhatja vissza, ake az utolso lepes volt, es lancban tobben is
    //
    sock.on('undo', () => {
        if ((phase !== 'licit' && phase !== 'jatek') || claimPending !== null) return;
        if (history.length === 0) return;
        const seat = seatOf(sock);
        if (seat < 0 || seat !== history[history.length - 1].actor) return;
        const s = history.pop().snap;
        phase = s.phase;
        turn = s.turn;
        highestBid = s.highestBid;
        firstDenom = s.firstDenom;
        kontraLevel = s.kontraLevel;
        passCount = s.passCount;
        contract = s.contract;
        trump = s.trump;
        declarer = s.declarer;
        dummy = s.dummy;
        hands = s.hands;
        currentTrick = s.currentTrick;
        tricks = s.tricks;
        trickCount = s.trickCount;
        trickHistory = s.trickHistory;
        bidsLog = s.bidsLog;
        stopAuto();
        io.emit('message', players[seat].name + ' visszavonta az utolsó lépést.');
        resyncAll();
    });

    //
    // "Minden utest viszek" bejelentes: ha az ellenfelek elfogadjak,
    // a hatralevo utesek a bejelento vonalae es vege a partinak
    //
    sock.on('claim', () => {
        if (phase !== 'jatek' || claimPending !== null) return;
        const seat = seatOf(sock);
        if (seat < 0 || seat === dummy) return; // az asztal nem jelenthet be
        const oppSide = 1 - (seat % 2);
        const needed = [oppSide, oppSide + 2].filter(s => s !== dummy); // az asztal nem szavaz
        claimPending = { seat: seat, needed: needed, accepted: [] };
        io.emit('message', players[seat].name + ' bejelentette: minden ütést visz.');
        io.emit('claimAsk', { claimerSeat: seat, claimerName: players[seat].name, needed: needed, cards: hands[seat] });
        sendUndoState();
    });

    sock.on('claimAnswer', (accept) => {
        if (phase !== 'jatek' || claimPending === null) return;
        const seat = seatOf(sock);
        if (!claimPending.needed.includes(seat) || claimPending.accepted.includes(seat)) return;
        if (!accept) { // elutasitva: folytatodik a jatek
            io.emit('message', players[seat].name + ' nem fogadta el a bejelentést, folytatódik a játék.');
            io.emit('claimResult', { accepted: false, name: players[seat].name });
            claimPending = null;
            promptPlay();
            return;
        }
        claimPending.accepted.push(seat);
        if (claimPending.accepted.length === claimPending.needed.length) { // mindenki elfogadta
            const claimSide = claimPending.seat % 2;
            tricks[claimSide] += 13 - trickCount;
            io.emit('message', 'Mindenki elfogadta: a hátralévő ütéseket ' +
                pairName(claimSide) + ' viszi.');
            io.emit('claimResult', { accepted: true, name: players[claimPending.seat].name });
            claimPending = null;
            finishGame();
        }
    });

    sock.on('disconnect', () => {
        dropPlayer(sock);
    });
});

server.on('error', (err) => {
    console.error('Server error:', err);
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
    console.log('Simple Bridge started on ' + PORT);
});
