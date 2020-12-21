import * as gulp from 'gulp';
import * as fs from 'fs-extra';
import * as gulpBabel from 'gulp-babel';
import * as gulpSass from 'gulp-sass';
import * as gulpLess from 'gulp-less';
import * as gulpWatch from 'gulp-watch';
import * as gulpStripCssComments from 'gulp-strip-css-comments';
import * as gulpConcatCss from 'gulp-concat-css';
import * as gulpIf from 'gulp-if';
import * as gulpSourcemaps from 'gulp-sourcemaps';
import * as mergeStream from 'merge-stream';
import * as path from 'path';
import { pri, srcPath } from '../node';
import { plugin } from './plugins';
import { getBabelOptions } from './babel-options';
import { globalState } from './global-state';
import { babelPluginTransformImport } from './babel-plugin-transfer-import';
import { PackageInfo } from './define';
import { runWebpack } from './webpack';

function getGulpByWatch(watch: boolean, filesPath: string) {
  if (watch) {
    return gulpWatch(filesPath);
  }
  /** 文件匹配 */
  return gulp.src(filesPath);
}

const buildTs = (watch: boolean, outdir: string, babelOptions: any, wholeProject: boolean, sourcePath: string) => {
  const targetPath = wholeProject
    ? path.join(pri.projectRootPath, '{src,packages}/**/*.{ts,tsx}')
    : path.join(sourcePath || pri.sourceRoot, srcPath.dir, '**/*.{ts,tsx}');

  return new Promise((resolve, reject) => {
    if (globalState.isDevelopment) {
      getGulpByWatch(watch, targetPath)
        .pipe(gulpSourcemaps.init())
        .pipe(gulpBabel(babelOptions))
        .pipe(gulpSourcemaps.write())
        .on('error', reject)
        .pipe(gulp.dest(outdir))
        .on('end', resolve);
    } else {
      getGulpByWatch(watch, targetPath)
        .pipe(gulpBabel(babelOptions))
        .on('error', reject)
        .pipe(gulp.dest(outdir))
        .on('end', resolve);
    }
  });
};

/** 获取样式文件路径 */
function getStyleFilePath(suffix: string, wholeProject: boolean, sourcePath: string) {
  return wholeProject || (pri.selectedSourceType === 'root' && pri.sourceConfig.cssExtract)
    ? path.join(pri.projectRootPath, `{src,packages}/**/*.${suffix}`)
    : path.join(sourcePath || pri.sourceRoot, srcPath.dir, `**/*.${suffix}`);
}

const buildSass = (wholeProject: boolean, sourcePath: string) => {
  const targetScssPath = getStyleFilePath('scss', wholeProject, sourcePath);
  return gulp.src(targetScssPath).pipe(
    gulpSass({
      includePaths: path.join(pri.projectRootPath, 'node_modules'),
    }),
  );
};

const buildLess = (wholeProject: boolean, sourcePath: string) => {
  const targetLessPath = getStyleFilePath('less', wholeProject, sourcePath);
  return gulp.src(targetLessPath).pipe(
    gulpLess({
      paths: [path.join(pri.projectRootPath, 'node_modules', 'includes')],
    }),
  );
};

const buildSassAndLess = (watch: boolean, outdir: string, wholeProject: boolean, sourcePath: string) => {
  const targetPath = getStyleFilePath('{scss,less}', wholeProject, sourcePath);
  const mergeStyle = (resolve: (value?: any) => void, reject: (value?: any) => void) =>
    mergeStream(buildLess(wholeProject, sourcePath), buildSass(wholeProject, sourcePath))
      .pipe(gulpIf(pri.sourceConfig.cssExtract, gulpConcatCss(pri.sourceConfig.outCssFileName)))
      .pipe(gulpStripCssComments())
      .on('error', reject)
      .pipe(gulp.dest(outdir))
      .on('end', resolve);
  if (watch) {
    return new Promise((resolve, reject) => {
      gulpWatch(targetPath, () => {
        mergeStyle(resolve, reject);
      });
    });
  }
  return new Promise(mergeStyle);
};

const buildCssWithWebpack = (outDir: string, copyDir: string) => {
  const cssFileNames = Object.keys(pri.sourceConfig.componentEntries).map(file => `${file}.css`);

  return runWebpack({
    mode: 'production',
    entryPath: pri.sourceConfig.componentEntries,
    distDir: outDir,
    outFileName: '[name].js',
    outCssFileName: '[name].css',
  }).then(() => {
    const distFiles = fs.readdirSync(outDir);
    distFiles.forEach(file => {
      const basename = path.basename(file);
      if (!cssFileNames.includes(basename)) {
        fs.removeSync(path.join(outDir, file));
      }
    });
    fs.copySync(outDir, copyDir);
  });
};

