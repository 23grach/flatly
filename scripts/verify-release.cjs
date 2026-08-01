const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const projectRoot = path.resolve(__dirname, '..')
const manifestPath = path.join(projectRoot, 'manifest.json')
const packagePath = path.join(projectRoot, 'package.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
const mainPath = path.join(projectRoot, manifest.main)

function readPngDimensions(relativePath) {
  const bytes = fs.readFileSync(path.join(projectRoot, relativePath))
  const pngSignature = '89504e470d0a1a0a'

  assert.equal(bytes.subarray(0, 8).toString('hex'), pngSignature, `${relativePath} must be a PNG file`)

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
}

assert.equal(manifest.api, '1.0.0', 'manifest.api must use the current stable plugin API')
assert.equal(manifest.documentAccess, 'dynamic-page', 'dynamic page access is required for new plugins')
assert.deepEqual(manifest.editorType, ['figma'], 'Flatly should run only in Figma Design')
assert.deepEqual(manifest.networkAccess, { allowedDomains: ['none'] }, 'Flatly must not request network access')
assert.equal(manifest.enableProposedApi, false, 'published plugins cannot use proposed APIs')
assert.equal(packageJson.main, manifest.main, 'package.json and manifest.json must use the same entry file')
assert.equal(packageJson.private, true, 'the Figma plugin package must not be publishable to npm')
assert.ok(fs.existsSync(mainPath), `Build output is missing: ${manifest.main}`)

const menuItems = manifest.menu.filter((item) => 'command' in item)
const commands = menuItems.map((item) => item.command)
assert.equal(new Set(commands).size, commands.length, 'manifest commands must be unique')
assert.deepEqual(commands, ['flatten', 'settings'], 'the published menu must contain Flatten and Settings')

for (const item of menuItems) {
  if (!item.parameterOnly) {
    continue
  }

  assert.ok(Array.isArray(item.parameters) && item.parameters.length > 0, `${item.command} needs parameters`)
  const parameterKeys = item.parameters.map((parameter) => parameter.key)
  assert.equal(new Set(parameterKeys).size, parameterKeys.length, `${item.command} parameter keys must be unique`)
}

const mainCode = fs.readFileSync(mainPath, 'utf8')
assert.ok(mainCode.length > 0, 'the compiled plugin entry file must not be empty')
assert.ok(mainCode.length < 1_000_000, 'the compiled plugin entry file is unexpectedly large')
assert.doesNotMatch(mainCode, /\brequire\s*\(/u, 'the compiled plugin must not depend on CommonJS at runtime')
new vm.Script(mainCode, { filename: manifest.main })

const icon = readPngDimensions('assets/Logo.png')
const thumbnail = readPngDimensions('assets/Flatly.png')
assert.equal(icon.width, icon.height, 'the Community icon must be square')
assert.ok(icon.width >= 128, 'the Community icon must be at least 128px square')
assert.equal(thumbnail.width * 9, thumbnail.height * 16, 'the Community thumbnail must use a 16:9 ratio')
assert.ok(thumbnail.width >= 1920 && thumbnail.height >= 1080, 'the Community thumbnail is too small')

console.log(
  `Release checks passed for ${manifest.name}: ${mainCode.length} bytes, ${commands.length} commands, no network access, ${icon.width}px icon, ${thumbnail.width}x${thumbnail.height}px thumbnail.`,
)
