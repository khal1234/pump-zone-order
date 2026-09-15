// 공통 곡명 검색 — 「담에 할 것」과 공개 존 파인더가 같은 규칙을 쓴다.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NAV_SEARCH = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
  var JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
  var JONG = ["", "ㄱ", "ㄲ", "ㄱㅅ", "ㄴ", "ㄴㅈ", "ㄴㅎ", "ㄷ", "ㄹ", "ㄹㄱ", "ㄹㅁ",
              "ㄹㅂ", "ㄹㅅ", "ㄹㅌ", "ㄹㅍ", "ㄹㅎ", "ㅁ", "ㅂ", "ㅂㅅ", "ㅅ", "ㅆ", "ㅇ",
              "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

  function normalize(s) {
    return String(s || "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  }
  function chosung(s) {
    return Array.from(s).map(function (c) {
      var n = c.charCodeAt(0) - 0xAC00;
      return n >= 0 && n < 11172 ? CHO.charAt(Math.floor(n / 588)) : c;
    }).join("");
  }
  function jamo(s) {
    return Array.from(s).map(function (c) {
      var n = c.charCodeAt(0) - 0xAC00;
      if (n < 0 || n >= 11172) return c;
      return CHO.charAt(Math.floor(n / 588)) + JUNG.charAt(Math.floor(n / 28) % 21) + JONG[n % 28];
    }).join("");
  }
  function commonPrefix(a, b) {
    var i = 0;
    while (i < a.length && i < b.length && a.charAt(i) === b.charAt(i)) i++;
    return i;
  }
  function rankTitles(q, titles, alternate) {
    var n = normalize(q);
    if (!n) return [];
    var queries = [n, jamo(n), chosung(n)];
    var pools = [[], [], []];
    titles.forEach(function (title) {
      var extra = alternate ? alternate(title) : [];
      if (!Array.isArray(extra)) extra = extra ? [extra] : [];
      var names = [title].concat(extra).map(normalize).filter(Boolean);
      for (var tier = 0; tier < pools.length; tier++) {
        var best = null;
        names.forEach(function (name) {
          var key = tier === 0 ? name : tier === 1 ? jamo(name) : chosung(name);
          var pos = key.indexOf(queries[tier]);
          if (pos < 0) return;
          var hit = {title:title, head:pos === 0 ? 0 : 1,
                     cp:commonPrefix(jamo(n), jamo(name)), tier:tier};
          if (!best || hit.head < best.head || (hit.head === best.head && hit.cp > best.cp)) best = hit;
        });
        if (best) { pools[tier].push(best); break; }
      }
    });
    var pool = pools.find(function (p) { return p.length; }) || [];
    pool.sort(function (x, y) {
      return x.head - y.head || y.cp - x.cp || x.title.length - y.title.length ||
             x.title.localeCompare(y.title);
    });
    return pool;
  }
  return {schemaVersion:1, normalize:normalize, chosung:chosung, jamo:jamo,
          commonPrefix:commonPrefix, rankTitles:rankTitles};
});
