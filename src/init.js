
const path = require('path');

const yargs = require('yargs');

const Command = require('./command');
const fs = require('./fs');

module.exports =
class Init extends Command {
  static commandNames = [ "init" ];

  constructor() {
    super();
    this.supportedSyntaxes = [ "coffeescript", "javascript" ];
  }

    parseOptions(argv) {
      const options = yargs(argv).wrap(Math.min(100, yargs.terminalWidth()));

      options.usage(`\
Usage:
  ppm init -p <package-name>
  ppm init -p <package-name> --syntax <javascript-or-coffeescript>
  ppm init -p <package-name> -c ~/Downloads/r.tmbundle
  ppm init -p <package-name> -c https://github.com/textmate/r.tmbundle
  ppm init -p <package-name> --template /path/to/your/package/template

  ppm init -t <theme-name>
  ppm init -t <theme-name> -c ~/Downloads/Dawn.tmTheme
  ppm init -t <theme-name> -c https://raw.github.com/chriskempson/tomorrow-theme/master/textmate/Tomorrow-Night-Eighties.tmTheme
  ppm init -t <theme-name> --template /path/to/your/theme/template

  ppm init -l <language-name>

Generates code scaffolding for either a theme or package depending
on the option selected.\
`
      );
      options.alias('p', 'package').string('package').describe('package', 'Generates a basic package');
      options.alias('s', 'syntax').string('syntax').describe('syntax', 'Sets package syntax to CoffeeScript or JavaScript');
      options.alias('t', 'theme').string('theme').describe('theme', 'Generates a basic theme');
      options.alias('l', 'language').string('language').describe('language', 'Generates a basic language package');
      options.alias('c', 'convert').string('convert').describe('convert', 'Path or URL to TextMate bundle/theme to convert');
      options.alias('h', 'help').describe('help', 'Print this usage message');
      return options.string('template').describe('template', 'Path to the package or theme template');
    }

    run(options) {
      let templatePath;
      const {callback} = options;
      options = this.parseOptions(options.commandArgs);
      if ((options.argv.package != null ? options.argv.package.length : undefined) > 0) {
        if (options.argv.convert) {
          return this.convertPackage(options.argv.convert, options.argv.package, callback);
        } else {
          const packagePath = path.resolve(options.argv.package);
          const syntax = options.argv.syntax || this.supportedSyntaxes[0];
          if (!Array.from(this.supportedSyntaxes).includes(syntax)) {
            return callback(`You must specify one of ${this.supportedSyntaxes.join(', ')} after the --syntax argument`);
          }
          templatePath = this.getTemplatePath(options.argv, `package-${syntax}`);
          this.generateFromTemplate(packagePath, templatePath);
          return callback();
        }
      } else if ((options.argv.theme != null ? options.argv.theme.length : undefined) > 0) {
        if (options.argv.convert) {
          return this.convertTheme(options.argv.convert, options.argv.theme, callback);
        } else {
          const themePath = path.resolve(options.argv.theme);
          templatePath = this.getTemplatePath(options.argv, 'theme');
          this.generateFromTemplate(themePath, templatePath);
          return callback();
        }
      } else if ((options.argv.language != null ? options.argv.language.length : undefined) > 0) {
        let languagePath = path.resolve(options.argv.language);
        const languageName = path.basename(languagePath).replace(/^language-/, '');
        languagePath = path.join(path.dirname(languagePath), `language-${languageName}`);
        templatePath = this.getTemplatePath(options.argv, 'language');
        this.generateFromTemplate(languagePath, templatePath, languageName);
        return callback();
      } else if (options.argv.package != null) {
        return callback('You must specify a path after the --package argument');
      } else if (options.argv.theme != null) {
        return callback('You must specify a path after the --theme argument');
      } else {
        return callback('You must specify either --package, --theme or --language to `ppm init`');
      }
    }

    convertPackage(sourcePath, destinationPath, callback) {
      if (!destinationPath) {
        callback("Specify directory to create package in using --package");
        return;
      }

      const PackageConverter = require('./package-converter');
      const converter = new PackageConverter(sourcePath, destinationPath);
      return converter.convert(error => {
        if (error != null) {
          return callback(error);
        } else {
          destinationPath = path.resolve(destinationPath);
          const templatePath = path.resolve(__dirname, '..', 'templates', 'bundle');
          this.generateFromTemplate(destinationPath, templatePath);
          return callback();
        }
      });
    }

