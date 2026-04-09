export function shouldShowTabBadges(tabCount: number): boolean {
  return tabCount > 0;
}

export function canCloseTab(tabCount: number): boolean {
  return tabCount > 1;
}
