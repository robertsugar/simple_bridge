let userName = null;

// Kartya kodok: elso karakter a szin (S,H,D,C), masodik az ertek (2-9,T,J,Q,K,A)
const SUIT_ORDER = ['S', 'H', 'C', 'D']; // valtott szinek a kirakashoz
const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUIT_SYMBOLS = { S: '&spades;', H: '&hearts;', C: '&clubs;', D: '&diams;' };
const RANK_LABELS = { T: '10' };
// Licit nemek emelkedo sorrendben: treff, karo, kor, pikk, szanzadu
const DENOMS = ['C', 'D', 'H', 'S', 'N'];
const DENOM_LABELS = { C: '&clubs;', D: '<span class="red">&diams;</span>', H: '<span class="red">&hearts;</span>', S: '&spades;', N: 'SZ' };
// Szekek: 0-2 par Eszak-Del, 1-3 par Kelet-Nyugat (a kor iranya E-K-D-NY)
const SEAT_LETTERS = ['E', 'K', 'D', 'NY'];

let mySeat = -1;        // -1: nezelodo
let myHand = [];
let names = [];         // a negy jatekos neve szek szerint
let dealer = 0;
let handCounts = [0, 0, 0, 0];
let dummySeat = -1;
let dummyCards = [];
let declarerSeat = -1;
let turnSeat = -1;
let playing = false;    // licit kozben false, lejatszas alatt true
let inGame = false;
let tricksPair = [0, 0];
let bids = [];          // {seat, text} a licitmenet sorban
let pendingPlay = null; // {actingSeat, fromDummy, legal} ha en jovok
let trickFull = false;  // az asztalon teljes utes van, a kovetkezo lapnal torlendo

function customSort(arr) { // szinenkent, azon belul csokkeno ertek szerint
    const tmarr = [];
    SUIT_ORDER.forEach(suit => {
        const inSuit = arr.filter(c => c[0] === suit);
        inSuit.sort((a, b) => RANK_ORDER.indexOf(b[1]) - RANK_ORDER.indexOf(a[1]));
        tmarr.push(...inSuit);
    });
    return tmarr;
}

function hideDiv(id) {
    document.getElementById(id).style.display = 'none';
}
function showDiv(id, mode) {
    document.getElementById(id).style.display = mode || 'block';
}

function cardEl(card) { // BBO stilusu lap: feher, nagy index a bal felso sarokban
    const el = document.createElement('div');
    el.className = 'card' + (card[0] === 'H' || card[0] === 'D' ? ' red' : '');
    el.dataset.card = card;
    el.innerHTML = '<div class="idx">' + (RANK_LABELS[card[1]] || card[1]) +
        '<br>' + SUIT_SYMBOLS[card[0]] + '</div>';
    return el;
}

function backEl() {
    const el = document.createElement('div');
    el.className = 'cardback';
    return el;
}

function slotOf(seat) { // sajat szek alul (0), tovabbi szekek balra (1), szemben (2), jobbra (3)
    const viewSeat = mySeat >= 0 ? mySeat : 0;
    return (seat - viewSeat + 4) % 4;
}

function renderFan(abs) {
    const fan = document.getElementById('fanR' + slotOf(abs));
    fan.innerHTML = '';
    fan.classList.toggle('dummy-fan', inGame && abs === dummySeat && abs !== mySeat);
    if (!inGame) return;
    if (abs === mySeat) { // sajat kez, kijatszhato lapok kiemelve
        const clickable = pendingPlay && !pendingPlay.fromDummy && pendingPlay.actingSeat === mySeat;
        customSort(myHand).forEach(card => {
            const el = cardEl(card);
            if (clickable) {
                if (pendingPlay.legal.includes(card)) {
                    el.classList.add('playable');
                    el.onclick = () => playCard(card);
                }
                else {
                    el.classList.add('dimmed');
                }
            }
            fan.appendChild(el);
        });
    }
    else if (abs === dummySeat && playing) { // teritett lapok
        const clickable = pendingPlay && pendingPlay.fromDummy;
        customSort(dummyCards).forEach(card => {
            const el = cardEl(card);
            if (clickable) {
                if (pendingPlay.legal.includes(card)) {
                    el.classList.add('playable');
                    el.onclick = () => playCard(card);
                }
                else {
                    el.classList.add('dimmed');
                }
            }
            fan.appendChild(el);
        });
    }
    else { // hatlapok
        for (let i = 0; i < handCounts[abs]; i++) {
            fan.appendChild(backEl());
        }
    }
}

