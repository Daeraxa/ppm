
const path = require('path');

const _ = require('underscore-plus');
const CSON = require('season');
const yargs = require('yargs');

const Command = require('./command');
const fs = require('./fs');
const config = require('./apm');
const tree = require('./tree');
const {getRepository} = require("./packages");

module.exports =
class List extends Command {
  static commandNames = [ "list", "ls" ];

    constructor() {
      let configPath;
      super();
      this.userPackagesDirectory = path.join(config.getAtomDirectory(), 'packages');
      this.devPackagesDirectory = path.join(config.getAtomDirectory(), 'dev', 'packages');
      if (configPath = CSON.resolve(path.join(config.getAtomDirectory(), 'config'))) {
        try {
          this.disabledPackages = CSON.readFileSync(configPath)?.['*']?.core?.disabledPackages;
        } catch (error) {}
      }
      if (this.disabledPackages == null) { this.disabledPackages = []; }
    }

    parseOptions(argv) {
      const options = yargs(argv).wrap(Math.min(100, yargs.terminalWidth()));
      options.usage(`\

Usage: ppm list
       ppm list --themes
       ppm list --packages
       ppm list --installed
       ppm list --installed --enabled
       ppm list --installed --bare > my-packages.txt
       ppm list --json

List all the installed packages and also the packages bundled with Atom.\
`
      );
      options.alias('b', 'bare').boolean('bare').describe('bare', 'Print packages one per line with no formatting');
      options.alias('e', 'enabled').boolean('enabled').describe('enabled', 'Print only enabled packages');
      options.alias('d', 'dev').boolean('dev').default('dev', true).describe('dev', 'Include dev packages');
      options.boolean('disabled').describe('disabled', 'Print only disabled packages');
      options.alias('h', 'help').describe('help', 'Print this usage message');
      options.alias('i', 'installed').boolean('installed').describe('installed', 'Only list installed packages/themes');
      options.alias('j', 'json').boolean('json').describe('json', 'Output all packages as a JSON object');
      options.alias('l', 'links').boolean('links').default('links', true).describe('links', 'Include linked packages');
      options.alias('t', 'themes').boolean('themes').describe('themes', 'Only list themes');
      options.alias('p', 'packages').boolean('packages').describe('packages', 'Only list packages');
      return options.alias('v', 'versions').boolean('versions').default('versions', true).describe('versions', 'Include version of each package');
    }

    isPackageDisabled(name) {
      return this.disabledPackages.indexOf(name) !== -1;
    }

    logPackages(packages, options) {
      if (options.argv.bare) {
        return (() => {
          const result = [];
          for (let pack of Array.from(packages)) {
            let packageLine = pack.name;
            if ((pack.version != null) && options.argv.versions) { packageLine += `@${pack.version}`; }
            result.push(console.log(packageLine));
          }
          return result;
        })();
      } else {
        tree(packages, pack => {
          let packageLine = pack.name;
          if ((pack.version != null) && options.argv.versions) { packageLine += `@${pack.version}`; }
          if (pack.apmInstallSource?.type === 'git') {
            const repo = getRepository(pack);
            let shaLine = `#${pack.apmInstallSource.sha.substr(0, 8)}`;
            if (repo != null) { shaLine = repo + shaLine; }
            packageLine += ` (${shaLine})`.grey;
          }
          if (this.isPackageDisabled(pack.name) && !options.argv.disabled) { packageLine += ' (disabled)'; }
          return packageLine;
        });
        return console.log();
      }
    }

    checkExclusiveOptions(options, positive_option, negative_option, value) {
      if (options.argv[positive_option]) {
        return value;
      } else if (options.argv[negative_option]) {
        return !value;
      } else {
        return true;
      }
    }

    isPackageVisible(options, manifest) {
      return this.checkExclusiveOptions(options, 'themes', 'packages', manifest.theme) &&
      this.checkExclusiveOptions(options, 'disabled', 'enabled', this.isPackageDisabled(manifest.name));
    }

