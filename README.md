# Quick Toss

Quick Toss is a lightweight 3D dice display for Foundry Virtual Tabletop v14. Foundry determines every roll. Quick Toss animates the resulting dice for about three quarters of a second, then reveals the chat card when the dice settle. Players can choose their own dice from supported Dice So Nice presets, themes, and textures registered by active skin modules.

## Install in Foundry

1. On Foundry's setup screen, open **Add-on Modules → Install Module**.
2. Paste this URL into the **Manifest URL** field and click **Install**.

   ```text
   https://github.com/Nuku/quick-toss/releases/latest/download/module.json
   ```

3. In your world, open **Manage Modules** and activate **Quick Toss**. Deactivate Dicer and Dice So Nice. Keep your dice skin modules active.

The [latest GitHub release](https://github.com/Nuku/quick-toss/releases/latest) also provides a ZIP for manual installation. Extract it so `Data/modules/quick-toss/module.json` exists.

## Choose dice

Open **Configure Settings → Module Settings → Quick Toss** and pick a **Dice preset**, **Dice theme**, or **Dice texture**. These choices are saved per player per world. Other players see the roller's selection when they can see the roll.

The settings show one still of the current selection and its palette. Living Inside previews use the landing frame. Each still is generated on demand and cached for the session.

Use **Dice size (%)** to set the size of dice on your screen from 50% to 150%. The preview resizes as you move the slider. Large rolls may use smaller dice to fit your screen.

**Animate dice** is a per-device option. Browser reduced-motion preferences disable tosses automatically.

Dice clatter during the toss and follow Foundry's **Interface** volume. Once the chat card appears, the settled dice linger for about two seconds. [Sound credits](assets/SOUND-CREDITS.md)

## Skin compatibility

**Living Inside** presets are available from active copies of MLP Dice, Pony Pantheon, From the Ashes, and Best of the Best. Quick Toss uses the packs’ artwork and simplified animated interiors. Each interior freezes as its die lands and keeps that frame until the die disappears, even if another roll starts.

Quick Toss fires `diceSoNiceInit` and `diceSoNiceReady` with a lightweight registration API. It reads model presets, text and image faces, color palettes, background textures, and TexturePacker atlases registered by active add-ons. A set that only supplies a d20 can be selected alongside the default dice for other sizes. Add-ons that explicitly require Dice So Nice to be *active* may not register with Quick Toss.

Model art uses static lighting and simplified materials. Add-on shader callbacks, animation clips, physical collisions, and special effects are outside the renderer. Cold or unavailable assets can fall back to a numbered die on a toss. Once assets are cached, subsequent rolls can use them. Very large throws show up to 16 dice and an omitted-dice count. Foundry's card still shows the full result.

Quick Toss uses Foundry's normal chat visibility. It animates new cards and rolls appended to a previously seen card. It exposes `game.dice3d.waitFor3DAnimationByMessageID(id)` and emits `diceSoNiceRollComplete` for gated cards. Its `showForRoll` API renders on the calling client.

## Development

### Registering a Living Inside preset

Any active add-on can register a Quick Toss interior through `diceSoNiceReady`. Check `dice3d.supportsLivingInteriors`, register a system with `addSystem`, and include an `interior` object in each procedural `addDicePreset` call.

```js
Hooks.once("diceSoNiceReady", (dice3d) => {
    if (!dice3d.supportsLivingInteriors) return;
    dice3d.addSystem({ id: "my-pack-interior", name: "My Pack (Living Inside)" });
    dice3d.addDicePreset({
        type: "d20",
        system: "my-pack-interior",
        interior: {
            palette: ["#171128", "#61388A", "#EBA8FF"],
            motion: "motes",
            speed: 0.8,
            mark: "modules/my-pack/assets/sigil.png",
        },
    });
});
```

The palette contains the shadow, body color, and highlight. The optional motion is one of `arcana`, `motes`, `prism`, `smoke`, or `vortices`. The optional speed controls how far the effect advances during the toss. The optional mark is a transparent image. Packs that only register Dicer shader callbacks need an adapter or a data registration like this.

Run `npm ci`, `npm run build`, and `npm test`. Set `QUICK_TOSS_BROWSER` to a Chromium browser executable to add the WebGL smoke test, which uses the adjacent `mlp-dice` checkout as an actual skin pack. Set `QUICK_TOSS_FOUNDRY_APP` to your Foundry v14 `resources/app` directory to also verify playback using Foundry's audio classes. With all three supported Ponyfinder packs installed, set `QUICK_TOSS_FOUNDRY_MODULES` to your Foundry `Data/modules` directory to test their presets too.

[Dice So Nice customization API](https://riccisi.gitlab.io/foundryvtt-dice-so-nice/api/customization/) · [Foundry chat render hook](https://foundryvtt.com/api/v14/functions/hookEvents.renderChatMessageHTML.html)
