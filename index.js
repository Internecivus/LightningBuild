'use strict';

const browserSync = require('browser-sync');
const chokidar = require('chokidar');
const esbuild = require('esbuild');
const fs = require('fs-extra');
const nodeSass = require('node-sass');
const path = require('path');
const util = require('util');
const babel = require('@babel/core');

/****** DEV ONLY! NOT PRODUCTION READY! ******/
process.env.NODE_ENV = 'development';

class Utils {
  static fastGetExtension(string) {
    let extension = '';
    for (let i = string.length - 1; i >= 0; i--) {
      if (string[i] === '?') {
        extension = '';
      } else if (string[i] === '.') {
        return extension;
      } else {
        extension = string[i] + extension;
      }
    }
  }

  static replaceAll(string, target, replacement) {
    while (string.indexOf(target) > -1) {
      string = string.replace(target, replacement);
    }
    return string;
  }

  static escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  static getCurrentTimeMs() {
    const time = process.hrtime();
    return (time[0] * 1000) + (time[1] / 1000000);
  }

  static normalizePath(path) {
    return path.split('\\').join('/');
  }

  static relativizePath(path) {
    return path && (path[0] === '/' ? path.substring(1) : path);
  }

  static getScriptFolder() {
    return Utils.normalizePath(process.cwd());
  }

  static getAllFilePaths(extension, folders) {
    let filePaths = [];
    for (let folder of folders) {
      for (let fileName of fs.readdirSync(folder)) {
        const filePath = path.join(folder, fileName);
        if (
          !fs.statSync(filePath).isDirectory()
          && Utils.fastGetExtension(fileName) === extension
        ) {
          filePaths = [...filePaths, filePath];
        }
      }
    }
    return filePaths;
  }

  static ensureFolderStructureExists(filePath) {
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(filePath, { recursive: true });
    }
  }

  static mergeDeep(target, ...sources) {
    if (!sources.length) return target;
    const source = sources.shift();

    if (Utils.isObject(target) && Utils.isObject(source)) {
      for (const key in source) {
        if (source.hasOwnProperty(key) && Utils.isObject(source[key])) {
          if (!target[key]) Object.assign(target, { [key]: {} });
          Utils.mergeDeep(target[key], source[key]);
        } else {
          Object.assign(target, { [key]: source[key] });
        }
      }
    }
    return Utils.mergeDeep(target, ...sources);
  }

  static isObject(item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
  }

  static resolveRequestPath({ outputPath, outputFolder }) {
    return Utils.relativizePath(outputPath.split(outputFolder)[1]);
  }

  static resolveRequestPathFromPath({ filePath, requestPath }) {
    return Utils.relativizePath(`${requestPath}/${filePath}`);
  }
}

class Configuration {
  async init() {
    const userConfiguration = await this.loadUserConfiguration();

    this._defaultMutableConfig();
    Utils.mergeDeep(this, this.defaultMutableConfig);
    Utils.mergeDeep(this, userConfiguration);
    this._defaultImmutableConfig();
    Utils.mergeDeep(this, this.defaultImmutableConfig);

    this.cssMapping.requestPath = Utils.resolveRequestPath({
      outputPath: this.cssMapping.outputFolder,
      outputFolder: this.outputFolder
    });
    this.jsMapping.requestPath = Utils.resolveRequestPath({
      outputPath: this.jsMapping.outputFolder,
      outputFolder: this.outputFolder
    });
    this.htmlMapping.requestPath = Utils.resolveRequestPath({
      outputPath: this.htmlMapping.outputFolder,
      outputFolder: this.outputFolder
    });

    this._chokidarConfig();
    this._nodeSassConfig();
    this._browserSyncConfig();
    this._esbuildConfig();

    if (configuration.alias) {
      this._aliasPlugin();
    } else if (configuration.useBabel) {
      this._babelPlugin();
    }
  }

  _defaultImmutableConfig() {
    return this.defaultImmutableConfig = Object.freeze({
      defaultMode: Configuration.MODE.development,
      hashFormat: `[name]${this.hashDelimiter}[hash]`,
      profilingEnabled: process.argv.includes('--profile'),
    });
  }