    listPackages(directoryPath, options) {
      const packages = [];
      for (let child of Array.from(fs.list(directoryPath))) {
        var manifestPath;
        if (!fs.isDirectorySync(path.join(directoryPath, child))) { continue; }
        if (child.match(/^\./)) { continue; }
        if (!options.argv.links) {
          if (fs.isSymbolicLinkSync(path.join(directoryPath, child))) { continue; }
        }

        let manifest = null;
        if (manifestPath = CSON.resolve(path.join(directoryPath, child, 'package'))) {
          try {
            manifest = CSON.readFileSync(manifestPath);
          } catch (error) {}
        }
        if (manifest == null) { manifest = {}; }
        manifest.name = child;

        if (!this.isPackageVisible(options, manifest)) { continue; }
        packages.push(manifest);
      }

      return packages;
    }

    listUserPackages(options, callback) {
      const userPackages = this.listPackages(this.userPackagesDirectory, options)
        .filter(pack => !pack.apmInstallSource);
      if (!options.argv.bare && !options.argv.json) {
        console.log(`Community Packages (${userPackages.length})`.cyan, `${this.userPackagesDirectory}`);
      }
      return callback?.(null, userPackages);
    }

    listDevPackages(options, callback) {
      if (!options.argv.dev) { return callback?.(null, []); }

      const devPackages = this.listPackages(this.devPackagesDirectory, options);
      if (devPackages.length > 0) {
        if (!options.argv.bare && !options.argv.json) {
          console.log(`Dev Packages (${devPackages.length})`.cyan, `${this.devPackagesDirectory}`);
        }
      }
      return callback?.(null, devPackages);
    }

    listGitPackages(options, callback) {
      const gitPackages = this.listPackages(this.userPackagesDirectory, options)
        .filter(pack => pack.apmInstallSource?.type === 'git');
      if (gitPackages.length > 0) {
        if (!options.argv.bare && !options.argv.json) {
          console.log(`Git Packages (${gitPackages.length})`.cyan, `${this.userPackagesDirectory}`);
        }
      }
      return callback?.(null, gitPackages);
    }

    listBundledPackages(options, callback) {
      return config.getResourcePath(resourcePath => {
        let _atomPackages;
        let metadata;
        try {
          const metadataPath = path.join(resourcePath, 'package.json');
          ({_atomPackages} = JSON.parse(fs.readFileSync(metadataPath)));
        } catch (error) {}
        if (_atomPackages == null) { _atomPackages = {}; }
        let packages = ((() => {
          const result = [];
          for (let packageName in _atomPackages) {
            ({metadata} = _atomPackages[packageName]);
            result.push(metadata);
          }
          return result;
        })());

        packages = packages.filter(metadata => {
          return this.isPackageVisible(options, metadata);
        });

        if (!options.argv.bare && !options.argv.json) {
          if (options.argv.themes) {
            console.log(`${'Built-in Atom Themes'.cyan} (${packages.length})`);
          } else {
            console.log(`${'Built-in Atom Packages'.cyan} (${packages.length})`);
          }
        }

        return callback?.(null, packages);
      });
    }

    listInstalledPackages(options) {
      this.listDevPackages(options, (error, packages) => {
        if (packages.length > 0) { this.logPackages(packages, options); }

        this.listUserPackages(options, (error, packages) => {
          this.logPackages(packages, options);

          this.listGitPackages(options, (error, packages) => {
            if (packages.length > 0) { return this.logPackages(packages, options); }
          });
        });
      });
    }

    listPackagesAsJson(options, callback) {
      if (callback == null) { callback = function() {}; }
      const output = {
        core: [],
        dev: [],
        git: [],
        user: []
      };

      this.listBundledPackages(options, (error, packages) => {
        if (error) { return callback(error); }
        output.core = packages;
        this.listDevPackages(options, (error, packages) => {
          if (error) { return callback(error); }
          output.dev = packages;
          this.listUserPackages(options, (error, packages) => {
            if (error) { return callback(error); }
            output.user = packages;
            this.listGitPackages(options, function(error, packages) {
              if (error) { return callback(error); }
              output.git = packages;
              console.log(JSON.stringify(output));
              return callback();
            });
          });
        });
      });
    }

    run(options) {
      const {callback} = options;
      options = this.parseOptions(options.commandArgs);

      if (options.argv.json) {
        return this.listPackagesAsJson(options, callback);
      } else if (options.argv.installed) {
        this.listInstalledPackages(options);
        return callback();
      } else {
        this.listBundledPackages(options, (error, packages) => {
          this.logPackages(packages, options);
          this.listInstalledPackages(options);
          return callback();
        });
      }
    }
  }
