const RESULT_GAP = 24
const SETTINGS_STORAGE_KEY = 'flatly.settings.v1'
const DEFAULT_GROUP_NAME = 'Flatly source layers'
const FIGMA_IMAGE_MAX_DIMENSION = 4096
const FLATTEN_COMMAND = 'flatten'
const SETTINGS_COMMAND = 'settings'
const SETTINGS_PARAMETER_KEY = 'settings'

type SourcePlacement = 'inside' | 'beside'
type NativeSettingsChoice = 'keep-inside' | 'keep-beside' | 'remove'

type FlatlySettings = {
  preserveOriginals: boolean
  placement: SourcePlacement
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
}

type FlattenableNode = FrameNode | ComponentNode | InstanceNode
type InPlaceFlattenableNode = FrameNode | ComponentNode
type SourceContainerNode = FrameNode | ComponentNode

type FlattenFailurePhase = 'export' | 'flatten'
type FlattenFailureOperation =
  | 'export'
  | 'read-bounds'
  | 'create-original-copy'
  | 'create-detached-frame'
  | 'place-result'
  | 'detach-instance'
  | 'configure-result'
  | 'preserve-source-layers'
  | 'remove-source-layers'
  | 'resize-result'
  | 'set-image'
  | 'flatten'

type SettledResult<T> =
  | {
      status: 'fulfilled'
      value: T
    }
  | {
      status: 'rejected'
      reason: unknown
    }

const FAILURE_OPERATION_MESSAGES: Record<FlattenFailureOperation, string> = {
  export: 'Could not export this layer as a PNG',
  'read-bounds': 'Could not read this layer\'s bounds',
  'create-original-copy': 'Could not create the original copy',
  'create-detached-frame': 'Could not create the detached frame',
  'place-result': 'Could not place the flattened result',
  'detach-instance': 'Could not detach the instance',
  'configure-result': 'Could not configure the flattened result',
  'preserve-source-layers': 'Could not preserve the source layers',
  'remove-source-layers': 'Could not remove the source layers',
  'resize-result': 'Could not resize the flattened result',
  'set-image': 'Could not set the flattened image',
  flatten: 'Could not flatten this layer',
}

const DEFAULT_SETTINGS: FlatlySettings = {
  preserveOriginals: true,
  placement: 'inside',
}

class FlattenFailure extends Error {
  readonly sourceNode: FlattenableNode
  readonly nodeId: string
  readonly nodeName: string
  readonly nodeType: FlattenableNode['type']
  readonly phase: FlattenFailurePhase
  readonly operation: FlattenFailureOperation
  readonly cause: unknown

  constructor(node: FlattenableNode, phase: FlattenFailurePhase, operation: FlattenFailureOperation, cause: unknown) {
    super(`${FAILURE_OPERATION_MESSAGES[operation]} for "${node.name}".`)
    this.name = 'FlattenFailure'
    this.sourceNode = node
    this.nodeId = node.id
    this.nodeName = node.name
    this.nodeType = node.type
    this.phase = phase
    this.operation = operation
    this.cause = cause
  }
}

function asFlattenFailure(
  error: unknown,
  node: FlattenableNode,
  phase: FlattenFailurePhase,
  operation: FlattenFailureOperation,
): FlattenFailure {
  if (error instanceof FlattenFailure) {
    return error
  }

  return new FlattenFailure(node, phase, operation, error)
}

function withFailureContext<T>(
  node: FlattenableNode,
  operation: FlattenFailureOperation,
  callback: () => T,
): T {
  try {
    return callback()
  } catch (error) {
    throw asFlattenFailure(error, node, 'flatten', operation)
  }
}

function settlePromise<T>(promise: Promise<T>): Promise<SettledResult<T>> {
  return promise.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason }),
  )
}

function logFlattenFailure(failure: FlattenFailure): void {
  console.error('[Flatly] Flattening failed.', {
    cause: failure.cause,
    nodeId: failure.nodeId,
    nodeName: failure.nodeName,
    nodeType: failure.nodeType,
    operation: failure.operation,
    phase: failure.phase,
  })
}