  _defaultMutableConfig() {
    return this.defaultMutableConfig = {
      alias: null,
      port: 3003,
      jsTarget: 'esnext',
      platform: 'browser',
      logLevel: 'silent',
      watcherIntervalMs: 100,
      serveFromMemory: this.isDevelopment(),
      useWatch: true,
      useMinify: this.isProduction(),
      useBabel: this.isProduction(),
      useSourcemaps: this.isDevelopment(),
      useHashes: this.isDevelopment(),
      useBrowserSync: true,
      babelConfig: undefined,
      hashDelimiter: '-',
      sourceFolder: null,
      watchFolder: [this.sourceFolder],
      outputFolder: null,
      requestPathIndex: '/',
      sassConfiguration: {},
      jsMapping: {
        sourceExtension: 'js',
        outputExtension: 'js',
        mimeType: 'text/javascript',
        sourceFolders: [this.sourceFolder],
        entryFiles: null,
        outputFolder: this.outputFolder,
      },
      htmlMapping: {
        sourceExtension: 'html',
        outputExtension: 'html',
        mimeType: 'text/html',
        indexFile: 'index.html',
        sourceFolders: [this.sourceFolder],
        outputFolder: this.outputFolder,
      },
      cssMapping: {
        sourceExtension: 'scss',
        outputExtension: 'css',
        mimeType: 'text/css',
        sourceFolders: [this.sourceFolder],
        entryFile: null,
        outputFolder: this.outputFolder,
        outputFile: null,
      },
      staticMapping: {
        sourceExtension: [],
        routes: [{ sourceFolders: null, outputFolder: null, }],
      },
      variables: {},
    };
  }

