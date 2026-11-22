import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeCsvCell, objectsToCsv, slugify } from './utils';

test('escapeCsvCell handles quotes, commas, newlines, negative numbers, and formula prefixes', () => {
  assert.equal(escapeCsvCell('BMW'), 'BMW');
  assert.equal(escapeCsvCell(-49.4), '-49.4');
  assert.equal(escapeCsvCell('EV Range, Charging'), '"EV Range, Charging"');
  assert.equal(escapeCsvCell('Line "quoted"'), '"Line ""quoted"""');
  assert.equal(escapeCsvCell('Line 1\nLine 2'), '"Line 1\nLine 2"');
  assert.equal(escapeCsvCell('=CMD()'), "'=CMD()");
  assert.equal(escapeCsvCell('+SUM(A1:A2)'), "'+SUM(A1:A2)");
  assert.equal(escapeCsvCell('-A1'), "'-A1");
  assert.equal(escapeCsvCell(null), '');
  assert.equal(escapeCsvCell(undefined), '');
});

test('objectsToCsv converts an array of objects using inferred headers in insertion order', () => {
  const rows = [
    {
      Market: 'Germany',
      Brand: 'BMW',
      'SOS (%)': '29.5',
      'SOV - SOS (pp)': 2.9,
    },
    {
      Market: 'Germany',
      Brand: 'Audi',
      'SOS (%)': '23.0',
      'SOV - SOS (pp)': -0.7,
    },
  ];

  const csv = objectsToCsv(rows);
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'Market,Brand,SOS (%),SOV - SOS (pp)');
  assert.equal(lines[1], 'Germany,BMW,29.5,2.9');
  assert.equal(lines[2], 'Germany,Audi,23.0,-0.7');
});

test('objectsToCsv supports sparse keys, explicit header ordering, and empty arrays', () => {
  assert.equal(objectsToCsv([]), '');
  assert.equal(objectsToCsv([], ['Asset ID', 'Brand']), 'Asset ID,Brand');

  const sparse = [
    { a: 'BMW-DE-8841', b: 'Quote: "620 km"' },
    { a: 'AUD-DE-5120', c: 'extra, field' },
  ];
  const csv = objectsToCsv(sparse);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'a,b,c');
  assert.equal(lines[1], 'BMW-DE-8841,"Quote: ""620 km""",');
  assert.equal(lines[2], 'AUD-DE-5120,,"extra, field"');

  const ordered = objectsToCsv(sparse, ['c', 'a']);
  assert.equal(ordered.split('\r\n')[0], 'c,a');
});

test('slugify creates clean filename-safe segments', () => {
  assert.equal(slugify('United Kingdom'), 'united-kingdom');
  assert.equal(slugify('Germany'), 'germany');
});
