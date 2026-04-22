const JAPANESE_EDIT_PATTERNS = [
  /(編集|更新|修正|書き換え|追記|追加|作成|保存|置換|反映|直)(して|してください|してほしい|して欲しい|してくれ|して|を頼む)/i,
  /(ノート|vault|ファイル|文書|メモ).{0,24}(編集|更新|修正|書き換え|追記|追加|作成|保存|置換|反映)/i,
  /(改善|整形|整えて|整理|翻訳|展開|清書|磨いて|リライト|書き直し)(して|してください|してほしい|して欲しい|してくれ|して|を頼む)/i,
  /(ノート|vault|ファイル|文書|メモ).{0,24}(改善|整形|整理|翻訳|展開|清書|リライト|書き直し)/i,
  /(実装|修正|追加|作成)して/i,
];

const ENGLISH_EDIT_PATTERNS = [
  /^(?:please\s+)?(edit|update|modify|write|rewrite|create|append|save|replace|apply|fix|implement|refactor|improve|translate|reformat|expand|clean(?:\s+up)?|polish|revise|reorganize|convert)\b/i,
  /\b(edit|update|modify|write|rewrite|create|append|save|replace|apply|fix|implement|refactor|improve|translate|reformat|expand|clean(?:\s+up)?|polish|revise|reorganize|convert)\b.{0,32}\b(note|vault|file|document|code|this|it)\b/i,
  /\b(?:summari[sz]e|turn|convert)\b.{0,24}\b(?:into|to|in)\b.{0,24}\b(note|vault|file|document)\b/i,
  /\bmake changes\b/i,
];

export function allowsVaultWrite(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) {
    return false;
  }
  return [...JAPANESE_EDIT_PATTERNS, ...ENGLISH_EDIT_PATTERNS].some((pattern) => pattern.test(text));
}