const mvResources = (
  watch: boolean,
  outdir: string,
  wholeProject: boolean,
  sourcePath: string,
  sourceType: string,
  moveStyle?: boolean,
) => {
  const selectedSourceType = sourceType || pri.selectedSourceType;
  const targetPath =
    wholeProject || (selectedSourceType === 'root' && pri.sourceConfig.cssExtract)
      ? path.join(
          pri.projectRootPath,
          `{src,packages}/**/*.{js,json,png,jpg,jpeg,gif,woff,woff2,eot,ttf,svg${moveStyle ? ',css,scss,less' : ''}}`,
        )
      : path.join(
          sourcePath || pri.sourceRoot,
          srcPath.dir,
          `**/*.{js,json,png,jpg,jpeg,gif,woff,woff2,eot,ttf,svg${moveStyle ? ',css,scss,less' : ''}}`,
        );

  return new Promise((resolve, reject) => {
    getGulpByWatch(watch, targetPath)
      .on('error', reject)
      .pipe(gulp.dest(outdir))
      .on('end', resolve);
  });
};

function importRename(packageAbsoluteToRelative = false) {
  return [
    babelPluginTransformImport,
    {
      removeCssImport: pri.sourceConfig.cssExtract,
      pipeImport: (text: string, filename: string) => {
        const scssRegex = '^(.+?)\\.scss$';
        const scssPattern = new RegExp(`^(${scssRegex}|${scssRegex}/.*)$`);

        if (scssPattern.test(text)) {
          const scssReplacePattern = new RegExp(scssRegex);
          return text.replace(scssReplacePattern, '$1.css');
        }

        if (packageAbsoluteToRelative) {
          // resolve absolute packages to relative path
          for (const eachPackage of globalState.packages) {
            if (eachPackage.packageJson && eachPackage.packageJson.name) {
              if (eachPackage.packageJson.name === text) {
                return path.relative(path.parse(filename).dir, path.join(eachPackage.rootPath, srcPath.dir));
              }
            }
          }
        }

        return text;
      },
    },
  ];
}

export const tsPlusBabel = async (watch = false, wholeProject = false, packageInfo: PackageInfo = null) => {
  const packagePath = packageInfo ? packageInfo.name : '';
  const rootDistPath = path.join(globalState.projectRootPath, pri.sourceConfig.distDir, packagePath);
  let mainDistPath = path.join(rootDistPath, 'main');
  let moduleDistPath = path.join(rootDistPath, 'module');
  let esm5DistPath = path.join(rootDistPath, 'esm5');

  if (pri.sourceConfig.materialComponent) {
    mainDistPath = path.join(globalState.sourceRoot, 'lib');
    moduleDistPath = path.join(globalState.sourceRoot, 'es');
    esm5DistPath = '';
  }

  const sourcePath = packageInfo ? packageInfo.rootPath : null;
  const sourceType = packageInfo ? packageInfo.name : null;

  // build component with webpack if config multy entries
  if (pri.sourceConfig.componentEntries) {
    await buildCssWithWebpack(mainDistPath, moduleDistPath);
  }

  return Promise.all([
    pri.sourceConfig.componentEntries ? null : buildSassAndLess(watch, mainDistPath, wholeProject, sourcePath),
    pri.sourceConfig.componentEntries ? null : buildSassAndLess(watch, moduleDistPath, wholeProject, sourcePath),

    buildTs(
      watch,
      mainDistPath,
      plugin.buildConfigBabelLoaderOptionsPipes.reduce(
        (options, fn) => {
          return fn(options);
        },
        getBabelOptions({
          plugins: [importRename(wholeProject)],
        }),
      ),
      wholeProject,
      sourcePath,
    ),
    buildTs(
      watch,
      moduleDistPath,
      plugin.buildConfigBabelLoaderOptionsPipes.reduce(
        (options, fn) => {
          return fn(options);
        },
        getBabelOptions({
          modules: false,
          plugins: [importRename(wholeProject)],
        }),
      ),
      wholeProject,
      sourcePath,
    ),
    esm5DistPath &&
      buildTs(
        watch,
        esm5DistPath,
        plugin.buildConfigBabelLoaderOptionsPipes.reduce(
          (options, fn) => {
            return fn(options);
          },
          getBabelOptions({
            modules: false,
          }),
        ),
        wholeProject,
        sourcePath,
      ),

    mvResources(watch, mainDistPath, wholeProject, sourcePath, sourceType),
    mvResources(watch, moduleDistPath, wholeProject, sourcePath, sourceType),
    esm5DistPath && mvResources(watch, esm5DistPath, wholeProject, sourcePath, sourceType, true),
  ]);
};
