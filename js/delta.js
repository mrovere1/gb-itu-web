// Chip de variação dos cartões: "+9,3%" / "−27,0%" em verde (melhorou), vermelho (piorou) ou cinza (igual).
// O sentido diz se subir é bom ('alta-boa', ex.: receita) ou ruim ('alta-ma', ex.: inadimplência). Não importa nada.

const PCT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Variação percentual de `now` sobre `before`; nula quando não há base (zero ou ausente). */
export function pctChange(now, before) {
  if (typeof now !== 'number' || typeof before !== 'number' || before <= 0) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

/** { text, tone } com tone em 'good' | 'bad' | 'flat'. */
export function deltaInfo(pct, sentido) {
  if (typeof pct !== 'number' || !isFinite(pct)) return null;
  if (Math.abs(pct) < 0.05) return { text: '0,0%', tone: 'flat' };
  const up = pct > 0;
  const good = sentido === 'alta-ma' ? !up : up;
  return { text: (up ? '+' : '−') + PCT.format(Math.abs(pct)) + '%', tone: good ? 'good' : 'bad' };
}

/** Desenha o chip (ou devolve null sem variação). `ref` é o texto do período, para leitores de tela. */
export function deltaChip(doc, pct, sentido, ref) {
  const info = deltaInfo(pct, sentido);
  if (!info) return null;
  const chip = doc.createElement('span');
  chip.className = 'delta delta-' + info.tone;
  chip.textContent = info.text;
  chip.setAttribute('aria-label', 'Variação de ' + info.text + (ref ? ' sobre ' + ref : ''));
  return chip;
}
