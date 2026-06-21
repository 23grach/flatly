const RESULT_GAP = 24
const SETTINGS_STORAGE_KEY = 'flatly.settings.v1'
const DEFAULT_GROUP_NAME = 'Flatly source layers'
const SETTINGS_COMMAND = 'settings'
const DOUBLE_SIZE_FLATTEN_COMMAND = 'double-size-flatten'
const SETTINGS_UI_WIDTH = 360
const SETTINGS_UI_HEIGHT = 620
const FIGMA_IMAGE_MAX_DIMENSION = 4096
const DEFAULT_RESULT_SCALE = 1
const DOUBLE_SIZE_RESULT_SCALE = 2

type SourcePlacement = 'inside' | 'beside'
type ExportScale = 1 | 2 | 3 | 4

type FlatlySettings = {
  preserveOriginals: boolean
  placement: SourcePlacement
  groupInside: boolean
  groupName: string
  flattenScale: ExportScale
  addExportSettings: boolean
  exportScale: ExportScale
}

type Bounds = {
  x: number
  y: number
  width: number
  height: number
}

type FlattenedExport = {
  node: FlattenableNode
  imageHash: string
  bounds: Bounds
  scale: number
}

type FlattenableNode = FrameNode | ComponentNode | InstanceNode
type InPlaceFlattenableNode = FrameNode | ComponentNode
type SourceContainerNode = FrameNode | ComponentNode

const DEFAULT_SETTINGS: FlatlySettings = {
  preserveOriginals: true,
  placement: 'inside',
  groupInside: true,
  groupName: DEFAULT_GROUP_NAME,
  flattenScale: 4,
  addExportSettings: false,
  exportScale: 4,
}

class UserVisibleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserVisibleError'
  }
}

function closeWithMessage(message: string): void {
  figma.closePlugin(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeScale(value: unknown, fallback: ExportScale): ExportScale {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : fallback
}

function normalizeSettings(value: unknown): FlatlySettings {
  const settings = isRecord(value) ? value : {}
  const preserveOriginals =
    typeof settings.preserveOriginals === 'boolean' ? settings.preserveOriginals : DEFAULT_SETTINGS.preserveOriginals
  const placement = settings.placement === 'inside' || settings.placement === 'beside' ? settings.placement : DEFAULT_SETTINGS.placement
  const groupInside = typeof settings.groupInside === 'boolean' ? settings.groupInside : DEFAULT_SETTINGS.groupInside
  const rawGroupName = typeof settings.groupName === 'string' ? settings.groupName.trim() : DEFAULT_SETTINGS.groupName
  const groupName = rawGroupName.length > 0 ? rawGroupName : DEFAULT_SETTINGS.groupName
  const flattenScale = normalizeScale(settings.flattenScale, DEFAULT_SETTINGS.flattenScale)
  const addExportSettings =
    typeof settings.addExportSettings === 'boolean' ? settings.addExportSettings : DEFAULT_SETTINGS.addExportSettings
  const exportScale = normalizeScale(settings.exportScale, DEFAULT_SETTINGS.exportScale)

  return {
    preserveOriginals,
    placement,
    groupInside,
    groupName,
    flattenScale,
    addExportSettings,
    exportScale,
  }
}

async function loadSettings(): Promise<FlatlySettings> {
  try {
    const storedSettings = await figma.clientStorage.getAsync(SETTINGS_STORAGE_KEY)
    return normalizeSettings(storedSettings)
  } catch (_error) {
    return DEFAULT_SETTINGS
  }
}

async function saveSettings(settings: unknown): Promise<FlatlySettings> {
  const normalizedSettings = normalizeSettings(settings)
  await figma.clientStorage.setAsync(SETTINGS_STORAGE_KEY, normalizedSettings)
  return normalizedSettings
}

function isFlattenableNode(node: SceneNode): node is FlattenableNode {
  return node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE'
}

function isInPlaceFlattenableNode(node: FlattenableNode): node is InPlaceFlattenableNode {
  return node.type === 'FRAME' || node.type === 'COMPONENT'
}

function isSourceLayersGroup(node: SceneNode, groupName: string): node is GroupNode {
  return node.type === 'GROUP' && node.name === groupName
}

function hasSelectedAncestor(node: FlattenableNode, selectedNodeIds: Set<string>): boolean {
  let parent = node.parent

  while (parent !== null) {
    if (selectedNodeIds.has(parent.id)) {
      return true
    }

    parent = parent.parent
  }

  return false
}

function validateSelection(selection: readonly SceneNode[]): FlattenableNode[] | null {
  if (selection.length === 0) {
    closeWithMessage('Select one or more frames, components, or instances to flatten.')
    return null
  }

  if (!selection.every(isFlattenableNode)) {
    closeWithMessage('Flatten only supports selected frames, main components, and instances. Remove unsupported layers from the selection.')
    return null
  }

  const nodes = [...selection]
  const selectedNodeIds = new Set(nodes.map((node) => node.id))
  const hasNestedNodeSelection = nodes.some((node) => hasSelectedAncestor(node, selectedNodeIds))

  if (hasNestedNodeSelection) {
    closeWithMessage('Select independent frames, components, or instances only. Do not select both a parent and a nested node.')
    return null
  }

  return nodes
}

function transformPoint(transform: Transform, x: number, y: number): Vector {
  return {
    x: transform[0][0] * x + transform[0][1] * y + transform[0][2],
    y: transform[1][0] * x + transform[1][1] * y + transform[1][2],
  }
}

function getTransformedBounds(node: FlattenableNode | SourceContainerNode): Bounds {
  const transform = node.relativeTransform
  const points = [
    transformPoint(transform, 0, 0),
    transformPoint(transform, node.width, 0),
    transformPoint(transform, 0, node.height),
    transformPoint(transform, node.width, node.height),
  ]
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)

  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, 0.01),
    height: Math.max(maxY - minY, 0.01),
  }
}

