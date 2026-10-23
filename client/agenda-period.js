const MIN_MONTH = 1900 * 12;
const MAX_MONTH = 9999 * 12 + 11;
const MAX_WINDOW_MONTH = MAX_MONTH - 2;

function monthKey(index) {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Three-month windows relative to the anchor, using calendar integers only.
 * Offsets select one month and are clamped to January 1900–December 9999.
 * The window always contains three valid months, including at either boundary.
 */
export function agendaPeriod(anchorMonthISO, offset = 0) {
  if (typeof anchorMonthISO !== "string")
    throw new TypeError("O mês de referência deve ser uma string YYYY-MM.");
  const match = /^(\d{4})-(\d{2})$/.exec(anchorMonthISO);
  if (!match)
    throw new TypeError("O mês de referência deve usar o formato YYYY-MM.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1900 || year > 9999 || month < 1 || month > 12)
    throw new RangeError(
      "O mês de referência deve estar entre 1900-01 e 9999-12.",
    );
  if (typeof offset !== "number")
    throw new TypeError("O deslocamento de mês deve ser um número inteiro.");
  if (!Number.isSafeInteger(offset))
    throw new RangeError("O deslocamento de mês deve ser um inteiro seguro.");

  const anchor = year * 12 + month - 1;
  const minOffset = MIN_MONTH - anchor;
  const maxOffset = MAX_MONTH - anchor;
  // Clamp before adding, so even very large safe integer offsets cannot make
  // the arithmetic overflow the safe integer range.
  const selectedOffset = Math.min(maxOffset, Math.max(minOffset, offset));
  const selected = anchor + selectedOffset;
  const groupedWindow = anchor + Math.floor(selectedOffset / 3) * 3;
  const window = Math.min(MAX_WINDOW_MONTH, Math.max(MIN_MONTH, groupedWindow));

  return {
    selectedMonth: monthKey(selected),
    windowMonth: monthKey(window),
    months: Array.from({ length: 3 }, (_, index) => ({
      key: monthKey(window + index),
      offset: window + index - anchor,
    })),
    offset: selectedOffset,
    windowOffset: window - anchor,
    minOffset,
    maxOffset,
  };
}
