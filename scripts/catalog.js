const standard = "standard";
const noop = () => {};
const done = async () => {};

class DiceSystem {
    static DICE_EVENT_TYPE = Object.freeze({
        SPAWN: "spawn", CLICK: "click", RESULT: "result", COLLIDE: "collide", DESPAWN: "despawn",
    });

    constructor(id, name, mode, group) {
        Object.assign(this, { id, name, group });
    }

    on = noop;
    registerBeforeShaderCompileCallback = noop;
    addSettingBoolean = noop;
    addSettingColor = noop;
    addSettingFile = noop;
    addSettingRange = noop;
    addSettingSelect = noop;
    addSettingString = noop;
    addSettingSeparator = noop;
    addSettingHTML = noop;
}

export function createCatalog(onChange = noop) {
    const systems = new Map();
    const presets = new Map();
    const colorsets = new Map();
    const textures = new Map();
    const shapes = new Map();

    const api = {
        DiceSystem,
        addSystem(system) {
            if (typeof system?.id !== "string") return;
            systems.set(system.id, system);
            onChange();
        },
        addDicePreset(preset, shape) {
            if (typeof preset?.type !== "string") return;
            const system = preset.system || standard;
            if (!presets.has(system)) presets.set(system, new Map());
            presets.get(system).set(preset.type, { ...preset, shape: shape || preset.shape });
            onChange();
        },
        async addColorset(colorset) {
            if (typeof colorset?.name !== "string") return;
            colorsets.set(colorset.name, { ...colorset });
            onChange();
        },
        async addTexture(id, texture) {
            if (typeof id !== "string" || !texture) return;
            textures.set(id, { ...texture });
            onChange();
        },
        addDiceShape(shape) {
            if (typeof shape?.name === "string") shapes.set(shape.name, shape);
        },
        preloadPresets: done,
        setRoleDefaults: noop,
        addRole: noop,
        addDamageTypeDefaults: noop,
        addSFXTrigger: noop,
        addSFXMode: noop,
        addSFXDefault: noop,
        addSFXDefaults: noop,
    };

    return {
        api,
        choices(localize) {
            const systemChoices = [[standard, "Standard"]];
            for (const [id, dice] of presets) {
                if (id === standard || !dice.size) continue;
                const entry = systems.get(id);
                const name = localize(entry?.name ?? id);
                systemChoices.push([id, entry?.group ? `${localize(entry.group)} · ${name}` : name]);
            }
            const byName = ([, a], [, b]) => a.localeCompare(b);
            return {
                system: Object.fromEntries([systemChoices[0], ...systemChoices.slice(1).sort(byName)]),
                colorset: Object.fromEntries([
                    ["", "Preset default"],
                    ...Array.from(colorsets)
                        .filter(([, theme]) => theme.visibility !== "hidden")
                        .map(([id, theme]) => [id, localize(theme.description ?? id)]).sort(byName),
                ]),
                texture: Object.fromEntries([["", "Preset default"], ...Array.from(textures, ([id, data]) =>
                    [id, localize(data.name ?? id)]).sort(byName)]),
            };
        },
        resolve(die, appearance = {}) {
            appearance ??= {};
            const preset = presets.get(appearance.system)?.get(die.type)
                ?? presets.get(standard)?.get(die.type);
            const theme = colorsets.get(appearance.colorset) ?? colorsets.get(preset?.colorset) ?? {};
            const textureId = appearance.texture || (Array.isArray(theme.texture)
                ? theme.texture[Math.floor(Math.random() * theme.texture.length)] : theme.texture);
            const texture = textures.get(textureId);
            return { preset, theme, texture, shape: shapes.get(preset?.shape) };
        },
    };
}

export function getFace(preset, die, index) {
    const type = die.type;
    const value = type === "d100" ? index % 10 * 10 : index + (preset?.values?.min ?? 1) - 1;
    const fallback = die.coin ? (value === 1 ? "T" : "H") : type === "d100" ? String(value).padStart(2, "0")
        : type === "d10" && die.percentile ? String(value % 10) : String(value);
    // Fudge dice have three values. Opposite cube faces carry the same symbol.
    if (type === "df" && !preset?.labels?.length) return ["−", "0", "+"][(index - 1) % 3];
    const label = preset?.labels;
    if (Array.isArray(label)) return label[index - 1] ?? fallback;
    if (typeof label === "string" && label && index === 1) return label;
    return fallback;
}

export function getResultFace(die, preset) {
    const mapped = preset?.valueMap && Object.hasOwn(preset.valueMap, die.value)
        ? preset.valueMap[die.value] : null;
    if (Number.isInteger(mapped) && mapped >= 1) return mapped;
    if (die.type === "d100") return die.value === 0 ? 10 : die.value / 10;
    if (die.type === "df") return die.value + 2;
    return die.value - (preset?.values?.min ?? 1) + 1;
}
