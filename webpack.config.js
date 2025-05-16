require('./crypto-shim.js')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path')

module.exports = {
  entry: './electron/main.js',
  mode: 'production',
  devtool: false,
  output: {
    path: path.resolve(__dirname, './electron'),
    filename: 'main-min.js'
  },
  target: 'electron-main'
}
