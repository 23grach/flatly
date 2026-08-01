const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const projectRoot = path.resolve(__dirname, '..')
const compiledCodePath = path.join(projectRoot, 'code.js')

function toPlain(value) {
  return JSON.parse(JSON.stringify(value))
}

function createMockRuntime(options = {}) {
  const state = {
    closeMessages: [],
    commits: 0,
    exports: [],
    imageCount: 0,
    inputHandler: null,
    logs: [],
    notificationCancels: 0,
    notifications: [],
    runHandler: null,
    storage: new Map(Object.entries(options.storage ?? {})),
    undos: 0,
  }
  let nextNodeId = 1

  function detachNode(node) {
    const parent = node.parent

    if (!parent || !Array.isArray(parent.children)) {
      return
    }

    const index = parent.children.indexOf(node)

    if (index >= 0) {
      parent.children.splice(index, 1)
    }

    node.parent = null
  }

  function insertChild(parent, index, child) {
    detachNode(child)
    parent.children.splice(Math.max(0, Math.min(index, parent.children.length)), 0, child)
    child.parent = parent
  }

  function createLeaf(overrides = {}) {
    const node = {
      id: overrides.id ?? `leaf-${nextNodeId++}`,
      type: overrides.type ?? 'RECTANGLE',
      name: overrides.name ?? 'Rectangle',
      parent: null,
      removed: false,
      visible: overrides.visible ?? true,
      clone() {
        return createLeaf({
          type: node.type,
          name: node.name,
          visible: node.visible,
        })
      },
      remove() {
        detachNode(node)
        node.removed = true
      },
    }

    return node
  }

  function createContainer(type = 'FRAME', overrides = {}) {
    const node = {
      id: overrides.id ?? `node-${nextNodeId++}`,
      type,
      name: overrides.name ?? type.toLowerCase(),
      parent: null,
      removed: false,
      width: overrides.width ?? 100,
      height: overrides.height ?? 50,
      relativeTransform: overrides.relativeTransform ?? [
        [1, 0, 0],
        [0, 1, 0],
      ],
      opacity: overrides.opacity ?? 1,
      strokes: overrides.strokes ?? [],
      effects: overrides.effects ?? [],
      fills: overrides.fills ?? [],
      visible: overrides.visible ?? true,
      children: [],
      appendChild(child) {
        insertChild(node, node.children.length, child)
      },
      insertChild(index, child) {
        insertChild(node, index, child)
      },
      resizeWithoutConstraints(width, height) {
        node.width = width
        node.height = height
      },
      clone() {
        const clone = createContainer(node.type, {
          name: node.name,
          width: node.width,
          height: node.height,
          relativeTransform: node.relativeTransform.map((row) => [...row]),
          opacity: node.opacity,
          strokes: [...node.strokes],
          effects: [...node.effects],
          fills: [...node.fills],
          visible: node.visible,
        })

        for (const child of node.children) {
          clone.appendChild(child.clone())
        }

        return clone
      },
      async exportAsync(settings) {
        state.exports.push(settings)

        const exportError =
          typeof options.exportError === 'function' ? options.exportError(node, settings) : options.exportError

        if (exportError) {
          throw exportError
        }

        return new Uint8Array([1, 2, 3])
      },
      remove() {
        detachNode(node)
        node.removed = true
      },
    }

    if (type === 'INSTANCE') {
      node.detachInstance = () => {
        node.type = 'FRAME'
        return node
      }
    }

    for (const child of overrides.children ?? []) {
      node.appendChild(child)
    }

    return node
  }

  const currentPage = {
    id: 'page-1',
    type: 'PAGE',
    parent: null,
    children: [],
    selection: [],
    appendChild(child) {
      insertChild(currentPage, currentPage.children.length, child)
    },
    insertChild(index, child) {
      insertChild(currentPage, index, child)
    },
  }

  for (const node of options.selection ?? []) {
    currentPage.appendChild(node)
    currentPage.selection.push(node)
  }

  const figma = {
    currentPage,
    parameters: {
      on(type, handler) {
        assert.equal(type, 'input')
        state.inputHandler = handler
      },
    },
    clientStorage: {
      async getAsync(key) {
        return state.storage.get(key)
      },
      async setAsync(key, value) {
        state.storage.set(key, toPlain(value))
      },
    },
    on(type, handler) {
      assert.equal(type, 'run')
      state.runHandler = handler
    },
    closePlugin(message) {
      state.closeMessages.push(message)
    },
    notify(message, settings) {
      state.notifications.push({ message, settings })
      return {
        cancel() {
          state.notificationCancels += 1
        },
      }
    },
    createFrame() {
      return createContainer('FRAME')
    },
    createImage() {
      state.imageCount += 1
      return { hash: `image-${state.imageCount}` }
    },
    group(children, parent, index) {
      if (options.groupError) {
        throw options.groupError
      }

      const group = createContainer('GROUP', { name: 'Group', width: 1, height: 1 })

      parent.insertChild(index, group)

      for (const child of [...children]) {
        group.appendChild(child)
      }

      return group
    },
    commitUndo() {
      state.commits += 1
    },
    triggerUndo() {
      state.undos += 1
    },
  }

  const runtimeConsole = {
    error(...args) {
      state.logs.push(args)
    },
    log(...args) {
      state.logs.push(args)
    },
  }
  const context = vm.createContext({
    console: runtimeConsole,
    figma,
    setTimeout,
    clearTimeout,
  })
  const compiledCode = fs.readFileSync(compiledCodePath, 'utf8')
  const exposedCode = `
globalThis.__flatlyTest = {
  getBatchMessage,
  getMaximumFlattenScale,
  getNativeSettingsChoice,
  getNativeSettingsSuggestions,
  getSelectionError,
  getTransformedBounds,
  normalizeSettings,
};`

  new vm.Script(`${compiledCode}\n${exposedCode}`, { filename: 'code.js' }).runInContext(context)

  return {
    figma,
    helpers: context.__flatlyTest,
    makeContainer: createContainer,
    makeLeaf: createLeaf,
    state,
  }
}

