// Bongeszos (headless Chromium) UI proba: 4 jatekos belep, ulesrendet
// valaszt, licital, jatszik, majd auto-val befejez egy partit.
// Futtatas: npm run test:ui  -  sajat porton (8020) inditja a szervert,
// igy nem zavarja a 8000-es elo jatekot.
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer');

const OUT = process.env.UI_OUT || os.tmpdir();
const NAMES = ['Anna', 'Bela', 'Cili', 'Denes'];
const PORT = process.env.TEST_PORT || '8020';
const URL = 'http://localhost:' + PORT;

let failed = false;
function assert(cond, msg) {
    console.log((cond ? '  OK: ' : '  FAIL: ') + msg);
    if (!cond) failed = true;
}

const serverProc = spawn('node', [path.join(__dirname, '..', 'server.js')],
    { stdio: 'pipe', env: Object.assign({}, process.env, { PORT: PORT }) });
serverProc.on('exit', (code) => {
    if (code !== null && code !== 0) {
        console.error('HIBA: a tesztszerver nem tudott elindulni (port foglalt?)');
        process.exit(1);
    }
});

async function clickWhenVisible(page, sel, timeout) {
    await page.waitForFunction(
        s => { const el = document.querySelector(s); return el && el.offsetParent !== null; },
        { timeout: timeout || 8000 }, sel);
    await page.click(sel);
}

