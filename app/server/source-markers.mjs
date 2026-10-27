const marker = '> 演示数据（虚构，不代表用户实际状态；请勿当成真实个人记录）';
const detailLines = new Set([
  '- 备注：演示记录。',
  '- 来源：模拟数值。',
  '- 来源：模拟的设备同步数值。',
  '- 热量为模拟值，不由餐食描述推算。',
]);

export function isGenerated(content) {
  return content.includes('演示数据（虚构');
}

export function visibleContent(content) {
  if (!isGenerated(content)) return content;
  return content.split(/\r?\n/).filter((line) => line !== marker && !detailLines.has(line)).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
}

export function preserveSource(content, previous) {
  return isGenerated(previous) && !isGenerated(content) ? `${marker}\n\n${content}` : content;
}
