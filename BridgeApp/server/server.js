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

const SUIT_NAMES = { S: 'pikk', H: 'kor', D: 'karo', C: 'treff' };
const RANK_NAMES = { T: '10', J: 'bubi', Q: 'dama', K: 'kiraly', A: 'asz' };

function cardName(card) { // pl. "SA" -> "pikk asz"
    const r = RANK_NAMES[card[1]] || card[1];
    return SUIT_NAMES[card[0]] + ' ' + r;
}

// Jatekosok: az elso negy belepo kap helyet (0-3), a tobbiek nezelodok
let players = [];      // {sock, name} - a tomb indexe a szek (seat)
let spectators = [];   // {sock, name}

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
let seatingDone = false;   // volt-e mar ulesrend valasztas
let seatChooser = null;    // az ulesrendet eppen valaszto jatekos socket-je
let seatOthers = [];       // a valasztaskor a tobbi harom jatekos (sorrendben)

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

function sendPlist() { // jatekos lista kikuldese, jelolve kinek a kore van
    const rows = players.map((p, i) => {
        let n = p.name;
        if (!p.connected) n = n + ' (megszakadt)';
        if (phase === 'jatek' || phase === 'vege') {
            if (i === declarer) n = '<span style="color:darkred;font-weight:bold">' + n + ' (felvevo)</span>';
            if (i === dummy) n = '<span style="color:darkgreen;font-weight:bold">' + n + ' (asztal)</span>';
        }
        if ((phase === 'licit' || phase === 'jatek') && i === turn) n = '&gt; ' + n;
        return n;
    });
    spectators.forEach(s => rows.push(s.name + ' (nezelodo)'));
    io.emit('plist', rows.join('<br/>'));
}

function kontraText() {
    return kontraLevel === 1 ? ' (kontra)' : (kontraLevel === 2 ? ' (rekontra)' : '');
}

