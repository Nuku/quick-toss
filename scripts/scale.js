export const DEFAULT_DICE_SCALE = 100;
export const DICE_SCALE_RANGE = { min: 50, max: 150, step: 5 };

export function diceScaleFactor(percent) {
    const value = Number.isFinite(percent) ? percent : DEFAULT_DICE_SCALE;
    return Math.min(DICE_SCALE_RANGE.max, Math.max(DICE_SCALE_RANGE.min, value)) / 100;
}
