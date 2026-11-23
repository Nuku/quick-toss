import assert from "node:assert/strict";
import test from "node:test";
import { createCatalog, getFace, getResultFace } from "../scripts/catalog.js";
import { getDice } from "../scripts/results.js";

test("uses evaluated faces and fits complete percentile pairs within the visual cap", () => {
    const rolls = [{ dice: [
        { faces: 20, denomination: "d20", results: [{ result: 18 }, { result: 3, active: false }] },
        { faces: 100, denomination: "d100", results: [{ result: 100 }, { result: 37 }] },
    ] }];
    const snapshot = structuredClone(rolls);
    const { dice, count } = getDice(rolls, 5);
    assert.equal(count, 4);
    assert.deepEqual(dice.map(({ type, value }) => [type, value]),
        [["d20", 18], ["d20", 3], ["d100", 0], ["d10", 10]]);
    assert.equal(dice[1].discarded, true);
    assert.equal(dice[2].pair, dice[3].pair);
    assert.equal(getFace(null, dice[2], getResultFace(dice[2])), "00");
    assert.equal(getFace(null, dice[3], getResultFace(dice[3])), "0");
    assert.deepEqual(rolls, snapshot);
});

test("resolves coin, Fate, and nonsequential custom labels", () => {
    const { dice } = getDice([{ dice: [
        { faces: 2, denomination: "c", results: [{ result: 0 }, { result: 1 }] },
        { faces: 3, denomination: "f", results: [{ result: -1 }, { result: 1 }] },
        { faces: 6, denomination: "dcustom", results: [{ result: 12 }] },
    ] }]);
    assert.deepEqual(dice.slice(0, 4).map((die) => getFace(null, die, getResultFace(die))), ["T", "H", "−", "+"]);
    const preset = { values: { min: 10 }, valueMap: { 12: 2 }, labels: ["One", "Two"] };
    assert.equal(getFace(preset, dice[4], getResultFace(dice[4], preset)), "Two");
});

test("discovers grouped presets, theme defaults, art, and per-player overrides", async () => {
    const catalog = createCatalog();
    const api = catalog.api;
    api.addSystem(new api.DiceSystem("custom", "Style", "default", "Creator"));
    api.addDicePreset({ type: "d20", system: "custom", modelFile: "d20.glb", colorset: "embedded" });
    await api.addColorset({ name: "embedded", visibility: "hidden", background: "#123" });
    await api.addColorset({ name: "fancy", description: "Fancy", background: "#789", texture: "grain" });
    await api.addTexture("grain", { source: "grain.png" });
    assert.deepEqual(catalog.choices((value) => value).system, { standard: "Standard", custom: "Creator · Style" });
    assert.equal(catalog.choices((value) => value).colorset.embedded, undefined);
    const die = { type: "d20", value: 20 };
    assert.equal(catalog.resolve(die, { system: "custom" }).theme.background, "#123");
    const override = catalog.resolve(die, { system: "custom", colorset: "fancy" });
    assert.equal(override.preset.modelFile, "d20.glb");
    assert.equal(override.texture.source, "grain.png");
    assert.equal(catalog.resolve({ type: "d6" }, { system: "custom" }).preset, undefined);

    assert.equal(api.supportsLivingInteriors, true);
    const interior = { palette: ["#20133e", "#6340a2", "#f18cd8"], motion: "motes", speed: 0.8 };
    api.addDicePreset({ type: "d20", system: "portable-interior", interior });
    assert.equal(api.hasLivingInterior("portable-interior"), true);
    assert.deepEqual(catalog.resolve(die, { system: "portable-interior" }).preset.interior, interior);
    api.addDicePreset({ type: "d20", system: "invalid-interior", interior: { palette: ["red"] } });
    assert.equal(api.hasLivingInterior("invalid-interior"), false);
});
