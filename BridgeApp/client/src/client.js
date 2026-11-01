let userName = null;

// Kartya kodok: elso karakter a szin (S,H,D,C), masodik az ertek (2-9,T,J,Q,K,A)
const SUIT_ORDER = ['S', 'H', 'C', 'D']; // valtott szinek a kirakashoz
const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUIT_SYMBOLS = { S: '&spades;', H: '&hearts;', C: '&clubs;', D: '&diams;' };
const RANK_LABELS = { T: '10' };
// Licit nemek emelkedo sorrendben: treff, karo, kor, pikk, szanzadu
const DENOMS = ['C', 'D', 'H', 'S', 'N'];
const DENOM_LABELS = { C: '&clubs;', D: '<span class="red">&diams;</span>', H: '<span class="red">&hearts;</span>', S: '&spades;', N: 'SZ' };
// Szekek: 0-2 par Eszak-Del, 1-3 par Kelet-Nyugat (a kor iranya É-K-D-NY)
const SEAT_LETTERS = ['É', 'K', 'D', 'NY'];

let mySeat = -1;        // -1: nezelodo
let myHand = [];
let names = [];         // a negy jatekos neve szek szerint
let dealer = 0;
let handCounts = [0, 0, 0, 0];
let dummySeat = -1;
let dummyCards = [];
let partnerSeat = -1;   // ha en vagyok az asztal: a felvevo szeke
let partnerCards = [];  // es a felvevo lapjai
let specHands = null;   // nezelodonek: mind a negy kez (szek szerint)
let chicago = null;     // {round, dealNo, vul, rows, roundTotal, total} a szervertol
let declarerSeat = -1;
let turnSeat = -1;
let playing = false;    // licit kozben false, lejatszas alatt true
let inGame = false;
let tricksPair = [0, 0];
let bids = [];          // {seat, text} a licitmenet sorban
let pendingPlay = null; // {actingSeat, fromDummy, legal} ha en jovok
let revealHands = null; // parti vegen: mindenki eredeti lapjai
let trickHist = [];     // parti vegen: az utesek es kik vittek oket
let seatsState = [null, null, null, null]; // ki ul melyik szeken (lobby)
let trumpSuit = null;   // az adu szin (a lapok rendezesehez)
let claimSeat = -1;     // a bejelento szeke (terul a lapja)
let claimCards = [];
let undoActor = -1;     // ki vonhatja vissza az utolso lepest
let gameEnded = false;  // lezarult-e az aktualis parti
let pendingReveal = null;
let trickZ = 1;
// Az asztal megjelenitesi sora: a teljes utes par masodpercig latszik,
// a kozben kijatszott lapok megvarjak, mig a gyoztes elviszi oket
let tableQueue = [];
let tableBusy = false;
let tableGen = 0;