    convertTheme(sourcePath, destinationPath, callback) {
      if (!destinationPath) {
        callback("Specify directory to create theme in using --theme");
        return;
      }

      const ThemeConverter = require('./theme-converter');
      const converter = new ThemeConverter(sourcePath, destinationPath);
      converter.convert(error => {
        if (error != null) {
          return callback(error);
        } else {
          destinationPath = path.resolve(destinationPath);
          const templatePath = path.resolve(__dirname, '..', 'templates', 'theme');
          this.generateFromTemplate(destinationPath, templatePath);
          fs.removeSync(path.join(destinationPath, 'styles', 'colors.less'));
          fs.removeSync(path.join(destinationPath, 'LICENSE.md'));
          return callback();
        }
      });
    }

    generateFromTemplate(packagePath, templatePath, packageName) {
      if (packageName == null) { packageName = path.basename(packagePath); }
      const packageAuthor = process.env.GITHUB_USER || 'atom';

      fs.makeTreeSync(packagePath);

      return (() => {
        const result = [];
        for (let childPath of Array.from(fs.listRecursive(templatePath))) {
          const templateChildPath = path.resolve(templatePath, childPath);
          let relativePath = templateChildPath.replace(templatePath, "");
          relativePath = relativePath.replace(/^\//, '');
          relativePath = relativePath.replace(/\.template$/, '');
          relativePath = this.replacePackageNamePlaceholders(relativePath, packageName);

          const sourcePath = path.join(packagePath, relativePath);
          if (fs.existsSync(sourcePath)) { continue; }
          if (fs.isDirectorySync(templateChildPath)) {
            result.push(fs.makeTreeSync(sourcePath));
          } else if (fs.isFileSync(templateChildPath)) {
            fs.makeTreeSync(path.dirname(sourcePath));
            let contents = fs.readFileSync(templateChildPath).toString();
            contents = this.replacePackageNamePlaceholders(contents, packageName);
            contents = this.replacePackageAuthorPlaceholders(contents, packageAuthor);
            contents = this.replaceCurrentYearPlaceholders(contents);
            result.push(fs.writeFileSync(sourcePath, contents));
          } else {
            result.push(undefined);
          }
        }
        return result;
      })();
    }

    replacePackageAuthorPlaceholders(string, packageAuthor) {
      return string.replace(/__package-author__/g, packageAuthor);
    }

    replacePackageNamePlaceholders(string, packageName) {
      const placeholderRegex = /__(?:(package-name)|([pP]ackageName)|(package_name))__/g;
      return string = string.replace(placeholderRegex, (match, dash, camel, underscore) => {
        if (dash) {
          return this.dasherize(packageName);
        } else if (camel) {
          if (/[a-z]/.test(camel[0])) {
            packageName = packageName[0].toLowerCase() + packageName.slice(1);
          } else if (/[A-Z]/.test(camel[0])) {
            packageName = packageName[0].toUpperCase() + packageName.slice(1);
          }
          return this.camelize(packageName);

        } else if (underscore) {
          return this.underscore(packageName);
        }
      });
    }

    replaceCurrentYearPlaceholders(string) {
      return string.replace('__current_year__', new Date().getFullYear());
    }

    getTemplatePath(argv, templateType) {
      if (argv.template != null) {
        return path.resolve(argv.template);
      } else {
        return path.resolve(__dirname, '..', 'templates', templateType);
      }
    }

    dasherize(string) {
      string = string[0].toLowerCase() + string.slice(1);
      return string.replace(/([A-Z])|(_)/g, function(m, letter, underscore) {
        if (letter) {
          return "-" + letter.toLowerCase();
        } else {
          return "-";
        }
      });
    }

    camelize(string) {
      return string.replace(/[_-]+(\w)/g, m => m[1].toUpperCase());
    }

    underscore(string) {
      string = string[0].toLowerCase() + string.slice(1);
      return string.replace(/([A-Z])|(-)/g, function(m, letter, dash) {
        if (letter) {
          return "_" + letter.toLowerCase();
        } else {
          return "_";
        }
      });
    }
  }
