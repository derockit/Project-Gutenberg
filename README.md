# Project Gutenberg Ebooks

A redistribution of project Gutenberg. It includes English, not copyrighted ones.

## Usage

The `database.sqlitle` contains an index from all crwaled items.

You can also generate the paths by the book ids yourselves:

```javascript
import md5 from 'md5';

const hash = md5(bookId);
const path = `${hash[0]}/${hash[1]}/${hash[2]}/${hash}`;
```

## Thanks to

1. [Project Gutenberg](https://www.gutenberg.org/)
2. [Gutendex](https://gutendex.com/)