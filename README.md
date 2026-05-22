# chart-of-standard-forms-of-national-characters

Typed JSON package for Taiwan's Ministry of Education (教育部) **Chart of Standard Forms of National Characters** (`國字標準字體表`) — three lists of standard Traditional Chinese characters:

| List                                                                | Count  | File                     |
| ------------------------------------------------------------------- | ------ | ------------------------ |
| Common National Characters (`常用國字標準字體表`)                   | 4,808  | `common.json`            |
| Less-Than-Common National Characters (`次常用國字標準字體表`)       | 6,329  | `less-than-common.json`  |
| Rarely-Used National Characters (`罕用字體表`)                      | 18,319 | `rarely-used.json`       |

## Installation

```sh
npm install chart-of-standard-forms-of-national-characters
```

## Usage

```ts
import {
  commonCharacters,
  lessThanCommonCharacters,
  rarelyUsedCharacters,
} from "chart-of-standard-forms-of-national-characters";

console.log(commonCharacters.length);          // 4808
console.log(lessThanCommonCharacters.length);  // 6329
console.log(rarelyUsedCharacters.length);      // 18319
```

You can also import the JSON files directly — sibling `.d.ts` files type each default export as `string[]`:

```ts
import common from "chart-of-standard-forms-of-national-characters/common.json";
import lessThanCommon from "chart-of-standard-forms-of-national-characters/less-than-common.json";
import rarelyUsed from "chart-of-standard-forms-of-national-characters/rarely-used.json";
```

Each list is a flat `string[]` of single characters in the official spreadsheet order.

## Data source

The character lists and ordering follow Taiwan's MOE standard. The spreadsheet in `data/臺灣TW-ABCN正字甲乙丙表.xlsx` is sourced from [TraditionalChinese/TW-ABCN](https://github.com/TraditionalChinese/TW-ABCN).

## Regenerating the JSON

```sh
node --experimental-strip-types scripts/parse.ts
```

## License

MIT