  _chokidarConfig() {
    return this.chokidarConfig = {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: this.watcherIntervalMs, },
    };
  }

  _nodeSassConfig() {
    return this.nodeSassConfig = {
      file: this.cssMapping.entryFile,
      outFile: this.cssMapping.outputFile,
      sourceMap: this.useSourcemaps,
      ...this.sassConfiguration,
    };
  }

  _browserSyncConfig() {
    return this.browserSyncConfig = {
      server: this.outputFolder,
      port: this.port,
      logLevel: this.logLevel,
      minify: false,
      ghostMode: false,
      notify: true,
      files: ['**/*.css'],
      serveStatic: this.staticMapping.routes.map((route) => {
        return {
          route: route.outputFolder.split(this.outputFolder)[1],
          dir: route.sourceFolders,
        }
      }),
    };
  }

  _aliasPlugin() {
    const regex = new RegExp(`${
      Object
        .keys(configuration.alias)
        .map(alias => `^${Utils.escapeRegExp(alias)}`)
        .join('|')}`);

    return this.aliasPlugin = {
      name: 'alias-plugin',
      setup(build) {
        build.onResolve({ filter: regex }, args => {
          const splitPath = args.path.split('/');
          const aliasKey = splitPath[0];
          const additionalPath = splitPath.slice(1).join('/');
          if (typeof configuration.alias[aliasKey] === 'undefined') {
            console.log();
          }
          const newPath = require.resolve(path.join(configuration.alias[aliasKey], additionalPath))

          return { path: newPath }
        })
      },
    }
  }

  _babelPlugin() {
    return this.babelPlugin = (options = {}) => ({
      name: 'babel',
      setup(build, { transform } = {}) {
        const { filter = /.*/, namespace = '', config = {} } = options;

        const transformContents = ({ args, contents }) => {
          const babelOptions = babel.loadOptions({
            ...config,
            filename: args.path,
            caller: {
              name: 'esbuild-plugin-babel',
              supportsStaticESM: true
            }
          });
          if (!babelOptions) return { contents };

          if (babelOptions.sourceMaps) {
            const filename = path.relative(process.cwd(), args.path);

            babelOptions.sourceFileName = filename;
          }

          return new Promise((resolve, reject) => {
            babel.transform(contents, babelOptions, (error, result) => {
              error ? reject(error) : resolve({ contents: result.code });
            });
          });
        };

        if (transform) return transformContents(transform);

        build.onLoad({ filter, namespace }, async args => {
          const contents = await fs.readFileSync(args.path, 'utf8');

          return transformContents({ args, contents });
        });
      }
    })
  }

  _esbuildConfig() {
    return this.esbuildConfig = {
      entryPoints: this.jsMapping.entryFiles,
      minify: this.useMinify,
      bundle: true,
      sourcemap: this.useSourcemaps ? 'inline' : false,
      incremental: true,
      outdir: this.jsMapping.outputFolder,
      logLevel: this.logLevel,
      platform: this.platform,
      target: this.jsTarget,
      write: !this.serveFromMemory,
      entryNames: this.useHashes ? this.hashFormat : undefined,
      define: this.variables,
    }
  };

  async loadUserConfiguration() {
    for (let directoryName of Configuration.CONFIGURATION_FILE_LOCATIONS) {
      const directoryPath = path.resolve(directoryName);
      for (let fileName of fs.readdirSync(directoryPath)) {
        const matches = Configuration.CONFIGURATION_FILE_REGEX.exec(fileName);
        const configFile = `${directoryPath}${path.sep}${fileName}`;
        if (matches && !fs.statSync(configFile).isDirectory()) {
          console.log(`Configuration file loaded: ${configFile}`);
          return await require(`${directoryName}/${fileName}`);
        }
      }
    }
    throw new Error('No user configuration found!');
  }

  getMode() {
    return Configuration.MODE[process.env.NODE_ENV] || this.defaultMode;
  }

  isDevelopment() {
    return this.getMode() === Configuration.MODE.development;
  }

  isProduction() {
    return this.getMode() === Configuration.MODE.production;
  }

  taskMessage({ extension, taskTimeMs }) {
    return {
      type: Configuration.MESSAGE.TASK,
      options: { extension, taskTimeMs },
      message: `⚡ ${extension.toUpperCase()} time: ${taskTimeMs}ms ⚡`,
    }
  }

  errorMessage(error) {
    return {
      type: Configuration.MESSAGE.ERROR,
      options: { error },
      message: error.message,
    }
  }

  initMessage({ taskTimeMs }) {
    return {
      type: Configuration.MESSAGE.INIT,
      options: { taskTimeMs },
      message: `⚡ INIT time: ${(Math.round(taskTimeMs))}ms TAKEOFF! ⚡`,
    }
  }

  profileMessage({ averageTimeMs, minTimeMs, maxTimeMs, file }) {
    return {
      type: Configuration.MESSAGE.PROFILE,
      options: { averageTimeMs, minTimeMs, maxTimeMs, file },
      message: `⚡ AVERAGE time: ${(Math.round(averageTimeMs))}ms ` +
        `(${(Math.round(minTimeMs))} - ${(Math.round(maxTimeMs))}) FOR ${file.toUpperCase()} ⚡`,
    }
  }
}
Configuration.MODE = {
  production: 'production',
  development: 'development',
};
Configuration.MESSAGE = {
  INIT: 'init',
  TASK: 'task',
  PROFILE: 'profile',
  ERROR: 'error',
};
Configuration.CONTENT_TYPE = 'Content-Type';
Configuration.REQUEST_ROOT = '/';
Configuration.CONFIGURATION_FILE_REGEX = new RegExp(/.*lightningBuild.config*\.m?js/);
Configuration.CONFIGURATION_FILE_LOCATIONS = [Utils.getScriptFolder()];

class MappedFileResult {
  constructor(mapping) {
    this.mapping = mapping;
    this.results = [];
  }

  clear() {
    this.results = [];
  }

  addResult({ contents, filePath }) {
    // filePath = filePath ?? Utils.resolveOutputPath({
    //   sourcePath: sourceFilePath, outputFolder: this.mapping.outputFolder });
    let fileName = path.basename(filePath);
    const requestPath = Utils.resolveRequestPathFromPath({
      filePath: fileName,
      requestPath: this.mapping.requestPath,
    });
    let requestPathWithoutHash;
    if (configuration.useHashes) {
      requestPathWithoutHash = this._resolveRequestPathWithoutHash(requestPath);
    }
    this.results = [...this.results, { contents, fileName, requestPath, requestPathWithoutHash }];
  }

