
const path = require('path');
const url = require('url');

const yargs = require('yargs');
const Git = require('git-utils');
const semver = require('semver');

const fs = require('./fs');
const config = require('./apm');
const Command = require('./command');
const Login = require('./login');
const Packages = require('./packages');
const request = require('./request');

module.exports =
class Publish extends Command {
  static commandNames = [ "publish" ];

    constructor() {
      super();
      this.userConfigPath = config.getUserConfigPath();
      this.atomNpmPath = require.resolve('npm/bin/npm-cli');
    }

    parseOptions(argv) {
      const options = yargs(argv).wrap(Math.min(100, yargs.terminalWidth()));
      options.usage(`\

Usage: ppm publish [<newversion> | major | minor | patch | build]
       ppm publish --tag <tagname>
       ppm publish --rename <new-name>

Publish a new version of the package in the current working directory.

If a new version or version increment is specified, then a new Git tag is
created and the package.json file is updated with that new version before
it is published to the ppm registry. The HEAD branch and the new tag are
pushed up to the remote repository automatically using this option.

If a tag is provided via the --tag flag, it must have the form \`vx.y.z\`.
For example, \`ppm publish -t v1.12.0\`.

If a new name is provided via the --rename flag, the package.json file is
updated with the new name and the package's name is updated.

Run \`ppm featured\` to see all the featured packages or
\`ppm view <packagename>\` to see information about your package after you
have published it.\
`
      );
      options.alias('h', 'help').describe('help', 'Print this usage message');
      options.alias('t', 'tag').string('tag').describe('tag', 'Specify a tag to publish. Must be of the form vx.y.z');
      return options.alias('r', 'rename').string('rename').describe('rename', 'Specify a new name for the package');
    }

    // Create a new version and tag use the `npm version` command.
    //
    // version  - The new version or version increment.
    // callback - The callback function to invoke with an error as the first
    //            argument and a the generated tag string as the second argument.
    versionPackage(version, callback) {
      process.stdout.write('Preparing and tagging a new version ');
      const versionArgs = ['version', version, '-m', 'Prepare v%s release'];
      return this.fork(this.atomNpmPath, versionArgs, (code, stderr, stdout) => {
        if (stderr == null) { stderr = ''; }
        if (stdout == null) { stdout = ''; }
        if (code === 0) {
          this.logSuccess();
          return callback(null, stdout.trim());
        } else {
          this.logFailure();
          return callback(`${stdout}\n${stderr}`.trim());
        }
      });
    }

    // Push a tag to the remote repository.
    //
    //  tag - The tag to push.
    //  pack - The package metadata.
    //  callback - The callback function to invoke with an error as the first
    //             argument.
    pushVersion(tag, pack, callback) {
      process.stdout.write(`Pushing ${tag} tag `);
      const pushArgs = ['push', Packages.getRemote(pack), 'HEAD', tag];
      return this.spawn('git', pushArgs, (...args) => {
        return this.logCommandResults(callback, ...args);
      });
    }

    // Check for the tag being available from the GitHub API before notifying
    // the package server about the new version.
    //
    // The tag is checked for 5 times at 1 second intervals.
    //
    // pack - The package metadata.
    // tag - The tag that was pushed.
    // callback - The callback function to invoke when either the tag is available
    //            or the maximum numbers of requests for the tag have been made.
    //            No arguments are passed to the callback when it is invoked.
    waitForTagToBeAvailable(pack, tag, callback) {
      let retryCount = 5;
      const interval = 1000;
      const requestSettings = {
        url: `https://api.github.com/repos/${Packages.getRepository(pack)}/tags`,
        json: true
      };

      var requestTags = () => request.get(requestSettings, function(error, response, tags) {
        if (tags == null) { tags = []; }
        if ((response != null ? response.statusCode : undefined) === 200) {
          for (let index = 0; index < tags.length; index++) {
            const {name} = tags[index];
            if (name === tag) {
              return callback();
            }
          }
        }
        if (--retryCount <= 0) {
          return callback();
        } else {
          return setTimeout(requestTags, interval);
        }
      });
      return requestTags();
    }

    // Does the given package already exist in the registry?
    //
    // packageName - The string package name to check.
    // callback    - The callback function invoke with an error as the first
    //               argument and true/false as the second argument.
    packageExists(packageName, callback) {
      return Login.getTokenOrLogin(function(error, token) {
        if (error != null) { return callback(error); }

        const requestSettings = {
          url: `${config.getAtomPackagesUrl()}/${packageName}`,
          json: true,
          headers: {
            authorization: token
          }
        };
        return request.get(requestSettings, function(error, response, body) {
          if (body == null) { body = {}; }
          if (error != null) {
            return callback(error);
          } else {
            return callback(null, response.statusCode === 200);
          }
        });
      });
    }