(async () => {
    await new Promise(res => serverProc.stdout.on('data', d => {
        if (d.toString().includes('started on ' + PORT)) res();
    }));

    const browser = await puppeteer.launch({ headless: 'new' });
    const pages = [];
    const errors = [];
    for (const name of NAMES) {
        const ctx = await browser.createBrowserContext();
        const page = await ctx.newPage();
        await page.setViewport({ width: 1400, height: 900 });
        page.on('pageerror', e => errors.push(name + ': ' + e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(name + ' console: ' + m.text()); });
        await page.goto(URL);
        await page.type('#name', name);
        await page.click('#enter');
        pages.push(page);
    }
    console.log('1. Negy jatekos belepett a bongeszoben');

    // Uzenet a lapok alatti dobozbol: mindenki latja
    await pages[1].type('#chat-input', 'Szia, kezdjuk!');
    await pages[1].click('#chat-send');
    await pages[3].waitForFunction(() =>
        document.getElementById('chat-log').innerText.includes('Bela: Szia, kezdjuk!'));
    assert(true, 'a lapok alatti uzenet mindenkinel megjelenik');

    // Jatek inditasa + ulesrend: Anna (Eszak) partnere Cili (Del), Kelet Bela
    await clickWhenVisible(pages[0], '#start');
    const clickSeatButton = async (name) => {
        await pages[0].waitForFunction((n) =>
            Array.from(document.querySelectorAll('#seat-setup-buttons button'))
                .some(b => b.innerText === n && b.offsetParent !== null), {}, name);
        await pages[0].evaluate((n) => {
            Array.from(document.querySelectorAll('#seat-setup-buttons button'))
                .find(b => b.innerText === n).click();
        }, name);
    };
    await clickSeatButton('Cili');
    await clickSeatButton('Bela');
    console.log('2. Parti elinditva, ulesrend kivalasztva');

    for (let i = 0; i < 4; i++) {
        await pages[i].waitForFunction(() => document.querySelectorAll('#fanR0 .card').length === 13);
    }
    assert(true, 'mind a negy jatekosnal 13 sajat lap latszik');
    const backs = await pages[1].evaluate(() => document.querySelectorAll('.cardback').length);
    assert(backs === 39, 'a masik harom jatekos 13-13 hatlapja latszik (' + backs + ')');
    await pages[0].screenshot({ path: OUT + '/ui-1-licit.png' });

    // Licit: Anna 1 kort mond (szint, majd szin), a tobbi harom Passz-t
    await clickWhenVisible(pages[0], '#bid-lvl-1');
    await clickWhenVisible(pages[0], '#bid-den-H');
    await pages[1].waitForFunction(() =>
        document.getElementById('bid-history').innerText.includes('1'));
    assert(true, 'a licitmenet tablazat mutatja a licitet');
    const header = await pages[1].evaluate(() =>
        Array.from(document.querySelectorAll('#bid-history th')).map(th => th.innerText.replace(/\s+/g, ' ').trim()));
    assert(header[0] === 'É Anna' && header[1] === 'K Bela' && header[2] === 'D Cili' && header[3] === 'NY Denes',
        'licit fejlec: egtaj + jatekosnev (' + header.join(' | ') + ')');
    const bidRow = await pages[1].evaluate(() => {
        const tr = document.querySelectorAll('#bid-history tr')[1];
        return Array.from(tr.cells).map(td => td.innerText.trim());
    });
    assert(bidRow[0].includes('1') && bidRow[1] === '' && bidRow[2] === '' && bidRow[3] === '',
        'Anna (É, oszto) licitje az elso oszlopban van: [' + bidRow.join('|') + ']');
    const partiText = await pages[0].$eval('#info-parti', el => el.innerText);
    assert(partiText === '1. parti', 'jatekinfo: "' + partiText + '"');
    await pages[1].screenshot({ path: OUT + '/ui-1b-bidtable.png' });
    for (const p of [pages[1], pages[2], pages[3]]) {
        await clickWhenVisible(p, '#passz-butt');
    }

    // Az asztal az elso kihivas ELOTT meg nem terul
    await new Promise(r => setTimeout(r, 600));
    const preReveal = await pages[1].evaluate(() => document.querySelectorAll('.dummy-fan .card').length);
    assert(preReveal === 0, 'az asztal az elso kihivas elott meg nem terul (' + preReveal + ' lap)');

    const playOne = async () => {
        for (;;) {
            for (const p of pages) {
                const sel = await p.$('.card.playable');
                if (sel) { await sel.click(); return; }
            }
            await new Promise(r => setTimeout(r, 200));
        }
    };
    await playOne();
    for (const i of [0, 1, 3]) {
        await pages[i].waitForFunction(() => document.querySelectorAll('.dummy-fan .card').length === 13);
    }
    assert(true, 'a teritett (asztal) 13 lapja az elso kihivas utan latszik');
    // Az asztal (Cili) latja a felvevo (Anna) lapjait szemben
    await pages[2].waitForFunction(() => document.querySelectorAll('#fanR2 .card').length === 13);
    assert(true, 'az asztal latja a felvevo 13 lapjat');
    // A szemben ulo terito lapja akkora, mint a sajat lap
    const sizes = await pages[0].evaluate(() => {
        const d = document.querySelector('.dummy-fan .card').getBoundingClientRect();
        const o = document.querySelector('.own-fan .card').getBoundingClientRect();
        return { d: Math.round(d.width), o: Math.round(o.width) };
    });
    assert(sizes.d === sizes.o, 'a felso terito lapmerete egyezik a sajattal (' + sizes.d + '=' + sizes.o + ')');

    const stateText = await pages[1].$eval('#state', el => el.innerText);
    assert(stateText.includes('Felvevő: Anna'), 'allapotsor mutatja a felvevot ekezettel: "' + stateText + '"');
    const plates = await pages[2].evaluate(() =>
        Array.from(document.querySelectorAll('.plate .badge')).map(b => b.innerText).join(','));
    assert(plates.split(',').length === 4, 'negy nevtabla latszik (' + plates + ')');
    const infoText = await pages[3].evaluate(() =>
        (document.querySelector('#info-bemondas .big-bid') || {}).innerText + ' / ' +
        document.getElementById('info-utesek').innerText);
    assert(infoText.includes('1♥') && infoText.includes('É-D') && infoText.includes('K-NY'),
        'jatekinfo panel: nagy bemondas es vonalankenti utesek latszanak (' + infoText.split('/')[0].trim() + ')');

    // Meg 7 lap: osszesen ket teljes utes
    for (let c = 0; c < 7; c++) {
        await playOne();
        await new Promise(r => setTimeout(r, 200));
    }
    await new Promise(r => setTimeout(r, 400));
    const state2 = await pages[2].$eval('#state', el => el.innerText);
    assert(/Ütések/.test(state2) && !/: 0 \|.*: 0/.test(state2), 'utes szamlalo valtozott: "' + state2 + '"');
    const backs2 = await pages[1].evaluate(() => document.querySelectorAll('.cardback').length);
    assert(backs2 < 39, 'a hatlapok szama csokkent a kijatszas utan (' + backs2 + ')');
    await pages[0].screenshot({ path: OUT + '/ui-2-felvevo.png' });
    await pages[1].screenshot({ path: OUT + '/ui-3-ellenfel.png' });

    // Teritek gomb proba
    await pages[3].click('#teritek-butt');
    await pages[0].waitForFunction(() => document.querySelectorAll('#terito-area .card').length > 0);
    assert(true, 'Teritek gomb: a lapok mindenkinel megjelennek');

    // Uj parti gomb proba
    await pages[2].click('#ujparti-butt');
    await pages[0].waitForFunction(() => document.querySelectorAll('#fanR0 .card').length === 13
        && document.querySelectorAll('.dummy-fan .card').length === 0);
    assert(true, 'Uj parti gomb: ujraosztas tortent');
    const stale = await pages[1].evaluate(() =>
        document.querySelectorAll('.dummy-vert').length +
        document.querySelectorAll('.fan-full:not(.own-fan)').length);
    assert(stale === 0, 'uj partiban nem ragad be az elozo terito elrendezese');
    const backs3 = await pages[1].evaluate(() => document.querySelectorAll('.cardback').length);
    assert(backs3 === 39, 'uj partiban ujra 39 hatlap latszik vizszintesen (' + backs3 + ')');

    // Masodik parti vegigjatszasa auto-val: sarga eredmenyablak
    const findBidder = async () => {
        for (;;) {
            for (const p of pages) {
                const vis = await p.evaluate(() => {
                    const el = document.getElementById('bid-buttons');
                    return el && el.offsetParent !== null;
                });
                if (vis) return p;
            }
            await new Promise(r => setTimeout(r, 200));
        }
    };
    const bidder = await findBidder();
    await clickWhenVisible(bidder, '#bid-lvl-2');
    await clickWhenVisible(bidder, '#bid-den-S');
    for (let i = 0; i < 3; i++) {
        const p = await findBidder();
        await clickWhenVisible(p, '#passz-butt');
    }
    await clickWhenVisible(pages[0], '#auto-butt');
    console.log('   Auto befejezes fut (kb. 40 mp)...');
    await pages[1].waitForFunction(() => {
        const el = document.getElementById('result-modal');
        return el && el.style.display === 'flex';
    }, { timeout: 90000 });
    const resultText = await pages[1].$eval('#result-lines', el => el.innerText);
    assert(resultText.includes('Bemondás') && /Eredmény: [+-]?\d/.test(resultText),
        'eredmenyablak: "' + resultText.replace(/\n/g, ' | ') + '"');
    await pages[1].screenshot({ path: OUT + '/ui-5-eredmeny.png' });
    await pages[2].click('#result-ujparti');
    await pages[0].waitForFunction(() => {
        const el = document.getElementById('result-modal');
        return el.style.display === 'none' && document.querySelectorAll('#fanR0 .card').length === 13;
    });
    assert(true, 'az eredmenyablak eltunik az Uj partira, es uj osztas jon');

    assert(errors.length === 0, 'nincs JS hiba a kliensben' + (errors.length ? ': ' + errors.join(' | ') : ''));

    await browser.close();
    serverProc.kill();
    console.log(failed ? 'VANNAK HIBAK!' : 'UI proba sikeres.');
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('HIBA:', e.message); serverProc.kill(); process.exit(1); });