  _resolveRequestPathWithoutHash(requestPath) {
    const splitWithDelimiter = requestPath.split(configuration.hashDelimiter);
    return `${splitWithDelimiter.slice(0, -1).join()}.${this.mapping.outputExtension}`;
  }

  getResultByRequestPath(targetRequestPath) {
    for (let result of this.results) {
      if (result.requestPath === Utils.relativizePath(targetRequestPath).split('?')[0]) {
        return result;
      }
    }
    throw new Error(`No file found for request: ${targetRequestPath}`);
  }

  getResultByRequestPathWithoutHash(targetRequestPath) {
    for (let result of this.results) {
      if (result.requestPathWithoutHash === Utils.relativizePath(targetRequestPath).split('?')[0]) {
        return result;
      }
    }
    throw new Error(`No file found for request: ${targetRequestPath}`);
  }
}

class TaskHTML {
  constructor() {
    if (!configuration.serveFromMemory) {
      Utils.ensureFolderStructureExists(configuration.htmlMapping.outputFolder);
    }
  }

  async run(filePath) {
    this.results = new MappedFileResult(configuration.htmlMapping);
    this.results.clear();

    this._files = Utils.getAllFilePaths(
      configuration.htmlMapping.sourceExtension,
      configuration.htmlMapping.sourceFolders);

    this._files.forEach((filePath) => {
      const contents = fs.readFileSync(filePath);
      this.results.addResult({ filePath: filePath, contents });
    });

    if (filePath) {
      // get by filePath and load this one only??
    }
    return this.results;
  }
}

class TaskSASS {
  constructor() {
    Utils.ensureFolderStructureExists(configuration.cssMapping.outputFolder);
    this._outputFilePath = path.join(
      configuration.cssMapping.outputFolder,
      configuration.cssMapping.outputFile);

    if (configuration.serveFromMemory) {
      fs.writeFileSync(this._outputFilePath, '');
    }
  }

  async run() {
    this.results = new MappedFileResult(configuration.cssMapping);
    this.results.clear();

    return new Promise((resolve, reject) => {
      nodeSass.render(configuration.nodeSassConfig, (error, renderResult) => {
        if (error) {
          reject(error);
          return;
        }

        if (!configuration.serveFromMemory) {
          fs.writeFileSync(this._outputFilePath, renderResult.css);
        } else {
          const date = new Date();
          fs.utimesSync(this._outputFilePath, date, date);
        }

        this.results.addResult({
          contents: renderResult.css,
          filePath: configuration.cssMapping.outputFile,
        });
        resolve(this.results);
      });
    });
  }
}

class TaskJS {
  constructor() {
    if (!configuration.serveFromMemory) {
      Utils.ensureFolderStructureExists(configuration.jsMapping.outputFolder);
    }
  }

  async run() {
    this.results = new MappedFileResult(configuration.jsMapping);
    this.results.clear();

    if (configuration.useHashes && !configuration.serveFromMemory) {
      fs.emptyDirSync(configuration.jsMapping.outputFolder);
    }

    if (this._esbuild) {
      this._task = this._rebuild();
    } else {
      this._task = this._firstBuild();
    }

    return new Promise(async (resolve, reject) => {
      try {
        this._esbuild = await this._task;
      } catch (error) {
        reject(error);
        return;
      }

      for (let outputFile of this._esbuild.outputFiles) {
        this.results.addResult({
          contents: outputFile.contents,
          filePath: outputFile.path,
        });
      }
      resolve(this.results);
    });
  }

  _rebuild() {
    return this._esbuild.rebuild();
  }

  _firstBuild() {
    const plugins = [];
    if (configuration.alias) {
      plugins.push(configuration.aliasPlugin);
    }
    if (configuration.useBabel) {
      plugins.push(configuration.babelPlugin(configuration.babelConfig))
    }
    return esbuild.build({
      ...configuration.esbuildConfig,
      plugins,
    });
  }
}

