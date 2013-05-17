path = require 'path'

module.exports =
  getAtomDirectory: ->
    process.env.ATOM_HOME ? path.join(process.env.HOME, '.atom')

  getResourcePath: ->
    process.env.ATOM_RESOURCE_PATH ? '/Applications/Atom.app/Contents/Frameworks/Atom.framework/Resources'

  getNodeUrl: ->
    process.env.ATOM_NODE_URL ? 'https://gh-contractor-zcbenz.s3.amazonaws.com/cefode2/dist'

  getAtomPackagesUrl: ->
    process.env.ATOM_PACKAGES_URL ? 'http://atom.iriscouch.com/registry/_design/apm/_view/atom_packages'

  getNodeVersion: ->
    '0.10.3'

  getUserConfigPath: ->
    path.resolve(__dirname, '..', '.apmrc')