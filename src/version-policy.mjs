export const GEMINI_VERSION_PROBE_TIMEOUT_MS=15000;
const ANSI_RE=/\x1B(?:\[[0-?]*[ -\/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;
const EXACT_VERSION_RE=/^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9._-]+)?$/;
export function normalizeGeminiVersionOutput(value){return String(value).replace(ANSI_RE,'').trim();}
export function parseExactGeminiVersionOutput(value){
  const clean=String(value).replace(ANSI_RE,'').replace(/\r\n?/g,'\n');
  const lines=clean.split('\n').map(x=>x.trim()).filter(Boolean);
  if(lines.length!==1||!EXACT_VERSION_RE.test(lines[0]))return null;
  return lines[0];
}
