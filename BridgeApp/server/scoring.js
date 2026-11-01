// Chicago pontozas: 4 leosztasos kor, minden leosztas kulon szamit
// (duplikat-stilus, MBSZ Szabalykonyv 77.: reszirasert 50, nincs atvitel, nincs honor)

// Szkorhelyzet a kor leosztasa (1-4) es az oszto szeke szerint: 1: altalanos mans,
// 2-3: az oszto vonala bellben, 4: altalanos bell. Visszaad: [0-2 vonal bellben, 1-3 vonal bellben]
function vulnerability(dealNo, dealerSeat) {
    if (dealNo === 1) return [false, false];
    if (dealNo === 4) return [true, true];
    const side = dealerSeat % 2;
    return [side === 0, side === 1];
}

function trickValue(denom) { // egy ütés erteke (szanzaduban az elso 40)
    return denom === 'C' || denom === 'D' ? 20 : 30;
}

// Egy leosztas pontja a felvevo vonalanak (bukasnal negativ)
// kontraLevel: 0 nincs, 1 kontra, 2 rekontra
function dealScore(level, denom, kontraLevel, vul, tricks) {
    const needed = 6 + level;
    if (tricks >= needed) {
        const mult = [1, 2, 4][kontraLevel];
        const base = (trickValue(denom) * level + (denom === 'N' ? 10 : 0)) * mult;
        let score = base;
        score += base >= 100 ? (vul ? 500 : 300) : 50; // gem- vagy reszirasjutalom
        if (level === 6) score += vul ? 750 : 500;     // kisszlem
        if (level === 7) score += vul ? 1500 : 1000;   // nagyszlem
        score += [0, 50, 100][kontraLevel];            // teljesitett kontrazott/rekontrazott felvetel
        const over = tricks - needed;
        if (kontraLevel === 0) score += over * trickValue(denom);
        else score += over * (vul ? 200 : 100) * (kontraLevel === 2 ? 2 : 1);
        return score;
    }
    const down = needed - tricks;
    let pen;
    if (kontraLevel === 0) pen = down * (vul ? 100 : 50);
    else {
        if (vul) pen = 200 + (down - 1) * 300;               // 200, 500, 800, ...
        else pen = down === 1 ? 100 : (down <= 3 ? 100 + (down - 1) * 200 : 500 + (down - 3) * 300); // 100, 300, 500, 800, ...
        if (kontraLevel === 2) pen *= 2;
    }
    return -pen;
}

module.exports = { vulnerability, dealScore };