async function waitForClose(state) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (state.closeMessages.length > 0) {
      return
    }

    await new Promise((resolve) => setImmediate(resolve))
  }

  assert.fail('The plugin did not close')
}

test('normalizes stored settings without trusting invalid values', () => {
  const { helpers } = createMockRuntime()

  assert.deepEqual(toPlain(helpers.normalizeSettings(undefined)), {
    preserveOriginals: true,
    placement: 'inside',
  })
  assert.deepEqual(toPlain(helpers.normalizeSettings({ preserveOriginals: false, placement: 'beside' })), {
    preserveOriginals: false,
    placement: 'beside',
  })
  assert.deepEqual(toPlain(helpers.normalizeSettings({ preserveOriginals: 'yes', placement: 'outside' })), {
    preserveOriginals: true,
    placement: 'inside',
  })
})

test('orders and filters native settings suggestions', () => {
  const { helpers } = createMockRuntime()
  const suggestions = helpers.getNativeSettingsSuggestions('keep-beside')

  assert.equal(suggestions[0].data, 'keep-beside')
  assert.deepEqual(
    toPlain(helpers.getNativeSettingsSuggestions('keep-inside', 'remove')),
    [{ name: 'Remove original layers', data: 'remove' }],
  )
})

test('rejects empty, mixed, and nested selections', () => {
  const runtime = createMockRuntime()
  const parent = runtime.makeContainer('FRAME', { name: 'Parent' })
  const nested = runtime.makeContainer('FRAME', { name: 'Nested' })
  const rectangle = runtime.makeLeaf()

  parent.appendChild(nested)

  assert.match(runtime.helpers.getSelectionError([]), /Select at least one/u)
  assert.match(runtime.helpers.getSelectionError([parent, rectangle]), /only frames/u)
  assert.match(runtime.helpers.getSelectionError([parent, nested]), /parent and a nested layer/u)
  assert.equal(runtime.helpers.getSelectionError([parent]), null)
})

test('computes transformed bounds and safe export scales', () => {
  const runtime = createMockRuntime()
  const rotated = runtime.makeContainer('FRAME', {
    width: 100,
    height: 50,
    relativeTransform: [
      [0, -1, 100],
      [1, 0, 20],
    ],
  })

  assert.deepEqual(toPlain(runtime.helpers.getTransformedBounds(rotated)), {
    x: 50,
    y: 20,
    width: 50,
    height: 100,
  })
  assert.equal(runtime.helpers.getMaximumFlattenScale({ width: 100, height: 50 }), 32)
  assert.equal(runtime.helpers.getMaximumFlattenScale({ width: 1024, height: 100 }), 4)
  assert.equal(runtime.helpers.getMaximumFlattenScale({ width: 8192, height: 100 }), 0.5)
  assert.equal(runtime.helpers.getMaximumFlattenScale({ width: 0, height: 0 }), 1)
})

