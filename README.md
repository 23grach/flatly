# Flatly

Flatly is a Figma plugin that rasterizes selected frames, main components, and instances.

When the `Flatten selection` command starts, Flatly exports every selected node as a PNG at your configured flatten scale. The default flatten scale is 4x. Frames and main components are flattened into a single image fill. Instances either keep the current linked instance and create a detached flattened frame nearby, or flatten the selected instance in place, depending on your source-layer settings. After flattening, Figma selects the flattened results and zooms to them. The `Double-size flatten` command uses the same flattening behavior, then scales each flattened result to 200%.

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Build the plugin:

   ```sh
   npm run build
   ```

3. In Figma, open `Plugins > Development > Import plugin from manifest...`.
4. Select `manifest.json` from this folder.

## Usage

1. Select one or more independent frames, main components, or instances in Figma.
2. Run `Plugins > Development > Flatly > Flatten selection`, or run `Double-size flatten` to flatten and scale the results to 200%.
3. Each flattened result becomes one rasterized image fill. Optional PNG export presets can be enabled in settings.

Use `Plugins > Development > Flatly > Settings` to choose what happens to the original editable layers before flattening. Settings are saved automatically as you change them.

## Validation

The plugin makes no changes and shows a message when:

- nothing is selected;
- any selected layer is not a frame, main component, or instance;
- both a parent node and one of its nested nodes are selected.

Regular frames, main components, and instances are supported in this version. Component sets, groups, and sections are intentionally ignored.

## Scale and Export Settings

Flatly uses 4x as the default flatten scale. This controls the maximum rasterization quality used while flattening layers. If the selected layer would create a PNG larger than Figma's 4096px image limit, Flatly automatically uses the highest lower scale that fits.

Flattened results bake the selected layer's transform into the image fill, so rotated or mirrored layers keep the same visual appearance while the flattened frame uses an unrotated transform.

Export presets are optional and off by default. Enable `Add export settings` when you want flattened results to receive a PNG export preset. The export preset scale is configured separately from the flatten scale, so changing `Export at` does not change rasterization quality.

## Source Layer Settings

By default, Flatly keeps editable source layers inside each flattened result. The default setup matches the previous behavior: source layers are moved into a hidden `Flatly source layers` group.

The settings window saves changes automatically and lets you choose:

- the flatten scale used while rasterizing selected layers;
- whether to add a PNG export preset to flattened results;
- the PNG export preset scale;
- whether to keep original editable layers;
- whether originals stay inside the flattened layer or are copied next to the selected layer;
- whether inside originals are wrapped in a hidden group;
- the hidden group name.

For frames and main components, `Next to selected layer` copies the original layer nearby, then replaces the selected layer with the flattened image. For instances, the default inside mode keeps the linked instance unchanged and creates a detached flattened frame nearby. If originals are disabled, or if `Next to selected layer` is selected, the selected instance is detached and flattened in place.

Settings are stored locally with Figma `clientStorage` under `flatly.settings.v1`. Flatly still makes no network requests and `networkAccess.allowedDomains` remains `none`.

## Development

Build TypeScript into the `code.js` file referenced by `manifest.json`:

```sh
npm run build
```

Run lint checks:

```sh
npm run lint
```
