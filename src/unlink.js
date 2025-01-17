
const path = require('path');

const CSON = require('season');
const yargs = require('yargs');

const Command = require('./command');
const config = require('./apm');
const fs = require('./fs');

module.exports =
class Unlink extends Command {
  static commandNames = [ "unlink" ];

    constructor() {
      super();
      this.devPackagesPath = path.join(config.getAtomDirectory(), 'dev', 'packages');
      this.packagesPath = path.join(config.getAtomDirectory(), 'packages');
    }

    parseOptions(argv) {
      const options = yargs(argv).wrap(Math.min(100, yargs.terminalWidth()));
      options.usage(`\

Usage: ppm unlink [<package_path>]

Delete the symlink in ~/.pulsar/packages for the package. The package in the
current working directory is unlinked if no path is given.

Run \`ppm links\` to view all the currently linked packages.\
`
      );
      options.alias('h', 'help').describe('help', 'Print this usage message');
      options.alias('d', 'dev').boolean('dev').describe('dev', 'Unlink package from ~/.pulsar/dev/packages');
      options.boolean('hard').describe('hard', 'Unlink package from ~/.pulsar/packages and ~/.pulsar/dev/packages');
      return options.alias('a', 'all').boolean('all').describe('all', 'Unlink all packages in ~/.pulsar/packages and ~/.pulsar/dev/packages');
    }

    getDevPackagePath(packageName) { return path.join(this.devPackagesPath, packageName); }

    getPackagePath(packageName) { return path.join(this.packagesPath, packageName); }

    unlinkPath(pathToUnlink) {
      try {
        process.stdout.write(`Unlinking ${pathToUnlink} `);
        fs.unlinkSync(pathToUnlink);
        return this.logSuccess();
      } catch (error) {
        this.logFailure();
        throw error;
      }
    }

    unlinkAll(options, callback) {
      try {
        let child, packagePath;
        for (child of fs.list(this.devPackagesPath)) {
          packagePath = path.join(this.devPackagesPath, child);
          if (fs.isSymbolicLinkSync(packagePath)) { this.unlinkPath(packagePath); }
        }
        if (!options.argv.dev) {
          for (child of fs.list(this.packagesPath)) {
            packagePath = path.join(this.packagesPath, child);
            if (fs.isSymbolicLinkSync(packagePath)) { this.unlinkPath(packagePath); }
          }
        }
        return callback();
      } catch (error) {
        return callback(error);
      }
    }

    unlinkPackage(options, callback) {
      let packageName;
      const packagePath = options.argv._[0]?.toString() ?? ".";
      const linkPath = path.resolve(process.cwd(), packagePath);

      try {
        packageName = CSON.readFileSync(CSON.resolve(path.join(linkPath, 'package'))).name;
      } catch (error) {}
      if (!packageName) { packageName = path.basename(linkPath); }

      if (options.argv.hard) {
        try {
          this.unlinkPath(this.getDevPackagePath(packageName));
          this.unlinkPath(this.getPackagePath(packageName));
          return callback();
        } catch (error) {
          return callback(error);
        }
      } else {
        let targetPath;
        if (options.argv.dev) {
          targetPath = this.getDevPackagePath(packageName);
        } else {
          targetPath = this.getPackagePath(packageName);
        }
        try {
          this.unlinkPath(targetPath);
          return callback();
        } catch (error) {
          return callback(error);
        }
      }
    }

    run(options) {
      const {callback} = options;
      options = this.parseOptions(options.commandArgs);

      if (options.argv.all) {
        return this.unlinkAll(options, callback);
      } else {
        return this.unlinkPackage(options, callback);
      }
    }
  }