    // Register the current repository with the package registry.
    //
    // pack - The package metadata.
    // callback - The callback function.
    registerPackage(pack, callback) {
      if (!pack.name) {
        callback('Required name field in package.json not found');
        return;
      }

      this.packageExists(pack.name, (error, exists) => {
        let repository;
        if (error != null) { return callback(error); }
        if (exists) { return callback(); }

        if (!(repository = Packages.getRepository(pack))) {
          callback('Unable to parse repository name/owner from package.json repository field');
          return;
        }

        process.stdout.write(`Registering ${pack.name} `);
        return Login.getTokenOrLogin((error, token) => {
          if (error != null) {
            this.logFailure();
            callback(error);
            return;
          }

          const requestSettings = {
            url: config.getAtomPackagesUrl(),
            json: true,
            qs: {
              repository
            },
            headers: {
              authorization: token
            }
          };
          request.post(requestSettings, (error, response, body) => {
            if (body == null) { body = {}; }
            if (error != null) {
              return callback(error);
            } else if (response.statusCode !== 201) {
              const message = request.getErrorMessage(response, body);
              this.logFailure();
              return callback(`Registering package in ${repository} repository failed: ${message}`);
            } else {
              this.logSuccess();
              return callback(null, true);
            }
          });
        });
      });
    }

    // Create a new package version at the given Git tag.
    //
    // packageName - The string name of the package.
    // tag - The string Git tag of the new version.
    // callback - The callback function to invoke with an error as the first
    //            argument.
    createPackageVersion(packageName, tag, options, callback) {
      Login.getTokenOrLogin(function(error, token) {
        if (error != null) {
          callback(error);
          return;
        }

        const requestSettings = {
          url: `${config.getAtomPackagesUrl()}/${packageName}/versions`,
          json: true,
          qs: {
            tag,
            rename: options.rename
          },
          headers: {
            authorization: token
          }
        };
        request.post(requestSettings, function(error, response, body) {
          if (body == null) { body = {}; }
          if (error != null) {
            return callback(error);
          } else if (response.statusCode !== 201) {
            const message = request.getErrorMessage(response, body);
            return callback(`Creating new version failed: ${message}`);
          } else {
            return callback();
          }
        });
      });
    }

    // Publish the version of the package associated with the given tag.
    //
    // pack - The package metadata.
    // tag - The Git tag string of the package version to publish.
    // options - An options Object (optional).
    // callback - The callback function to invoke when done with an error as the
    //            first argument.
    publishPackage(pack, tag, ...remaining) {
      let options;
      if (remaining.length >= 2) { options = remaining.shift(); }
      if (options == null) { options = {}; }
      const callback = remaining.shift();

      process.stdout.write(`Publishing ${options.rename || pack.name}@${tag} `);
      this.createPackageVersion(pack.name, tag, options, error => {
        if (error != null) {
          this.logFailure();
          return callback(error);
        } else {
          this.logSuccess();
          return callback();
        }
      });
    }

    logFirstTimePublishMessage(pack) {
      process.stdout.write('Congrats on publishing a new package!'.rainbow);
      // :+1: :package: :tada: when available
      if (process.platform === 'darwin') {
        process.stdout.write(' \uD83D\uDC4D  \uD83D\uDCE6  \uD83C\uDF89');
      }

      return process.stdout.write(`\nCheck it out at https://web.pulsar-edit.dev/packages/${pack.name}\n`);
    }

    loadMetadata() {
      const metadataPath = path.resolve('package.json');
      if (!fs.isFileSync(metadataPath)) {
        throw new Error(`No package.json file found at ${process.cwd()}/package.json`);
      }

      try {
        return JSON.parse(fs.readFileSync(metadataPath));
      } catch (error) {
        throw new Error(`Error parsing package.json file: ${error.message}`);
      }
    }

    saveMetadata(pack, callback) {
      const metadataPath = path.resolve('package.json');
      const metadataJson = JSON.stringify(pack, null, 2);
      return fs.writeFile(metadataPath, `${metadataJson}\n`, callback);
    }

    loadRepository() {
      let currentBranch, remoteName, upstreamUrl;
      const currentDirectory = process.cwd();

      const repo = Git.open(currentDirectory);
      if (!(repo != null ? repo.isWorkingDirectory(currentDirectory) : undefined)) {
        throw new Error('Package must be in a Git repository before publishing: https://help.github.com/articles/create-a-repo');
      }


      if (currentBranch = repo.getShortHead()) {
        remoteName = repo.getConfigValue(`branch.${currentBranch}.remote`);
      }
      if (remoteName == null) { remoteName = repo.getConfigValue('branch.master.remote'); }

      if (remoteName) { upstreamUrl = repo.getConfigValue(`remote.${remoteName}.url`); }
      if (upstreamUrl == null) { upstreamUrl = repo.getConfigValue('remote.origin.url'); }

      if (!upstreamUrl) {
        throw new Error('Package must be pushed up to GitHub before publishing: https://help.github.com/articles/create-a-repo');
      }
    }