class Index {
  constructor() {
    this.messageLog = [];
    if (configuration.useBrowserSync) {
      this.initBrowserSync();
    }
    this.taskJS = new TaskJS();
    this.taskSASS = new TaskSASS();
    this.taskHTML = new TaskHTML();
  }

  initBrowserSync() {
    this.browser = browserSync.create();
    //this.browser.use(htmlInjector); Bug

    const config = configuration.browserSyncConfig;
    if (configuration.serveFromMemory) {
      config.middleware = this._serveFromMemoryMiddleware();
    }
    this.browser.init(config);
  }

  _serveFromMemoryMiddleware() {
    return (req, res) => {
      if (req.url === Configuration.REQUEST_ROOT) {
        req.url = configuration.htmlMapping.indexFile;
        this._serveHTMLFromMemory(req, res);
      } else if (Utils.fastGetExtension(req.url) === configuration.htmlMapping.outputExtension) {
        this._serveHTMLFromMemory(req, res);
      } else if (Utils.fastGetExtension(req.url) === configuration.cssMapping.outputExtension) {
        this._serveCSSFromMemory(req, res);
      } else if (Utils.fastGetExtension(req.url) === configuration.jsMapping.outputExtension) {
        this._serveJSFromMemory(req, res);
      }
    }
  }

  _serveHTMLFromMemory(req, res) {
    const contents = this.resultHTML.getResultByRequestPath(req.url).contents;
    let contentsStr = new util.TextDecoder().decode(contents);
    if (configuration.useHashes) {
      contentsStr = this._fixHashedLinksInFile(contentsStr);
    }
    res.end(contentsStr);
  }

  _serveCSSFromMemory(req, res) {
    const contents = this.resultSASS.getResultByRequestPath(req.url).contents;
    const contentsStr = new util.TextDecoder().decode(contents);
    res.end(contentsStr);
  }

  _serveJSFromMemory(req, res) {
    const contents = this.resultJS.getResultByRequestPath(req.url).contents;
    const contentsStr = new util.TextDecoder().decode(contents);
    res.end(contentsStr);
  }

  _fixHashedLinksInFile(string) {
    const linkRegex = new RegExp(/src=".*.js"/g);

    let linkMatch;
    while (linkMatch = linkRegex.exec(string)) {
      const fileMatch = Utils.replaceAll(linkMatch[0].split('=')[1], '"', '');
      const splitByHashDelimiter = fileMatch.split(configuration.hashDelimiter);
      const isHashed = splitByHashDelimiter.length > 1;
      const testedMatch = isHashed ? splitByHashDelimiter[0] : fileMatch;

      // Bug - temporary fix
      if (testedMatch === 'js/vendor.js') {
        string = string.replace(linkMatch, '');
      } else {
        const result = this.resultJS.getResultByRequestPathWithoutHash(testedMatch);
        if (testedMatch === result.requestPathWithoutHash) {
          const hashedLink = `src="${result.requestPath}"`;
          string = string.replace(linkMatch, hashedLink);
        }
      }
    }

    return string;
  }

  init() {
    const initStartMs = Utils.getCurrentTimeMs();
    this._init()
      .then(() => {
        const initEndMs = Utils.getCurrentTimeMs();
        const taskTimeMs = initEndMs - initStartMs;
        this._handleMessage(configuration.initMessage({ taskTimeMs }));
      })
      .catch((e) => {
        this._handleMessage(e);
      });
  }

  async _init() {
    if (configuration.useWatch) {
      configuration.watchFolder.forEach((watchFolder) => {
        this._initAutoSaveRun(watchFolder);
      });
    }
    await this._initRunAll();
  }

  async _initRunAll() {
    await Promise.all([this.taskHTML.run(), this.taskJS.run(), this.taskSASS.run()])
      .then((buildResults) => {
        this.resultHTML = buildResults[0];
        this.resultJS = buildResults[1];
        this.resultSASS = buildResults[2];

        this.reloadBrowser();
      })
  }

  reloadBrowser() {
    if (configuration.useBrowserSync) {
      this.browser.reload();
    }
  }

