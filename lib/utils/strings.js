'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.shortenHash = shortenHash;
exports.ellipsisMiddle = ellipsisMiddle;
function shortenHash(hash, partLength = 4) {
  return hash.slice(0, partLength) + '...' + hash.slice(hash.length - partLength, hash.length);
}

function ellipsisMiddle(text, length = 12, ellipsis = '...') {
  const tl = text.length;
  if (tl <= length) {
    return text;
  }

  const el = ellipsis.length;
  if (tl <= el) {
    return text;
  }

  const sl = length - el;
  const pl = Math.ceil(sl / 2);
  const left = text.slice(0, pl);
  const right = text.slice(-(length - el - pl));
  return `${left}${ellipsis}${right}`;
}