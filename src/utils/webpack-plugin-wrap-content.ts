import * as webpack from 'webpack';
import * as ConcatSource from 'webpack-sources';

export class WrapContent {
  private header = '';

  private footer = '';

  public constructor(header = '', footer = '') {
    this.header = header;
    this.footer = footer;
  }

  public apply(compiler: webpack.Compiler) {
    compiler.hooks.compilation.tap('WrapContent', compilation => {
      compilation.hooks.optimizeChunkAssets.tapAsync('WrapContent', (chunks, done) => {
        chunks.forEach(chunk => {
          chunk.files.forEach((fileName: string) => {
            // Ignore workers
            if (fileName.indexOf('worker.js') > -1) {
              return;
            }

            if (chunk.name === 'main') {
              // eslint-disable-next-line no-param-reassign
              compilation.assets[fileName] = new ConcatSource.ConcatSource(
                this.header,
                compilation.assets[fileName],
                this.footer,
              );
            }
          });
        });
        done();
      });
    });
  }
}
