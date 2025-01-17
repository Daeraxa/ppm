
const child_process = require('child_process');
const path = require('path');
const _ = require('underscore-plus');
const semver = require('semver');
const config = require('./apm');
const git = require('./git');

module.exports =
class Command {
  constructor() {
    this.logCommandResults = this.logCommandResults.bind(this);
    this.logCommandResultsIfFail = this.logCommandResultsIfFail.bind(this);
  }

  spawn(command, args, ...remaining) {
    let options;
    if (remaining.length >= 2) { options = remaining.shift(); }
    const callback = remaining.shift();

    const spawned = child_process.spawn(command, args, options);

    const errorChunks = [];
    const outputChunks = [];

    spawned.stdout.on('data', function(chunk) {
      if ((options != null ? options.streaming : undefined)) {
        return process.stdout.write(chunk);
      } else {
        return outputChunks.push(chunk);
      }
    });

    spawned.stderr.on('data', function(chunk) {
      if ((options != null ? options.streaming : undefined)) {
        return process.stderr.write(chunk);
      } else {
        return errorChunks.push(chunk);
      }
    });

    const onChildExit = function(errorOrExitCode) {
      spawned.removeListener('error', onChildExit);
      spawned.removeListener('close', onChildExit);
      return (typeof callback === 'function' ? callback(errorOrExitCode, Buffer.concat(errorChunks).toString(), Buffer.concat(outputChunks).toString()) : undefined);
    };

    spawned.on('error', onChildExit);
    spawned.on('close', onChildExit);

    return spawned;
  }

  fork(script, args, ...remaining) {
    args.unshift(script);
    return this.spawn(process.execPath, args, ...remaining);
  }

  packageNamesFromArgv(argv) {
    return this.sanitizePackageNames(argv._);
  }

  sanitizePackageNames(packageNames) {
    if (packageNames == null) { packageNames = []; }
    packageNames = packageNames.map(packageName => packageName.trim());
    return _.compact(_.uniq(packageNames));
  }

  logSuccess() {
    if (process.platform === 'win32') {
      return process.stdout.write('done\n'.green);
    } else {
      return process.stdout.write('\u2713\n'.green);
    }
  }

  logFailure() {
    if (process.platform === 'win32') {
      return process.stdout.write('failed\n'.red);
    } else {
      return process.stdout.write('\u2717\n'.red);
    }
  }

  logCommandResults(callback, code, stderr, stdout) {
    if (stderr == null) { stderr = ''; }
    if (stdout == null) { stdout = ''; }
    if (code === 0) {
      this.logSuccess();
      return callback();
    } else {
      this.logFailure();
      return callback(`${stdout}\n${stderr}`.trim());
    }
  }

  logCommandResultsIfFail(callback, code, stderr, stdout) {
    if (stderr == null) { stderr = ''; }
    if (stdout == null) { stdout = ''; }
    if (code === 0) {
      return callback();
    } else {
      this.logFailure();
      return callback(`${stdout}\n${stderr}`.trim());
    }
  }

  normalizeVersion(version) {
    if (typeof version === 'string') {
      // Remove commit SHA suffix
      return version.replace(/-.*$/, '');
    } else {
      return version;
    }
  }

  loadInstalledAtomMetadata(callback) {
    this.getResourcePath(resourcePath => {
      let electronVersion;
      try {
        let version;
        ({ version, electronVersion } = require(path.join(resourcePath, "package.json")) ?? {});
        version = this.normalizeVersion(version);
        if (semver.valid(version)) { this.installedAtomVersion = version; }
      } catch (error) {}

      this.electronVersion = process.env.ATOM_ELECTRON_VERSION ?? electronVersion;
      if (this.electronVersion == null) {
        throw new Error('Could not determine Electron version');
      }

      return callback();
    });
  }

  getResourcePath(callback) {
    if (this.resourcePath) {
      return process.nextTick(() => callback(this.resourcePath));
    } else {
      return config.getResourcePath(resourcePath => { this.resourcePath = resourcePath; return callback(this.resourcePath); });
    }
  }

  addBuildEnvVars(env) {
    if (config.isWin32()) { this.updateWindowsEnv(env); }
    this.addNodeBinToEnv(env);
    this.addProxyToEnv(env);
    env.npm_config_runtime = "electron";
    env.npm_config_target = this.electronVersion;
    env.npm_config_disturl = config.getElectronUrl();
    env.npm_config_arch = config.getElectronArch();
    env.npm_config_target_arch = config.getElectronArch(); // for node-pre-gyp
    env.npm_config_force_process_config = "true"; // for node-gyp
  }
    // node-gyp >=8.4.0 needs --force-process-config=true set for older Electron.
    // For more details, see: https://github.com/nodejs/node-gyp/pull/2497,
    // and also see the issues/PRs linked from that one for more context.

  getNpmBuildFlags() {
    return [`--target=${this.electronVersion}`, `--disturl=${config.getElectronUrl()}`, `--arch=${config.getElectronArch()}`, "--force-process-config"];
  }

  updateWindowsEnv(env) {
    env.USERPROFILE = env.HOME;

    return git.addGitToEnv(env);
  }

  addNodeBinToEnv(env) {
    const nodeBinFolder = path.resolve(__dirname, '..', 'bin');
    const pathKey = config.isWin32() ? 'Path' : 'PATH';
    if (env[pathKey]) {
      return env[pathKey] = `${nodeBinFolder}${path.delimiter}${env[pathKey]}`;
    } else {
      return env[pathKey]= nodeBinFolder;
    }
  }

  addProxyToEnv(env) {
    const httpProxy = this.npm.config.get('proxy');
    if (httpProxy) {
      if (env.HTTP_PROXY == null) { env.HTTP_PROXY = httpProxy; }
      if (env.http_proxy == null) { env.http_proxy = httpProxy; }
    }

    const httpsProxy = this.npm.config.get('https-proxy');
    if (httpsProxy) {
      if (env.HTTPS_PROXY == null) { env.HTTPS_PROXY = httpsProxy; }
      if (env.https_proxy == null) { env.https_proxy = httpsProxy; }

      // node-gyp only checks HTTP_PROXY (as of node-gyp@4.0.0)
      if (env.HTTP_PROXY == null) { env.HTTP_PROXY = httpsProxy; }
      if (env.http_proxy == null) { env.http_proxy = httpsProxy; }
    }

    // node-gyp doesn't currently have an option for this so just set the
    // environment variable to bypass strict SSL
    // https://github.com/nodejs/node-gyp/issues/448
    const useStrictSsl = this.npm.config.get("strict-ssl") ?? true;
    if (!useStrictSsl) { return env.NODE_TLS_REJECT_UNAUTHORIZED = 0; }
  }
};
