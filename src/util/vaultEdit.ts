const JAPANESE_EDIT_PATTERNS = [
  /(編集|更新|修正|書き換え|追記|追加|作成|保存|置換|反映|直)(して|してください|してほしい|して欲しい|してくれ|して|を頼む)/i,
  /(ノート|vault|ファイル|文書|メモ).{0,24}(編集|更新|修正|書き換え|追記|追加|作成|保存|置換|反映)/i,
  /(実装|修正|追加|作成)して/i,
];

const ENGLISH_EDIT_PATTERNS = [
  /^(?:please\s+)?(edit|update|modify|write|rewrite|create|append|save|replace|apply|fix|implement|refactor)\b/i,
  /\b(edit|update|modify|write|rewrite|create|append|save|replace|apply|fix|implement|refactor)\b.{0,32}\b(note|vault|file|document|code|this|it)\b/i,
  /\bmake changes\b/i,
];

export function allowsVaultWrite(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) {
    return false;
  }
  return [...JAPANESE_EDIT_PATTERNS, ...ENGLISH_EDIT_PATTERNS].some((pattern) => pattern.test(text));
}
