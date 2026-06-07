export interface JapaneseOrthographyWarning {
  preferred: string;
  accepted: string;
}

export interface JapaneseCerScore {
  cer: number;
  cerPct: number;
  editDistance: number;
  refLen: number;
  hypLen: number;
  refNorm: string;
  hypNorm: string;
  orthographyWarnings: JapaneseOrthographyWarning[];
}

interface JapaneseReadingAlias {
  preferred: string;
  accepted: string;
}

const JAPANESE_READING_ALIASES: JapaneseReadingAlias[] = [
  { preferred: '休みの日', accepted: 'やすみのひ' },
  { preferred: '話してください', accepted: 'はなしてください' },
  { preferred: '作ろう', accepted: 'つくろう' },
  { preferred: '作りました', accepted: 'つくりました' },
  { preferred: '考えています', accepted: 'かんがえています' },
  { preferred: '思ってる', accepted: 'おもってる' },
  { preferred: '行きます', accepted: 'いきます' },
  { preferred: '会社', accepted: 'かいしゃ' },
  { preferred: '会議', accepted: 'かいぎ' },
  { preferred: '商品', accepted: 'しょうひん' },
  { preferred: '売上げ', accepted: 'うりあげ' },
  { preferred: '売り上げ', accepted: 'うりあげ' },
  { preferred: '売上', accepted: 'うりあげ' },
  { preferred: '変化', accepted: 'へんか' },
  { preferred: '自分', accepted: 'じぶん' },
  { preferred: '今', accepted: 'いま' },
  { preferred: '社内', accepted: 'しゃない' },
  { preferred: '説明', accepted: 'せつめい' },
  { preferred: '何', accepted: 'なに' },
  { preferred: '分かる', accepted: 'わかる' },
  { preferred: '企業', accepted: 'きぎょう' },
  { preferred: '人', accepted: 'ひと' },
  { preferred: '紹介', accepted: 'しょうかい' },
  { preferred: '社員', accepted: 'しゃいん' },
  { preferred: '日本語', accepted: 'にほんご' },
  { preferred: '日本', accepted: 'にほん' },
  { preferred: '働いて', accepted: 'はたらいて' },
  { preferred: '社長', accepted: 'しゃちょう' },
  { preferred: '国', accepted: 'くに' },
  { preferred: '支店', accepted: 'してん' },
  { preferred: '質問', accepted: 'しつもん' },
  { preferred: '聞いて', accepted: 'きいて' },
  { preferred: '答えて', accepted: 'こたえて' },
  { preferred: '新しい', accepted: 'あたらしい' },
  { preferred: '実は', accepted: 'じつは' },
  { preferred: '話せる', accepted: 'はなせる' },
  { preferred: '理由', accepted: 'りゆう' },
  { preferred: '準備', accepted: 'じゅんび' },
  { preferred: '次', accepted: 'つぎ' },
  { preferred: '誰', accepted: 'だれ' },
  { preferred: '家', accepted: 'いえ' },
];

const SORTED_ALIASES = [...JAPANESE_READING_ALIASES].sort((a, b) => b.preferred.length - a.preferred.length);

function normalizeSurface(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\s　]+/g, '')
    .replace(/[、。，．,.?？！!「」『』（）()・〜~\-—…:：;；]/g, '')
    .toLowerCase();
}

function foldJapaneseReadings(text: string): string {
  let folded = normalizeSurface(text);
  for (const alias of SORTED_ALIASES) {
    folded = folded.split(normalizeSurface(alias.preferred)).join(normalizeSurface(alias.accepted));
  }
  return folded;
}

function containsKanji(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function collectOrthographyWarnings(reference: string, hypothesis: string): JapaneseOrthographyWarning[] {
  const refSurface = normalizeSurface(reference);
  const hypSurface = normalizeSurface(hypothesis);
  const hypFolded = foldJapaneseReadings(hypothesis);
  const warnings: Array<JapaneseOrthographyWarning & { index: number }> = [];

  for (const alias of JAPANESE_READING_ALIASES) {
    if (!containsKanji(alias.preferred)) continue;
    const preferred = normalizeSurface(alias.preferred);
    const accepted = normalizeSurface(alias.accepted);
    const index = refSurface.indexOf(preferred);
    if (index === -1) continue;
    if (hypSurface.includes(preferred)) continue;
    if (!hypFolded.includes(accepted)) continue;
    warnings.push({ preferred: alias.preferred, accepted: alias.accepted, index });
  }

  warnings.sort((a, b) => a.index - b.index || b.preferred.length - a.preferred.length);
  return warnings.map(({ preferred, accepted }) => ({ preferred, accepted }));
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ai = a[i - 1];
    for (let j = 1; j <= n; j++) {
      const cost = ai === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export function normalizeJapaneseAcceptanceText(text: string): string {
  return foldJapaneseReadings(text);
}

export function computeJapaneseAcceptanceCer(reference: string, hypothesis: string): JapaneseCerScore {
  const refNorm = normalizeJapaneseAcceptanceText(reference);
  const hypNorm = normalizeJapaneseAcceptanceText(hypothesis);
  const editDistance = levenshtein(refNorm, hypNorm);
  const cer = refNorm.length === 0 ? 0 : editDistance / refNorm.length;
  return {
    cer,
    cerPct: +(cer * 100).toFixed(2),
    editDistance,
    refLen: refNorm.length,
    hypLen: hypNorm.length,
    refNorm,
    hypNorm,
    orthographyWarnings: collectOrthographyWarnings(reference, hypothesis),
  };
}
