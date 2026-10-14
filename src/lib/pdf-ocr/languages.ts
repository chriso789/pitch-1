/** OCR languages offered. Only Latin-script languages whose letters the invisible text layer can store (WinAnsi). */
export const OCR_LANGUAGES = [
  { code: 'eng', label: 'English' },
  { code: 'spa', label: 'Spanish' },
  { code: 'fra', label: 'French' },
  { code: 'por', label: 'Portuguese' },
  { code: 'deu', label: 'German' },
  { code: 'ita', label: 'Italian' },
] as const;
export type OcrLang = typeof OCR_LANGUAGES[number]['code'];

/** Tesseract language string: always includes English (drawings mix English titles/units). Unknown codes fall back to English. */
export function ocrLangString(langs: string[] | undefined): string {
  const ok = (langs ?? []).filter(l => OCR_LANGUAGES.some(o => o.code === l));
  return Array.from(new Set(['eng', ...ok])).join('+');
}