function getEffectiveFlattenScale(bounds: Bounds, requestedScale: ExportScale): number {
  const maxDimension = Math.max(bounds.width, bounds.height)

  if (maxDimension <= 0) {
    return requestedScale
  }

  return Math.min(requestedScale, FIGMA_IMAGE_MAX_DIMENSION / maxDimension)
}

function formatScale(scale: number): string {
  return `${Number(scale.toFixed(2))}x`
}

function getFlattenedMessage(exportedFrames: FlattenedExport[], requestedScale: ExportScale): string {
  const nodeLabel = exportedFrames.length === 1 ? 'node' : 'nodes'
  const usesReducedScale = exportedFrames.some((exportedFrame) => exportedFrame.scale < requestedScale)

  if (!usesReducedScale) {
    return `Flattened ${exportedFrames.length} ${nodeLabel} at ${requestedScale}x.`
  }

  const uniqueScaleLabels = [...new Set(exportedFrames.map((exportedFrame) => formatScale(exportedFrame.scale)))]

  if (uniqueScaleLabels.length === 1) {
    return `Flattened ${exportedFrames.length} ${nodeLabel} at ${uniqueScaleLabels[0]} to fit Figma's 4096px image limit.`
  }

  return `Flattened ${exportedFrames.length} ${nodeLabel} at up to ${requestedScale}x. Some layers were reduced to fit Figma's 4096px image limit.`
}

function createIdentityTransform(bounds: Bounds): Transform {
  return [
    [1, 0, bounds.x],
    [0, 1, bounds.y],
  ]
}

function createShiftedTransform(transform: Transform, bounds: Bounds): Transform {
  return [
    [transform[0][0], transform[0][1], transform[0][2] - bounds.x],
    [transform[1][0], transform[1][1], transform[1][2] - bounds.y],
  ]
}

function translateNode(node: FlattenableNode | SourceContainerNode, dx: number, dy: number): void {
  const transform = node.relativeTransform

  node.relativeTransform = [
    [transform[0][0], transform[0][1], transform[0][2] + dx],
    [transform[1][0], transform[1][1], transform[1][2] + dy],
  ]
}

function createExportWrapper(node: FlattenableNode, bounds: Bounds, transform: Transform): FrameNode {
  const wrapper = figma.createFrame()
  let exportClone: FlattenableNode | null = null

  try {
    wrapper.name = `${node.name} Flatly export wrapper`
    wrapper.fills = []
    wrapper.strokes = []
    wrapper.clipsContent = true
    wrapper.resizeWithoutConstraints(bounds.width, bounds.height)
    wrapper.relativeTransform = createIdentityTransform(bounds)
    insertNodeAfter(node, wrapper)

    exportClone = node.clone()
    wrapper.appendChild(exportClone)
    exportClone.relativeTransform = createShiftedTransform(transform, bounds)
  } catch (error) {
    exportClone?.remove()
    wrapper.remove()
    throw error
  }

  return wrapper
}

