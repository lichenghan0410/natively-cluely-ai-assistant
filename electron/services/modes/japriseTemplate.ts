// electron/services/modes/japriseTemplate.ts
//
// Seed content for the user-visible "Japrise" mode (Japanese oral-test practice).
// The five official Japrise parts are seeded as editable reference files — they
// become the retrieval corpus for real-time answer assistance (ADR-005 Phase 2.1,
// Option 1A). Users can edit/delete these files and add their own notes through
// the same reference-file path. Content is in Japanese so it embeds well with the
// multilingual-e5 local model and matches Japanese transcript/query input.

export interface SeedReferenceFile {
    fileName: string;
    content: string;
}

// Content follows the official Japrise part-opening prompts (read out at the
// start of each part) plus the real prep/speak timing, then a coaching aid
// (structure + useful expressions). The concrete per-question material (the
// specific 10 questions, the speech topic + its points, the graph, the role-play
// task) arrives later in the transcript at runtime.
export const JAPRISE_REFERENCE_FILES: SeedReferenceFile[] = [
    {
        fileName: 'Part1-インタビュー.md',
        content: [
            '第一部分・インタビュー。開始の案内：「10の質問があります。よく聞いて、質問に答えましょう。」話す時間：各質問のあと20秒。',
            '評価観点：回答の関連性と、説明する力。',
            '答え方のコツ：まず結論を一文で述べ、次に理由、最後に具体例を添える。20秒で簡潔にまとめる。一文で終わらせず展開する。',
            '使える表現：私は〜だと思います。なぜなら〜からです。たとえば〜。具体的には〜。',
        ].join('\n'),
    },
    {
        fileName: 'Part2-音読.md',
        content: [
            '第二部分・音読。開始の案内：「8の文があります。声に出して読みましょう。」話す時間：1問10秒。',
            '評価観点：明瞭で自然な日本語の発音。',
            '読み方のコツ：意味のまとまりで区切る、文末まではっきり発音する、アクセント・長音・促音・濁音に注意する。',
            '注記：内容を答えるパートではないため、回答の提案は行わない。発音・区切りの助言のみ。',
        ].join('\n'),
    },
    {
        fileName: 'Part3-スピーチ.md',
        content: [
            '第三部分・スピーチ。開始の案内：「テーマについて話しましょう。できるだけたくさん話してください。」準備40秒／話す60秒。',
            '評価観点：テーマとの関連性と、意見を展開する力。問題で示された観点（多くは3点）にすべて触れる。',
            '構成のコツ：序論・本論・結論の三部構成。各点を「主張→理由→具体例」で展開する。',
            '展開の接続表現：まず第一に、次に、さらに、最後に、なぜなら、その結果、たとえば。',
            '意見の表現：私は〜だと考えます。〜することが大切だと思います。〜のではないでしょうか。',
        ].join('\n'),
    },
    {
        fileName: 'Part4-プレゼンテーション.md',
        content: [
            '第四部分・プレゼンテーション。開始の案内：「グラフを見ながらプレゼンテーションしてください。」準備40秒／話す60秒。',
            '評価観点：文字以外の情報（グラフ）を口頭で描写する力。',
            '導入：このグラフは〜を示しています。横軸は〜、縦軸は〜を表しています。',
            '増減の表現：急激に増加する、緩やかに減少する、横ばいで推移する、ピークに達する、最も低い水準。',
            '比較の表現：〜に比べて、〜より多い／少ない、約2倍、全体の3分の1を占める、最も大きな割合。',
            '締め：このことから〜が分かります。',
        ].join('\n'),
    },
    {
        fileName: 'Part5-ロールプレイ.md',
        content: [
            '第五部分・ロールプレイ。開始の案内：「タスクの説明を読んでください。その状況にいると想像して、相手と話してください。」準備40秒／話す時間：質問ごとに30秒。',
            '評価観点：質問への回答だけでなく、文脈を理解して適切に応答する力。',
            'コツ：相手の発話の意図をつかみ、場面にふさわしい敬語・丁寧表現で応じる。聞き取れない時は確認する。',
            '丁寧な依頼：〜していただけますか、〜をお願いできますか、恐れ入りますが〜。',
            '確認の表現：もう一度おっしゃっていただけますか、つまり〜ということですか。',
            'よくある場面：店員とのやり取り（在庫・値段・サイズ・返品交換）、予約、問い合わせ、道案内。',
        ].join('\n'),
    },
];

export const JAPRISE_NOTE_SECTIONS: Array<{ title: string; description: string }> = [
    { title: '全体の出来',     description: '今回の練習全体の総括。' },
    { title: 'パート別評価',   description: '第一〜第五部分それぞれの出来と気づき。' },
    { title: '良かった点',     description: 'うまく言えた表現・構成・発音。' },
    { title: '改善点',         description: '発音・文法・語彙・展開で直したいところ。' },
    { title: '次に練習すること', description: '次回までに重点的に練習する項目。' },
];
