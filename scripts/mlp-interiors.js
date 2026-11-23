import { registerInteriorSet } from "./interior-presets.js";

const MODULE = "mlp-dice";
const ASSETS = `modules/${MODULE}/assets/dice`;

export async function registerMlpInteriors(api) {
    if (!game.modules.get(MODULE)?.active) return;
    const path = `modules/${MODULE}/scripts/catalog.js`;
    try {
        const { CHARACTERS } = await import(globalThis.foundry?.utils?.getRoute?.(path) ?? `/${path}`);
        for (const { slug, name, palette, motion, speed } of CHARACTERS) {
            registerInteriorSet(api, {
                id: `${MODULE}-${slug}-living`, name: `${name} (Living Inside)`, group: "MLP Dice",
                foreground: "#fff8ee", label: `${ASSETS}/crests/${slug}.png`,
                interior: { palette, motion, speed, mark: `${ASSETS}/marks/${slug}.png` },
            });
        }
    } catch (error) {
        console.warn("Quick Toss | Could not register MLP Dice Living Insides", error);
    }
}