test('runs a frame flatten and preserves sources without changing selection', async () => {
  const runtime = createMockRuntime()
  const child = runtime.makeLeaf({ name: 'Source rectangle' })
  const frame = runtime.makeContainer('FRAME', {
    id: 'frame-1',
    name: 'Card',
    width: 100,
    height: 50,
    children: [child],
  })

  runtime.figma.currentPage.appendChild(frame)
  runtime.figma.currentPage.selection = [frame]
  runtime.state.runHandler({ command: 'flatten', parameters: undefined })
  await waitForClose(runtime.state)

  assert.deepEqual(runtime.state.closeMessages, ['Flattened 1 layer.'])
  assert.equal(runtime.state.exports.length, 1)
  assert.equal(runtime.state.exports[0].constraint.value, 32)
  assert.equal(runtime.figma.currentPage.selection.length, 1)
  assert.equal(runtime.figma.currentPage.selection[0], frame)
  assert.equal(frame.fills[0].imageHash, 'image-1')
  assert.equal(frame.children.length, 1)
  assert.equal(frame.children[0].name, 'Flatly source layers')
  assert.equal(frame.children[0].visible, false)
  assert.equal(runtime.state.commits, 2)
  assert.equal(runtime.figma.currentPage.children.length, 1)
})

test('keeps an instance linked and creates a detached flattened result without changing selection', async () => {
  const runtime = createMockRuntime()
  const child = runtime.makeLeaf({ name: 'Instance child' })
  const instance = runtime.makeContainer('INSTANCE', {
    id: 'instance-1',
    name: 'Button instance',
    width: 100,
    height: 50,
    relativeTransform: [
      [1, 0, 10],
      [0, 1, 20],
    ],
    children: [child],
  })

  runtime.figma.currentPage.appendChild(instance)
  runtime.figma.currentPage.selection = [instance]
  runtime.state.runHandler({ command: 'flatten', parameters: undefined })
  await waitForClose(runtime.state)

  const result = runtime.figma.currentPage.children[1]
  assert.equal(runtime.figma.currentPage.children.length, 2)
  assert.equal(runtime.figma.currentPage.children[0], instance)
  assert.equal(instance.type, 'INSTANCE')
  assert.equal(instance.children[0], child)
  assert.equal(result.type, 'FRAME')
  assert.equal(result.name, 'Button instance')
  assert.equal(result.relativeTransform[0][2], 134)
  assert.equal(result.fills[0].imageHash, 'image-1')
  assert.equal(runtime.figma.currentPage.selection[0], instance)
})

test('removes source layers and flattens an instance in place when configured', async () => {
  const runtime = createMockRuntime({
    storage: {
      'flatly.settings.v1': {
        preserveOriginals: false,
        placement: 'beside',
      },
    },
  })
  const child = runtime.makeLeaf({ name: 'Source child' })
  const instance = runtime.makeContainer('INSTANCE', {
    id: 'instance-remove',
    name: 'Avatar instance',
    children: [child],
  })

  runtime.figma.currentPage.appendChild(instance)
  runtime.figma.currentPage.selection = [instance]
  runtime.state.runHandler({ command: 'flatten', parameters: undefined })
  await waitForClose(runtime.state)

  assert.equal(runtime.figma.currentPage.children.length, 1)
  assert.equal(runtime.figma.currentPage.children[0], instance)
  assert.equal(instance.type, 'FRAME')
  assert.equal(instance.children.length, 0)
  assert.equal(instance.fills[0].imageHash, 'image-1')
  assert.equal(runtime.figma.currentPage.selection[0], instance)
})