function closeWithMessage(message: string): void {
  figma.closePlugin(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type ParameterSuggestion = {
  name: string
  data: NativeSettingsChoice
}

function filterSuggestions(suggestions: readonly ParameterSuggestion[], query: string): ParameterSuggestion[] {
  const normalizedQuery = query.trim().toLowerCase()

  if (normalizedQuery.length === 0) {
    return [...suggestions]
  }

  return suggestions.filter((suggestion) => suggestion.name.toLowerCase().includes(normalizedQuery))
}

const NATIVE_SETTINGS_OPTIONS: ReadonlyArray<{
  name: string
  data: NativeSettingsChoice
  preserveOriginals: boolean
  placement: SourcePlacement
}> = [
  {
    name: 'Keep original layers / Inside',
    data: 'keep-inside',
    preserveOriginals: true,
    placement: 'inside',
  },
  {
    name: 'Keep original layers / Beside',
    data: 'keep-beside',
    preserveOriginals: true,
    placement: 'beside',
  },
  {
    name: 'Remove original layers',
    data: 'remove',
    preserveOriginals: false,
    placement: 'inside',
  },
]

function getNativeSettingsChoice(settings: Pick<FlatlySettings, 'preserveOriginals' | 'placement'>): NativeSettingsChoice {
  if (!settings.preserveOriginals) {
    return 'remove'
  }

  return settings.placement === 'inside' ? 'keep-inside' : 'keep-beside'
}

function getNativeSettingsSuggestions(preferredChoice: NativeSettingsChoice, query = ''): ParameterSuggestion[] {
  const orderedOptions = [
    ...NATIVE_SETTINGS_OPTIONS.filter((option) => option.data === preferredChoice),
    ...NATIVE_SETTINGS_OPTIONS.filter((option) => option.data !== preferredChoice),
  ]
  const suggestions = orderedOptions.map(({ name, data }) => ({ name, data }))

  return filterSuggestions(suggestions, query)
}

function parseNativeSettingsChoice(value: unknown): NativeSettingsChoice | null {
  return value === 'keep-inside' || value === 'keep-beside' || value === 'remove' ? value : null
}

function parsePlacement(value: unknown, fallback: SourcePlacement): SourcePlacement {
  return value === 'inside' || value === 'beside' ? value : fallback
}

function normalizeSettings(value: unknown): FlatlySettings {
  const settings = isRecord(value) ? value : {}
  const preserveOriginals =
    typeof settings.preserveOriginals === 'boolean' ? settings.preserveOriginals : DEFAULT_SETTINGS.preserveOriginals
  const placement = parsePlacement(settings.placement, DEFAULT_SETTINGS.placement)

  return {
    preserveOriginals,
    placement,
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
  const errorMessage = getSelectionError(selection)

  if (errorMessage !== null) {
    closeWithMessage(errorMessage)
    return null
  }

  return selection.filter(isFlattenableNode)
}

function getSelectionError(selection: readonly SceneNode[]): string | null {
  if (selection.length === 0) {
    return 'Select one or more frames, components, or instances to flatten.'
  }

  if (!selection.every(isFlattenableNode)) {
    return 'Flatten only supports selected frames, main components, and instances. Remove unsupported layers from the selection.'
  }

  const nodes = selection.filter(isFlattenableNode)
  const selectedNodeIds = new Set(nodes.map((node) => node.id))

  if (nodes.some((node) => hasSelectedAncestor(node, selectedNodeIds))) {
    return 'Select independent frames, components, or instances only. Do not select both a parent and a nested node.'
  }

  return null
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

function getMaximumFlattenScale(bounds: Bounds): number {
  const maxDimension = Math.max(bounds.width, bounds.height)

  if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
    return 1
  }

  return FIGMA_IMAGE_MAX_DIMENSION / maxDimension
}

function getFlattenedMessage(nodeCount: number): string {
  const nodeLabel = nodeCount === 1 ? 'node' : 'nodes'
  return `Flattened ${nodeCount} ${nodeLabel}.`
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

function neutralizeExportClone(node: FlattenableNode): void {
  // The bitmap owns the node's fills and descendants. Keep node-level presentation on the result.
  node.opacity = 1
  node.strokes = []
  node.effects = []
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
    neutralizeExportClone(exportClone)
    exportClone.relativeTransform = createShiftedTransform(transform, bounds)
  } catch (error) {
    exportClone?.remove()
    wrapper.remove()
    throw error
  }

  return wrapper
}

async function exportNode(node: FlattenableNode): Promise<FlattenedExport> {
  const bounds = getTransformedBounds(node)
  const scale = getMaximumFlattenScale(bounds)
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
    }
  } finally {
    exportWrapper.remove()
  }
}

async function exportNodeWithContext(node: FlattenableNode): Promise<FlattenedExport> {
  try {
    return await exportNode(node)
  } catch (error) {
    throw asFlattenFailure(error, node, 'export', 'export')
  }
}

function createImageFill(imageHash: string): ImagePaint {
  return {
    type: 'IMAGE',
    imageHash,
    scaleMode: 'FILL',
  }
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

function preserveSourceLayersInGroup(container: SourceContainerNode): void {
  const children = [...container.children]

  if (children.length === 0) {
    return
  }

  const existingWrapper = children[0]

  if (
    children.length === 1 &&
    existingWrapper.type === 'GROUP' &&
    existingWrapper.name === DEFAULT_GROUP_NAME &&
    !existingWrapper.visible
  ) {
    return
  }

  const sourceGroup = figma.group(children, container, 0)
  sourceGroup.name = DEFAULT_GROUP_NAME
  sourceGroup.visible = false
}

function applySourceLayerStrategy(container: SourceContainerNode, settings: FlatlySettings): void {
  if (!settings.preserveOriginals || settings.placement === 'beside') {
    removeSourceLayers(container)
    return
  }

  preserveSourceLayersInGroup(container)
}

function setFlattenedImage(
  container: SourceContainerNode,
  targetBounds: Bounds,
  imageBounds: Bounds,
): void {
  container.relativeTransform = createIdentityTransform(targetBounds)
  container.resizeWithoutConstraints(imageBounds.width, imageBounds.height)
}

function flattenContainer<T extends SourceContainerNode>(container: T, exportedFrame: FlattenedExport, settings: FlatlySettings): T {
  const sourceNode = exportedFrame.node
  const targetBounds = withFailureContext(sourceNode, 'read-bounds', () => getTransformedBounds(container))
  const sourceLayerOperation =
    settings.preserveOriginals && settings.placement === 'inside'
      ? 'preserve-source-layers'
      : 'remove-source-layers'

  withFailureContext(sourceNode, sourceLayerOperation, () => applySourceLayerStrategy(container, settings))
  withFailureContext(sourceNode, 'resize-result', () => setFlattenedImage(container, targetBounds, exportedFrame.bounds))
  withFailureContext(sourceNode, 'set-image', () => {
    container.fills = [createImageFill(exportedFrame.imageHash)]
  })

  return container
}

function replaceNodeContentsWithImage(exportedFrame: FlattenedExport, settings: FlatlySettings): InPlaceFlattenableNode {
  const { node } = exportedFrame

  if (!isInPlaceFlattenableNode(node)) {
    throw new Error('Only frames and main components can be flattened in place.')
  }

  if (settings.preserveOriginals && settings.placement === 'beside') {
    withFailureContext(node, 'create-original-copy', () => createOriginalCopyBeside(node))
  }

  return flattenContainer(node, exportedFrame, settings)
}

function createFlattenedFrameNextToInstance(exportedFrame: FlattenedExport, settings: FlatlySettings): FrameNode {
  const { node } = exportedFrame

  if (node.type !== 'INSTANCE') {
    throw new Error('Only instances can be flattened into a new frame.')
  }

  const instanceCopy = withFailureContext(node, 'create-detached-frame', () => node.clone())
  withFailureContext(node, 'place-result', () => {
    insertNodeAfter(node, instanceCopy)
    placeNodeBeside(node, instanceCopy)
  })

  const resultFrame = withFailureContext(node, 'detach-instance', () => instanceCopy.detachInstance())
  withFailureContext(node, 'configure-result', () => {
    resultFrame.name = node.name
  })
  withFailureContext(node, 'place-result', () => placeNodeBeside(node, resultFrame))

  return flattenContainer(resultFrame, exportedFrame, settings)
}

function flattenInstanceInPlace(exportedFrame: FlattenedExport, settings: FlatlySettings): FrameNode {
  const { node } = exportedFrame

  if (node.type !== 'INSTANCE') {
    throw new Error('Only instances can be flattened in place.')
  }

  if (settings.preserveOriginals && settings.placement === 'beside') {
    withFailureContext(node, 'create-original-copy', () => createOriginalCopyBeside(node))
  }

  const resultFrame = withFailureContext(node, 'detach-instance', () => node.detachInstance())
  withFailureContext(node, 'configure-result', () => {
    resultFrame.name = node.name
  })

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
  } catch (error) {
    throw asFlattenFailure(error, exportedFrame.node, 'flatten', 'flatten')
  }
}

function isSceneNode(node: BaseNode | null): node is SceneNode {
  return node !== null && node.type !== 'DOCUMENT' && node.type !== 'PAGE'
}

async function resolveFailedNodes(failures: readonly FlattenFailure[]): Promise<SceneNode[]> {
  const selectedNodes: SceneNode[] = []
  const selectedNodeIds = new Set<string>()

  for (const failure of failures) {
    const resolvedNode = await figma.getNodeByIdAsync(failure.nodeId)
    const node = isSceneNode(resolvedNode)
      ? resolvedNode
      : failure.sourceNode.removed
        ? null
        : failure.sourceNode

    if (node !== null && !selectedNodeIds.has(node.id)) {
      selectedNodeIds.add(node.id)
      selectedNodes.push(node)
    }
  }

  return selectedNodes
}

function getFailureSummary(failure: FlattenFailure): string {
  return `${failure.nodeName} — ${FAILURE_OPERATION_MESSAGES[failure.operation]}.`
}

function getBatchMessage(
  totalNodeCount: number,
  flattenedNodeCount: number,
  failures: readonly FlattenFailure[],
  selectedFailedNodeCount: number,
): string {
  if (failures.length === 0) {
    return getFlattenedMessage(flattenedNodeCount)
  }

  const nodeLabel = totalNodeCount === 1 ? 'node' : 'nodes'
  const maxDisplayedFailures = 8
  const displayedFailures = failures.slice(0, maxDisplayedFailures).map((failure) => `- ${getFailureSummary(failure)}`)

  if (failures.length > maxDisplayedFailures) {
    displayedFailures.push(`- ${failures.length - maxDisplayedFailures} more nodes failed.`)
  }

  const selectionMessage =
    selectedFailedNodeCount === 0
      ? 'Failed layers could not be selected.'
      : selectedFailedNodeCount === 1
        ? 'The failed layer is selected.'
        : 'Failed layers are selected.'

  return [
    `Flattened ${flattenedNodeCount} of ${totalNodeCount} ${nodeLabel}.`,
    '',
    'Failed:',
    ...displayedFailures,
    '',
    selectionMessage,
  ].join('\n')
}

async function run(): Promise<void> {
  const nodes = validateSelection(figma.currentPage.selection)

  if (nodes === null) {
    return
  }

  const settings = await loadSettings()
  const progressNotification =
    nodes.length > 1
      ? figma.notify(`Flattening ${nodes.length} layers...`, {
          timeout: Infinity,
        })
      : null

  try {
    const exportResults = await Promise.all(nodes.map((node) => settlePromise(exportNodeWithContext(node))))
    const exportedFrames: FlattenedExport[] = []
    const flattenedNodes: SceneNode[] = []
    const failures: FlattenFailure[] = []

    for (const [index, result] of exportResults.entries()) {
      if (result.status === 'fulfilled') {
        exportedFrames.push(result.value)
        continue
      }

      const failure = asFlattenFailure(result.reason, nodes[index], 'export', 'export')
      failures.push(failure)
      logFlattenFailure(failure)
    }

    for (const exportedFrame of exportedFrames) {
      let mutationBoundaryOpen = false

      try {
        figma.commitUndo()
        mutationBoundaryOpen = true

        const flattenedNode = applyFlattenedExportWithContext(exportedFrame, settings)

        figma.commitUndo()
        mutationBoundaryOpen = false
        flattenedNodes.push(flattenedNode)
      } catch (error) {
        const failure = asFlattenFailure(error, exportedFrame.node, 'flatten', 'flatten')

        if (mutationBoundaryOpen) {
          try {
            figma.triggerUndo()
            mutationBoundaryOpen = false
          } catch (rollbackError) {
            console.error('[Flatly] Could not restore the failed node.', {
              cause: rollbackError,
              nodeId: failure.nodeId,
              nodeName: failure.nodeName,
            })
            progressNotification?.cancel()
            closeWithMessage(
              `Could not restore "${failure.nodeName}" after the flattening error. Flattening stopped. Check the document and use Undo.`,
            )
            return
          }
        }

        failures.push(failure)
        logFlattenFailure(failure)
      }
    }

    const failedNodes = failures.length > 0 ? await resolveFailedNodes(failures) : []
    figma.currentPage.selection = failedNodes.length > 0 ? failedNodes : flattenedNodes

    progressNotification?.cancel()
    closeWithMessage(getBatchMessage(nodes.length, flattenedNodes.length, failures, failedNodes.length))
  } catch (error) {
    progressNotification?.cancel()

    if (error instanceof FlattenFailure) {
      logFlattenFailure(error)
      closeWithMessage(getFailureSummary(error))
      return
    }

    closeWithMessage('Could not flatten the selected nodes. Check that every selected frame, component, or instance can be exported.')
  }
}

async function saveNativeSettings(parameters: ParameterValues | undefined): Promise<void> {
  const currentSettings = await loadSettings()
  const choice = parseNativeSettingsChoice(parameters?.[SETTINGS_PARAMETER_KEY])

  if (choice === null) {
    closeWithMessage('Settings unchanged.')
    return
  }

  const selectedOption = NATIVE_SETTINGS_OPTIONS.find((option) => option.data === choice)

  if (!selectedOption) {
    closeWithMessage('Settings unchanged.')
    return
  }

  try {
    await saveSettings({
      ...currentSettings,
      preserveOriginals: selectedOption.preserveOriginals,
      placement: selectedOption.preserveOriginals ? selectedOption.placement : currentSettings.placement,
    })
    closeWithMessage('Settings saved.')
  } catch (_error) {
    closeWithMessage('Could not save settings.')
  }
}

async function main(command: string, parameters: ParameterValues | undefined): Promise<void> {
  if (command === SETTINGS_COMMAND) {
    await saveNativeSettings(parameters)
    return
  }

  if (command !== FLATTEN_COMMAND) {
    closeWithMessage('Unknown Flatly command.')
    return
  }

  await run()
}

figma.parameters.on('input', async ({ key, query, result }) => {
  if (key !== SETTINGS_PARAMETER_KEY) {
    return
  }

  const settings = await loadSettings()
  const suggestions = getNativeSettingsSuggestions(getNativeSettingsChoice(settings), query)

  if (suggestions.length === 0) {
    result.setError('Choose a valid original-layer setting.')
    return
  }

  result.setSuggestions(suggestions)
})

figma.on('run', ({ command, parameters }) => {
  void main(command, parameters)
})
