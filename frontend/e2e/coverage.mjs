import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import createConverter from 'v8-to-istanbul';
import coverageLibrary from 'istanbul-lib-coverage';
import reportLibrary from 'istanbul-lib-report';
import reports from 'istanbul-reports';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = join(frontend, 'src') + '/';

export default class BrowserCoverageReporter {
  attachments = [];

  onTestEnd(_test, result) {
    if (result.status === 'passed') {
      this.attachments.push(
        ...result.attachments.filter((item) => item.name === 'browser-coverage'),
      );
    }
  }

  async onEnd() {
    const map = coverageLibrary.createCoverageMap({});
    for (const attachment of this.attachments) {
      const body = attachment.body ?? (await readFile(attachment.path));
      for (const entry of JSON.parse(body.toString('utf8'))) {
        const url = new URL(entry.url);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
        if (!/^\/src\/[\w./-]+\.tsx?$/.test(url.pathname) || !entry.source) continue;
        const file = resolve(frontend, '.' + url.pathname);
        if (!file.startsWith(sourceDirectory)) continue;
        const converter = createConverter(file, 0, { source: entry.source });
        await converter.load();
        converter.applyCoverage(entry.functions);
        map.merge(converter.toIstanbul());
      }
    }
    if (!map.files().length)
      throw new Error('Playwright не собрал покрытие исходников интерфейса.');
    const context = reportLibrary.createContext({
      dir: join(frontend, 'coverage/e2e'),
      coverageMap: map,
    });
    reports.create('lcovonly', { projectRoot: resolve(frontend, '..') }).execute(context);
  }
}