test('keeps a failed export unchanged without changing selection', async () => {
  const runtime = createMockRuntime({
    exportError: new Error('export failed'),
  })
  const child = runtime.makeLeaf()
  const frame = runtime.makeContainer('FRAME', {
    id: 'frame-failure',
    name: 'Broken card',
    children: [child],
  })

  runtime.figma.currentPage.appendChild(frame)
  runtime.figma.currentPage.selection = [frame]
  runtime.state.runHandler({ command: 'flatten', parameters: undefined })
  await waitForClose(runtime.state)

  assert.match(runtime.state.closeMessages[0], /Flattened 0 of 1 layer/u)
  assert.match(runtime.state.closeMessages[0], /"Broken card": Couldn't export it as a PNG/u)
  assert.equal(runtime.figma.currentPage.selection.length, 1)
  assert.equal(runtime.figma.currentPage.selection[0], frame)
  assert.equal(frame.children.length, 1)
  assert.equal(frame.children[0], child)
  assert.equal(runtime.figma.currentPage.children.length, 1)
  assert.equal(runtime.state.logs.length, 1)
})

test('rolls back a node when flattening fails after export', async () => {
  const runtime = createMockRuntime({ groupError: new Error('group failed') })
  const child = runtime.makeLeaf()
  const frame = runtime.makeContainer('FRAME', {
    id: 'frame-rollback',
    name: 'Rollback card',
    children: [child],
  })

  runtime.figma.currentPage.appendChild(frame)
  runtime.figma.currentPage.selection = [frame]
  runtime.state.runHandler({ command: 'flatten', parameters: undefined })
  await waitForClose(runtime.state)

  assert.match(runtime.state.closeMessages[0], /Couldn't keep the original layers/u)
  assert.equal(runtime.state.commits, 1)
  assert.equal(runtime.state.undos, 1)
  assert.equal(frame.children[0], child)
  assert.equal(runtime.figma.currentPage.selection[0], frame)
})

test('finishes a mixed batch without changing selection', async () => {
  const runtime = createMockRuntime({
    exportError(node) {
      return node.name.startsWith('Bad card') ? new Error('export failed') : null
    },
  })
  const goodFrame = runtime.makeContainer('FRAME', {
    id: 'frame-good',
    name: 'Good card',
    children: [runtime.makeLeaf()],
  })
  const badFrame = runtime.makeContainer('FRAME', {
    id: 'frame-bad',
    name: 'Bad card',
    children: [runtime.makeLeaf()],
  })

  runtime.figma.currentPage.appendChild(goodFrame)
  runtime.figma.currentPage.appendChild(badFrame)
  runtime.figma.currentPage.selection = [goodFrame, badFrame]
  runtime.state.runHandler({ command: 'flatten', parameters: undefined })
  await waitForClose(runtime.state)

  assert.match(runtime.state.closeMessages[0], /Flattened 1 of 2 layers/u)
  assert.equal(goodFrame.fills[0].imageHash, 'image-1')
  assert.equal(badFrame.fills.length, 0)
  assert.equal(runtime.figma.currentPage.selection.length, 2)
  assert.equal(runtime.figma.currentPage.selection[0], goodFrame)
  assert.equal(runtime.figma.currentPage.selection[1], badFrame)
  assert.equal(runtime.state.notifications.length, 1)
  assert.equal(runtime.state.notificationCancels, 1)
})

test('loads parameter suggestions and saves the selected settings', async () => {
  const runtime = createMockRuntime({
    storage: {
      'flatly.settings.v1': {
        preserveOriginals: false,
        placement: 'beside',
      },
    },
  })
  const result = {
    error: null,
    suggestions: null,
    setError(message) {
      result.error = message
    },
    setSuggestions(suggestions) {
      result.suggestions = suggestions
    },
  }

  await runtime.state.inputHandler({ key: 'settings', query: '', result })
  assert.equal(result.suggestions[0].data, 'remove')

  await runtime.state.inputHandler({ key: 'settings', query: 'missing', result })
  assert.equal(result.error, 'Choose an original-layer option.')

  runtime.state.runHandler({ command: 'settings', parameters: { settings: 'keep-inside' } })
  await waitForClose(runtime.state)

  assert.deepEqual(runtime.state.storage.get('flatly.settings.v1'), {
    preserveOriginals: true,
    placement: 'inside',
  })
  assert.deepEqual(runtime.state.closeMessages, ['Settings saved.'])
})

test('closes unknown commands with a clear message', async () => {
  const runtime = createMockRuntime()

  runtime.state.runHandler({ command: 'unknown', parameters: undefined })
  await waitForClose(runtime.state)

  assert.deepEqual(runtime.state.closeMessages, ["Flatly couldn't start this action. Run the plugin again."])
})
