import en from '../../../../public/i18n/en.json';
import fr from '../../../../public/i18n/fr.json';

type Tree = { [key: string]: string | Tree };

/** Flattens `{ a: { b: 'x' } }` to `{ 'a.b': 'x' }`. */
function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      result[path] = value;
    } else {
      Object.assign(result, flatten(value, path));
    }
  }
  return result;
}

const placeholders = (text: string) =>
  (text.match(/{{\s*\w+\s*}}/g) ?? []).map((p) => p.replace(/\s/g, '')).sort();

describe('translation files', () => {
  const english = flatten(en as Tree);
  const french = flatten(fr as Tree);

  it('define the same keys in en.json and fr.json', () => {
    const missingInFrench = Object.keys(english).filter(
      (key) => !(key in french),
    );
    const missingInEnglish = Object.keys(french).filter(
      (key) => !(key in english),
    );
    expect({ missingInFrench, missingInEnglish }).toEqual({
      missingInFrench: [],
      missingInEnglish: [],
    });
  });

  it('have no empty value', () => {
    const empty = [...Object.entries(english), ...Object.entries(french)]
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it('use the same {{placeholders}} in both languages', () => {
    const mismatched = Object.keys(english).filter(
      (key) =>
        key in french &&
        placeholders(english[key]).join() !== placeholders(french[key]).join(),
    );
    expect(mismatched).toEqual([]);
  });
});
