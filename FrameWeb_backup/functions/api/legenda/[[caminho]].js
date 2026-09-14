// /api/legenda/<qualquer-nome>.srt?url=...  — mesmo handler de /api/legenda.
//
// Existe porque o Web Video Caster decide o formato da legenda pela URL: um
// link que termina em "?url=..." sem extensão ele não reconhece. Com
// ".srt" no caminho ele carrega direto, sem "baixando legendas" nem seletor.
export { onRequestGet, onRequestOptions } from '../legenda.js';