async function exportNode(node: FlattenableNode, requestedScale: ExportScale): Promise<FlattenedExport> {
  const bounds = getTransformedBounds(node)
  const scale = getEffectiveFlattenScale(bounds, requestedScale)
  const transform = node.relativeTransform
  const exportWrapper = createExportWrapper(node, bounds, transform)

  try {
    const bytes = await exportWrapper.exportAsync({
      format: 'PNG',
      useAbsoluteBounds: true,
      constraint: {
        type: 'SCALE',
        value: scale,
      },
    })
    const image = figma.createImage(bytes)

    return {
      node,
      imageHash: image.hash,
      bounds,
      scale,
    }
  } finally {
    exportWrapper.remove()
  }
}

async function exportNodeWithContext(node: FlattenableNode, scale: ExportScale): Promise<FlattenedExport> {
  try {
    return await exportNode(node, scale)
  } catch (_error) {
    throw new UserVisibleError(`Could not export "${node.name}". Check that this layer can be exported as a PNG.`)
  }
}

function createImageFill(imageHash: string): ImagePaint {
  return {
    type: 'IMAGE',
    imageHash,
    scaleMode: 'FILL',
  }
}

function applyExportSettings(node: SourceContainerNode, settings: FlatlySettings): void {
  if (!settings.addExportSettings) {
    node.exportSettings = []
    return
  }

  node.exportSettings = [
    {
      format: 'PNG',
      constraint: {
        type: 'SCALE',
        value: settings.exportScale,
      },
    },
  ]
}

function insertNodeAfter(sourceNode: SceneNode, insertedNode: SceneNode): void {
  const parent = sourceNode.parent

  if (parent === null) {
    return
  }

  const sourceIndex = parent.children.indexOf(sourceNode)

  if (sourceIndex === -1) {
    parent.appendChild(insertedNode)
  } else {
    parent.insertChild(sourceIndex + 1, insertedNode)
  }
}

function placeNodeBeside(sourceNode: FlattenableNode, placedNode: FlattenableNode | SourceContainerNode): void {
  const sourceBounds = getTransformedBounds(sourceNode)
  const placedBounds = getTransformedBounds(placedNode)
  const targetX = sourceBounds.x + sourceBounds.width + RESULT_GAP
  const targetY = sourceBounds.y

  translateNode(placedNode, targetX - placedBounds.x, targetY - placedBounds.y)
}

function createOriginalCopyBeside(node: FlattenableNode): FlattenableNode {
  const originalCopy = node.clone()
  originalCopy.name = `${node.name} original`
  insertNodeAfter(node, originalCopy)
  placeNodeBeside(node, originalCopy)

  return originalCopy
}

function removeSourceLayers(container: SourceContainerNode): void {
  for (const child of [...container.children]) {
    child.remove()
  }
}

function hideSourceLayers(container: SourceContainerNode): void {
  for (const child of [...container.children]) {
    child.visible = false
  }
}

function preserveSourceLayersInGroup(container: SourceContainerNode, groupName: string): GroupNode | null {
  const children = [...container.children]

  if (children.length === 0) {
    return null
  }

  if (children.length === 1 && isSourceLayersGroup(children[0], groupName)) {
    children[0].visible = false
    return children[0]
  }

  const sourceGroup = figma.group(children, container, 0)
  sourceGroup.name = groupName
  sourceGroup.visible = false

  return sourceGroup
}

function applySourceLayerStrategy(container: SourceContainerNode, settings: FlatlySettings): void {
  if (!settings.preserveOriginals || settings.placement === 'beside') {
    removeSourceLayers(container)
    return
  }

  if (settings.groupInside) {
    preserveSourceLayersInGroup(container, settings.groupName)
    return
  }

  hideSourceLayers(container)
}

function setFlattenedImage(
  container: SourceContainerNode,
  imageHash: string,
  targetBounds: Bounds,
  imageBounds: Bounds,
  settings: FlatlySettings,
): void {
  container.relativeTransform = createIdentityTransform(targetBounds)
  container.resizeWithoutConstraints(imageBounds.width, imageBounds.height)
  container.fills = [createImageFill(imageHash)]
  applyExportSettings(container, settings)
}

function flattenContainer<T extends SourceContainerNode>(container: T, exportedFrame: FlattenedExport, settings: FlatlySettings): T {
  const targetBounds = getTransformedBounds(container)

  applySourceLayerStrategy(container, settings)
  setFlattenedImage(container, exportedFrame.imageHash, targetBounds, exportedFrame.bounds, settings)

  return container
}

function replaceNodeContentsWithImage(exportedFrame: FlattenedExport, settings: FlatlySettings): InPlaceFlattenableNode {
  const { node } = exportedFrame

  if (!isInPlaceFlattenableNode(node)) {
    throw new Error('Only frames and main components can be flattened in place.')
  }

  if (settings.preserveOriginals && settings.placement === 'beside') {
    createOriginalCopyBeside(node)
  }

  return flattenContainer(node, exportedFrame, settings)
}