    // Rename package if necessary
    renamePackage(pack, name, callback) {
      if ((name != null ? name.length : undefined) > 0) {
        if (pack.name === name) { return callback('The new package name must be different than the name in the package.json file'); }

        const message = `Renaming ${pack.name} to ${name} `;
        process.stdout.write(message);
        return this.setPackageName(pack, name, error => {
          if (error != null) {
            this.logFailure();
            return callback(error);
          }

          return config.getSetting('git', gitCommand => {
            if (gitCommand == null) { gitCommand = 'git'; }
            return this.spawn(gitCommand, ['add', 'package.json'], (code, stderr, stdout) => {
              if (stderr == null) { stderr = ''; }
              if (stdout == null) { stdout = ''; }
              if (code !== 0) {
                this.logFailure();
                const addOutput = `${stdout}\n${stderr}`.trim();
                return callback(`\`git add package.json\` failed: ${addOutput}`);
              }

              return this.spawn(gitCommand, ['commit', '-m', message], (code, stderr, stdout) => {
                if (stderr == null) { stderr = ''; }
                if (stdout == null) { stdout = ''; }
                if (code === 0) {
                  this.logSuccess();
                  return callback();
                } else {
                  this.logFailure();
                  const commitOutput = `${stdout}\n${stderr}`.trim();
                  return callback(`Failed to commit package.json: ${commitOutput}`);
                }
              });
            });
          });
        });
      } else {
        // Just fall through if the name is empty
        return callback();
      }
    }

    setPackageName(pack, name, callback) {
      pack.name = name;
      return this.saveMetadata(pack, callback);
    }

    validateSemverRanges(pack) {
      let packageName, semverRange;
      if (!pack) { return; }

      const isValidRange = function(semverRange) {
        if (semver.validRange(semverRange)) { return true; }

        try {
          if (url.parse(semverRange).protocol.length > 0) { return true; }
        } catch (error) {}

        return semverRange === 'latest';
      };

      const range = pack.engines?.pulsar ?? pack.engines?.atom ?? undefined;
      if (range != null) {
        if (!semver.validRange(range)) {
          throw new Error(`The Pulsar or Atom engine range in the package.json file is invalid: ${range}`);
        }
      }

      for (packageName in pack.dependencies) {
        semverRange = pack.dependencies[packageName];
        if (!isValidRange(semverRange)) {
          throw new Error(`The ${packageName} dependency range in the package.json file is invalid: ${semverRange}`);
        }
      }

      for (packageName in pack.devDependencies) {
        semverRange = pack.devDependencies[packageName];
        if (!isValidRange(semverRange)) {
          throw new Error(`The ${packageName} dev dependency range in the package.json file is invalid: ${semverRange}`);
        }
      }

    }

    // Run the publish command with the given options
    run(options) {
      let error, pack;
      const {callback} = options;
      options = this.parseOptions(options.commandArgs);
      let {tag, rename} = options.argv;
      let [version] = options.argv._;

      try {
        pack = this.loadMetadata();
      } catch (error1) {
        error = error1;
        return callback(error);
      }

      try {
        this.validateSemverRanges(pack);
      } catch (error2) {
        error = error2;
        return callback(error);
      }

      try {
        this.loadRepository();
      } catch (error3) {
        error = error3;
        return callback(error);
      }

      if (((version != null ? version.length : undefined) > 0) || ((rename != null ? rename.length : undefined) > 0)) {
        let originalName;
        if (!((version != null ? version.length : undefined) > 0)) { version = 'patch'; }
        if ((rename != null ? rename.length : undefined) > 0) { originalName = pack.name; }

        this.registerPackage(pack, (error, firstTimePublishing) => {
          if (error != null) { return callback(error); }

          this.renamePackage(pack, rename, error => {
            if (error != null) { return callback(error); }

            this.versionPackage(version, (error, tag) => {
              if (error != null) { return callback(error); }

              this.pushVersion(tag, pack, error => {
                if (error != null) { return callback(error); }

                this.waitForTagToBeAvailable(pack, tag, () => {

                  if (originalName != null) {
                    // If we're renaming a package, we have to hit the API with the
                    // current name, not the new one, or it will 404.
                    rename = pack.name;
                    pack.name = originalName;
                  }
                  this.publishPackage(pack, tag, {rename},  error => {
                    if (firstTimePublishing && (error == null)) {
                      this.logFirstTimePublishMessage(pack);
                    }
                    return callback(error);
                  });
                });
              });
            });
          });
        });
      } else if ((tag != null ? tag.length : undefined) > 0) {
        this.registerPackage(pack, (error, firstTimePublishing) => {
          if (error != null) { return callback(error); }

          this.publishPackage(pack, tag, error => {
            if (firstTimePublishing && (error == null)) {
              this.logFirstTimePublishMessage(pack);
            }
            return callback(error);
          });
        });
      } else {
        return callback('A version, tag, or new package name is required');
      }
    }
  }