function renderPlate(abs) {
    const plate = document.getElementById('plateR' + slotOf(abs));
    if (!inGame || !names[abs]) {
        plate.innerHTML = '';
        plate.style.display = 'none';
        return;
    }
    plate.style.display = 'flex';
    plate.classList.toggle('onturn', turnSeat === abs);
    const star = (playing && abs === declarerSeat) ? '&#9733; ' : '';
    const count = playing ? tricksPair[abs % 2] : '';
    plate.innerHTML = '<span class="badge">' + SEAT_LETTERS[abs] + '</span>' +
        '<span class="pname">' + star + names[abs] + '</span>' +
        '<span class="pcount">' + count + '</span>';
}

function renderSeats() {
    for (let abs = 0; abs < 4; abs++) {
        renderFan(abs);
        renderPlate(abs);
    }
}

function renderBidHistory() { // licitmenet tablazat a kozepso asztalon
    const el = document.getElementById('bid-history');
    if (playing || !inGame) {
        el.style.display = 'none';
        return;
    }
    el.style.display = 'block';
    let html = '<table><tr>';
    SEAT_LETTERS.forEach(l => { html += '<th>' + l + '</th>'; });
    html += '</tr>';
    const cells = [];
    for (let i = 0; i < dealer; i++) cells.push(''); // az oszto elotti szekek uresen
    bids.forEach(b => cells.push(b.text));
    for (let i = 0; i < cells.length; i += 4) {
        html += '<tr>';
        for (let j = 0; j < 4; j++) {
            html += '<td>' + (cells[i + j] === undefined ? '' : cells[i + j]) + '</td>';
        }
        html += '</tr>';
    }
    html += '</table>';
    el.innerHTML = html;
}

function clearTrick() {
    for (let i = 0; i < 4; i++) {
        document.getElementById('trickR' + i).innerHTML = '';
    }
    trickFull = false;
}

function showOnTable(seat, card) {
    if (trickFull) clearTrick();
    const pos = document.getElementById('trickR' + slotOf(seat));
    pos.innerHTML = '';
    pos.appendChild(cardEl(card));
}

function playCard(card) {
    if (!pendingPlay) return;
    sock.emit('playcard', card);
    pendingPlay = null;
    renderSeats();
}

function hideBidButtons() {
    hideDiv('bid-buttons');
    ['passz', 'kontra', 'rekontra'].forEach(b => hideDiv(b + '-butt'));
}

function showBidPanel(data) { // data: {highest, kontra, rekontra}
    for (let level = 1; level <= 7; level++) {
        DENOMS.forEach(denom => {
            const butt = document.getElementById('bid-' + level + '-' + denom);
            let allowed = true;
            if (data.highest !== null) { // csak a jelenleginel magasabb licit valaszthato
                if (level < data.highest.level) allowed = false;
                if (level === data.highest.level && DENOMS.indexOf(denom) <= DENOMS.indexOf(data.highest.denom)) allowed = false;
            }
            butt.disabled = !allowed;
        });
    }
    showDiv('passz-butt', 'inline-block');
    if (data.kontra) showDiv('kontra-butt', 'inline-block');
    if (data.rekontra) showDiv('rekontra-butt', 'inline-block');
    showDiv('bid-buttons');
}

function resetGameView() {
    myHand = [];
    handCounts = [0, 0, 0, 0];
    dummySeat = -1;
    dummyCards = [];
    declarerSeat = -1;
    turnSeat = -1;
    playing = false;
    tricksPair = [0, 0];
    bids = [];
    pendingPlay = null;
    clearTrick();
    hideBidButtons();
    hideDiv('auto-butt');
    document.getElementById('terito-area').innerHTML = '';
    renderSeats();
    renderBidHistory();
}

const sock = io();

const writeEvent = (text) => {
    const parent = document.querySelector('#events');
    const el = document.createElement('li');
    el.innerHTML = text;
    parent.appendChild(el);
    parent.scrollTop = parent.scrollHeight;
};
const writePlayerList = (text) => {
    document.getElementById('player-list').innerHTML = text;
};
const onChatSubmitted = (e) => {
    e.preventDefault();
    const input = document.querySelector('#chat');
    const text = input.value;
    input.value = '';
    if (text) sock.emit('message', userName + ': ' + text);
};
const onStartGame = (e) => {
    e.preventDefault();
    sock.emit('ujparti');
};
const onUjParti = (e) => {
    e.preventDefault();
    sock.emit('ujparti');
};
const onTerit = (e) => {
    e.preventDefault();
    sock.emit('teritek');
};
const onAuto = (e) => {
    e.preventDefault();
    sock.emit('autofinish');
    hideDiv('auto-butt');
};
const onBid = (payload) => (e) => {
    e.preventDefault();
    sock.emit('bid', payload);
    hideBidButtons();
};