function createFlattenedFrameNextToInstance(exportedFrame: FlattenedExport, settings: FlatlySettings): FrameNode {
  const { node } = exportedFrame

  if (node.type !== 'INSTANCE') {
    throw new Error('Only instances can be flattened into a new frame.')
  }

  const instanceCopy = node.clone()
  insertNodeAfter(node, instanceCopy)
  placeNodeBeside(node, instanceCopy)

  const resultFrame = instanceCopy.detachInstance()
  resultFrame.name = node.name
  placeNodeBeside(node, resultFrame)

  return flattenContainer(resultFrame, exportedFrame, settings)
}

function flattenInstanceInPlace(exportedFrame: FlattenedExport, settings: FlatlySettings): FrameNode {
  const { node } = exportedFrame

  if (node.type !== 'INSTANCE') {
    throw new Error('Only instances can be flattened in place.')
  }

  if (settings.preserveOriginals && settings.placement === 'beside') {
    createOriginalCopyBeside(node)
  }

  const resultFrame = node.detachInstance()
  resultFrame.name = node.name

  return flattenContainer(resultFrame, exportedFrame, settings)
}

function applyFlattenedExport(exportedFrame: FlattenedExport, settings: FlatlySettings): SourceContainerNode {
  if (exportedFrame.node.type === 'INSTANCE') {
    if (settings.preserveOriginals && settings.placement === 'inside') {
      return createFlattenedFrameNextToInstance(exportedFrame, settings)
    }

    return flattenInstanceInPlace(exportedFrame, settings)
  }

  return replaceNodeContentsWithImage(exportedFrame, settings)
}

function applyFlattenedExportWithContext(exportedFrame: FlattenedExport, settings: FlatlySettings): SourceContainerNode {
  try {
    return applyFlattenedExport(exportedFrame, settings)
  } catch (_error) {
    throw new UserVisibleError(`Could not flatten "${exportedFrame.node.name}". Check the source layer settings and try again.`)
  }
}

async function run(resultScale = DEFAULT_RESULT_SCALE): Promise<void> {
  const nodes = validateSelection(figma.currentPage.selection)

  if (nodes === null) {
    return
  }

  const settings = await loadSettings()
  const progressNotification =
    nodes.length > 1
      ? figma.notify(`Flattening ${nodes.length} layers at ${settings.flattenScale}x...`, {
          timeout: Infinity,
        })
      : null

  try {
    const exportedFrames = await Promise.all(nodes.map((node) => exportNodeWithContext(node, settings.flattenScale)))
    const flattenedNodes: SceneNode[] = []

    for (const exportedFrame of exportedFrames) {
      const flattenedNode = applyFlattenedExportWithContext(exportedFrame, settings)

      if (resultScale !== DEFAULT_RESULT_SCALE) {
        flattenedNode.rescale(resultScale)
      }

      flattenedNodes.push(flattenedNode)
    }

    figma.currentPage.selection = flattenedNodes

    progressNotification?.cancel()
    closeWithMessage(getFlattenedMessage(exportedFrames, settings.flattenScale))
  } catch (error) {
    progressNotification?.cancel()

    if (error instanceof UserVisibleError) {
      closeWithMessage(error.message)
      return
    }

    closeWithMessage('Could not flatten the selected nodes. Check that every selected frame, component, or instance can be exported.')
  }
}

async function showSettings(): Promise<void> {
  const settings = await loadSettings()

  figma.showUI(__html__, {
    width: SETTINGS_UI_WIDTH,
    height: SETTINGS_UI_HEIGHT,
    themeColors: true,
  })

  figma.ui.onmessage = (message: unknown) => {
    if (!isRecord(message) || typeof message.type !== 'string') {
      return
    }

    if (message.type === 'settings-ready') {
      figma.ui.postMessage({
        type: 'settings-loaded',
        settings,
      })
      return
    }

    if (message.type === 'settings-changed') {
      void saveSettings(message.settings)
        .catch(() => {
          figma.notify('Could not save settings.', { error: true })
        })
    }
  }
}

async function main(): Promise<void> {
  if (figma.command === SETTINGS_COMMAND) {
    await showSettings()
    return
  }

  if (figma.command === DOUBLE_SIZE_FLATTEN_COMMAND) {
    await run(DOUBLE_SIZE_RESULT_SCALE)
    return
  }

  await run(DEFAULT_RESULT_SCALE)
}

void main()
