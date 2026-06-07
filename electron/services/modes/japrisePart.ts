// electron/services/modes/japrisePart.ts
//
// ADR-005 Phase 2.2: deterministic Japrise part detection + per-part routing
// directives. Detection is transcript-keyword based (no screen/OCR integration):
// it reads the active part from explicit part markers ("第三部分", "パート3", …)
// or, failing that, distinctive content cues per part. Used by ModesManager to
// (a) bias retrieval toward the active part's reference file, (b) tell the LLM
// which part is active so MODE_JAPRISE_PROMPT applies the right per-part strategy,
// and (c) hard-suppress content suggestions during Part 2 (音読 / pronunciation).

export type JaprisePart = 1 | 2 | 3 | 4 | 5;

const PART_NAMES: Record<JaprisePart, string> = {
    1: 'インタビュー',
    2: '音読',
    3: 'スピーチ',
    4: 'プレゼンテーション',
    5: 'ロールプレイ',
};

const KANJI_NUM: Record<string, JaprisePart> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5 };
const ASCII_NUM: Record<string, JaprisePart> = {
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5,
    '１': 1, '２': 2, '３': 3, '４': 4, '５': 5,
};

// Reference-file name prefix per part (matches japriseTemplate.ts).
export const PART_FILE_PREFIX: Record<JaprisePart, string> = {
    1: 'Part1-', 2: 'Part2-', 3: 'Part3-', 4: 'Part4-', 5: 'Part5-',
};

/**
 * Detect the active Japrise part from transcript/query text.
 * Explicit markers ("第三部分", "パート3", "part 3") win; otherwise distinctive
 * content cues decide. Returns null when there is no clear signal.
 */
export function detectJaprisePart(text: string): JaprisePart | null {
    if (!text) return null;
    const t = text.normalize('NFKC');

    // 1) Explicit part markers — most reliable.
    //    第三部分 / 第三部 / 第3部分 / パート3 / part 3
    const marker = t.match(/第\s*([一二三四五1-5])\s*部/) || t.match(/パート\s*([1-5])/i) || t.match(/\bpart\s*([1-5])\b/i);
    if (marker) {
        const raw = marker[1];
        const p = KANJI_NUM[raw] ?? ASCII_NUM[raw];
        if (p) return p;
    }

    // 2) Distinctive content cues, ordered so the most specific parts match first.
    //    Part 1 (generic "面接/質問") is checked last to avoid stealing Part 5's
    //    "質問への回答" or Part 3's "テーマについて話す".
    if (/音読|朗読|声に出して読|読み上げ|逐句/.test(t)) return 2;
    if (/グラフ|図表|横軸|縦軸|棒グラフ|円グラフ|割合|推移|増減|プレゼンテーション|プレゼン/.test(t)) return 4;
    if (/ロールプレイ|役割|場面|店員|自動音声|角色扮演|タスクの説明|相手と話/.test(t)) return 5;
    if (/スピーチ|演説|演讲|テーマについて|[3三]つのポイント|次の[3三]つ|[3三]つを話|序論|本論|結論/.test(t)) return 3;
    if (/面接|インタビュー|問答|10問|質問に答え/.test(t)) return 1;

    return null;
}

/**
 * Build the per-part directive block injected ahead of the retrieved context for
 * the active Japrise mode. Tells the LLM the active part; for Part 2 it adds a
 * hard pronunciation-only guard that suppresses content suggestions.
 */
/**
 * Extract the three required key points from a Part-3 speech prompt embedded in
 * the transcript. Japrise Part-3 prompts enumerate the points, e.g.
 *   "次の3つを話してください。誰と何をしたいか、それをしたい理由、次にいつそれができるか。準備してください。"
 * Returns the 3 points, or null when they can't be confidently parsed (caller
 * then falls back to the generic LLM coverage nudge). Note: NFKC normalizes
 * circled markers ①②③ to plain digits, so the numbered branch matches on 1/2/3.
 */
export function extractPart3Points(transcript: string): string[] | null {
    if (!transcript) return null;
    const t = transcript.normalize('NFKC');
    const trig = t.search(/(?:次の)?\s*[3３三]\s*つ/);
    if (trig < 0) return null;

    let seg = t.slice(trig);
    // Drop the trigger instruction sentence ("…3つを話してください。") up to its end.
    seg = seg.replace(/^[^。：:！？\n]*[。：:！？\n]/, '');
    // Cut at the closing instruction ("準備してください" / "どうぞ" …).
    const stop = seg.search(/準備して|始めてください|どうぞ/);
    if (stop >= 0) seg = seg.slice(0, stop);

    const parts = (/[、,]/.test(seg)
        ? seg.split(/[、,]/)
        : seg.split(/(?:^|\s)[1-9][.．)）]?\s*(?=\S)/)) // post-NFKC ①②③ → 1/2/3
        .map(s => s.replace(/[。．\s]+$/, '').trim())
        .filter(Boolean)
        .filter(p => p.length >= 2 && !/話してください|準備|ポイント|ください$/.test(p));

    return parts.length === 3 ? parts : null;
}

/**
 * Build the directive that injects the three concrete required points so the LLM
 * tracks coverage of THESE specific points (coverage judgment stays with the LLM,
 * which is robust to paraphrase — lexical/threshold matching is not).
 */
export function buildPart3PointsDirective(points: string[]): string {
    const list = points.map((p, i) => `${['①', '②', '③'][i] ?? '・'}${p}`).join('　');
    return `<part3_required_points>このスピーチで必ず触れる3点：${list}。ユーザーの発話を見て、まだ触れていない点があれば「あと『〜』が未です」と短く促すこと。3点すべてに触れていれば指摘しない。</part3_required_points>`;
}

/** Official display name for a Japrise part (used by the instant-reference feed). */
export function japrisePartName(part: JaprisePart): string {
    return PART_NAMES[part];
}

export function buildJaprisePartDirective(part: JaprisePart): string {
    const kanji = ['', '一', '二', '三', '四', '五'][part];
    const lines = [
        `<active_japrise_part>第${kanji}部分・${PART_NAMES[part]}（Part ${part}）。この部分の評価観点と進め方に従って支援すること。</active_japrise_part>`,
    ];
    if (part === 2) {
        lines.push('<part2_pronunciation_guard>第二部分は音読（発音の評価）。回答内容の提案や模範解答は一切出さないこと。必要な場合のみ、発音・区切り・アクセントの短い助言にとどめる。</part2_pronunciation_guard>');
    }
    return lines.join('\n');
}
