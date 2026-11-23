export const MAX_ROLL_DICE = 16;

export function getDice(rolls, limit = MAX_ROLL_DICE) {
    const dice = [];
    let count = 0;
    for (const roll of rolls ?? []) {
        for (const term of roll?.dice ?? []) {
            const faces = term.faces;
            if (!Number.isInteger(faces) || faces < 1) continue;
            const denomination = term.denomination;
            const coin = denomination === "c";
            const type = denomination === "f" ? "df" : typeof denomination === "string"
                && /^d[\w-]+$/i.test(denomination) ? denomination : `d${faces}`;
            for (const result of term.results ?? []) {
                if (!Number.isInteger(result?.result)) continue;
                const value = result.result;
                const discarded = result.active === false || Boolean(result.discarded || result.rerolled);
                count += 1;
                if (dice.length >= limit) continue;
                if (type === "d100" && value >= 1 && value <= 100) {
                    if (dice.length + 2 > limit) continue;
                    const pair = count;
                    dice.push({ type, faces: 10, value: Math.floor(value % 100 / 10) * 10, discarded, pair });
                    dice.push({ type: "d10", faces: 10, value: value % 10 || 10, percentile: true, discarded, pair });
                } else if (coin) {
                    dice.push({ type, faces, value: value + 1, coin, discarded });
                } else {
                    dice.push({ type, faces, value, discarded });
                }
            }
        }
    }
    return { dice, count };
}