  _initAutoSaveRun(watchFolder) {
    chokidar
      .watch(`${watchFolder}/**`, configuration.chokidarConfig)
      .on('all', async (event, path) => {
        const taskStartMs = Utils.getCurrentTimeMs();
        const extension = Utils.fastGetExtension(path);

        try {
          await this._runTaskForExtension(extension, path);
        } catch (e) {
          this._handleMessage(configuration.errorMessage(e));
          return;
        }

        const taskEndMs = Utils.getCurrentTimeMs();
        const taskTimeMs = Math.round(taskEndMs - taskStartMs);
        this._handleMessage(configuration.taskMessage({ extension, taskTimeMs }));
      });
  }

  async _runTaskForExtension(extension, path) {
    if (extension === configuration.jsMapping.sourceExtension) {
      this.resultJS = await this.taskJS.run();
      this.reloadBrowser();
    } else if (extension === configuration.cssMapping.sourceExtension) {
      this.resultSASS = await this.taskSASS.run();
    } else if (extension === configuration.htmlMapping.sourceExtension) {
      this.resultHTML = await this.taskHTML.run(path);
      // htmlInjector(path, stats); Bug
      this.reloadBrowser();
    } else if (configuration.staticMapping.sourceExtension.includes(extension)) {
      this.reloadBrowser();
    } else {
    }
  }

  _handleMessage(message) {
    this.messageLog = [...this.messageLog, message];
    console.log(message.message);
    if (configuration.useBrowserSync && this.browser) {
      setTimeout(() => {
        this.browser.notify(message.message, 4000);
      }, 2000);
    }
  }
}

class Profiler {
  async init() {
    this.lightningBuild = new Index()
    await this.lightningBuild.init();

    this.taskIterations = 50;
    this.taskTimeoutMs = 1000;
    this.ignoreFirstNTasks = 6;

    this.testJSFile = configuration.jsMapping.entryFiles[0];
    this.testCSSFile = configuration.cssMapping.entryFile;

    this.testFiles = [this.testJSFile, this.testCSSFile];

    this._profileTasks(0, this.taskIterations, () => {
      this._sendProfileMessage();
      process.exit();
    });
  }

  _sendProfileMessage() {
    const messagesByExtension = this.getTaskMessagesGroupedByExtension();
    for (const extension of Object.keys(messagesByExtension)) {
      const messages = messagesByExtension[extension];
      const timeStats = messages
        .map((message) => message.options.taskTimeMs)
        .reduce((acc, value) => {
          acc.min = (!acc.min || value < acc.min) ? value : acc.min
          acc.max = (!acc.max || value > acc.max) ? value : acc.max;
          acc.sum = (acc.sum || 0) + value;
          return acc;
        }, {});

      const profileMessage = configuration.profileMessage({
        maxTimeMs: timeStats.max,
        minTimeMs: timeStats.min,
        averageTimeMs: timeStats.sum / messages.length,
        file: extension,
      });

      this.lightningBuild._handleMessage(profileMessage);
    }
  }

  getTaskMessagesGroupedByExtension() {
    return this.lightningBuild.messageLog
      .filter((message, index) =>
        index >= this.ignoreFirstNTasks && message.type === Configuration.MESSAGE.TASK)
      .reduce((acc, message) => {
        (acc[message.options.extension] = acc[message.options.extension] || []).push(message);
        return acc;
      }, {});
  }

  _profileTasks(currentIteration, totalIterations, completed) {
    if (currentIteration < totalIterations) {
      setTimeout(() => {
        const fileToChange = this._chooseFauxFile(currentIteration);
        this._fauxChangeFile(fileToChange);
        this._profileTasks(++currentIteration, totalIterations, completed);
      }, this.taskTimeoutMs);
    } else if (currentIteration === totalIterations) {
      completed();
    }
  }

  // not really faux...
  _chooseFauxFile(iteration) {
    return this.testFiles[iteration % this.testFiles.length];
  }

  _fauxChangeFile(file) {
    const date = new Date();
    fs.utimesSync(file, date, date);
  }
}

const configuration = new Configuration();
configuration.init().then(() => {
  configuration.profilingEnabled ? new Profiler().init() : new Index().init();
});
