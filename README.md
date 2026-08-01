# Flatly

Flatly is a Figma plugin that rasterizes selected frames, main components, and instances.

When Flatly runs, it exports every selected node as a PNG at maximum resolution. The largest image dimension is 4096px. Frames and main components are flattened into a single image fill. Instances either keep the current linked instance and create a detached flattened frame nearby, or flatten the selected instance in place, depending on your source-layer settings. After flattening, Figma selects the flattened results and zooms to them.

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
2. Run `Plugins > Development > Flatly > Flatten`.
3. Each flattened result becomes one rasterized image fill.

Use `Plugins > Development > Flatly > Settings` to configure what happens to the original editable layers before flattening. Choose one of the three native options:

- `Keep original layers / Inside`;
- `Keep original layers / Beside`;
- `Remove original layers`.

Settings are saved when you finish the native Figma parameter flow. Removing original layers no longer asks for a placement.

## Validation

The plugin makes no changes and shows a message when:

- nothing is selected;
- any selected layer is not a frame, main component, or instance;
- both a parent node and one of its nested nodes are selected.

Regular frames, main components, and instances are supported in this version. Component sets, groups, and sections are intentionally ignored.

## Flatten Resolution

Flatly sizes each rasterized image up to the maximum resolution Figma supports. The largest image dimension is 4096px, and the other dimension keeps the layer's aspect ratio. Small layers are automatically upscaled by no more than 32x. Flatly does not show or store a scale choice.

Flattened results bake the selected layer's transform into the image fill, so rotated or mirrored layers keep the same visual appearance while the flattened frame uses an unrotated transform.

## Source Layer Settings

By default, Flatly keeps editable source layers inside each flattened result. The default setup matches the previous behavior: source layers are moved into a hidden `Flatly source layers` group.

The native `Settings` command lets you choose whether to keep original editable layers and, when they are kept, where they stay.

When originals stay inside the flattened result, Flatly always wraps them in a hidden group named `Flatly source layers`. The group name and grouping behavior are fixed.

For frames and main components, `Beside` copies the original layer nearby, then replaces the selected layer with the flattened image. For instances, the default inside mode keeps the linked instance unchanged and creates a detached flattened frame nearby. If originals are disabled, or if `Beside` is selected, the selected instance is detached and flattened in place.

Settings are stored locally with Figma `clientStorage` under `flatly.settings.v1`, so they remain available between plugin runs. Flatly still makes no network requests and `networkAccess.allowedDomains` remains `none`.

## Development

Build TypeScript into the `code.js` file referenced by `manifest.json`:

```sh
npm run build
```

Run lint checks:

```sh
npm run lint
```
