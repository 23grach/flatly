# Flatly

Flatly turns selected Figma frames, main components, and instances into PNG-backed layers. It calculates the export resolution for each layer, then applies the result according to your source-layer setting.

## Install for development

1. Install dependencies:

   ```sh
   npm install
   ```

2. Build the plugin:

   ```sh
   npm run build
   ```

3. In Figma, open `Plugins > Development > Import plugin from manifest...`.
4. Select this project's `manifest.json`.

## Flatten a selection

1. Select one or more independent frames, main components, or instances.
2. Run `Plugins > Development > Flatly > Flatten`.
3. Flatly exports each selected layer as a PNG and applies it as one image fill.

For frames and main components, Flatly replaces the selected layer's contents with the image. For instances, the default mode keeps the linked instance and creates a detached flattened frame beside it.

## Source layer settings

Open `Plugins > Development > Flatly > Settings`, then choose an option under `Original layers`. Settings can be opened without a selection and are saved locally between runs.

| Option | Frames and main components | Instances |
| --- | --- | --- |
| `Keep original layers inside the result` (default) | Keep child layers in a hidden `Flatly source layers` group inside the flattened layer. | Keep the linked instance and create a detached flattened frame beside it. |
| `Keep original layers beside the result` | Copy the original layer beside the result, then flatten the selected layer in place. | Copy the linked instance beside the result, then detach and flatten the selected instance in place. |
| `Remove original layers` | Remove child layers and flatten the selected layer in place. | Detach the instance, remove its child layers, and flatten it in place. |

Copies kept beside the result use the original name followed by ` — original` and are placed 24px away.

## Automatic resolution

Flatly calculates the largest export scale that keeps the longest transformed dimension at or below 4096px. Smaller layers can be upscaled automatically, up to 24x. A 4-million-pixel budget can lower the scale for larger layers. The other dimension keeps its aspect ratio.

There is no resolution picker or saved scale setting. Flatly also bakes the source transform into the image, so rotated and mirrored layers keep their visual appearance in the flattened result.

## Supported selections

Flatly supports regular frames, main components, and instances. It does not flatten groups, component sets, sections, or other layer types.

Select independent layers only. Flatly rejects a selection that contains both a parent and one of its nested supported layers, and it leaves the document unchanged when the selection is invalid.

If one layer cannot be exported or flattened, Flatly reports the failure and keeps that layer unchanged. Other valid layers in the same selection can still finish.

## Development

Build the TypeScript entry point referenced by `manifest.json`:

```sh
npm run build
```

Run lint checks:

```sh
npm run lint
```

Run tests:

```sh
npm test
```

Run the complete release check:

```sh
npm run verify
```

Flatly runs only in Figma Design and requests no network access.
