import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

const ROOT = join(import.meta.dirname, "..");

// Parse the three character lists from the 臺灣TW-ABCN正字甲乙丙表 spreadsheet:
//   A常用字4808       (4,808 common characters)        -> common.json
//   B次常用字6329     (6,329 less-than-common chars)   -> less-than-common.json
//   C罕用字18319      (18,319 rarely-used characters)  -> rarely-used.json
//
// The xlsx is a zip of XML parts. Each target sheet stores characters in column
// B as references into xl/sharedStrings.xml. We read the zip's central
// directory, inflate sharedStrings.xml and the three sheet XML parts, then
// extract column B values in row order. The final row of each sheet is a
// COUNTBLANK trailer that we skip.

const XLSX_PATH = join(ROOT, "data/臺灣TW-ABCN正字甲乙丙表.xlsx");

interface ZipEntry {
	method: number;
	compressedSize: number;
	uncompressedSize: number;
	localHeaderOffset: number;
}

function readZipEntries(buffer: Buffer): Map<string, ZipEntry> {
	// Locate the End of Central Directory record by scanning from the end.
	const EOCD_SIGNATURE = 0x06054b50;
	let eocdOffset = -1;
	for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
		if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
			eocdOffset = i;
			break;
		}
	}
	if (eocdOffset < 0) throw new Error("EOCD not found in xlsx");

	const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
	const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

	const entries = new Map<string, ZipEntry>();
	let cursor = centralDirOffset;
	const CDFH_SIGNATURE = 0x02014b50;
	for (let i = 0; i < totalEntries; i++) {
		if (buffer.readUInt32LE(cursor) !== CDFH_SIGNATURE) {
			throw new Error(`Bad central directory entry at ${cursor}`);
		}
		const method = buffer.readUInt16LE(cursor + 10);
		const compressedSize = buffer.readUInt32LE(cursor + 20);
		const uncompressedSize = buffer.readUInt32LE(cursor + 24);
		const nameLen = buffer.readUInt16LE(cursor + 28);
		const extraLen = buffer.readUInt16LE(cursor + 30);
		const commentLen = buffer.readUInt16LE(cursor + 32);
		const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
		const name = buffer.toString("utf-8", cursor + 46, cursor + 46 + nameLen);
		entries.set(name, {
			method,
			compressedSize,
			uncompressedSize,
			localHeaderOffset,
		});
		cursor += 46 + nameLen + extraLen + commentLen;
	}
	return entries;
}

function readEntry(buffer: Buffer, entry: ZipEntry): string {
	const LFH_SIGNATURE = 0x04034b50;
	const offset = entry.localHeaderOffset;
	if (buffer.readUInt32LE(offset) !== LFH_SIGNATURE) {
		throw new Error(`Bad local file header at ${offset}`);
	}
	const nameLen = buffer.readUInt16LE(offset + 26);
	const extraLen = buffer.readUInt16LE(offset + 28);
	const dataStart = offset + 30 + nameLen + extraLen;
	const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
	let data: Buffer;
	if (entry.method === 0) {
		data = compressed;
	} else if (entry.method === 8) {
		data = inflateRawSync(compressed);
	} else {
		throw new Error(`Unsupported compression method ${entry.method}`);
	}
	return data.toString("utf-8");
}

function parseSharedStrings(xml: string): string[] {
	// <si>...<t>VALUE</t>...</si> — values may contain XML entities; the file we
	// care about is plain CJK without &amp;/&lt; in the character cells, but
	// decode the common entities defensively. Rich-text <si> entries can have
	// multiple <t> children which we concatenate.
	const strings: string[] = [];
	const siPattern = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
	const tPattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
	for (const siMatch of xml.matchAll(siPattern)) {
		let value = "";
		for (const tMatch of siMatch[1]!.matchAll(tPattern)) {
			value += tMatch[1]!;
		}
		strings.push(decodeXmlEntities(value));
	}
	return strings;
}

function decodeXmlEntities(text: string): string {
	return text.replace(/&(amp|lt|gt|quot|apos|#(\d+)|#x([0-9A-Fa-f]+));/g, (_, name, dec, hex) => {
		if (name === "amp") return "&";
		if (name === "lt") return "<";
		if (name === "gt") return ">";
		if (name === "quot") return '"';
		if (name === "apos") return "'";
		if (dec) return String.fromCodePoint(Number.parseInt(dec, 10));
		return String.fromCodePoint(Number.parseInt(hex, 16));
	});
}

function extractColumnB(sheetXml: string, sharedStrings: string[], expectedCount: number): string[] {
	// Each data row is <row r="N" ...> ... <c r="BN" s="..." t="s"><v>IDX</v></c> ... </row>.
	// The final row (expectedCount + 1) is a COUNTBLANK trailer with no column-B
	// shared-string reference; we stop once we have expectedCount characters.
	const rowPattern = /<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
	const bCellPattern = /<c\b[^>]*\br="B(\d+)"[^>]*\bt="s"[^>]*>\s*<v>(\d+)<\/v>\s*<\/c>/;

	const characters: string[] = [];
	for (const rowMatch of sheetXml.matchAll(rowPattern)) {
		const rowIndex = Number.parseInt(rowMatch[1]!, 10);
		if (rowIndex > expectedCount) break;
		if (rowIndex !== characters.length + 1) {
			throw new Error(
				`Expected row ${characters.length + 1}, got row ${rowIndex}`,
			);
		}
		const cellMatch = bCellPattern.exec(rowMatch[2]!);
		if (!cellMatch) {
			throw new Error(`Row ${rowIndex}: no shared-string column B cell`);
		}
		const sharedIndex = Number.parseInt(cellMatch[2]!, 10);
		const value = sharedStrings[sharedIndex];
		if (value === undefined) {
			throw new Error(`Row ${rowIndex}: shared string ${sharedIndex} missing`);
		}
		if ([...value].length !== 1) {
			throw new Error(
				`Row ${rowIndex}: expected single character, got ${JSON.stringify(value)}`,
			);
		}
		characters.push(value);
	}

	if (characters.length !== expectedCount) {
		throw new Error(
			`Expected ${expectedCount} characters, got ${characters.length}`,
		);
	}
	return characters;
}

const buffer = readFileSync(XLSX_PATH);
const entries = readZipEntries(buffer);

function getEntry(name: string): ZipEntry {
	const entry = entries.get(name);
	if (!entry) throw new Error(`Missing entry: ${name}`);
	return entry;
}

const sharedStrings = parseSharedStrings(
	readEntry(buffer, getEntry("xl/sharedStrings.xml")),
);

const targets: Array<{ sheet: string; count: number; output: string }> = [
	{ sheet: "xl/worksheets/sheet2.xml", count: 4808, output: "common.json" },
	{ sheet: "xl/worksheets/sheet3.xml", count: 6329, output: "less-than-common.json" },
	{ sheet: "xl/worksheets/sheet4.xml", count: 18319, output: "rarely-used.json" },
];

for (const { sheet, count, output } of targets) {
	const xml = readEntry(buffer, getEntry(sheet));
	const characters = extractColumnB(xml, sharedStrings, count);
	const outputPath = join(ROOT, output);
	writeFileSync(outputPath, JSON.stringify(characters), "utf-8");
	console.log(`Wrote ${characters.length} characters to ${output}`);
}