// Lapok sorrendje balrol jobbra (ill. fentrol le): adu (ha van),
// pikk, kor, treff, karo
function suitOrderH() {
    if (!trumpSuit || !playing) return SUIT_ORDER;
    return [trumpSuit].concat(SUIT_ORDER.filter(x => x !== trumpSuit));
}
function suitOrderV() {
    return suitOrderH();
}
function customSort(arr, order) { // szinenkent, azon belul csokkeno ertek szerint
    const tmarr = [];
    (order || SUIT_ORDER).forEach(suit => {
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

function vulOf(seat) { // bellben van-e a szek vonala a futo leosztasban
    return chicago !== null && chicago.vul[seat % 2];
}

function vulText(v) { // szkorhelyzet szovegesen
    if (v[0] && v[1]) return 'általános bell';
    if (v[0]) return 'É-D bellben';
    if (v[1]) return 'K-NY bellben';
    return 'általános mans';
}

function slotOf(seat) { // sajat szek alul (0), tovabbi szekek balra (1), szemben (2), jobbra (3)
    const viewSeat = mySeat >= 0 ? mySeat : 0;
    return (seat - viewSeat + 4) % 4;
}

function fillOpenFan(fan, rel, cards) { // felforditott kez az adott pozicioban
    if (rel === 1 || rel === 3) { // oldalt szinenkent kulon sorokban, adu felul
        fan.classList.add('dummy-vert');
        suitOrderV().forEach(suit => {
            const row = document.createElement('div');
            row.className = 'suit-row';
            customSort(cards.filter(c => c[0] === suit)).forEach(card => row.appendChild(cardEl(card)));
            if (row.children.length > 0) fan.appendChild(row);
        });
    }
    else {
        fan.classList.add('fan-full');
        customSort(cards, suitOrderH()).forEach(card => fan.appendChild(cardEl(card)));
    }
}

function renderFan(abs) {
    const fan = document.getElementById('fanR' + slotOf(abs));
    fan.innerHTML = '';
    fan.classList.remove('dummy-fan', 'dummy-vert', 'fan-full'); // ne ragadjon be az elozo parti elrendezese
    if (inGame && abs === dummySeat && abs !== mySeat) fan.classList.add('dummy-fan');
    if (!inGame) return;
    if (revealHands !== null) { // parti vege: mindenki eredeti lapja felforditva
        fillOpenFan(fan, slotOf(abs), revealHands[abs]);
        return;
    }
    if (abs === claimSeat && claimCards.length > 0 && abs !== mySeat) { // a bejelento lapjai terulnek
        fillOpenFan(fan, slotOf(abs), claimCards);
        return;
    }
    if (abs === mySeat) { // sajat kez, kijatszhato lapok kiemelve
        const clickable = pendingPlay && !pendingPlay.fromDummy && pendingPlay.actingSeat === mySeat;
        customSort(myHand, suitOrderH()).forEach(card => {
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
            suitOrderV().forEach(suit => { // az adu szin felulre
                const row = document.createElement('div');
                row.className = 'suit-row';
                customSort(dummyCards.filter(c => c[0] === suit)).forEach(card => row.appendChild(makeCard(card)));
                if (row.children.length > 0) fan.appendChild(row);
            });
        }
        else {
            customSort(dummyCards, suitOrderH()).forEach(card => fan.appendChild(makeCard(card))); // adu jobbra
        }
    }
    else if (abs === partnerSeat && playing) { // en vagyok az asztal: latom a felvevo lapjait
        fan.classList.add('fan-full');
        customSort(partnerCards, suitOrderH()).forEach(card => fan.appendChild(cardEl(card)));
    }
    else if (specHands !== null) { // nezelodo: mindenki lapja felforditva
        fillOpenFan(fan, slotOf(abs), specHands[abs]);
    }
    else { // hatlapok
        for (let i = 0; i < handCounts[abs]; i++) {
            fan.appendChild(backEl());
        }
    }
}

function lobbySeatOfMe() { // hol ulok az ulesek szerint (nev alapjan)
    return seatsState.findIndex(x => x !== null && x.name === userName);
}

function renderPlate(abs) {
    const plate = document.getElementById('plateR' + slotOf(abs));
    plate.innerHTML = '';
    plate.style.display = 'flex';
    const seatInfo = seatsState[abs];
    plate.classList.toggle('onturn', inGame && !gameEnded && turnSeat === abs);
    plate.classList.toggle('empty-seat', seatInfo === null);
    plate.classList.toggle('vul', inGame && vulOf(abs)); // bellben: piros ulesbetu
    plate.title = inGame && chicago !== null ? (vulOf(abs) ? 'Bellben' : 'Mansban') : '';
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = SEAT_LETTERS[abs];
    const nameSpan = document.createElement('span');
    nameSpan.className = 'pname';
    let nm = seatInfo ? seatInfo.name : '(üres hely)';
    if (seatInfo && seatInfo.bot) nm = '\ud83e\udd16 ' + nm;
    if (seatInfo && !seatInfo.connected) nm += ' (megszakadt)';
    if (playing && abs === declarerSeat) nm = '\u2605 ' + nm;
    nameSpan.textContent = nm;
    const count = document.createElement('span');
    count.className = 'pcount';
    count.textContent = playing ? tricksPair[abs % 2] : '';
    plate.appendChild(badge);
    plate.appendChild(nameSpan);
    plate.appendChild(count);
    const myLobby = lobbySeatOfMe();
    if (seatInfo === null && myLobby < 0 && userName) { // ures hely: leulhetek
        const b = document.createElement('button');
        b.id = 'sit-' + abs;
        b.className = 'seat-btn';
        b.textContent = 'Leülök';
        b.onclick = () => sock.emit('sit', abs);
        plate.appendChild(b);
    }
    if (seatInfo === null && userName) { // ures hely: robot is ultetheto
        const b = document.createElement('button');
        b.id = 'bot-' + abs;
        b.className = 'seat-btn';
        b.textContent = 'Bot';
        b.title = 'Robot leültetése erre a helyre';
        b.onclick = () => sock.emit('addBot', abs);
        plate.appendChild(b);
    }
    if (seatInfo !== null && seatInfo.name === userName) { // felallas (jatek kozben is: a hely kiurul, kibic lesz)
        const b = document.createElement('button');
        b.id = 'stand-btn';
        b.className = 'seat-btn';
        b.textContent = 'Felállok';
        b.onclick = () => sock.emit('stand');
        plate.appendChild(b);
    }
    if (seatInfo !== null && userName && (seatInfo.bot || !seatInfo.connected)) {
        // botot es megszakadt jatekost barki elkuldhet (kibic is)
        const b = document.createElement('button');
        b.className = 'seat-btn kick-btn';
        b.textContent = 'Elküld';
        b.onclick = () => sock.emit('kick', abs);
        plate.appendChild(b);
    }
}

function renderStartCenter() { // Jatek inditasa gomb kozepen, ha negyen ulnek
    const full = seatsState.every(x => x !== null);
    const allBots = full && seatsState.every(x => x.bot);
    // ulo jatekos indithat; ha negy robot ul, barki (nezelodo is)
    const show = full && !inGame && (lobbySeatOfMe() >= 0 || allBots);
    document.getElementById('start-center').style.display = show ? 'block' : 'none';
}

function renderUndo() { // visszavonas gomb: csak az utolso lepes gazdajanak aktiv
    const b = document.getElementById('undo-butt');
    const show = inGame && !gameEnded && mySeat >= 0;
    b.style.display = show ? 'inline-block' : 'none';
    b.disabled = undoActor !== mySeat || mySeat < 0;
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
    el.innerHTML = bidTableHtml();
}

function bidTableHtml() { // a licitmenet tablazata (kozepen es bal oldalt is)
    let html = '<table><tr>';
    SEAT_LETTERS.forEach((l, i) => { // egtaj + alatta a jatekos neve; bellben piros
        html += '<th' + (vulOf(i) ? ' class="vul"' : '') + '>' + l + '<span class="th-name">' + (names[i] || '') + '</span></th>';
    });
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
    return html;
}

function miniCard(card) { // kis szoveges lap az uteslistahoz, pl. "A♠"
    const red = card[0] === 'H' || card[0] === 'D';
    return '<span' + (red ? ' class="red"' : '') + '>' +
        (RANK_LABELS[card[1]] || card[1]) + SUIT_SYMBOLS[card[0]] + '</span>';
}

function renderTrickHistory() { // parti vegen: melyik utest ki vitte
    const el = document.getElementById('trick-history');
    if (revealHands === null) {
        el.style.display = 'none';
        return;
    }
    el.style.display = 'block';
    let html = '<table><tr><th>#</th>';
    SEAT_LETTERS.forEach(l => { html += '<th>' + l + '</th>'; });
    html += '<th>Vitte</th></tr>';
    trickHist.forEach((t, i) => {
        const bySeat = ['', '', '', ''];
        t.cards.forEach(c => { bySeat[c.seat] = miniCard(c.card); });
        html += '<tr><td>' + (i + 1) + '.</td>';
        bySeat.forEach((c, s) => {
            html += '<td' + (s === t.winnerSeat ? ' class="trick-win"' : '') + '>' + c + '</td>';
        });
        html += '<td><b>' + SEAT_LETTERS[t.winnerSeat] + '</b></td></tr>';
    });
    if (trickHist.length < 13) {
        html += '<tr><td colspan="6">A többi ütés bejelentéssel dőlt el.</td></tr>';
    }
    html += '</table>';
    el.innerHTML = html;
}

function clearTrick() {
    for (let i = 0; i < 4; i++) {
        document.getElementById('trickR' + i).innerHTML = '';
    }
    trickZ = 1;
}

function resetTableQueue() { // uj osztasnal/visszavonasnal minden fuggo animacio ervenytelen
    tableGen++;
    tableQueue = [];
    tableBusy = false;
    clearTrick();
}

function showOnTable(seat, card) {
    const pos = document.getElementById('trickR' + slotOf(seat));
    pos.innerHTML = '';
    const el = cardEl(card);
    el.style.zIndex = trickZ++; // a kesobbi lap felulre
    pos.appendChild(el);
}

function enqueueTable(ev) {
    tableQueue.push(ev);
    pumpTable();
}

function pumpTable() {
    if (tableBusy) return;
    const ev = tableQueue.shift();
    if (!ev) return;
    if (ev.type === 'card') {
        showOnTable(ev.seat, ev.card);
        pumpTable();
        return;
    }
    // teljes utes: par masodpercig mozdulatlanul latszik, aztan a gyoztes elviszi;
    // az utolso utes tovabb marad
    tableBusy = true;
    const gen = tableGen;
    setTimeout(() => {
        if (gen !== tableGen) return;
        const rel = slotOf(ev.winnerSeat);
        for (let i = 0; i < 4; i++) {
            const c = document.querySelector('#trickR' + i + ' .card');
            if (c) c.classList.add('fly', 'fly-' + rel);
        }
        setTimeout(() => {
            if (gen !== tableGen) return;
            clearTrick();
            tableBusy = false;
            pumpTable();
        }, 900);
    }, ev.last ? 5000 : 2000);
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
    const sz = document.getElementById('info-szkor');
    renderScoreSheet();
    if (!inGame) {
        p.innerText = '';
        sz.innerHTML = '';
        b.innerHTML = '';
        u.innerHTML = '';
        return;
    }
    if (chicago !== null) {
        p.innerText = chicago.round + '. kör – ' + chicago.dealNo + '/4. leosztás';
        sz.innerHTML = 'Szkórhelyzet: <b>' + vulText(chicago.vul) + '</b>';
    }
    else {
        p.innerText = gameNo + '. parti';
        sz.innerHTML = '';
    }
    if (contractInfo) { // a bemondas ket sorban, nagyon nagy betukkel
        b.innerHTML = '<div class="big-bid">' + contractInfo.level + DENOM_LABELS[contractInfo.denom] +
            '<span class="big-kontra">' + kontraLabel(contractInfo.kontraLevel) + '</span></div>' +
            '<div class="big-name">' + contractInfo.declarerName + '</div>';
    }
    else {
        b.innerHTML = 'Licit folyik...';
    }
    if (playing) {
        u.innerHTML = 'Ütések:<br>' +
            'É-D (' + names[0] + ' &amp; ' + names[2] + '): <b>' + tricksPair[0] + '</b><br>' +
            'K-NY (' + names[1] + ' &amp; ' + names[3] + '): <b>' + tricksPair[1] + '</b>';
    }
    else {
        u.innerHTML = '';
    }
    const t = document.getElementById('info-turn');
    if (inGame && !gameEnded && turnSeat >= 0 && names[turnSeat]) {
        t.innerHTML = 'Jön: <b>' + names[turnSeat] + '</b>';
    }
    else {
        t.innerHTML = '';
    }
    const lic = document.getElementById('info-licit');
    lic.innerHTML = (playing && bids.length > 0) ? 'Licitmenet:' + bidTableHtml() : '';
}

function renderScoreSheet() { // Chicago eredmenylap a bal oldalon: a kor leosztasai es az osszegek
    const el = document.getElementById('info-chicago');
    if (!inGame || chicago === null || (chicago.rows.length === 0 && chicago.round === 1)) {
        el.innerHTML = '';
        return;
    }
    const vulShort = v => v[0] && v[1] ? 'mind' : (v[0] ? 'É-D' : (v[1] ? 'K-NY' : '–'));
    let html = 'Eredménylap (' + chicago.round + '. kör):<table><tr><th>#</th><th>Bell</th>' +
        '<th>Felvétel</th><th>Ered.</th><th>É-D</th><th>K-NY</th></tr>';
    chicago.rows.forEach(r => {
        const k = r.kontraLevel === 1 ? 'X' : (r.kontraLevel === 2 ? 'XX' : '');
        const diff = r.diff === 0 ? '=' : (r.diff > 0 ? '+' + r.diff : String(r.diff));
        html += '<tr><td>' + r.dealNo + '</td><td>' + vulShort(r.vul) + '</td><td>' +
            r.level + DENOM_LABELS[r.denom] + k + ' ' + SEAT_LETTERS[r.declarerSeat] + '</td><td>' + diff +
            '</td><td>' + (r.pts[0] || '') + '</td><td>' + (r.pts[1] || '') + '</td></tr>';
    });
    html += '<tr class="sum"><td colspan="4">Kör összesen</td><td>' + chicago.roundTotal[0] +
        '</td><td>' + chicago.roundTotal[1] + '</td></tr>';
    if (chicago.round > 1) {
        html += '<tr class="sum"><td colspan="4">Mind összesen</td><td>' + chicago.total[0] +
            '</td><td>' + chicago.total[1] + '</td></tr>';
    }
    el.innerHTML = html + '</table>';
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

function resetGameView() {
    myHand = [];
    handCounts = [0, 0, 0, 0];
    dummySeat = -1;
    dummyCards = [];
    partnerSeat = -1;
    partnerCards = [];
    specHands = null;
    chicago = null;
    declarerSeat = -1;
    turnSeat = -1;
    playing = false;
    tricksPair = [0, 0];
    bids = [];
    pendingPlay = null;
    resetTableQueue();
    hideBidButtons();
    hideDiv('auto-butt');
    hideDiv('claim-butt');
    hideDiv('result-modal');
    hideDiv('claim-modal');
    revealHands = null;
    trickHist = [];
    contractInfo = null;
    trumpSuit = null;
    claimSeat = -1;
    claimCards = [];
    undoActor = -1;
    gameEnded = false;
    pendingReveal = null;
    hideDiv('confirm-modal');
    renderSeats();
    renderBidHistory();
    renderTrickHistory();
    renderInfo();
    renderUndo();
    renderStartCenter();
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
const onChatSubmit = (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    input.value = '';
    if (text) sock.emit('chat', text);
};
const onUjParti = (e) => {
    e.preventDefault();
    if (inGame && !gameEnded) { // futo parti: megerosites
        showDiv('confirm-modal', 'flex');
        return;
    }
    sock.emit('ujparti');
};
const onClaim = (e) => {
    e.preventDefault();
    sock.emit('claim');
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

document.getElementById('start-center').addEventListener('click', (e) => {
    e.preventDefault();
    sock.emit('ujparti');
});
document.getElementById('undo-butt').addEventListener('click', (e) => {
    e.preventDefault();
    sock.emit('undo');
});
document.getElementById('confirm-yes').addEventListener('click', (e) => {
    e.preventDefault();
    hideDiv('confirm-modal');
    sock.emit('ujparti');
});
document.getElementById('confirm-no').addEventListener('click', (e) => {
    e.preventDefault();
    hideDiv('confirm-modal');
});
document.getElementById('leave-butt').addEventListener('click', (e) => {
    e.preventDefault();
    showDiv('leave-modal', 'flex');
});
document.getElementById('leave-yes').addEventListener('click', (e) => {
    e.preventDefault();
    sock.emit('leave');
    try { sessionStorage.removeItem('bridgeName'); } catch (err) { }
    setTimeout(() => location.reload(), 200); // vissza a belepo kepernyore
});
document.getElementById('score-help-butt').addEventListener('click', (e) => {
    e.preventDefault();
    showDiv('score-modal', 'flex');
});
document.getElementById('score-close').addEventListener('click', (e) => {
    e.preventDefault();
    hideDiv('score-modal');
});
document.getElementById('leave-no').addEventListener('click', (e) => {
    e.preventDefault();
    hideDiv('leave-modal');
});
document.getElementById('chat-form').addEventListener('submit', onChatSubmit);
document.getElementById('ujparti-butt').addEventListener('click', onUjParti);
document.getElementById('result-ujparti').addEventListener('click', (e) => {
    hideDiv('result-modal');
    onUjParti(e);
});
document.getElementById('claim-butt').addEventListener('click', onClaim);
document.getElementById('claim-accept').addEventListener('click', (e) => {
    e.preventDefault();
    sock.emit('claimAnswer', true);
    hideDiv('claim-buttons');
});
document.getElementById('claim-reject').addEventListener('click', (e) => {
    e.preventDefault();
    sock.emit('claimAnswer', false);
    hideDiv('claim-buttons');
});
document.getElementById('result-close').addEventListener('click', (e) => {
    e.preventDefault();
    hideDiv('result-modal'); // a lapok es az utesek megtekinthetok mogotte
});
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

        sock.on('chat', (d) => { // jatekosok uzenetei (mindenki latja)
            const log = document.getElementById('chat-log');
            const row = document.createElement('div');
            const b = document.createElement('b');
            b.textContent = d.name + ': ';
            row.appendChild(b);
            row.appendChild(document.createTextNode(d.text));
            log.appendChild(row);
            while (log.children.length > 100) log.removeChild(log.firstChild);
            log.scrollTop = log.scrollHeight;
        });
        sock.on('plist', (text) => {
            writePlayerList('Belépett játékosok:<br/>' + text);
        });
        sock.on('seats', (arr) => { // ulesek allapota (lobby es jatek kozben is)
            seatsState = arr;
            // ki- es beulesnel a nevek a licittablaban es a bal oldalon is frissulnek
            names = arr.map(x => x ? x.name : '(üres hely)');
            renderBidHistory();
            renderInfo();
            renderSeats();
            renderStartCenter();
        });
        sock.on('undoState', (d) => { // ki vonhatja vissza az utolso lepest
            undoActor = d.actor;
            renderUndo();
        });
        sock.on('deal', (data) => { // uj parti, osztas
            resetGameView();
            inGame = true;
            mySeat = data.seat;
            myHand = data.cards;
            specHands = data.allHands ? data.allHands.map(h => h.slice()) : null;
            names = data.names;
            dealer = data.dealer;
            gameNo = data.gameNo || gameNo + 1;
            contractInfo = null;
            handCounts = data.counts ? data.counts.slice() : [13, 13, 13, 13]; // ujracsatlakozasnal a valos lapszamok
            tricksPair = data.tricks ? data.tricks.slice() : [0, 0];
            renderSeats();
            renderBidHistory();
            renderInfo();
            renderUndo();
            renderStartCenter();
            showDiv('ujparti-butt', 'inline-block');
        });
        sock.on('turn', (t) => {
            turnSeat = t;
            renderSeats();
            renderInfo();
        });
        sock.on('chicago', (d) => { // kor, leosztas, szkorhelyzet es eredmenylap
            chicago = d;
            renderSeats();
            renderBidHistory();
            renderInfo();
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
            trumpSuit = c.denom === 'N' ? null : c.denom;
            contractInfo = { level: c.level, denom: c.denom, kontraLevel: c.kontraLevel, declarerName: c.declarerName };
            hideBidButtons();
            showDiv('auto-butt', 'inline-block');
            if (mySeat >= 0 && mySeat !== c.dummySeat) { // az asztal nem jelenthet be
                showDiv('claim-butt', 'inline-block');
            }
            renderSeats();
            renderBidHistory(); // eltunik, jonnek a kijatszott lapok
            renderInfo();
        });
        sock.on('dummyHand', (data) => { // a terito lapjai (mindenki latja)
            dummySeat = data.seat;
            dummyCards = data.cards;
            renderSeats();
        });
        sock.on('partnerHand', (data) => { // en vagyok az asztal: a felvevo lapjai
            partnerSeat = data.seat;
            partnerCards = data.cards;
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
            if (specHands !== null) {
                specHands[data.seat] = specHands[data.seat].filter(c => c !== data.card);
            }
            enqueueTable({ type: 'card', seat: data.seat, card: data.card });
            renderSeats();
        });
        sock.on('trickDone', (data) => {
            tricksPair = data.tricks;
            enqueueTable({ type: 'trickEnd', winnerSeat: data.winnerSeat, last: data.tricks[0] + data.tricks[1] === 13 });
            renderSeats();
            renderInfo();
        });
        sock.on('gameOver', (data) => {
            pendingPlay = null;
            turnSeat = -1;
            gameEnded = true;
            hideDiv('auto-butt');
            hideDiv('claim-butt');
            hideDiv('claim-modal');
            renderSeats();
            renderInfo();
            renderUndo();
            // Az utolso utes es az animacio meg latsszon: kis kesleltetes,
            // utana megvarja, hogy az asztalon levo utesek elfogyjanak
            const showResult = () => {
                if (!gameEnded) return; // kozben uj parti indult
                if (tableBusy || tableQueue.length > 0) {
                    setTimeout(showResult, 200);
                    return;
                }
                if (pendingReveal) { // mindenki lapja es az utesek
                    revealHands = pendingReveal.hands;
                    trickHist = pendingReveal.tricksHist;
                    pendingReveal = null;
                    resetTableQueue();
                    renderSeats();
                    renderTrickHistory();
                }
                if (data.level !== undefined) { // sarga eredmenyablak
                    const kontraTxt = data.kontraLevel === 1 ? ' (kontra)' : (data.kontraLevel === 2 ? ' (rekontra)' : '');
                    const side = data.pts[0] > 0 ? 'É-D' : (data.pts[1] > 0 ? 'K-NY' : '');
                    const ptsTxt = side ? side + ': +' + Math.max(data.pts[0], data.pts[1]) + ' pont' : '0 pont';
                    const roundTxt = data.roundOver ? '<div>Vége a körnek: É-D <b>' + data.roundTotal[0] +
                        '</b> – K-NY <b>' + data.roundTotal[1] + '</b></div>' : '';
                    document.getElementById('result-lines').innerHTML =
                        '<div>Bemondás: <b>' + data.level + DENOM_LABELS[data.denom] + kontraTxt +
                        '</b> (' + data.declarerName + ')</div>' +
                        '<div>A felvevők ' + '<b>' + data.declTricks + '</b> ütést vittek (kellett: ' + data.needed + ')</div>' +
                        '<div>Eredmény: <b>' + ptsTxt + '</b></div>' + roundTxt;
                    showDiv('result-modal', 'flex');
                }
            };
            setTimeout(showResult, 3300);
        });
        sock.on('claimAsk', (d) => { // valaki bejelentette: minden utest visz
            claimSeat = d.claimerSeat;
            claimCards = d.cards || [];
            renderSeats(); // a bejelento lapjai terulnek
            document.getElementById('claim-title').innerText = d.claimerName + ' bejelentette: minden ütést visz!';
            if (d.needed.includes(mySeat)) {
                document.getElementById('claim-text').innerText = 'Elfogadod?';
                showDiv('claim-buttons');
            }
            else {
                document.getElementById('claim-text').innerText = 'Várakozás az ellenfelek válaszára...';
                hideDiv('claim-buttons');
            }
            showDiv('claim-modal', 'flex');
        });
        sock.on('claimResult', (d) => {
            hideDiv('claim-modal');
            if (!d.accepted) {
                claimSeat = -1;
                claimCards = [];
                renderSeats();
                const log = document.getElementById('chat-log');
                const row = document.createElement('div');
                row.textContent = '— ' + d.name + ' nem fogadta el a bejelentést, folytatódik a játék.';
                log.appendChild(row);
                log.scrollTop = log.scrollHeight;
            }
        });
        sock.on('reveal', (d) => { // parti vege: a gameOver kesleltetve jeleniti meg
            pendingReveal = d;
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
