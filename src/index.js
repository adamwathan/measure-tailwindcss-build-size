const util = require('util')
const exec = util.promisify(require('child_process').exec)
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const readFile = fs.promises.readFile
const readdir = fs.promises.readdir
const copyFile = fs.promises.copyFile
const stat = fs.promises.stat
const writeFile = fs.promises.writeFile

const rimraf = require('rimraf')
const { gzip } = require('node-gzip')
const CleanCSS = require('clean-css')
const Table = require('cli-table')

const brotli = (input, options) => {
  return new Promise(function(resolve, reject) {
    zlib.brotliCompress(input, options, function (error, result) {
      if(!error) resolve(result)
      else reject(Error(error))
    })
  })
}

const clearOutput = () => rimraf.sync('./output/*')

const split = file => file.split(/\.(?=[^\.]+$)/)

const convertToKB = bytes => (bytes / 1024).toFixed(1) + 'K'

const build = async (config, output, css) => {
  await exec(`npx tailwind build ${css} -c ${config} -o ${output}`)
}

const minify = async (directory, file) => {
  const [filename, extension] = split(file)
  const css = await readFile(directory + file)

  const { styles } = new CleanCSS().minify(css.toString())

  await writeFile(`${directory + filename}.min.${extension}`, styles)
}

const compress = async path => {
  const file = await readFile(path)
  const gzipCompressed = gzip(file.toString())
  const brotliCompressed = brotli(file.toString())
  await Promise.all([
    writeFile(`${path}.gzip`, await gzipCompressed),
    writeFile(`${path}.brotli`, await brotliCompressed),
  ])
}

const getFileSizes = async (outputDirectory, filename) => {
  const { size: original } = await stat(`${outputDirectory + filename}.css`)
  const { size: minified } = await stat(`${outputDirectory + filename}.min.css`)
  const { size: gzipped } = await stat(`${outputDirectory + filename}.min.css.gzip`)
  const { size: brotlified } = await stat(`${outputDirectory + filename}.min.css.brotli`)
  return {
    original: convertToKB(original),
    minified: convertToKB(minified),
    gzipped: convertToKB(gzipped),
    brotlified: convertToKB(brotlified),
  }
}

const getCssStats = async path => {
  const css = await readFile(path)
  const classes = css.toString().match(/(\.[^{} ]*){/g).length
  const declarations = css.toString().match(/([^{} ]*){/g).length
  const colorDeclarations = css.toString().match(/{(background-color|border-color|color)/g).length
  return {
    classes,
    declarations,
    colorDeclarations,
  }
}

const measure = async (outputDirectory, filename) => {
  return {
    ...await getFileSizes(outputDirectory, filename),
    ...await getCssStats(`${outputDirectory + filename}.min.css`)
  }
}

const display = data => {
  const table = new Table({ head: ['Config', 'Original', 'Minified', 'Gzip', 'Brotli', 'Classes', 'Declarations', 'Color Declarations'] })
  table.push(...data)
  console.info(table.toString())
}

const compareTailwindBuilds = async (configDirectory, cssPath) => {
  const configs = await readdir(configDirectory)
  return await Promise.all(configs.map(async config => {
    const [filename, extension] = split(config)
    const outputDirectory = `./output/`
    const outputFile = `${filename}.css`

    try {
      await build(configDirectory + config, outputDirectory + outputFile, cssPath)
      await minify(outputDirectory, outputFile)
      await compress(`${outputDirectory + filename}.min.css`)
      const { original, minified, gzipped, brotlified, classes, declarations, colorDeclarations } = await measure(outputDirectory, filename)

      return { [config]: [original, minified, gzipped, brotlified, classes, declarations, colorDeclarations] }

    } catch (error) {
      console.error(error)
    }
  }))
}

const compareOtherFrameworks = async () => {
  const frameworks = [
    ['semantic-ui', 'semantic-ui/dist/semantic.css', 'semantic-ui/dist/semantic.min.css'],
    ['tachyons', 'tachyons/css/tachyons.css', 'tachyons/css/tachyons.min.css'],
    ['bulma', 'bulma/css/bulma.css', 'bulma/css/bulma.min.css'],
    ['bootstrap', 'bootstrap/dist/css/bootstrap.css', 'bootstrap/dist/css/bootstrap.min.css'],
    ['foundation', 'foundation-sites/dist/css/foundation.css', 'foundation-sites/dist/css/foundation.min.css'],
    ['materialize', 'materialize-css/dist/css/materialize.css', 'materialize-css/dist/css/materialize.min.css'],
  ]
  await Promise.all(frameworks.map(([framework, originalPath, minifiedPath]) => {
    copyFile(require.resolve(originalPath), `./output/${framework}.css`)
    copyFile(require.resolve(minifiedPath), `./output/${framework}.min.css`)
  }))
  await Promise.all(frameworks.map(([framework]) => compress(`./output/${framework}.min.css`)))

  return await Promise.all(frameworks.map(async ([framework]) => {
    const { original, minified, gzipped, brotlified } = await getFileSizes('./output/', framework)
    return { [framework] : [original, minified, gzipped, brotlified, '—', '—', '—'] }
  }))
}

module.exports = async (configDirectory, cssPath) => {
  clearOutput()

  console.info('Calculating...')
  const [tailwindData, otherFrameworkData] = await Promise.all([
    compareTailwindBuilds(configDirectory, cssPath),
    compareOtherFrameworks(),
  ])
  console.info('Finished.')

  display([...tailwindData, ...otherFrameworkData])
}