function broadcastState() { // allapotsor minden kliensnek
    let text = '';
    if (phase === 'varakozas') text = 'Varakozas jatekosokra...';
    if (phase === 'licit') {
        text = 'Licit';
        if (highestBid !== null) {
            text += ' - allas: ' + bidText(highestBid.level, highestBid.denom) + kontraText() +
                ' (' + players[highestBid.seat].name + ')';
        }
        text += ' - ' + players[turn].name + ' jon';
    }
    if (phase === 'vege' && declarer === null) text = 'Mindenki passzolt, nincs jatek.';
    if ((phase === 'jatek' || phase === 'vege') && declarer !== null) {
        text = 'Bemondas: ' + bidText(contract.level, contract.denom) + kontraText() +
            ' - Felvevo: ' + players[declarer].name + ' | Utesek - ' +
            pairName(0) + ': ' + tricks[0] + ' | ' + pairName(1) + ': ' + tricks[1];
        if (phase === 'jatek') text += ' | ' + players[turn].name + ' jon';
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
    io.emit('message', '--- Bemondas: ' + bidText(contract.level, contract.denom) + kontraText() +
        ', ' + players[declarer].name + ' a felvevo, ' + players[dummy].name +
        ' teriti a lapjait, ' + players[turn].name + ' indul ---');
    io.emit('contract', {
        level: contract.level,
        denom: contract.denom,
        declarerSeat: declarer,
        declarerName: players[declarer].name,
        dummySeat: dummy,
        dummyName: players[dummy].name,
        kontraLevel: kontraLevel
    });
    io.emit('dummyHand', { seat: dummy, name: players[dummy].name, cards: hands[dummy] });
    promptPlay();
}

function doPlayCard(acting, card) { // ervenyesitett lap kijatszasa es a jatek leptetese
    hands[acting] = hands[acting].filter(c => c !== card);
    currentTrick.push({ seat: acting, card: card });
    io.emit('cardPlayed', { seat: acting, name: players[acting].name, card: card });
    if (acting === dummy) {
        io.emit('dummyHand', { seat: dummy, name: players[dummy].name, cards: hands[dummy] });
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

function resolveTrick() {
    let winner = currentTrick[0];
    currentTrick.forEach(t => {
        if (beats(t.card, winner.card)) {
            winner = t;
        }
    });
    tricks[winner.seat % 2]++;
    trickCount++;
    io.emit('message', players[winner.seat].name + ' vitte az utest (' +
        currentTrick.map(t => cardName(t.card)).join(', ') + ')');
    io.emit('trickDone', {
        winnerSeat: winner.seat,
        winnerName: players[winner.seat].name,
        tricks: tricks,
        pairNames: [pairName(0), pairName(1)]
    });
    currentTrick = [];
    if (trickCount === 13) {
        phase = 'vege';
        const declSide = declarer % 2;
        const needed = 6 + contract.level;
        const result = tricks[declSide] >= needed
            ? 'teljesitette a bemondast (' + tricks[declSide] + ' utes, kellett: ' + needed + ')'
            : 'elbukta a bemondast (' + tricks[declSide] + ' utes, kellett: ' + needed + ')';
        io.emit('message', '=== Vege a partinak! ' + players[declarer].name + ' ' +
            bidText(contract.level, contract.denom) + kontraText() + ': ' + result + '. ' +
            pairName(declSide) + ': ' + tricks[declSide] + ' utes, ' +
            pairName(1 - declSide) + ': ' + tricks[1 - declSide] + ' utes ===');
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
        io.emit('gameOver', lastGameOver);
        io.emit('turn', -1);
        sendPlist();
        broadcastState();
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
    lastGameOver = null;
    lastDealAt = Date.now();
    gameNo++;
    currentDealer = dealer;
    const deck = shuffle(DECK.slice());
    const names = players.map(p => p.name);
    for (let i = 0; i < 4; i++) {
        hands[i] = deck.slice(i * 13, i * 13 + 13);
        players[i].sock.emit('deal', { seat: i, cards: hands[i], dealer: dealer, names: names, gameNo: gameNo });
    }
    spectators.forEach(s => s.sock.emit('deal', { seat: -1, cards: [], dealer: dealer, names: names, gameNo: gameNo }));
    turn = dealer;
    io.emit('message', '--- Uj parti, ' + players[dealer].name + ' kezdi a licitet ---');
    dealer = (dealer + 1) % 4;
    promptBid();
}

// Ujracsatlakozo jatekosnak a teljes jatekallas ujrakuldese
function resync(seat, sock) {
    if (gameNo === 0) return;
    const names = players.map(p => p.name);
    const sendCounts = hands.map(h => h.length);
    currentTrick.forEach(t => sendCounts[t.seat]++); // az asztalon levo lapokat ujra "kijatsszuk"
    sock.emit('deal', {
        seat: seat, cards: hands[seat], dealer: currentDealer, names: names,
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
        sock.emit('dummyHand', { seat: dummy, name: players[dummy].name, cards: hands[dummy] });
        currentTrick.forEach(t => sock.emit('cardPlayed', { seat: t.seat, name: players[t.seat].name, card: t.card }));
    }
    if (phase === 'licit') promptBid();       // a soron levo ujra megkapja a lehetosegeit
    else if (phase === 'jatek') promptPlay();
    else if (phase === 'vege' && lastGameOver !== null) sock.emit('gameOver', lastGameOver);
}

function announceBid(seat, text) { // licitlepes kikuldese es naplozasa
    const b = { seat: seat, text: text };
    bidsLog.push(b);
    io.emit('bidMade', b);
}

function seatOf(sock) {
    return players.findIndex(p => p.sock === sock);
}

function dropPlayer(sock) {
    const seat = seatOf(sock);
    if (seat >= 0) {
        const name = players[seat].name;
        if (phase !== 'varakozas') {
            // Jatek kozben nem dobjuk ki: a helye megmarad, ugyanazzal a
            // nevvel visszalepve folytathatja
            players[seat].connected = false;
            io.emit('message', name + ' kapcsolata megszakadt - ugyanazzal a nevvel belepve folytathatja.');
        }
        else {
            players.splice(seat, 1);
            seatingDone = false; // ha valaki kilep, ujra kell valasztani az ulesrendet
            seatChooser = null;
            seatOthers = [];
            io.emit('message', name + ' kilepett.');
        }
    }
    else {
        spectators = spectators.filter(s => s.sock !== sock);
    }
    sendPlist();
    broadcastState();
}

io.on('connection', (sock) => {
    console.log('Someone connected');

    sock.on('name', (text) => {
        const name = String(text).substring(0, 20).trim();
        if (!name) return;
        if (seatOf(sock) >= 0 || spectators.some(s => s.sock === sock)) return; // mar bent van
        // Visszacsatlakozas: ha van ilyen nevu, megszakadt jatekos, visszaul a helyere
        const back = players.findIndex(p => !p.connected && p.name === name);
        if (back >= 0) {
            players[back].sock = sock;
            players[back].connected = true;
            console.log('Visszatert ' + name + ' ID: ' + sock.id);
            io.emit('message', name + ' visszatert, folytatodik a jatek.');
            resync(back, sock);
            sendPlist();
            broadcastState();
            return;
        }
        if (players.length < 4) {
            players.push({ sock: sock, name: name, connected: true });
            console.log('Belepett ' + name + ' ID: ' + sock.id);
            if (players.length === 4) {
                io.emit('message', 'Negyen vagyunk, indulhat a jatek!');
                io.emit('canstart');
            }
            else {
                io.emit('message', name + ' belepett. Varunk, mig negyen leszunk... (' + players.length + '/4)');
            }
        }
        else {
            spectators.push({ sock: sock, name: name });
            sock.emit('message', 'A jatek megtelt (4 jatekos), nezelodokent lephetsz be.');
            io.emit('message', name + ' belepett nezelodokent.');
        }
        sendPlist();
        broadcastState();
    });

    sock.on('message', (text) => {
        io.emit('message', text);
    });

    sock.on('ujparti', () => {
        if (players.length < 4) {
            sock.emit('message', 'Negy jatekos kell az inditashoz.');
            return;
        }
        if (seatOf(sock) < 0) {
            sock.emit('message', 'Uj partit csak jatekos indithat.');
            return;
        }
        if (phase === 'licit' && Date.now() - lastDealAt < 3000) return; // dupla kattintas vedelem
        if (!seatingDone) { // elso indites: az indito (Eszak) valasztja az ulesrendet
            const seat = seatOf(sock);
            if (seatChooser !== null) return; // mar folyamatban van a valasztas
            seatChooser = sock;
            seatOthers = players.filter(p => p.sock !== sock);
            sock.emit('seatSetup', { names: seatOthers.map(p => p.name) });
            io.emit('message', players[seat].name + ' (Eszak) valasztja az ulesrendet...');
            return;
        }
        newGame();
    });

    //
    // Ulesrend valasztas: az indito Eszak, o mondja meg ki a partnere (Del)
    // es ki uljon Keletre; a negyedik jatekos Nyugat lesz
    //
    sock.on('seatChoice', (data) => {
        if (sock !== seatChooser) return;
        if (!data || typeof data !== 'object') return;
        const p = data.partner;
        const k = data.kelet;
        if (!Number.isInteger(p) || !Number.isInteger(k) || p < 0 || p > 2 || k < 0 || k > 2 || p === k) return;
        const chooser = players.find(pl => pl.sock === sock);
        if (!chooser || seatOthers.some(o => !players.includes(o))) { // valaki kozben kilepett
            seatChooser = null;
            seatOthers = [];
            return;
        }
        const west = seatOthers.find((o, i) => i !== p && i !== k);
        players = [chooser, seatOthers[k], seatOthers[p], west];
        seatingDone = true;
        seatChooser = null;
        seatOthers = [];
        io.emit('message', 'Ulesrend - E: ' + players[0].name + ', K: ' + players[1].name +
            ', D: ' + players[2].name + ', NY: ' + players[3].name);
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
            kontraLevel = 1;
            passCount = 0;
            io.emit('message', name + ': Kontra');
            announceBid(seat, 'Kontra');
        }
        else if (b.type === 'rekontra') {
            if (kontraLevel !== 1 || (seat % 2) !== (highestBid.seat % 2)) return;
            kontraLevel = 2;
            passCount = 0;
            io.emit('message', name + ': Rekontra');
            announceBid(seat, 'Rekontra');
        }
        else if (b.type === 'passz') {
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
        if (phase !== 'jatek') return;
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
        io.emit('message', players[seat].name + ' keresere a parti automatikusan befejezodik...');
        autoTimer = setInterval(() => {
            if (phase !== 'jatek') {
                clearInterval(autoTimer);
                autoTimer = null;
                return;
            }
            doPlayCard(turn, legalCards(turn)[0]);
        }, 700);
    });

    //
    // Teritek: a jatekos felfedi a lapjait mindenkinek
    //
    sock.on('teritek', () => {
        const seat = seatOf(sock);
        if (seat < 0 || hands[seat].length === 0) return;
        io.emit('message', players[seat].name + ' teritette a lapjait.');
        io.emit('teritett', { name: players[seat].name, cards: hands[seat] });
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