// Licit racs legyartasa: 1C..7N gombok
const bidGrid = document.getElementById('bid-grid');
for (let level = 1; level <= 7; level++) {
    DENOMS.forEach(denom => {
        const butt = document.createElement('button');
        butt.id = 'bid-' + level + '-' + denom;
        butt.innerHTML = level + DENOM_LABELS[denom];
        butt.addEventListener('click', onBid({ type: 'bid', level: level, denom: denom }));
        bidGrid.appendChild(butt);
    });
}

document.getElementById('start-game').addEventListener('submit', onStartGame);
document.getElementById('chat-form').addEventListener('submit', onChatSubmitted);
document.getElementById('ujparti-butt').addEventListener('click', onUjParti);
document.getElementById('teritek-butt').addEventListener('click', onTerit);
document.getElementById('auto-butt').addEventListener('click', onAuto);
document.getElementById('passz-butt').addEventListener('click', onBid({ type: 'passz' }));
document.getElementById('kontra-butt').addEventListener('click', onBid({ type: 'kontra' }));
document.getElementById('rekontra-butt').addEventListener('click', onBid({ type: 'rekontra' }));

const onEntrySubmitted = (e) => {
    e.preventDefault();
    const input = document.querySelector('#name');
    userName = input.value.substring(0, 20).trim();
    if (userName) {
        hideDiv('entry');
        showDiv('mainblock', 'flex');
        hideDiv('start-game');
        writeEvent('Egyszeru Bridzs beszelgetes');

        sock.on('message', (text) => {
            writeEvent(text);
        });
        sock.on('plist', (text) => {
            writePlayerList('Belepett jatekosok:<br/>' + text);
        });
        sock.on('state', (text) => {
            document.getElementById('state').innerHTML = text;
        });
        sock.on('canstart', () => {
            showDiv('start-game');
        });
        sock.on('deal', (data) => { // uj parti, osztas
            hideDiv('start-game');
            resetGameView();
            inGame = true;
            mySeat = data.seat;
            myHand = data.cards;
            names = data.names;
            dealer = data.dealer;
            handCounts = [13, 13, 13, 13];
            renderSeats();
            renderBidHistory();
            showDiv('ujparti-butt', 'inline-block');
            if (mySeat >= 0) showDiv('teritek-butt', 'inline-block');
        });
        sock.on('turn', (t) => {
            turnSeat = t;
            renderSeats();
        });
        sock.on('bidTurn', (opts) => { // en jovok a licitben
            showBidPanel(opts);
        });
        sock.on('bidMade', (b) => {
            bids.push(b);
            renderBidHistory();
        });
        sock.on('contract', (c) => {
            declarerSeat = c.declarerSeat;
            playing = true;
            hideBidButtons();
            showDiv('auto-butt', 'inline-block');
            renderSeats();
            renderBidHistory(); // eltunik, jonnek a kijatszott lapok
        });
        sock.on('dummyHand', (data) => { // a terito lapjai (mindenki latja)
            dummySeat = data.seat;
            dummyCards = data.cards;
            renderSeats();
        });
        sock.on('playTurn', (data) => { // en jovok (vagy en jatszom az asztal lapjabol)
            pendingPlay = data;
            renderSeats();
        });
        sock.on('cardPlayed', (data) => {
            if (handCounts[data.seat] > 0) handCounts[data.seat]--;
            if (data.seat === mySeat) {
                myHand = myHand.filter(c => c !== data.card);
            }
            showOnTable(data.seat, data.card);
            renderSeats();
        });
        sock.on('trickDone', (data) => {
            tricksPair = data.tricks;
            trickFull = true; // a kovetkezo kijatszott lapnal urul az asztal
            renderSeats();
        });
        sock.on('gameOver', () => {
            pendingPlay = null;
            turnSeat = -1;
            hideDiv('auto-butt');
            renderSeats();
        });
        sock.on('teritett', (data) => { // valaki teritette a lapjait
            const area = document.getElementById('terito-area');
            let strip = document.getElementById('terito-' + data.name);
            if (!strip) {
                strip = document.createElement('div');
                strip.id = 'terito-' + data.name;
                strip.className = 'terito-strip';
                area.appendChild(strip);
            }
            strip.innerHTML = '<div class="terito-name">' + data.name + ' lapjai:</div>';
            const fan = document.createElement('div');
            fan.className = 'fan mini-fan';
            customSort(data.cards).forEach(card => fan.appendChild(cardEl(card)));
            strip.appendChild(fan);
        });
        sock.on('reset', () => { // valaki kilepett, a jatek megszakadt
            inGame = false;
            resetGameView();
        });

        sock.emit('name', userName);
    }
};

hideDiv('mainblock');
document.querySelector('#entry-form').addEventListener('submit', onEntrySubmitted);
