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

**Animate dice** is a per-device option. Browser reduced-motion preferences disable tosses automatically.

Dice clatter during the toss and follow Foundry's **Interface** volume. Once the chat card appears, the settled dice linger for about two seconds. [Sound credits](assets/SOUND-CREDITS.md)

## Skin compatibility

Quick Toss fires `diceSoNiceInit` and `diceSoNiceReady` with a lightweight registration API. It reads model presets, text and image faces, color palettes, background textures, and TexturePacker atlases registered by active add-ons. A set that only supplies a d20 can be selected alongside the default dice for other sizes. Add-ons that explicitly require Dice So Nice to be *active* may not register with Quick Toss.

Model art uses static lighting and simplified materials. Custom shaders, animation clips, physical collisions, and special effects are outside the renderer. Cold or unavailable assets can fall back to a numbered die on a toss. Once assets are cached, subsequent rolls can use them. Very large throws show up to 16 dice and an omitted-dice count. Foundry's card still shows the full result.

Quick Toss uses Foundry's normal chat visibility. It animates new cards and rolls appended to a previously seen card. It exposes `game.dice3d.waitFor3DAnimationByMessageID(id)` and emits `diceSoNiceRollComplete` for gated cards. Its `showForRoll` API renders on the calling client.

## Development

Run `npm ci`, `npm run build`, and `npm test`. Set `QUICK_TOSS_BROWSER` to a Chromium browser executable to add the WebGL smoke test, which uses the adjacent `mlp-dice` checkout as an actual skin pack. Set `QUICK_TOSS_FOUNDRY_APP` to your Foundry v14 `resources/app` directory to also verify playback using Foundry's audio classes.

[Dice So Nice customization API](https://riccisi.gitlab.io/foundryvtt-dice-so-nice/api/customization/) · [Foundry chat render hook](https://foundryvtt.com/api/v14/functions/hookEvents.renderChatMessageHTML.html)
