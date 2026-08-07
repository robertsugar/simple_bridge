let userName = null;

// Kartya kodok: elso karakter a szin (S,H,D,C), masodik az ertek (2-9,T,J,Q,K,A)
// A kep fajlnev a kod + ".png", pl. "SA.png"
const SUIT_ORDER = ['S', 'H', 'C', 'D']; // valtott szinek a kirakashoz
const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

let mySeat = -1;        // -1: nezelodo
let myHand = [];
let dummySeat = -1;
let dummyCards = [];
let dummyName = '';
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

function cardImg(card) {
    const img = document.createElement('img');
    img.src = 'cards/' + card + '.png';
    img.dataset.card = card;
    return img;
}

function renderHand() {
    const parent = document.getElementById('hand-cards');
    parent.innerHTML = '';
    const sorted = customSort(myHand);
    const clickable = pendingPlay && !pendingPlay.fromDummy && pendingPlay.actingSeat === mySeat;
    sorted.forEach(card => {
        const img = cardImg(card);
        if (clickable) {
            if (pendingPlay.legal.includes(card)) {
                img.className = 'playable';
                img.onclick = () => playCard(card);
            }
            else {
                img.className = 'dimmed';
            }
        }
        parent.appendChild(img);
    });
    document.getElementById('hand-label').innerText = myHand.length > 0 ? 'A lapjaid:' : '';
}

function renderDummy() {
    const parent = document.getElementById('dummy-cards');
    parent.innerHTML = '';
    if (dummySeat < 0) {
        document.getElementById('dummy-label').innerText = '';
        return;
    }
    document.getElementById('dummy-label').innerText = dummyName + ' teritett lapjai:';
    const sorted = customSort(dummyCards);
    const clickable = pendingPlay && pendingPlay.fromDummy;
    sorted.forEach(card => {
        const img = cardImg(card);
        if (clickable) {
            if (pendingPlay.legal.includes(card)) {
                img.className = 'playable';
                img.onclick = () => playCard(card);
            }
            else {
                img.className = 'dimmed';
            }
        }
        parent.appendChild(img);
    });
}

function clearTable() {
    for (let i = 0; i < 4; i++) {
        document.getElementById('slot' + i).innerHTML = '';
    }
    trickFull = false;
}

function slotOf(seat) { // sajat lap alul (0), tovabbi szekek balra (1), szemben (2), jobbra (3)
    const viewSeat = mySeat >= 0 ? mySeat : 0;
    return (seat - viewSeat + 4) % 4;
}

function showOnTable(seat, name, card) {
    if (trickFull) clearTable();
    const slot = document.getElementById('slot' + slotOf(seat));
    slot.innerHTML = '<div class="slot-name">' + name + '</div>';
    slot.appendChild(cardImg(card));
}

function playCard(card) {
    if (!pendingPlay) return;
    sock.emit('playcard', card);
    pendingPlay = null;
    renderHand();
    renderDummy();
}

function hideBidButtons() {
    ['passz', 'licit', 'kontra', 'rekontra'].forEach(b => hideDiv(b + '-butt'));
}

function resetGameView() {
    myHand = [];
    dummySeat = -1;
    dummyCards = [];
    dummyName = '';
    pendingPlay = null;
    clearTable();
    hideBidButtons();
    document.getElementById('terito-area').innerHTML = '';
    renderHand();
    renderDummy();
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
const onBid = (type) => (e) => {
    e.preventDefault();
    sock.emit('bid', type);
    hideBidButtons();
};

document.getElementById('start-game').addEventListener('submit', onStartGame);
document.getElementById('chat-form').addEventListener('submit', onChatSubmitted);
document.getElementById('ujparti-butt').addEventListener('click', onUjParti);
document.getElementById('teritek-butt').addEventListener('click', onTerit);
document.getElementById('passz-butt').addEventListener('click', onBid('passz'));
document.getElementById('licit-butt').addEventListener('click', onBid('licit'));
document.getElementById('kontra-butt').addEventListener('click', onBid('kontra'));
document.getElementById('rekontra-butt').addEventListener('click', onBid('rekontra'));

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
            document.getElementById('state').innerText = text;
        });
        sock.on('canstart', () => {
            showDiv('start-game');
        });
        sock.on('deal', (data) => { // uj parti, osztas
            hideDiv('start-game');
            resetGameView();
            mySeat = data.seat;
            myHand = data.cards;
            renderHand();
            showDiv('ujparti-butt', 'inline-block');
            if (mySeat >= 0) showDiv('teritek-butt', 'inline-block');
        });
        sock.on('bidTurn', (opts) => { // en jovok a licitben
            showDiv('passz-butt', 'inline-block');
            showDiv('licit-butt', 'inline-block');
            if (opts.kontra) showDiv('kontra-butt', 'inline-block');
            if (opts.rekontra) showDiv('rekontra-butt', 'inline-block');
        });
        sock.on('contract', () => {
            hideBidButtons();
        });
        sock.on('dummyHand', (data) => { // a terito lapjai (mindenki latja)
            dummySeat = data.seat;
            dummyName = data.name;
            dummyCards = data.cards;
            renderDummy();
        });
        sock.on('playTurn', (data) => { // en jovok (vagy en jatszom az asztal lapjabol)
            pendingPlay = data;
            renderHand();
            renderDummy();
        });
        sock.on('cardPlayed', (data) => {
            showOnTable(data.seat, data.name, data.card);
            if (data.seat === mySeat) {
                myHand = myHand.filter(c => c !== data.card);
                renderHand();
            }
        });
        sock.on('trickDone', () => {
            trickFull = true; // a kovetkezo kijatszott lapnal urul az asztal
        });
        sock.on('gameOver', () => {
            pendingPlay = null;
            renderHand();
            renderDummy();
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
            customSort(data.cards).forEach(card => strip.appendChild(cardImg(card)));
        });
        sock.on('reset', () => { // valaki kilepett, a jatek megszakadt
            resetGameView();
        });

        sock.emit('name', userName);
    }
};

hideDiv('mainblock');
document.querySelector('#entry-form').addEventListener('submit', onEntrySubmitted);
