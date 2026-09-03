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

function cardEl(card) { // feher lap, a szam es a szin kitolti az egesz lapot
    const el = document.createElement('div');
    el.className = 'card' + (card[0] === 'H' || card[0] === 'D' ? ' red' : '');
    el.dataset.card = card;
    el.innerHTML = '<div class="rank">' + (RANK_LABELS[card[1]] || card[1]) + '</div>' +
        '<div class="suit">' + SUIT_SYMBOLS[card[0]] + '</div>';
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
    fan.classList.remove('dummy-fan', 'dummy-vert', 'fan-full'); // ne ragadjon be az elozo parti elrendezese
    if (inGame && abs === dummySeat && abs !== mySeat) fan.classList.add('dummy-fan');
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
        const side = slotOf(abs) === 1 || slotOf(abs) === 3; // oldalt szinenkent kulon sorokban
        fan.classList.toggle('dummy-vert', side);
        fan.classList.toggle('fan-full', !side); // szemben akkora lapokkal, mint a sajat kez
        const makeCard = (card) => {
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
            return el;
        };
        if (side) {
            SUIT_ORDER.forEach(suit => {
                const row = document.createElement('div');
                row.className = 'suit-row';
                customSort(dummyCards.filter(c => c[0] === suit)).forEach(card => row.appendChild(makeCard(card)));
                if (row.children.length > 0) fan.appendChild(row);
            });
        }
        else {
            customSort(dummyCards).forEach(card => fan.appendChild(makeCard(card)));
        }
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

let bidHighest = null;    // az aktualis legmagasabb licit a panelhez
let selectedLevel = null; // a kivalasztott szint (szam), utana jon a szin
let gameNo = 0;           // hanyadik parti
let contractInfo = null;  // {level, denom, kontraLevel, declarerName}

function kontraLabel(k) {
    return k === 1 ? ' (kontra)' : (k === 2 ? ' (rekontra)' : '');
}

function renderInfo() { // bal oldali nagy betus jatekinfo
    const p = document.getElementById('info-parti');
    const b = document.getElementById('info-bemondas');
    const u = document.getElementById('info-utesek');
    if (!inGame) {
        p.innerText = '';
        b.innerHTML = '';
        u.innerHTML = '';
        return;
    }
    p.innerText = gameNo + '. parti';
    if (contractInfo) { // a bemondas ket sorban, nagyon nagy betukkel
        b.innerHTML = '<div class="big-bid">' + contractInfo.level + DENOM_LABELS[contractInfo.denom] +
            '<span class="big-kontra">' + kontraLabel(contractInfo.kontraLevel) + '</span></div>' +
            '<div class="big-name">' + contractInfo.declarerName + '</div>';
    }
    else {
        b.innerHTML = 'Licit folyik...';
    }
    if (playing) {
        u.innerHTML = 'Utesek:<br>' +
            'E-D (' + names[0] + ' &amp; ' + names[2] + '): <b>' + tricksPair[0] + '</b><br>' +
            'K-NY (' + names[1] + ' &amp; ' + names[3] + '): <b>' + tricksPair[1] + '</b>';
    }
    else {
        u.innerHTML = '';
    }
}

function denomAllowed(level, denom) { // magasabb-e ez a licit a jelenleginel
    if (bidHighest === null) return true;
    if (level > bidHighest.level) return true;
    return level === bidHighest.level && DENOMS.indexOf(denom) > DENOMS.indexOf(bidHighest.denom);
}

function refreshBidPick() {
    for (let level = 1; level <= 7; level++) {
        const butt = document.getElementById('bid-lvl-' + level);
        butt.disabled = !DENOMS.some(d => denomAllowed(level, d));
        butt.classList.toggle('selected', selectedLevel === level);
    }
    DENOMS.forEach(denom => {
        const butt = document.getElementById('bid-den-' + denom);
        butt.disabled = selectedLevel === null || !denomAllowed(selectedLevel, denom);
    });
}

function showBidPanel(data) { // data: {highest, kontra, rekontra}
    bidHighest = data.highest;
    selectedLevel = null;
    refreshBidPick();
    showDiv('passz-butt', 'block');
    if (data.kontra) showDiv('kontra-butt', 'block');
    if (data.rekontra) showDiv('rekontra-butt', 'block');
    showDiv('bid-buttons', 'flex');
}

function showSeatSetup(names) { // az indito (Eszak) valasztja: partner (Del), majd Kelet
    const title = document.getElementById('seat-setup-title');
    const btns = document.getElementById('seat-setup-buttons');
    let partnerIdx = null;
    const step2 = () => {
        title.innerText = 'Ki uljon Keletre?';
        btns.innerHTML = '';
        names.forEach((n, i) => {
            if (i === partnerIdx) return;
            const b = document.createElement('button');
            b.innerText = n;
            b.onclick = () => {
                sock.emit('seatChoice', { partner: partnerIdx, kelet: i });
                hideDiv('seat-setup');
            };
            btns.appendChild(b);
        });
    };
    title.innerText = 'Te vagy Eszak. Valassz partnert (Del):';
    btns.innerHTML = '';
    names.forEach((n, i) => {
        const b = document.createElement('button');
        b.innerText = n;
        b.onclick = () => { partnerIdx = i; step2(); };
        btns.appendChild(b);
    });
    showDiv('seat-setup');
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
    hideDiv('result-modal');
    hideDiv('seat-setup');
    document.getElementById('terito-area').innerHTML = '';
    contractInfo = null;
    renderSeats();
    renderBidHistory();
    renderInfo();
}

const sock = io();

// Ha a szerver ujraindult (uj verzio), a lap ujratoltodik, hogy friss
// kliens fusson; a nev megmarad, es a belepes magatol megismetlodik
sock.on('hello', (boot) => {
    try {
        const prev = sessionStorage.getItem('serverBoot');
        sessionStorage.setItem('serverBoot', boot);
        if (prev && prev !== boot) location.reload();
    } catch (e) { }
});

const writePlayerList = (text) => {
    document.getElementById('player-list').innerHTML = text;
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

// Licit valaszto legyartasa: felul a szintek (1-7), alul a szinek
const levelRow = document.getElementById('bid-levels');
for (let level = 1; level <= 7; level++) {
    const butt = document.createElement('button');
    butt.id = 'bid-lvl-' + level;
    butt.innerText = level;
    butt.addEventListener('click', (e) => {
        e.preventDefault();
        selectedLevel = level;
        refreshBidPick();
    });
    levelRow.appendChild(butt);
}
const denomRow = document.getElementById('bid-denoms');
DENOMS.forEach(denom => {
    const butt = document.createElement('button');
    butt.id = 'bid-den-' + denom;
    butt.innerHTML = DENOM_LABELS[denom];
    butt.addEventListener('click', (e) => {
        e.preventDefault();
        if (selectedLevel === null) return;
        sock.emit('bid', { type: 'bid', level: selectedLevel, denom: denom });
        hideBidButtons();
    });
    denomRow.appendChild(butt);
});

document.getElementById('start-game').addEventListener('submit', onStartGame);
document.getElementById('ujparti-butt').addEventListener('click', onUjParti);
document.getElementById('result-ujparti').addEventListener('click', (e) => {
    hideDiv('result-modal');
    onUjParti(e);
});
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
        try { sessionStorage.setItem('bridgeName', userName); } catch (e) { }
        hideDiv('entry');
        showDiv('mainblock', 'flex');
        hideDiv('start-game');

        sock.on('plist', (text) => {
            writePlayerList('Belepett jatekosok:<br/>' + text);
        });
        sock.on('state', (text) => {
            document.getElementById('state').innerHTML = text;
        });
        sock.on('canstart', () => {
            showDiv('start-game');
        });
        sock.on('seatSetup', (data) => { // en inditottam: en valasztom az ulesrendet
            hideDiv('start-game');
            showSeatSetup(data.names);
        });
        sock.on('deal', (data) => { // uj parti, osztas
            hideDiv('start-game');
            resetGameView();
            inGame = true;
            mySeat = data.seat;
            myHand = data.cards;
            names = data.names;
            dealer = data.dealer;
            gameNo = data.gameNo || gameNo + 1;
            contractInfo = null;
            handCounts = data.counts ? data.counts.slice() : [13, 13, 13, 13]; // ujracsatlakozasnal a valos lapszamok
            tricksPair = data.tricks ? data.tricks.slice() : [0, 0];
            renderSeats();
            renderBidHistory();
            renderInfo();
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
            contractInfo = { level: c.level, denom: c.denom, kontraLevel: c.kontraLevel, declarerName: c.declarerName };
            hideBidButtons();
            showDiv('auto-butt', 'inline-block');
            renderSeats();
            renderBidHistory(); // eltunik, jonnek a kijatszott lapok
            renderInfo();
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
            renderInfo();
        });
        sock.on('gameOver', (data) => {
            pendingPlay = null;
            turnSeat = -1;
            hideDiv('auto-butt');
            renderSeats();
            if (data.level !== undefined) { // sarga eredmenyablak
                const kontraTxt = data.kontraLevel === 1 ? ' (kontra)' : (data.kontraLevel === 2 ? ' (rekontra)' : '');
                const diffTxt = (data.diff >= 0 ? '+' : '') + data.diff;
                document.getElementById('result-lines').innerHTML =
                    '<div>Bemondas: <b>' + data.level + DENOM_LABELS[data.denom] + kontraTxt +
                    '</b> (' + data.declarerName + ')</div>' +
                    '<div>A felvevok ' + '<b>' + data.declTricks + '</b> utest vittek (kellett: ' + data.needed + ')</div>' +
                    '<div>Eredmeny: <b>' + diffTxt + '</b></div>';
                showDiv('result-modal', 'flex');
            }
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
        sock.on('connect', () => { // ujracsatlakozas (pl. szerver ujraindult): nev ujrakuldese
            inGame = false;
            resetGameView(); // ha van futo jatek, a szerver ujrakuldi az allast
            sock.emit('name', userName);
        });
    }
};

hideDiv('mainblock');
document.querySelector('#entry-form').addEventListener('submit', onEntrySubmitted);

// Ujratoltes (pl. szerverfrissites) utan automatikus visszalepes a mentett nevvel
try {
    const savedName = sessionStorage.getItem('bridgeName');
    if (savedName) {
        document.querySelector('#name').value = savedName;
        onEntrySubmitted(new Event('submit'));
    }
} catch (e) { }
