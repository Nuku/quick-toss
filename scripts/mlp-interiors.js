const MODULE = "mlp-dice";
const ASSETS = `modules/${MODULE}/assets/dice`;
const TYPES = ["d2", "d4", "d6", "d8", "d10", "d12", "d20", "d100"];

function labelsFor(type, crest) {
    const count = type === "d100" ? 10 : Number(type.slice(1));
    const labels = Array.from({ length: count }, (_, index) => {
        const value = index + 1;
        if (type === "d100") return String(value % 10 * 10).padStart(2, "0");
        if (type === "d10") return String(value % 10);
        return String(value);
    });
    if (type === "d20") labels[19] = crest;
    return labels;
}

export async function registerMlpInteriors(api) {
    if (!game.modules.get(MODULE)?.active) return;
    const path = `modules/${MODULE}/scripts/catalog.js`;
    try {
        const { CHARACTERS } = await import(globalThis.foundry?.utils?.getRoute?.(path) ?? `/${path}`);
        for (const { slug, name, palette, motion, speed } of CHARACTERS) {
            const id = `${MODULE}-${slug}-living`;
            const description = `${name} (Living Inside)`;
            const interior = { palette, motion, speed, mark: `${ASSETS}/marks/${slug}.png` };
            api.addSystem({ id, name: description, group: "MLP Dice" });
            void api.addColorset({
                name: id, description, foreground: "#fff8ee", background: palette[1],
                outline: palette[0], visibility: "hidden",
            });
            for (const type of TYPES) {
                const labels = labelsFor(type, `${ASSETS}/crests/${slug}.png`);
                api.addDicePreset({ type, system: id, colorset: id, labels, interior });
            }
        }
    } catch (error) {
        console.warn("Quick Toss | Could not register MLP Dice Living Insides", error);
    }
}
