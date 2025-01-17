
const _ = require('underscore-plus');
const path = require('path');
const CSON = require('season');
const yargs = require('yargs');

const config = require('./apm');
const Command = require('./command');
const List = require('./list');

module.exports =
class Disable extends Command {
  static commandNames = [ "disable" ];

    parseOptions(argv) {
      const options = yargs(argv).wrap(Math.min(100, yargs.terminalWidth()));
      options.usage(`\

Usage: ppm disable [<package_name>]...

Disables the named package(s).\
`
      );
      return options.alias('h', 'help').describe('help', 'Print this usage message');
    }

    getInstalledPackages(callback) {
      const options = {
        argv: {
          theme: false,
          bare: true
        }
      };

      const lister = new List();
      return lister.listBundledPackages(options, (error, core_packages) => lister.listDevPackages(options, (error, dev_packages) => lister.listUserPackages(options, (error, user_packages) => callback(null, core_packages.concat(dev_packages, user_packages)))));
    }

    run(options) {
      let settings;
      const {callback} = options;
      options = this.parseOptions(options.commandArgs);

      let packageNames = this.packageNamesFromArgv(options.argv);

      const configFilePath = CSON.resolve(path.join(config.getAtomDirectory(), 'config'));
      if (!configFilePath) {
        callback("Could not find config.cson. Run Atom first?");
        return;
      }

      try {
        settings = CSON.readFileSync(configFilePath);
      } catch (error) {
        callback(`Failed to load \`${configFilePath}\`: ${error.message}`);
        return;
      }

      return this.getInstalledPackages((error, installedPackages) => {
        if (error) { return callback(error); }

        const installedPackageNames = (Array.from(installedPackages).map((pkg) => pkg.name));

        // uninstalledPackages = (name for name in packageNames when !installedPackageNames[name])
        const uninstalledPackageNames = _.difference(packageNames, installedPackageNames);
        if (uninstalledPackageNames.length > 0) {
          console.log(`Not Installed:\n  ${uninstalledPackageNames.join('\n  ')}`);
        }

        // only installed packages can be disabled
        packageNames = _.difference(packageNames, uninstalledPackageNames);

        if (packageNames.length === 0) {
          callback("Please specify a package to disable");
          return;
        }

        const keyPath = '*.core.disabledPackages';
        const disabledPackages = _.valueForKeyPath(settings, keyPath) ?? [];
        const result = _.union(disabledPackages, packageNames);
        _.setValueForKeyPath(settings, keyPath, result);

        try {
          CSON.writeFileSync(configFilePath, settings);
        } catch (error) {
          callback(`Failed to save \`${configFilePath}\`: ${error.message}`);
          return;
        }

        console.log(`Disabled:\n  ${packageNames.join('\n  ')}`);
        this.logSuccess();
        return callback();
      });
    }
  }
