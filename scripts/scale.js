export const DEFAULT_DICE_SCALE = 100;
export const DICE_SCALE_RANGE = { min: 50, max: 150, step: 5 };
export const PREVIEW_HALF_SPAN = 1.28;

export function diceScaleFactor(percent) {
    const value = Number.isFinite(percent) ? percent : DEFAULT_DICE_SCALE;
    return Math.min(DICE_SCALE_RANGE.max, Math.max(DICE_SCALE_RANGE.min, value)) / 100;
}

export function diceLayout(width, height, scale, lastSlot = 0) {
    const baseColumns = width < 580 ? 4 : 6;
    const baseSize = Math.max(18, Math.min(43, width / (baseColumns * 3.1), height / 14)) * 1.25;
    const desiredSize = baseSize * scale;
    const columns = Math.max(1, Math.min(baseColumns, Math.floor(width * 0.92 / (desiredSize * 2.2))));
    const lastRow = Math.floor(lastSlot / columns);
    const size = Math.min(desiredSize, width * 0.92 / 2.2, height / ((lastRow + 1) * 2.2));
    return { columns, lastRow, size };
}
