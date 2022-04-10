// @ts-check
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import chalk from 'chalk';
import md5 from 'md5';
import fetch from 'node-fetch';
import json2md from 'json2md';
import exec from 'await-exec';

const STATUS_FILE_PATH = './status.json';
const INDEX_FILE_PATH = './index.csv';

export class Crawler {
  get status() {
    return JSON.parse(readFileSync(STATUS_FILE_PATH, { encoding: 'utf8' }));
  }

  set status(value) {
    writeFileSync(STATUS_FILE_PATH, JSON.stringify(value), {
      encoding: 'utf8',
    });
  }

  async start() {
    let next = null;
    do {
      const page = await this.fetchNextPage();
      const items = page.results.filter((item) => {
        return (
          !item.copyright &&
          item.languages?.includes('en') &&
          Object.keys(item.formats).includes('application/epub+zip')
        );
      });
      for (const item of items) {
        await this.save(item);
      }
      this.status = { lastPage: this.status.lastPage + 1 };
      next = page.next;
    } while (next);
  }

  async commitChanges({ id, title }) {
    title = title.replace('"', `'`);
    const { stdout } = await exec(
      `git add --all && git commit -m "[${id}] ${title}" && git push`
    );
    console.log(stdout);
  }

  /**
   *
   * @returns {{ next: string; results: any[] }}
   */
  fetchNextPage() {
    // @ts-ignore
    return fetch(
      `https://gutendex.com/books/?page=${this.status.lastPage + 1}`
    ).then((res) => res.json());
  }

  /**
   *
   * @param {string} hash
   */
  hashToPath(hash) {
    return `${hash[0]}/${hash[1]}/${hash[2]}/${hash}`;
  }

  async save(item) {
    const label = chalk.green(`[${item.id}] ${item.title}`);
    const hash = md5(item.id);
    const directory = this.hashToPath(hash);
    if (existsSync(`${directory}/README.md`)) {
      console.log(`Exists: ${label}`);
      return;
    }
    console.log(`Started: ${label} ...`);
    console.time(label);
    mkdirSync(directory, { recursive: true });
    await this.saveAssets(item, directory);
    writeFileSync(`${directory}/meta.json`, JSON.stringify(item), {
      encoding: 'utf8',
    });
    writeFileSync(`${directory}/README.md`, this.createReadme(item), {
      encoding: 'utf8',
    });
    appendFileSync(INDEX_FILE_PATH, `\n${item.id},${directory}`);
    await this.commitChanges(item);
    console.timeEnd(label);
    console.log(Array(40).fill('-').join(''));
  }

  async saveAssets(item, directory) {
    const epubFile = await fetch(item.formats['application/epub+zip']).then(
      (res) => res.buffer()
    );
    writeFileSync(`${directory}/ebook.epub`, epubFile);

    const smallCover = await fetch(
      `https://www.gutenberg.org/cache/epub/${item.id}/pg${item.id}.cover.small.jpg`
    ).then((res) => res.buffer());
    writeFileSync(`${directory}/cover.small.jpg`, smallCover);

    const mediumCover = await fetch(
      `https://www.gutenberg.org/cache/epub/${item.id}/pg${item.id}.cover.medium.jpg`
    ).then((res) => res.buffer());
    writeFileSync(`${directory}/cover.medium.jpg`, mediumCover);
  }

  createReadme(item) {
    return json2md([
      { h1: `${item.title} <kbd>${item.id}</kbd>` },
      { img: { source: './cover.medium.jpg' } },
      { h2: 'Authors' },
      {
        ul: item.authors.map(
          ({ name, birth_year, death_year }) =>
            `${name} <small>(${birth_year} - ${death_year})</small>`
        ),
      },
      { h2: 'Subjects' },
      { ul: item.subjects },
      { h2: 'Download' },
      {
        ul: Object.keys(item.formats).map((key) => item.formats[key]),
      },
      { h2: 'Book Shelves' },
      { ul: item.bookshelves },
    ]);
  }
}

async function main() {
  const crawler = new Crawler();
  await crawler.start();
}

main().catch(console.error);
