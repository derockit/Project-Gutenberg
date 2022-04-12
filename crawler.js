// @ts-check
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import chalk from 'chalk';
import md5 from 'md5';
import fetch from 'node-fetch';
import json2md from 'json2md';
import exec from 'await-exec';
import { Sequelize, DataTypes } from 'sequelize';

const STATUS_FILE_PATH = './status.json';
const database = new Sequelize({
  dialect: 'sqlite',
  storage: `${process.cwd()}/database.sqlite`,
  logging: false,
});
const index = database.define('Book', {
  id: { type: DataTypes.INTEGER, primaryKey: true },
  title: { type: DataTypes.STRING, allowNull: false },
  downloadsCount: { type: DataTypes.INTEGER, allowNull: false },
  authorBirthYear: { type: DataTypes.INTEGER, allowNull: true },
  authorDeathYear: { type: DataTypes.INTEGER, allowNull: true },
  path: { type: DataTypes.STRING, allowNull: false, unique: true },
});

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
      try {
        const page = await this.fetchNextPage();
        for (const item of page.results) {
          await this.save(item);
        }
        this.status = { lastPage: this.status.lastPage + 1 };
        next = page.next;
      } catch (error) {
        console.error(error);
      }
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
    const url = new URL('https://gutendex.com/books/');
    url.searchParams.append('languages', 'en');
    url.searchParams.append('copyright', 'false');
    url.searchParams.append('mime_type', 'application/epub+zip');
    // url.searchParams.append('sort', 'ascending');
    url.searchParams.append('page', this.status.lastPage + 1);
    // @ts-ignore
    return fetch(url).then((res) => res.json());
  }

  /**
   *
   * @param {string} hash
   */
  hashToPath(hash) {
    return `${hash[0]}/${hash[1]}/${hash[2]}/${hash}`;
  }

  async save(item) {
    const label = chalk.gray(`[${chalk.green(item.id)}] ${item.title}`);
    const hash = md5(item.id);
    const directory = this.hashToPath(hash);
    if (existsSync(`${directory}/README.md`)) {
      const record = await index.findByPk(item.id);
      if (!record) {
        await this.saveIndex(item, directory);
      }
      console.log(`${chalk.cyan('Exists:')} ${label}`);
      return;
    }
    console.log(`${chalk.cyan('Started:')} ${label} ...`);
    console.time(label);
    mkdirSync(directory, { recursive: true });
    if (!(await this.saveAssets(item, directory))) {
      console.log(`${chalk.cyan('Skipped:')} ${label}.`);
    }
    writeFileSync(`${directory}/meta.json`, JSON.stringify(item), {
      encoding: 'utf8',
    });
    writeFileSync(`${directory}/README.md`, this.createReadme(item), {
      encoding: 'utf8',
    });
    await this.saveIndex(item, directory);
    await this.commitChanges(item);
    console.timeEnd(label);
    console.log(Array(40).fill('-').join(''));
  }

  async saveIndex(item, path) {
    const [author] = item.authors;
    return index.create({
      id: item.id,
      title: item.title,
      downloadsCount: item.download_count,
      authorBirthYear: author?.birth_year || null,
      authorDeathYear: author?.death_year || null,
      path,
    });
  }

  async saveAssets(item, directory) {
    const epubFile = await fetch(item.formats['application/epub+zip']).then(
      (res) => res.buffer()
    );
    if (epubFile.length <= Math.pow(1024, 2) * 100) {
      writeFileSync(`${directory}/ebook.epub`, epubFile);
    }

    const smallCover = await fetch(
      `https://www.gutenberg.org/cache/epub/${item.id}/pg${item.id}.cover.small.jpg`
    ).then((res) => res.buffer());
    writeFileSync(`${directory}/cover.small.jpg`, smallCover);

    const mediumCover = await fetch(
      `https://www.gutenberg.org/cache/epub/${item.id}/pg${item.id}.cover.medium.jpg`
    ).then((res) => res.buffer());
    writeFileSync(`${directory}/cover.medium.jpg`, mediumCover);
    return true;
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
  await database.sync();
  const crawler = new Crawler();
  await crawler.start();
}

main().catch(console.error);
