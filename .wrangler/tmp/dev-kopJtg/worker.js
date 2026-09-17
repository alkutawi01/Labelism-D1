var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// .wrangler/tmp/bundle-obLms4/checked-fetch.js
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
var urls;
var init_checked_fetch = __esm({
  ".wrangler/tmp/bundle-obLms4/checked-fetch.js"() {
    urls = /* @__PURE__ */ new Set();
    __name(checkURL, "checkURL");
    globalThis.fetch = new Proxy(globalThis.fetch, {
      apply(target, thisArg, argArray) {
        const [request, init] = argArray;
        checkURL(request, init);
        return Reflect.apply(target, thisArg, argArray);
      }
    });
  }
});

// wrangler-modules-watch:wrangler:modules-watch
var init_wrangler_modules_watch = __esm({
  "wrangler-modules-watch:wrangler:modules-watch"() {
    init_checked_fetch();
    init_modules_watch_stub();
  }
});

// node_modules/wrangler/templates/modules-watch-stub.js
var init_modules_watch_stub = __esm({
  "node_modules/wrangler/templates/modules-watch-stub.js"() {
    init_wrangler_modules_watch();
  }
});

// node_modules/bcryptjs/dist/bcrypt.js
var require_bcrypt = __commonJS({
  "node_modules/bcryptjs/dist/bcrypt.js"(exports, module) {
    init_checked_fetch();
    init_modules_watch_stub();
    (function(global, factory) {
      if (typeof define === "function" && define["amd"])
        define([], factory);
      else if (typeof __require === "function" && typeof module === "object" && module && module["exports"])
        module["exports"] = factory();
      else
        (global["dcodeIO"] = global["dcodeIO"] || {})["bcrypt"] = factory();
    })(exports, function() {
      "use strict";
      var bcrypt2 = {};
      var randomFallback = null;
      function random(len) {
        if (typeof module !== "undefined" && module && module["exports"])
          try {
            return __require("crypto")["randomBytes"](len);
          } catch (e) {
          }
        try {
          var a;
          (self["crypto"] || self["msCrypto"])["getRandomValues"](a = new Uint32Array(len));
          return Array.prototype.slice.call(a);
        } catch (e) {
        }
        if (!randomFallback)
          throw Error("Neither WebCryptoAPI nor a crypto module is available. Use bcrypt.setRandomFallback to set an alternative");
        return randomFallback(len);
      }
      __name(random, "random");
      var randomAvailable = false;
      try {
        random(1);
        randomAvailable = true;
      } catch (e) {
      }
      randomFallback = null;
      bcrypt2.setRandomFallback = function(random2) {
        randomFallback = random2;
      };
      bcrypt2.genSaltSync = function(rounds, seed_length) {
        rounds = rounds || GENSALT_DEFAULT_LOG2_ROUNDS;
        if (typeof rounds !== "number")
          throw Error("Illegal arguments: " + typeof rounds + ", " + typeof seed_length);
        if (rounds < 4)
          rounds = 4;
        else if (rounds > 31)
          rounds = 31;
        var salt = [];
        salt.push("$2a$");
        if (rounds < 10)
          salt.push("0");
        salt.push(rounds.toString());
        salt.push("$");
        salt.push(base64_encode(random(BCRYPT_SALT_LEN), BCRYPT_SALT_LEN));
        return salt.join("");
      };
      bcrypt2.genSalt = function(rounds, seed_length, callback) {
        if (typeof seed_length === "function")
          callback = seed_length, seed_length = void 0;
        if (typeof rounds === "function")
          callback = rounds, rounds = void 0;
        if (typeof rounds === "undefined")
          rounds = GENSALT_DEFAULT_LOG2_ROUNDS;
        else if (typeof rounds !== "number")
          throw Error("illegal arguments: " + typeof rounds);
        function _async(callback2) {
          nextTick(function() {
            try {
              callback2(null, bcrypt2.genSaltSync(rounds));
            } catch (err) {
              callback2(err);
            }
          });
        }
        __name(_async, "_async");
        if (callback) {
          if (typeof callback !== "function")
            throw Error("Illegal callback: " + typeof callback);
          _async(callback);
        } else
          return new Promise(function(resolve, reject) {
            _async(function(err, res) {
              if (err) {
                reject(err);
                return;
              }
              resolve(res);
            });
          });
      };
      bcrypt2.hashSync = function(s, salt) {
        if (typeof salt === "undefined")
          salt = GENSALT_DEFAULT_LOG2_ROUNDS;
        if (typeof salt === "number")
          salt = bcrypt2.genSaltSync(salt);
        if (typeof s !== "string" || typeof salt !== "string")
          throw Error("Illegal arguments: " + typeof s + ", " + typeof salt);
        return _hash(s, salt);
      };
      bcrypt2.hash = function(s, salt, callback, progressCallback) {
        function _async(callback2) {
          if (typeof s === "string" && typeof salt === "number")
            bcrypt2.genSalt(salt, function(err, salt2) {
              _hash(s, salt2, callback2, progressCallback);
            });
          else if (typeof s === "string" && typeof salt === "string")
            _hash(s, salt, callback2, progressCallback);
          else
            nextTick(callback2.bind(this, Error("Illegal arguments: " + typeof s + ", " + typeof salt)));
        }
        __name(_async, "_async");
        if (callback) {
          if (typeof callback !== "function")
            throw Error("Illegal callback: " + typeof callback);
          _async(callback);
        } else
          return new Promise(function(resolve, reject) {
            _async(function(err, res) {
              if (err) {
                reject(err);
                return;
              }
              resolve(res);
            });
          });
      };
      function safeStringCompare(known, unknown) {
        var right = 0, wrong = 0;
        for (var i = 0, k = known.length; i < k; ++i) {
          if (known.charCodeAt(i) === unknown.charCodeAt(i))
            ++right;
          else
            ++wrong;
        }
        if (right < 0)
          return false;
        return wrong === 0;
      }
      __name(safeStringCompare, "safeStringCompare");
      bcrypt2.compareSync = function(s, hash) {
        if (typeof s !== "string" || typeof hash !== "string")
          throw Error("Illegal arguments: " + typeof s + ", " + typeof hash);
        if (hash.length !== 60)
          return false;
        return safeStringCompare(bcrypt2.hashSync(s, hash.substr(0, hash.length - 31)), hash);
      };
      bcrypt2.compare = function(s, hash, callback, progressCallback) {
        function _async(callback2) {
          if (typeof s !== "string" || typeof hash !== "string") {
            nextTick(callback2.bind(this, Error("Illegal arguments: " + typeof s + ", " + typeof hash)));
            return;
          }
          if (hash.length !== 60) {
            nextTick(callback2.bind(this, null, false));
            return;
          }
          bcrypt2.hash(s, hash.substr(0, 29), function(err, comp) {
            if (err)
              callback2(err);
            else
              callback2(null, safeStringCompare(comp, hash));
          }, progressCallback);
        }
        __name(_async, "_async");
        if (callback) {
          if (typeof callback !== "function")
            throw Error("Illegal callback: " + typeof callback);
          _async(callback);
        } else
          return new Promise(function(resolve, reject) {
            _async(function(err, res) {
              if (err) {
                reject(err);
                return;
              }
              resolve(res);
            });
          });
      };
      bcrypt2.getRounds = function(hash) {
        if (typeof hash !== "string")
          throw Error("Illegal arguments: " + typeof hash);
        return parseInt(hash.split("$")[2], 10);
      };
      bcrypt2.getSalt = function(hash) {
        if (typeof hash !== "string")
          throw Error("Illegal arguments: " + typeof hash);
        if (hash.length !== 60)
          throw Error("Illegal hash length: " + hash.length + " != 60");
        return hash.substring(0, 29);
      };
      var nextTick = typeof process !== "undefined" && process && typeof process.nextTick === "function" ? typeof setImmediate === "function" ? setImmediate : process.nextTick : setTimeout;
      function stringToBytes(str) {
        var out = [], i = 0;
        utfx.encodeUTF16toUTF8(function() {
          if (i >= str.length) return null;
          return str.charCodeAt(i++);
        }, function(b) {
          out.push(b);
        });
        return out;
      }
      __name(stringToBytes, "stringToBytes");
      var BASE64_CODE = "./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".split("");
      var BASE64_INDEX = [
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        0,
        1,
        54,
        55,
        56,
        57,
        58,
        59,
        60,
        61,
        62,
        63,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10,
        11,
        12,
        13,
        14,
        15,
        16,
        17,
        18,
        19,
        20,
        21,
        22,
        23,
        24,
        25,
        26,
        27,
        -1,
        -1,
        -1,
        -1,
        -1,
        -1,
        28,
        29,
        30,
        31,
        32,
        33,
        34,
        35,
        36,
        37,
        38,
        39,
        40,
        41,
        42,
        43,
        44,
        45,
        46,
        47,
        48,
        49,
        50,
        51,
        52,
        53,
        -1,
        -1,
        -1,
        -1,
        -1
      ];
      var stringFromCharCode = String.fromCharCode;
      function base64_encode(b, len) {
        var off = 0, rs = [], c1, c2;
        if (len <= 0 || len > b.length)
          throw Error("Illegal len: " + len);
        while (off < len) {
          c1 = b[off++] & 255;
          rs.push(BASE64_CODE[c1 >> 2 & 63]);
          c1 = (c1 & 3) << 4;
          if (off >= len) {
            rs.push(BASE64_CODE[c1 & 63]);
            break;
          }
          c2 = b[off++] & 255;
          c1 |= c2 >> 4 & 15;
          rs.push(BASE64_CODE[c1 & 63]);
          c1 = (c2 & 15) << 2;
          if (off >= len) {
            rs.push(BASE64_CODE[c1 & 63]);
            break;
          }
          c2 = b[off++] & 255;
          c1 |= c2 >> 6 & 3;
          rs.push(BASE64_CODE[c1 & 63]);
          rs.push(BASE64_CODE[c2 & 63]);
        }
        return rs.join("");
      }
      __name(base64_encode, "base64_encode");
      function base64_decode(s, len) {
        var off = 0, slen = s.length, olen = 0, rs = [], c1, c2, c3, c4, o, code;
        if (len <= 0)
          throw Error("Illegal len: " + len);
        while (off < slen - 1 && olen < len) {
          code = s.charCodeAt(off++);
          c1 = code < BASE64_INDEX.length ? BASE64_INDEX[code] : -1;
          code = s.charCodeAt(off++);
          c2 = code < BASE64_INDEX.length ? BASE64_INDEX[code] : -1;
          if (c1 == -1 || c2 == -1)
            break;
          o = c1 << 2 >>> 0;
          o |= (c2 & 48) >> 4;
          rs.push(stringFromCharCode(o));
          if (++olen >= len || off >= slen)
            break;
          code = s.charCodeAt(off++);
          c3 = code < BASE64_INDEX.length ? BASE64_INDEX[code] : -1;
          if (c3 == -1)
            break;
          o = (c2 & 15) << 4 >>> 0;
          o |= (c3 & 60) >> 2;
          rs.push(stringFromCharCode(o));
          if (++olen >= len || off >= slen)
            break;
          code = s.charCodeAt(off++);
          c4 = code < BASE64_INDEX.length ? BASE64_INDEX[code] : -1;
          o = (c3 & 3) << 6 >>> 0;
          o |= c4;
          rs.push(stringFromCharCode(o));
          ++olen;
        }
        var res = [];
        for (off = 0; off < olen; off++)
          res.push(rs[off].charCodeAt(0));
        return res;
      }
      __name(base64_decode, "base64_decode");
      var utfx = (function() {
        "use strict";
        var utfx2 = {};
        utfx2.MAX_CODEPOINT = 1114111;
        utfx2.encodeUTF8 = function(src, dst) {
          var cp = null;
          if (typeof src === "number")
            cp = src, src = /* @__PURE__ */ __name(function() {
              return null;
            }, "src");
          while (cp !== null || (cp = src()) !== null) {
            if (cp < 128)
              dst(cp & 127);
            else if (cp < 2048)
              dst(cp >> 6 & 31 | 192), dst(cp & 63 | 128);
            else if (cp < 65536)
              dst(cp >> 12 & 15 | 224), dst(cp >> 6 & 63 | 128), dst(cp & 63 | 128);
            else
              dst(cp >> 18 & 7 | 240), dst(cp >> 12 & 63 | 128), dst(cp >> 6 & 63 | 128), dst(cp & 63 | 128);
            cp = null;
          }
        };
        utfx2.decodeUTF8 = function(src, dst) {
          var a, b, c, d, fail = /* @__PURE__ */ __name(function(b2) {
            b2 = b2.slice(0, b2.indexOf(null));
            var err = Error(b2.toString());
            err.name = "TruncatedError";
            err["bytes"] = b2;
            throw err;
          }, "fail");
          while ((a = src()) !== null) {
            if ((a & 128) === 0)
              dst(a);
            else if ((a & 224) === 192)
              (b = src()) === null && fail([a, b]), dst((a & 31) << 6 | b & 63);
            else if ((a & 240) === 224)
              ((b = src()) === null || (c = src()) === null) && fail([a, b, c]), dst((a & 15) << 12 | (b & 63) << 6 | c & 63);
            else if ((a & 248) === 240)
              ((b = src()) === null || (c = src()) === null || (d = src()) === null) && fail([a, b, c, d]), dst((a & 7) << 18 | (b & 63) << 12 | (c & 63) << 6 | d & 63);
            else throw RangeError("Illegal starting byte: " + a);
          }
        };
        utfx2.UTF16toUTF8 = function(src, dst) {
          var c1, c2 = null;
          while (true) {
            if ((c1 = c2 !== null ? c2 : src()) === null)
              break;
            if (c1 >= 55296 && c1 <= 57343) {
              if ((c2 = src()) !== null) {
                if (c2 >= 56320 && c2 <= 57343) {
                  dst((c1 - 55296) * 1024 + c2 - 56320 + 65536);
                  c2 = null;
                  continue;
                }
              }
            }
            dst(c1);
          }
          if (c2 !== null) dst(c2);
        };
        utfx2.UTF8toUTF16 = function(src, dst) {
          var cp = null;
          if (typeof src === "number")
            cp = src, src = /* @__PURE__ */ __name(function() {
              return null;
            }, "src");
          while (cp !== null || (cp = src()) !== null) {
            if (cp <= 65535)
              dst(cp);
            else
              cp -= 65536, dst((cp >> 10) + 55296), dst(cp % 1024 + 56320);
            cp = null;
          }
        };
        utfx2.encodeUTF16toUTF8 = function(src, dst) {
          utfx2.UTF16toUTF8(src, function(cp) {
            utfx2.encodeUTF8(cp, dst);
          });
        };
        utfx2.decodeUTF8toUTF16 = function(src, dst) {
          utfx2.decodeUTF8(src, function(cp) {
            utfx2.UTF8toUTF16(cp, dst);
          });
        };
        utfx2.calculateCodePoint = function(cp) {
          return cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4;
        };
        utfx2.calculateUTF8 = function(src) {
          var cp, l = 0;
          while ((cp = src()) !== null)
            l += utfx2.calculateCodePoint(cp);
          return l;
        };
        utfx2.calculateUTF16asUTF8 = function(src) {
          var n = 0, l = 0;
          utfx2.UTF16toUTF8(src, function(cp) {
            ++n;
            l += utfx2.calculateCodePoint(cp);
          });
          return [n, l];
        };
        return utfx2;
      })();
      Date.now = Date.now || function() {
        return +/* @__PURE__ */ new Date();
      };
      var BCRYPT_SALT_LEN = 16;
      var GENSALT_DEFAULT_LOG2_ROUNDS = 10;
      var BLOWFISH_NUM_ROUNDS = 16;
      var MAX_EXECUTION_TIME = 100;
      var P_ORIG = [
        608135816,
        2242054355,
        320440878,
        57701188,
        2752067618,
        698298832,
        137296536,
        3964562569,
        1160258022,
        953160567,
        3193202383,
        887688300,
        3232508343,
        3380367581,
        1065670069,
        3041331479,
        2450970073,
        2306472731
      ];
      var S_ORIG = [
        3509652390,
        2564797868,
        805139163,
        3491422135,
        3101798381,
        1780907670,
        3128725573,
        4046225305,
        614570311,
        3012652279,
        134345442,
        2240740374,
        1667834072,
        1901547113,
        2757295779,
        4103290238,
        227898511,
        1921955416,
        1904987480,
        2182433518,
        2069144605,
        3260701109,
        2620446009,
        720527379,
        3318853667,
        677414384,
        3393288472,
        3101374703,
        2390351024,
        1614419982,
        1822297739,
        2954791486,
        3608508353,
        3174124327,
        2024746970,
        1432378464,
        3864339955,
        2857741204,
        1464375394,
        1676153920,
        1439316330,
        715854006,
        3033291828,
        289532110,
        2706671279,
        2087905683,
        3018724369,
        1668267050,
        732546397,
        1947742710,
        3462151702,
        2609353502,
        2950085171,
        1814351708,
        2050118529,
        680887927,
        999245976,
        1800124847,
        3300911131,
        1713906067,
        1641548236,
        4213287313,
        1216130144,
        1575780402,
        4018429277,
        3917837745,
        3693486850,
        3949271944,
        596196993,
        3549867205,
        258830323,
        2213823033,
        772490370,
        2760122372,
        1774776394,
        2652871518,
        566650946,
        4142492826,
        1728879713,
        2882767088,
        1783734482,
        3629395816,
        2517608232,
        2874225571,
        1861159788,
        326777828,
        3124490320,
        2130389656,
        2716951837,
        967770486,
        1724537150,
        2185432712,
        2364442137,
        1164943284,
        2105845187,
        998989502,
        3765401048,
        2244026483,
        1075463327,
        1455516326,
        1322494562,
        910128902,
        469688178,
        1117454909,
        936433444,
        3490320968,
        3675253459,
        1240580251,
        122909385,
        2157517691,
        634681816,
        4142456567,
        3825094682,
        3061402683,
        2540495037,
        79693498,
        3249098678,
        1084186820,
        1583128258,
        426386531,
        1761308591,
        1047286709,
        322548459,
        995290223,
        1845252383,
        2603652396,
        3431023940,
        2942221577,
        3202600964,
        3727903485,
        1712269319,
        422464435,
        3234572375,
        1170764815,
        3523960633,
        3117677531,
        1434042557,
        442511882,
        3600875718,
        1076654713,
        1738483198,
        4213154764,
        2393238008,
        3677496056,
        1014306527,
        4251020053,
        793779912,
        2902807211,
        842905082,
        4246964064,
        1395751752,
        1040244610,
        2656851899,
        3396308128,
        445077038,
        3742853595,
        3577915638,
        679411651,
        2892444358,
        2354009459,
        1767581616,
        3150600392,
        3791627101,
        3102740896,
        284835224,
        4246832056,
        1258075500,
        768725851,
        2589189241,
        3069724005,
        3532540348,
        1274779536,
        3789419226,
        2764799539,
        1660621633,
        3471099624,
        4011903706,
        913787905,
        3497959166,
        737222580,
        2514213453,
        2928710040,
        3937242737,
        1804850592,
        3499020752,
        2949064160,
        2386320175,
        2390070455,
        2415321851,
        4061277028,
        2290661394,
        2416832540,
        1336762016,
        1754252060,
        3520065937,
        3014181293,
        791618072,
        3188594551,
        3933548030,
        2332172193,
        3852520463,
        3043980520,
        413987798,
        3465142937,
        3030929376,
        4245938359,
        2093235073,
        3534596313,
        375366246,
        2157278981,
        2479649556,
        555357303,
        3870105701,
        2008414854,
        3344188149,
        4221384143,
        3956125452,
        2067696032,
        3594591187,
        2921233993,
        2428461,
        544322398,
        577241275,
        1471733935,
        610547355,
        4027169054,
        1432588573,
        1507829418,
        2025931657,
        3646575487,
        545086370,
        48609733,
        2200306550,
        1653985193,
        298326376,
        1316178497,
        3007786442,
        2064951626,
        458293330,
        2589141269,
        3591329599,
        3164325604,
        727753846,
        2179363840,
        146436021,
        1461446943,
        4069977195,
        705550613,
        3059967265,
        3887724982,
        4281599278,
        3313849956,
        1404054877,
        2845806497,
        146425753,
        1854211946,
        1266315497,
        3048417604,
        3681880366,
        3289982499,
        290971e4,
        1235738493,
        2632868024,
        2414719590,
        3970600049,
        1771706367,
        1449415276,
        3266420449,
        422970021,
        1963543593,
        2690192192,
        3826793022,
        1062508698,
        1531092325,
        1804592342,
        2583117782,
        2714934279,
        4024971509,
        1294809318,
        4028980673,
        1289560198,
        2221992742,
        1669523910,
        35572830,
        157838143,
        1052438473,
        1016535060,
        1802137761,
        1753167236,
        1386275462,
        3080475397,
        2857371447,
        1040679964,
        2145300060,
        2390574316,
        1461121720,
        2956646967,
        4031777805,
        4028374788,
        33600511,
        2920084762,
        1018524850,
        629373528,
        3691585981,
        3515945977,
        2091462646,
        2486323059,
        586499841,
        988145025,
        935516892,
        3367335476,
        2599673255,
        2839830854,
        265290510,
        3972581182,
        2759138881,
        3795373465,
        1005194799,
        847297441,
        406762289,
        1314163512,
        1332590856,
        1866599683,
        4127851711,
        750260880,
        613907577,
        1450815602,
        3165620655,
        3734664991,
        3650291728,
        3012275730,
        3704569646,
        1427272223,
        778793252,
        1343938022,
        2676280711,
        2052605720,
        1946737175,
        3164576444,
        3914038668,
        3967478842,
        3682934266,
        1661551462,
        3294938066,
        4011595847,
        840292616,
        3712170807,
        616741398,
        312560963,
        711312465,
        1351876610,
        322626781,
        1910503582,
        271666773,
        2175563734,
        1594956187,
        70604529,
        3617834859,
        1007753275,
        1495573769,
        4069517037,
        2549218298,
        2663038764,
        504708206,
        2263041392,
        3941167025,
        2249088522,
        1514023603,
        1998579484,
        1312622330,
        694541497,
        2582060303,
        2151582166,
        1382467621,
        776784248,
        2618340202,
        3323268794,
        2497899128,
        2784771155,
        503983604,
        4076293799,
        907881277,
        423175695,
        432175456,
        1378068232,
        4145222326,
        3954048622,
        3938656102,
        3820766613,
        2793130115,
        2977904593,
        26017576,
        3274890735,
        3194772133,
        1700274565,
        1756076034,
        4006520079,
        3677328699,
        720338349,
        1533947780,
        354530856,
        688349552,
        3973924725,
        1637815568,
        332179504,
        3949051286,
        53804574,
        2852348879,
        3044236432,
        1282449977,
        3583942155,
        3416972820,
        4006381244,
        1617046695,
        2628476075,
        3002303598,
        1686838959,
        431878346,
        2686675385,
        1700445008,
        1080580658,
        1009431731,
        832498133,
        3223435511,
        2605976345,
        2271191193,
        2516031870,
        1648197032,
        4164389018,
        2548247927,
        300782431,
        375919233,
        238389289,
        3353747414,
        2531188641,
        2019080857,
        1475708069,
        455242339,
        2609103871,
        448939670,
        3451063019,
        1395535956,
        2413381860,
        1841049896,
        1491858159,
        885456874,
        4264095073,
        4001119347,
        1565136089,
        3898914787,
        1108368660,
        540939232,
        1173283510,
        2745871338,
        3681308437,
        4207628240,
        3343053890,
        4016749493,
        1699691293,
        1103962373,
        3625875870,
        2256883143,
        3830138730,
        1031889488,
        3479347698,
        1535977030,
        4236805024,
        3251091107,
        2132092099,
        1774941330,
        1199868427,
        1452454533,
        157007616,
        2904115357,
        342012276,
        595725824,
        1480756522,
        206960106,
        497939518,
        591360097,
        863170706,
        2375253569,
        3596610801,
        1814182875,
        2094937945,
        3421402208,
        1082520231,
        3463918190,
        2785509508,
        435703966,
        3908032597,
        1641649973,
        2842273706,
        3305899714,
        1510255612,
        2148256476,
        2655287854,
        3276092548,
        4258621189,
        236887753,
        3681803219,
        274041037,
        1734335097,
        3815195456,
        3317970021,
        1899903192,
        1026095262,
        4050517792,
        356393447,
        2410691914,
        3873677099,
        3682840055,
        3913112168,
        2491498743,
        4132185628,
        2489919796,
        1091903735,
        1979897079,
        3170134830,
        3567386728,
        3557303409,
        857797738,
        1136121015,
        1342202287,
        507115054,
        2535736646,
        337727348,
        3213592640,
        1301675037,
        2528481711,
        1895095763,
        1721773893,
        3216771564,
        62756741,
        2142006736,
        835421444,
        2531993523,
        1442658625,
        3659876326,
        2882144922,
        676362277,
        1392781812,
        170690266,
        3921047035,
        1759253602,
        3611846912,
        1745797284,
        664899054,
        1329594018,
        3901205900,
        3045908486,
        2062866102,
        2865634940,
        3543621612,
        3464012697,
        1080764994,
        553557557,
        3656615353,
        3996768171,
        991055499,
        499776247,
        1265440854,
        648242737,
        3940784050,
        980351604,
        3713745714,
        1749149687,
        3396870395,
        4211799374,
        3640570775,
        1161844396,
        3125318951,
        1431517754,
        545492359,
        4268468663,
        3499529547,
        1437099964,
        2702547544,
        3433638243,
        2581715763,
        2787789398,
        1060185593,
        1593081372,
        2418618748,
        4260947970,
        69676912,
        2159744348,
        86519011,
        2512459080,
        3838209314,
        1220612927,
        3339683548,
        133810670,
        1090789135,
        1078426020,
        1569222167,
        845107691,
        3583754449,
        4072456591,
        1091646820,
        628848692,
        1613405280,
        3757631651,
        526609435,
        236106946,
        48312990,
        2942717905,
        3402727701,
        1797494240,
        859738849,
        992217954,
        4005476642,
        2243076622,
        3870952857,
        3732016268,
        765654824,
        3490871365,
        2511836413,
        1685915746,
        3888969200,
        1414112111,
        2273134842,
        3281911079,
        4080962846,
        172450625,
        2569994100,
        980381355,
        4109958455,
        2819808352,
        2716589560,
        2568741196,
        3681446669,
        3329971472,
        1835478071,
        660984891,
        3704678404,
        4045999559,
        3422617507,
        3040415634,
        1762651403,
        1719377915,
        3470491036,
        2693910283,
        3642056355,
        3138596744,
        1364962596,
        2073328063,
        1983633131,
        926494387,
        3423689081,
        2150032023,
        4096667949,
        1749200295,
        3328846651,
        309677260,
        2016342300,
        1779581495,
        3079819751,
        111262694,
        1274766160,
        443224088,
        298511866,
        1025883608,
        3806446537,
        1145181785,
        168956806,
        3641502830,
        3584813610,
        1689216846,
        3666258015,
        3200248200,
        1692713982,
        2646376535,
        4042768518,
        1618508792,
        1610833997,
        3523052358,
        4130873264,
        2001055236,
        3610705100,
        2202168115,
        4028541809,
        2961195399,
        1006657119,
        2006996926,
        3186142756,
        1430667929,
        3210227297,
        1314452623,
        4074634658,
        4101304120,
        2273951170,
        1399257539,
        3367210612,
        3027628629,
        1190975929,
        2062231137,
        2333990788,
        2221543033,
        2438960610,
        1181637006,
        548689776,
        2362791313,
        3372408396,
        3104550113,
        3145860560,
        296247880,
        1970579870,
        3078560182,
        3769228297,
        1714227617,
        3291629107,
        3898220290,
        166772364,
        1251581989,
        493813264,
        448347421,
        195405023,
        2709975567,
        677966185,
        3703036547,
        1463355134,
        2715995803,
        1338867538,
        1343315457,
        2802222074,
        2684532164,
        233230375,
        2599980071,
        2000651841,
        3277868038,
        1638401717,
        4028070440,
        3237316320,
        6314154,
        819756386,
        300326615,
        590932579,
        1405279636,
        3267499572,
        3150704214,
        2428286686,
        3959192993,
        3461946742,
        1862657033,
        1266418056,
        963775037,
        2089974820,
        2263052895,
        1917689273,
        448879540,
        3550394620,
        3981727096,
        150775221,
        3627908307,
        1303187396,
        508620638,
        2975983352,
        2726630617,
        1817252668,
        1876281319,
        1457606340,
        908771278,
        3720792119,
        3617206836,
        2455994898,
        1729034894,
        1080033504,
        976866871,
        3556439503,
        2881648439,
        1522871579,
        1555064734,
        1336096578,
        3548522304,
        2579274686,
        3574697629,
        3205460757,
        3593280638,
        3338716283,
        3079412587,
        564236357,
        2993598910,
        1781952180,
        1464380207,
        3163844217,
        3332601554,
        1699332808,
        1393555694,
        1183702653,
        3581086237,
        1288719814,
        691649499,
        2847557200,
        2895455976,
        3193889540,
        2717570544,
        1781354906,
        1676643554,
        2592534050,
        3230253752,
        1126444790,
        2770207658,
        2633158820,
        2210423226,
        2615765581,
        2414155088,
        3127139286,
        673620729,
        2805611233,
        1269405062,
        4015350505,
        3341807571,
        4149409754,
        1057255273,
        2012875353,
        2162469141,
        2276492801,
        2601117357,
        993977747,
        3918593370,
        2654263191,
        753973209,
        36408145,
        2530585658,
        25011837,
        3520020182,
        2088578344,
        530523599,
        2918365339,
        1524020338,
        1518925132,
        3760827505,
        3759777254,
        1202760957,
        3985898139,
        3906192525,
        674977740,
        4174734889,
        2031300136,
        2019492241,
        3983892565,
        4153806404,
        3822280332,
        352677332,
        2297720250,
        60907813,
        90501309,
        3286998549,
        1016092578,
        2535922412,
        2839152426,
        457141659,
        509813237,
        4120667899,
        652014361,
        1966332200,
        2975202805,
        55981186,
        2327461051,
        676427537,
        3255491064,
        2882294119,
        3433927263,
        1307055953,
        942726286,
        933058658,
        2468411793,
        3933900994,
        4215176142,
        1361170020,
        2001714738,
        2830558078,
        3274259782,
        1222529897,
        1679025792,
        2729314320,
        3714953764,
        1770335741,
        151462246,
        3013232138,
        1682292957,
        1483529935,
        471910574,
        1539241949,
        458788160,
        3436315007,
        1807016891,
        3718408830,
        978976581,
        1043663428,
        3165965781,
        1927990952,
        4200891579,
        2372276910,
        3208408903,
        3533431907,
        1412390302,
        2931980059,
        4132332400,
        1947078029,
        3881505623,
        4168226417,
        2941484381,
        1077988104,
        1320477388,
        886195818,
        18198404,
        3786409e3,
        2509781533,
        112762804,
        3463356488,
        1866414978,
        891333506,
        18488651,
        661792760,
        1628790961,
        3885187036,
        3141171499,
        876946877,
        2693282273,
        1372485963,
        791857591,
        2686433993,
        3759982718,
        3167212022,
        3472953795,
        2716379847,
        445679433,
        3561995674,
        3504004811,
        3574258232,
        54117162,
        3331405415,
        2381918588,
        3769707343,
        4154350007,
        1140177722,
        4074052095,
        668550556,
        3214352940,
        367459370,
        261225585,
        2610173221,
        4209349473,
        3468074219,
        3265815641,
        314222801,
        3066103646,
        3808782860,
        282218597,
        3406013506,
        3773591054,
        379116347,
        1285071038,
        846784868,
        2669647154,
        3771962079,
        3550491691,
        2305946142,
        453669953,
        1268987020,
        3317592352,
        3279303384,
        3744833421,
        2610507566,
        3859509063,
        266596637,
        3847019092,
        517658769,
        3462560207,
        3443424879,
        370717030,
        4247526661,
        2224018117,
        4143653529,
        4112773975,
        2788324899,
        2477274417,
        1456262402,
        2901442914,
        1517677493,
        1846949527,
        2295493580,
        3734397586,
        2176403920,
        1280348187,
        1908823572,
        3871786941,
        846861322,
        1172426758,
        3287448474,
        3383383037,
        1655181056,
        3139813346,
        901632758,
        1897031941,
        2986607138,
        3066810236,
        3447102507,
        1393639104,
        373351379,
        950779232,
        625454576,
        3124240540,
        4148612726,
        2007998917,
        544563296,
        2244738638,
        2330496472,
        2058025392,
        1291430526,
        424198748,
        50039436,
        29584100,
        3605783033,
        2429876329,
        2791104160,
        1057563949,
        3255363231,
        3075367218,
        3463963227,
        1469046755,
        985887462
      ];
      var C_ORIG = [
        1332899944,
        1700884034,
        1701343084,
        1684370003,
        1668446532,
        1869963892
      ];
      function _encipher(lr, off, P, S) {
        var n, l = lr[off], r = lr[off + 1];
        l ^= P[0];
        n = S[l >>> 24];
        n += S[256 | l >> 16 & 255];
        n ^= S[512 | l >> 8 & 255];
        n += S[768 | l & 255];
        r ^= n ^ P[1];
        n = S[r >>> 24];
        n += S[256 | r >> 16 & 255];
        n ^= S[512 | r >> 8 & 255];
        n += S[768 | r & 255];
        l ^= n ^ P[2];
        n = S[l >>> 24];
        n += S[256 | l >> 16 & 255];
        n ^= S[512 | l >> 8 & 255];
        n += S[768 | l & 255];
        r ^= n ^ P[3];
        n = S[r >>> 24];
        n += S[256 | r >> 16 & 255];
        n ^= S[512 | r >> 8 & 255];
        n += S[768 | r & 255];
        l ^= n ^ P[4];
        n = S[l >>> 24];
        n += S[256 | l >> 16 & 255];
        n ^= S[512 | l >> 8 & 255];
        n += S[768 | l & 255];
        r ^= n ^ P[5];
        n = S[r >>> 24];
        n += S[256 | r >> 16 & 255];
        n ^= S[512 | r >> 8 & 255];
        n += S[768 | r & 255];
        l ^= n ^ P[6];
        n = S[l >>> 24];
        n += S[256 | l >> 16 & 255];
        n ^= S[512 | l >> 8 & 255];
        n += S[768 | l & 255];
        r ^= n ^ P[7];
        n = S[r >>> 24];
        n += S[256 | r >> 16 & 255];
        n ^= S[512 | r >> 8 & 255];
        n += S[768 | r & 255];
        l ^= n ^ P[8];
        n = S[l >>> 24];
        n += S[256 | l >> 16 & 255];
        n ^= S[512 | l >> 8 & 255];
        n += S[768 | l & 255];
        r ^= n ^ P[9];
        n = S[r >>> 24];
        n += S[256 | r >> 16 & 255];
        n ^= S[512 | r >> 8 & 255];
        n += S[768 | r & 255];
        l ^= n ^ P[10];
        n = S[l >>> 24];
        n += S[256 | l >> 16 & 255];
        n ^= S[512 | l >> 8 & 255];
        n += S[768 | l & 255];
        r ^= n ^ P[11];
        n = S[r >>> 24];
        n += S[256 | r >> 16 & 255];
        n ^= S[512 | r >> 8 & 255];
        n += S[768 | r & 255];
        l ^= n ^ P[12];
        n = S[l >>> 24];
        n += S[256 | l >> 16 & 255];
        n ^= S[512 | l >> 8 & 255];
        n += S[768 | l & 255];
        r ^= n ^ P[13];
        n = S[r >>> 24];
        n += S[256 | r >> 16 & 255];
        n ^= S[512 | r >> 8 & 255];
        n += S[768 | r & 255];
        l ^= n ^ P[14];
        n = S[l >>> 24];
        n += S[256 | l >> 16 & 255];
        n ^= S[512 | l >> 8 & 255];
        n += S[768 | l & 255];
        r ^= n ^ P[15];
        n = S[r >>> 24];
        n += S[256 | r >> 16 & 255];
        n ^= S[512 | r >> 8 & 255];
        n += S[768 | r & 255];
        l ^= n ^ P[16];
        lr[off] = r ^ P[BLOWFISH_NUM_ROUNDS + 1];
        lr[off + 1] = l;
        return lr;
      }
      __name(_encipher, "_encipher");
      function _streamtoword(data, offp) {
        for (var i = 0, word = 0; i < 4; ++i)
          word = word << 8 | data[offp] & 255, offp = (offp + 1) % data.length;
        return { key: word, offp };
      }
      __name(_streamtoword, "_streamtoword");
      function _key(key, P, S) {
        var offset = 0, lr = [0, 0], plen = P.length, slen = S.length, sw;
        for (var i = 0; i < plen; i++)
          sw = _streamtoword(key, offset), offset = sw.offp, P[i] = P[i] ^ sw.key;
        for (i = 0; i < plen; i += 2)
          lr = _encipher(lr, 0, P, S), P[i] = lr[0], P[i + 1] = lr[1];
        for (i = 0; i < slen; i += 2)
          lr = _encipher(lr, 0, P, S), S[i] = lr[0], S[i + 1] = lr[1];
      }
      __name(_key, "_key");
      function _ekskey(data, key, P, S) {
        var offp = 0, lr = [0, 0], plen = P.length, slen = S.length, sw;
        for (var i = 0; i < plen; i++)
          sw = _streamtoword(key, offp), offp = sw.offp, P[i] = P[i] ^ sw.key;
        offp = 0;
        for (i = 0; i < plen; i += 2)
          sw = _streamtoword(data, offp), offp = sw.offp, lr[0] ^= sw.key, sw = _streamtoword(data, offp), offp = sw.offp, lr[1] ^= sw.key, lr = _encipher(lr, 0, P, S), P[i] = lr[0], P[i + 1] = lr[1];
        for (i = 0; i < slen; i += 2)
          sw = _streamtoword(data, offp), offp = sw.offp, lr[0] ^= sw.key, sw = _streamtoword(data, offp), offp = sw.offp, lr[1] ^= sw.key, lr = _encipher(lr, 0, P, S), S[i] = lr[0], S[i + 1] = lr[1];
      }
      __name(_ekskey, "_ekskey");
      function _crypt(b, salt, rounds, callback, progressCallback) {
        var cdata = C_ORIG.slice(), clen = cdata.length, err;
        if (rounds < 4 || rounds > 31) {
          err = Error("Illegal number of rounds (4-31): " + rounds);
          if (callback) {
            nextTick(callback.bind(this, err));
            return;
          } else
            throw err;
        }
        if (salt.length !== BCRYPT_SALT_LEN) {
          err = Error("Illegal salt length: " + salt.length + " != " + BCRYPT_SALT_LEN);
          if (callback) {
            nextTick(callback.bind(this, err));
            return;
          } else
            throw err;
        }
        rounds = 1 << rounds >>> 0;
        var P, S, i = 0, j;
        if (Int32Array) {
          P = new Int32Array(P_ORIG);
          S = new Int32Array(S_ORIG);
        } else {
          P = P_ORIG.slice();
          S = S_ORIG.slice();
        }
        _ekskey(salt, b, P, S);
        function next() {
          if (progressCallback)
            progressCallback(i / rounds);
          if (i < rounds) {
            var start = Date.now();
            for (; i < rounds; ) {
              i = i + 1;
              _key(b, P, S);
              _key(salt, P, S);
              if (Date.now() - start > MAX_EXECUTION_TIME)
                break;
            }
          } else {
            for (i = 0; i < 64; i++)
              for (j = 0; j < clen >> 1; j++)
                _encipher(cdata, j << 1, P, S);
            var ret = [];
            for (i = 0; i < clen; i++)
              ret.push((cdata[i] >> 24 & 255) >>> 0), ret.push((cdata[i] >> 16 & 255) >>> 0), ret.push((cdata[i] >> 8 & 255) >>> 0), ret.push((cdata[i] & 255) >>> 0);
            if (callback) {
              callback(null, ret);
              return;
            } else
              return ret;
          }
          if (callback)
            nextTick(next);
        }
        __name(next, "next");
        if (typeof callback !== "undefined") {
          next();
        } else {
          var res;
          while (true)
            if (typeof (res = next()) !== "undefined")
              return res || [];
        }
      }
      __name(_crypt, "_crypt");
      function _hash(s, salt, callback, progressCallback) {
        var err;
        if (typeof s !== "string" || typeof salt !== "string") {
          err = Error("Invalid string / salt: Not a string");
          if (callback) {
            nextTick(callback.bind(this, err));
            return;
          } else
            throw err;
        }
        var minor, offset;
        if (salt.charAt(0) !== "$" || salt.charAt(1) !== "2") {
          err = Error("Invalid salt version: " + salt.substring(0, 2));
          if (callback) {
            nextTick(callback.bind(this, err));
            return;
          } else
            throw err;
        }
        if (salt.charAt(2) === "$")
          minor = String.fromCharCode(0), offset = 3;
        else {
          minor = salt.charAt(2);
          if (minor !== "a" && minor !== "b" && minor !== "y" || salt.charAt(3) !== "$") {
            err = Error("Invalid salt revision: " + salt.substring(2, 4));
            if (callback) {
              nextTick(callback.bind(this, err));
              return;
            } else
              throw err;
          }
          offset = 4;
        }
        if (salt.charAt(offset + 2) > "$") {
          err = Error("Missing salt rounds");
          if (callback) {
            nextTick(callback.bind(this, err));
            return;
          } else
            throw err;
        }
        var r1 = parseInt(salt.substring(offset, offset + 1), 10) * 10, r2 = parseInt(salt.substring(offset + 1, offset + 2), 10), rounds = r1 + r2, real_salt = salt.substring(offset + 3, offset + 25);
        s += minor >= "a" ? "\0" : "";
        var passwordb = stringToBytes(s), saltb = base64_decode(real_salt, BCRYPT_SALT_LEN);
        function finish(bytes) {
          var res = [];
          res.push("$2");
          if (minor >= "a")
            res.push(minor);
          res.push("$");
          if (rounds < 10)
            res.push("0");
          res.push(rounds.toString());
          res.push("$");
          res.push(base64_encode(saltb, saltb.length));
          res.push(base64_encode(bytes, C_ORIG.length * 4 - 1));
          return res.join("");
        }
        __name(finish, "finish");
        if (typeof callback == "undefined")
          return finish(_crypt(passwordb, saltb, rounds));
        else {
          _crypt(passwordb, saltb, rounds, function(err2, bytes) {
            if (err2)
              callback(err2, null);
            else
              callback(null, finish(bytes));
          }, progressCallback);
        }
      }
      __name(_hash, "_hash");
      bcrypt2.encodeBase64 = base64_encode;
      bcrypt2.decodeBase64 = base64_decode;
      return bcrypt2;
    });
  }
});

// .wrangler/tmp/bundle-obLms4/middleware-loader.entry.ts
init_checked_fetch();
init_modules_watch_stub();

// .wrangler/tmp/bundle-obLms4/middleware-insertion-facade.js
init_checked_fetch();
init_modules_watch_stub();

// src/worker.js
init_checked_fetch();
init_modules_watch_stub();

// src/auth/index.js
init_checked_fetch();
init_modules_watch_stub();
var import_bcryptjs = __toESM(require_bcrypt(), 1);
var COOKIE_NAME = "labelism_session";
var SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
var PUBLIC_PATHS = /* @__PURE__ */ new Set(["/login.html", "/style.css", "/favicon.ico"]);
var PUBLIC_API_PATHS = /* @__PURE__ */ new Set(["/api/login", "/api/logout", "/api/health"]);
function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(toHex, "toHex");
async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}
__name(hmacKey, "hmacKey");
async function sign(value, secret) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toHex(sig);
}
__name(sign, "sign");
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
__name(timingSafeEqual, "timingSafeEqual");
function authConfigured(env) {
  return Boolean(env.LABELISM_ADMIN_PASSWORD_HASH && env.LABELISM_SESSION_SECRET);
}
__name(authConfigured, "authConfigured");
function assertAuthSafeToBoot(env) {
  if (env.NODE_ENV === "production" && !authConfigured(env)) {
    throw new Error(
      "REFUSE TO BOOT: NODE_ENV=production but LABELISM_ADMIN_PASSWORD_HASH / LABELISM_SESSION_SECRET is not set."
    );
  }
}
__name(assertAuthSafeToBoot, "assertAuthSafeToBoot");
async function verifyPassword(password, env) {
  if (!env.LABELISM_ADMIN_PASSWORD_HASH) return false;
  return import_bcryptjs.default.compare(password, env.LABELISM_ADMIN_PASSWORD_HASH);
}
__name(verifyPassword, "verifyPassword");
async function makeSessionCookieValue(env) {
  const adminUser = env.LABELISM_ADMIN_USER || "izzat";
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = `${adminUser}.${expires}`;
  const signature = await sign(payload, env.LABELISM_SESSION_SECRET);
  return `${payload}.${signature}`;
}
__name(makeSessionCookieValue, "makeSessionCookieValue");
async function verifySessionCookieValue(value, env) {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [user, expiresStr, signature] = parts;
  const payload = `${user}.${expiresStr}`;
  const expected = await sign(payload, env.LABELISM_SESSION_SECRET);
  if (!timingSafeEqual(signature, expected)) return false;
  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || Date.now() > expires) return false;
  const adminUser = env.LABELISM_ADMIN_USER || "izzat";
  return user === adminUser;
}
__name(verifySessionCookieValue, "verifySessionCookieValue");
function parseCookies(req) {
  const header = req.headers.get("cookie");
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((pair) => {
      const idx = pair.indexOf("=");
      return [pair.slice(0, idx).trim(), decodeURIComponent(pair.slice(idx + 1).trim())];
    })
  );
}
__name(parseCookies, "parseCookies");
async function setSessionCookieHeader(env) {
  const isSecureEnv = env.NODE_ENV === "production";
  const value = await makeSessionCookieValue(env);
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1e3)}`
  ];
  if (isSecureEnv) attrs.push("Secure");
  return attrs.join("; ");
}
__name(setSessionCookieHeader, "setSessionCookieHeader");
function clearSessionCookieHeader() {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`;
}
__name(clearSessionCookieHeader, "clearSessionCookieHeader");
async function authGate(request, env) {
  const url = new URL(request.url);
  if (!authConfigured(env)) {
    if (env.NODE_ENV === "production") {
      return Response.json({ error: "Auth not configured." }, { status: 500 });
    }
    return null;
  }
  if (url.pathname.startsWith("/api/")) {
    if (PUBLIC_API_PATHS.has(url.pathname)) return null;
    const cookies2 = parseCookies(request);
    if (await verifySessionCookieValue(cookies2[COOKIE_NAME], env)) return null;
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (PUBLIC_PATHS.has(url.pathname)) return null;
  const cookies = parseCookies(request);
  if (await verifySessionCookieValue(cookies[COOKIE_NAME], env)) return null;
  return Response.redirect(new URL("/login.html", request.url), 302);
}
__name(authGate, "authGate");

// src/routes/index.js
init_checked_fetch();
init_modules_watch_stub();

// src/services/catalog.js
init_checked_fetch();
init_modules_watch_stub();

// src/db/d1.js
init_checked_fetch();
init_modules_watch_stub();
function newInternalId() {
  return crypto.randomUUID();
}
__name(newInternalId, "newInternalId");
function newOpaqueToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(newOpaqueToken, "newOpaqueToken");
function buildEventBatch(db, { eventId, unitId, eventType, payload, actor, occurredAt, disposition, condition, locationId }) {
  const statements = [
    db.prepare(
      `INSERT INTO unit_events (id, unit_id, seq, event_type, payload, actor, occurred_at)
       SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?
       FROM unit_events WHERE unit_id = ?
       RETURNING seq`
    ).bind(eventId, unitId, eventType, payload ? JSON.stringify(payload) : null, actor ?? null, occurredAt ?? null, unitId)
  ];
  const sets = [];
  const params = [];
  if (disposition !== void 0) {
    sets.push("current_disposition = ?");
    params.push(disposition);
  }
  if (condition !== void 0) {
    sets.push("current_condition = ?");
    params.push(condition);
  }
  if (locationId !== void 0) {
    sets.push("current_location_id = ?");
    params.push(locationId);
  }
  sets.push("last_event_seq = last_event_seq + 1");
  params.push(unitId);
  statements.push(db.prepare(`UPDATE units SET ${sets.join(", ")} WHERE id = ?`).bind(...params));
  return statements;
}
__name(buildEventBatch, "buildEventBatch");

// src/domain/validation.js
init_checked_fetch();
init_modules_watch_stub();
var ValidationError = class extends Error {
  static {
    __name(this, "ValidationError");
  }
};
function requireInt(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError(`${label} must be a whole number >= 0.`);
  }
  return value;
}
__name(requireInt, "requireInt");

// src/services/catalog.js
async function createProduct(db, { name }) {
  if (!name) throw new ValidationError("Product name is required.");
  const id = newInternalId();
  await db.prepare("INSERT INTO products (id, name) VALUES (?, ?)").bind(id, name).run();
  return { id, name };
}
__name(createProduct, "createProduct");
async function listProducts(db) {
  const { results: products } = await db.prepare("SELECT id, name FROM products ORDER BY name").all();
  const { results: dimensions } = await db.prepare("SELECT id, product_id, name FROM product_dimensions ORDER BY sort_order, name").all();
  const { results: variants } = await db.prepare("SELECT id, product_id, variant_label FROM variants ORDER BY variant_label").all();
  const { results: attrs } = await db.prepare("SELECT variant_id, key, value FROM variant_attributes").all();
  const attrsByVariant = /* @__PURE__ */ new Map();
  for (const a of attrs) {
    if (!attrsByVariant.has(a.variant_id)) attrsByVariant.set(a.variant_id, {});
    attrsByVariant.get(a.variant_id)[a.key] = a.value;
  }
  const dimensionsByProduct = /* @__PURE__ */ new Map();
  for (const d of dimensions) {
    if (!dimensionsByProduct.has(d.product_id)) dimensionsByProduct.set(d.product_id, []);
    dimensionsByProduct.get(d.product_id).push(d.name);
  }
  const variantsByProduct = /* @__PURE__ */ new Map();
  for (const v of variants) {
    if (!variantsByProduct.has(v.product_id)) variantsByProduct.set(v.product_id, []);
    variantsByProduct.get(v.product_id).push({
      id: v.id,
      variantLabel: v.variant_label,
      attributes: attrsByVariant.get(v.id) ?? {}
    });
  }
  return products.map((p) => ({
    id: p.id,
    name: p.name,
    dimensions: dimensionsByProduct.get(p.id) ?? [],
    variants: variantsByProduct.get(p.id) ?? []
  }));
}
__name(listProducts, "listProducts");
async function addProductDimensions(db, productId, names) {
  const product = await db.prepare("SELECT id FROM products WHERE id = ?").bind(productId).first();
  if (!product) return { notFound: true };
  const existingRow = await db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM product_dimensions WHERE product_id = ?").bind(productId).first();
  let nextOrder = existingRow.maxOrder + 1;
  const statements = [];
  for (const rawName of names) {
    const name = String(rawName).trim();
    if (!name) continue;
    statements.push(
      db.prepare("INSERT OR IGNORE INTO product_dimensions (id, product_id, name, sort_order) VALUES (?, ?, ?, ?)").bind(newInternalId(), productId, name, nextOrder++)
    );
  }
  if (statements.length) await db.batch(statements);
  const { results } = await db.prepare("SELECT name FROM product_dimensions WHERE product_id = ? ORDER BY sort_order, name").bind(productId).all();
  return { productId, dimensions: results.map((r) => r.name) };
}
__name(addProductDimensions, "addProductDimensions");
async function createVariant(db, { productId, variantLabel, attributes }) {
  if (!productId || !variantLabel) {
    throw new ValidationError("productId and variantLabel are required.");
  }
  const id = newInternalId();
  const statements = [
    db.prepare("INSERT INTO variants (id, product_id, variant_label) VALUES (?, ?, ?)").bind(id, productId, variantLabel)
  ];
  if (attributes && typeof attributes === "object") {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== void 0 && value !== null && value !== "") {
        statements.push(
          db.prepare("INSERT INTO variant_attributes (variant_id, key, value) VALUES (?, ?, ?)").bind(id, key, String(value))
        );
      }
    }
  }
  await db.batch(statements);
  return { id, productId, variantLabel };
}
__name(createVariant, "createVariant");
async function createProductionBatch(db, { variantId, batchNumber, plannedQuantity, unitCostCents, producerName, notes, orderLineId }) {
  if (!variantId || !batchNumber || !plannedQuantity) {
    throw new ValidationError("variantId, batchNumber, and plannedQuantity are required.");
  }
  const id = newInternalId();
  await db.prepare(
    `INSERT INTO production_batches (id, variant_id, batch_number, planned_quantity, unit_cost_cents, producer_name, notes, order_line_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, variantId, String(batchNumber), plannedQuantity, unitCostCents ?? null, producerName ?? null, notes ?? null, orderLineId ?? null).run();
  return { id, variantId, batchNumber: String(batchNumber), plannedQuantity, orderLineId: orderLineId ?? null };
}
__name(createProductionBatch, "createProductionBatch");
async function listProductionBatches(db) {
  const { results } = await db.prepare(
    `SELECT pb.id, pb.batch_number, pb.planned_quantity, pb.notes, pb.order_line_id, p.name AS product_name, v.variant_label,
              o.id AS order_id, o.order_reference, c.id AS customer_id, c.name AS customer_name,
              (SELECT COUNT(*) FROM units u WHERE u.batch_id = pb.id) AS registered_count,
              (SELECT COUNT(*) FROM units u WHERE u.batch_id = pb.id AND u.label_confirmed_at IS NOT NULL) AS labeled_count
       FROM production_batches pb
       JOIN variants v ON v.id = pb.variant_id
       JOIN products p ON p.id = v.product_id
       LEFT JOIN order_lines ol ON ol.id = pb.order_line_id
       LEFT JOIN orders o ON o.id = ol.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       ORDER BY pb.created_at DESC`
  ).all();
  return results;
}
__name(listProductionBatches, "listProductionBatches");
async function getProductionBatch(db, id) {
  const batch = await db.prepare(
    `SELECT pb.*, o.order_reference, c.name AS customer_name
       FROM production_batches pb
       LEFT JOIN order_lines ol ON ol.id = pb.order_line_id
       LEFT JOIN orders o ON o.id = ol.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE pb.id = ?`
  ).bind(id).first();
  if (!batch) return null;
  const { results: receipts } = await db.prepare("SELECT * FROM batch_receipts WHERE batch_id = ? ORDER BY received_at").bind(id).all();
  const countRow = await db.prepare("SELECT COUNT(*) AS n FROM units WHERE batch_id = ?").bind(id).first();
  return { ...batch, receipts, unitCount: Number(countRow.n) };
}
__name(getProductionBatch, "getProductionBatch");
async function getDashboardStats(db) {
  const row = await db.prepare(
    `SELECT
        (SELECT COUNT(*) FROM products) AS products,
        (SELECT COUNT(*) FROM variants) AS variants,
        (SELECT COUNT(*) FROM production_batches) AS batches,
        (SELECT COUNT(*) FROM units) AS units,
        (SELECT COUNT(*) FROM units WHERE current_disposition = 'AVAILABLE') AS availableUnits,
        (SELECT COUNT(*) FROM locations) AS locations`
  ).first();
  return {
    products: Number(row.products),
    variants: Number(row.variants),
    batches: Number(row.batches),
    units: Number(row.units),
    availableUnits: Number(row.availableUnits),
    locations: Number(row.locations)
  };
}
__name(getDashboardStats, "getDashboardStats");
async function listLocations(db) {
  const { results } = await db.prepare("SELECT * FROM locations ORDER BY name").all();
  return results;
}
__name(listLocations, "listLocations");
async function createLocation(db, { name, locationType }) {
  if (!name) throw new ValidationError("Location name is required.");
  const id = newInternalId();
  await db.prepare("INSERT INTO locations (id, name, location_type) VALUES (?, ?, ?)").bind(id, name, locationType ?? null).run();
  return { id, name, locationType: locationType ?? null };
}
__name(createLocation, "createLocation");
async function getOrCreateLocation(db, name) {
  let location = await db.prepare("SELECT * FROM locations WHERE lower(name) = lower(?)").bind(name).first();
  if (!location) {
    const id = newInternalId();
    await db.prepare("INSERT INTO locations (id, name) VALUES (?, ?)").bind(id, name).run();
    location = { id, name };
  }
  return location;
}
__name(getOrCreateLocation, "getOrCreateLocation");
async function listUnitsForBatch(db, batchId) {
  const { results } = await db.prepare(
    `SELECT u.id, u.human_code, u.internal_token, u.current_disposition, u.label_confirmed_at, u.recipient_name,
              u.current_location_id, l.name AS location_name,
              EXISTS(
                SELECT 1 FROM unit_events ue
                WHERE ue.unit_id = u.id AND ue.event_type = 'LABEL_SCANNED_FOR_ATTACHMENT'
                  AND ue.seq > COALESCE(
                    (SELECT MAX(seq) FROM unit_events WHERE unit_id = u.id AND event_type = 'LABEL_REISSUED'), 0
                  )
              ) AS label_scan_verified
       FROM units u
       LEFT JOIN locations l ON l.id = u.current_location_id
       WHERE u.batch_id = ? ORDER BY u.human_code`
  ).bind(batchId).all();
  return results;
}
__name(listUnitsForBatch, "listUnitsForBatch");

// src/services/receiving.js
init_checked_fetch();
init_modules_watch_stub();
async function createReceipt(db, batchId, { observedQuantity, acceptedQuantity, rejectedQuantity, rejectionReason, notes }) {
  const batch = await db.prepare("SELECT * FROM production_batches WHERE id = ?").bind(batchId).first();
  if (!batch) return { notFound: true };
  requireInt(observedQuantity, "observedQuantity");
  const accepted = acceptedQuantity ?? observedQuantity;
  const rejected = rejectedQuantity ?? 0;
  requireInt(accepted, "acceptedQuantity");
  requireInt(rejected, "rejectedQuantity");
  if (accepted + rejected > observedQuantity) {
    throw new ValidationError(
      `Accepted (${accepted}) + rejected (${rejected}) cannot exceed observed (${observedQuantity}).`
    );
  }
  const id = newInternalId();
  await db.prepare(
    `INSERT INTO batch_receipts (id, batch_id, actual_quantity, accepted_quantity, rejected_quantity, rejection_reason, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, batchId, observedQuantity, accepted, rejected, rejectionReason ?? null, notes ?? null).run();
  return {
    id,
    batchId,
    observedQuantity,
    acceptedQuantity: accepted,
    rejectedQuantity: rejected,
    plannedQuantity: batch.planned_quantity,
    variance: observedQuantity - batch.planned_quantity
  };
}
__name(createReceipt, "createReceipt");
function buildUnitStatementsForBatch(db, batchId, plannedQuantity, existingInBatch = 0, unitNames = [], actor = "system") {
  const toCreate = plannedQuantity - existingInBatch;
  if (toCreate <= 0) return { createdUnits: [], statements: [] };
  const createdUnits = [];
  const statements = [];
  for (let i = 0; i < toCreate; i++) {
    const seqNo = existingInBatch + i + 1;
    const unitId = newInternalId();
    const humanCode = String(seqNo).padStart(6, "0");
    const internalToken = newOpaqueToken();
    const publicToken = newOpaqueToken();
    const recipientName = unitNames[i] ? String(unitNames[i]).trim() : null;
    statements.push(
      db.prepare(
        `INSERT INTO units (id, batch_id, human_code, internal_token, public_token, current_disposition, recipient_name)
           VALUES (?, ?, ?, ?, ?, 'AVAILABLE', ?)`
      ).bind(unitId, batchId, humanCode, internalToken, publicToken, recipientName)
    );
    statements.push(
      db.prepare(
        `INSERT INTO unit_events (id, unit_id, seq, event_type, payload, actor)
           VALUES (?, ?, 1, 'UNIT_REGISTERED', ?, ?)`
      ).bind(newInternalId(), unitId, JSON.stringify({ source: "order_obligation", recipientName }), actor ?? "system")
    );
    statements.push(db.prepare("UPDATE units SET last_event_seq = 1 WHERE id = ?").bind(unitId));
    createdUnits.push({ id: unitId, humanCode, recipientName });
  }
  return { createdUnits, statements };
}
__name(buildUnitStatementsForBatch, "buildUnitStatementsForBatch");
async function generateUnitsForBatch(db, batchId, actor, unitNames = []) {
  const batch = await db.prepare("SELECT * FROM production_batches WHERE id = ?").bind(batchId).first();
  if (!batch) return { notFound: true };
  let names = Array.isArray(unitNames) && unitNames.length ? unitNames : [];
  if (!names.length && batch.notes) {
    try {
      const parsed = JSON.parse(batch.notes);
      if (Array.isArray(parsed.plannedUnitNames)) names = parsed.plannedUnitNames;
    } catch {
    }
  }
  const existingRow = await db.prepare("SELECT COUNT(*) AS n FROM units WHERE batch_id = ?").bind(batchId).first();
  const existingInBatch = Number(existingRow.n);
  const { createdUnits, statements } = buildUnitStatementsForBatch(db, batchId, batch.planned_quantity, existingInBatch, names, actor);
  if (!statements.length) {
    return { created: 0, alreadyRegistered: existingInBatch, message: "All units for this batch are already generated." };
  }
  await db.batch(statements);
  return { created: createdUnits.length, units: createdUnits };
}
__name(generateUnitsForBatch, "generateUnitsForBatch");
async function registerUnits(db, receiptId, actor) {
  const receipt = await db.prepare("SELECT * FROM batch_receipts WHERE id = ?").bind(receiptId).first();
  if (!receipt) return { notFound: true };
  const alreadyRow = await db.prepare("SELECT COUNT(*) AS n FROM units WHERE batch_receipt_id = ?").bind(receiptId).first();
  const already = Number(alreadyRow.n);
  const toCreate = receipt.accepted_quantity - already;
  if (toCreate <= 0) {
    return { created: 0, alreadyRegistered: already, message: "All units for this receipt are already registered." };
  }
  const existingRow = await db.prepare("SELECT COUNT(*) AS n FROM units WHERE batch_id = ?").bind(receipt.batch_id).first();
  const existingInBatch = Number(existingRow.n);
  const created = [];
  const statements = [];
  for (let i = 0; i < toCreate; i++) {
    const seqNo = existingInBatch + i + 1;
    const unitId = newInternalId();
    const humanCode = String(seqNo).padStart(6, "0");
    const internalToken = newOpaqueToken();
    const publicToken = newOpaqueToken();
    statements.push(
      db.prepare(
        `INSERT INTO units (id, batch_id, batch_receipt_id, human_code, internal_token, public_token, current_disposition)
           VALUES (?, ?, ?, ?, ?, ?, 'AVAILABLE')`
      ).bind(unitId, receipt.batch_id, receipt.id, humanCode, internalToken, publicToken)
    );
    statements.push(
      db.prepare(
        `INSERT INTO unit_events (id, unit_id, seq, event_type, payload, actor)
           VALUES (?, ?, 1, 'UNIT_REGISTERED', ?, ?)`
      ).bind(newInternalId(), unitId, JSON.stringify({ receiptId: receipt.id }), actor ?? "system")
    );
    statements.push(
      db.prepare("UPDATE units SET last_event_seq = 1 WHERE id = ?").bind(unitId)
    );
    created.push({ id: unitId, humanCode });
  }
  await db.batch(statements);
  return { created: created.length, units: created };
}
__name(registerUnits, "registerUnits");

// src/services/units.js
init_checked_fetch();
init_modules_watch_stub();
function extractScannedCode(raw) {
  const trimmed = (raw ?? "").trim();
  try {
    const url = new URL(trimmed);
    const param = url.searchParams.get("code");
    if (param) return param;
  } catch {
  }
  return trimmed;
}
__name(extractScannedCode, "extractScannedCode");
async function verifyLabelScan(db, unitId, rawCode, actor) {
  const unit = await db.prepare("SELECT * FROM units WHERE id = ?").bind(unitId).first();
  if (!unit) return { notFound: true };
  if (!rawCode) throw new ValidationError("A scanned code is required.");
  if (unit.label_confirmed_at) {
    throw new ValidationError("This label is already confirmed attached.");
  }
  const code = extractScannedCode(rawCode);
  const { results: matches } = await db.prepare(
    `SELECT u.*, v.variant_label, p.name AS product_name, pb.batch_number
       FROM units u
       JOIN production_batches pb ON pb.id = u.batch_id
       JOIN variants v ON v.id = pb.variant_id
       JOIN products p ON p.id = v.product_id
       WHERE u.human_code = ?1 OR u.internal_token = ?1 OR u.public_token = ?1`
  ).bind(code).all();
  if (!matches.length) return { verified: false, reason: "not_found" };
  if (matches.length > 1) {
    return { verified: false, reason: "ambiguous" };
  }
  const scanned = matches[0];
  if (scanned.id !== unitId) {
    return {
      verified: false,
      reason: "mismatch",
      actualUnit: {
        id: scanned.id,
        humanCode: scanned.human_code,
        product: scanned.product_name,
        variant: scanned.variant_label,
        batchNumber: scanned.batch_number
      }
    };
  }
  const eventId = newInternalId();
  const statements = buildEventBatch(db, {
    eventId,
    unitId,
    eventType: "LABEL_SCANNED_FOR_ATTACHMENT",
    actor: actor ?? "izzat"
  });
  await db.batch(statements);
  return { verified: true };
}
__name(verifyLabelScan, "verifyLabelScan");
async function confirmLabel(db, unitId, actor) {
  const unit = await db.prepare("SELECT * FROM units WHERE id = ?").bind(unitId).first();
  if (!unit) return { notFound: true };
  const scanned = await db.prepare(
    `SELECT 1 FROM unit_events
       WHERE unit_id = ? AND event_type = 'LABEL_SCANNED_FOR_ATTACHMENT'
         AND seq > COALESCE((SELECT MAX(seq) FROM unit_events WHERE unit_id = ? AND event_type = 'LABEL_REISSUED'), 0)
       LIMIT 1`
  ).bind(unitId, unitId).first();
  if (!scanned) {
    throw new ValidationError("Scan the label actually attached to this unit before confirming -- a click alone is not proof of physical attachment.");
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const eventId = newInternalId();
  const statements = buildEventBatch(db, {
    eventId,
    unitId,
    eventType: "LABEL_ATTACHED_CONFIRMED",
    actor: actor ?? "izzat"
  });
  statements.push(db.prepare("UPDATE units SET label_confirmed_at = ? WHERE id = ?").bind(now, unitId));
  await db.batch(statements);
  return { unitId, labelConfirmedAt: now };
}
__name(confirmLabel, "confirmLabel");
async function reissueLabel(db, unitId, actor) {
  const unit = await db.prepare("SELECT * FROM units WHERE id = ?").bind(unitId).first();
  if (!unit) return { notFound: true };
  if (unit.label_confirmed_at) {
    throw new ValidationError(
      "This label is already confirmed attached -- reissuing would sever a real physical identity. Use Record Damage / Confirm Missing instead."
    );
  }
  const newInternal = newOpaqueToken();
  const newPublic = newOpaqueToken();
  const eventId = newInternalId();
  const statements = buildEventBatch(db, {
    eventId,
    unitId,
    eventType: "LABEL_REISSUED",
    payload: { reason: "lost_or_spoiled_before_attachment" },
    actor: actor ?? "izzat"
  });
  statements.push(
    db.prepare("UPDATE units SET internal_token = ?, public_token = ? WHERE id = ?").bind(newInternal, newPublic, unitId)
  );
  await db.batch(statements);
  return { unitId, internalToken: newInternal, publicToken: newPublic };
}
__name(reissueLabel, "reissueLabel");
async function reissueLabelAfterAttachment(db, unitId, actor) {
  const unit = await db.prepare("SELECT * FROM units WHERE id = ?").bind(unitId).first();
  if (!unit) return { notFound: true };
  if (!unit.label_confirmed_at) {
    throw new ValidationError(
      'This unit was never confirmed attached -- use the "Lost -- Reissue" action on Print Labels instead.'
    );
  }
  await db.batch(
    buildEventBatch(db, {
      eventId: newInternalId(),
      unitId,
      eventType: "DAMAGE_OBSERVED",
      payload: { reason: "label_damaged_or_lost_after_attachment" },
      actor: actor ?? "izzat"
    })
  );
  const newInternal = newOpaqueToken();
  const newPublic = newOpaqueToken();
  const statements = buildEventBatch(db, {
    eventId: newInternalId(),
    unitId,
    eventType: "LABEL_REISSUED",
    payload: { reason: "lost_or_spoiled_after_attachment", previousInternalToken: unit.internal_token },
    actor: actor ?? "izzat"
  });
  statements.push(
    db.prepare("UPDATE units SET internal_token = ?, public_token = ?, label_confirmed_at = NULL WHERE id = ?").bind(newInternal, newPublic, unitId)
  );
  await db.batch(statements);
  return { unitId, internalToken: newInternal, publicToken: newPublic, requiresReattachment: true };
}
__name(reissueLabelAfterAttachment, "reissueLabelAfterAttachment");
async function lookupUnit(db, code) {
  const { results } = await db.prepare(
    `SELECT u.*, pb.batch_number, v.variant_label, p.name AS product_name, l.name AS location_name,
              o.order_reference, c.name AS customer_name
       FROM units u
       JOIN production_batches pb ON pb.id = u.batch_id
       JOIN variants v ON v.id = pb.variant_id
       JOIN products p ON p.id = v.product_id
       LEFT JOIN locations l ON l.id = u.current_location_id
       LEFT JOIN order_lines ol ON ol.id = pb.order_line_id
       LEFT JOIN orders o ON o.id = ol.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE u.human_code = ?1 OR u.internal_token = ?1 OR u.public_token = ?1`
  ).bind(code).all();
  if (!results.length) return null;
  if (results.length > 1) {
    return {
      ambiguous: true,
      candidates: results.map((u) => ({
        id: u.id,
        humanCode: u.human_code,
        product: u.product_name,
        variant: u.variant_label,
        batchNumber: u.batch_number,
        internalToken: u.internal_token
      }))
    };
  }
  const unit = results[0];
  const { results: events } = await db.prepare("SELECT event_type, payload, actor, occurred_at, recorded_at, seq FROM unit_events WHERE unit_id = ? ORDER BY seq").bind(unit.id).all();
  const { results: shipments } = await db.prepare(
    `SELECT s.reference, s.status FROM shipment_units su
       JOIN shipments s ON s.id = su.shipment_id WHERE su.unit_id = ?`
  ).bind(unit.id).all();
  return {
    id: unit.id,
    humanCode: unit.human_code,
    product: unit.product_name,
    variant: unit.variant_label,
    batchNumber: unit.batch_number,
    disposition: unit.current_disposition,
    condition: unit.current_condition,
    locationId: unit.current_location_id,
    locationName: unit.location_name,
    labelConfirmedAt: unit.label_confirmed_at,
    internalToken: unit.internal_token,
    orderReference: unit.order_reference,
    customerName: unit.customer_name,
    shipments,
    events
  };
}
__name(lookupUnit, "lookupUnit");
async function recordUnitEvent(db, unitId, { eventType, payload, actor, disposition, condition, locationId, occurredAt }) {
  const unit = await db.prepare("SELECT * FROM units WHERE id = ?").bind(unitId).first();
  if (!unit) return { notFound: true };
  if (!eventType) throw new ValidationError("eventType is required.");
  const eventId = newInternalId();
  const statements = buildEventBatch(db, {
    eventId,
    unitId,
    eventType,
    payload,
    actor,
    occurredAt,
    disposition,
    condition,
    locationId
  });
  const results = await db.batch(statements);
  const seq = results[0].results[0].seq;
  return { unitId, seq, eventType };
}
__name(recordUnitEvent, "recordUnitEvent");

// src/services/stocktake.js
init_checked_fetch();
init_modules_watch_stub();
async function openStocktakeSession(db, { batchId, locationId, actor }) {
  if (!batchId && !locationId) throw new ValidationError("Either batchId or locationId is required.");
  if (batchId && locationId) throw new ValidationError("Provide batchId or locationId, not both.");
  let availableUnits;
  if (locationId) {
    const location = await db.prepare("SELECT id FROM locations WHERE id = ?").bind(locationId).first();
    if (!location) return { notFound: true };
    ({ results: availableUnits } = await db.prepare("SELECT id FROM units WHERE current_location_id = ? AND current_disposition = 'AVAILABLE'").bind(locationId).all());
  } else {
    const batch = await db.prepare("SELECT * FROM production_batches WHERE id = ?").bind(batchId).first();
    if (!batch) return { notFound: true };
    ({ results: availableUnits } = await db.prepare("SELECT id FROM units WHERE batch_id = ? AND current_disposition = 'AVAILABLE'").bind(batchId).all());
  }
  const id = newInternalId();
  const statements = [
    db.prepare("INSERT INTO stocktake_sessions (id, batch_id, location_id, started_by) VALUES (?, ?, ?, ?)").bind(id, batchId ?? null, locationId ?? null, actor ?? null),
    ...availableUnits.map(
      (u) => db.prepare("INSERT INTO stocktake_expected_units (session_id, unit_id) VALUES (?, ?)").bind(id, u.id)
    )
  ];
  await db.batch(statements);
  return { id, batchId: batchId ?? null, locationId: locationId ?? null, status: "OPEN", expectedCount: availableUnits.length };
}
__name(openStocktakeSession, "openStocktakeSession");
async function listStocktakeSessions(db) {
  const { results } = await db.prepare(
    `SELECT ss.id, ss.status, ss.started_at, ss.closed_at, l.name AS location_name,
              pb.batch_number, p.name AS product_name, v.variant_label,
              (SELECT COUNT(*) FROM stocktake_expected_units seu WHERE seu.session_id = ss.id) AS expected_count,
              (SELECT COUNT(*) FROM stocktake_scans sc WHERE sc.session_id = ss.id) AS scanned_count
       FROM stocktake_sessions ss
       LEFT JOIN locations l ON l.id = ss.location_id
       LEFT JOIN production_batches pb ON pb.id = ss.batch_id
       LEFT JOIN variants v ON v.id = pb.variant_id
       LEFT JOIN products p ON p.id = v.product_id
       ORDER BY ss.started_at DESC
       LIMIT 20`
  ).all();
  return results;
}
__name(listStocktakeSessions, "listStocktakeSessions");
async function getStocktakeSession(db, sessionId) {
  const session = await db.prepare("SELECT * FROM stocktake_sessions WHERE id = ?").bind(sessionId).first();
  if (!session) return null;
  const { results: expected } = await db.prepare(
    `SELECT u.id, u.human_code, u.current_disposition FROM stocktake_expected_units seu
       JOIN units u ON u.id = seu.unit_id
       WHERE seu.session_id = ?`
  ).bind(sessionId).all();
  const { results: scanned } = await db.prepare(
    `SELECT u.id, u.human_code, u.batch_id FROM stocktake_scans ss
       JOIN units u ON u.id = ss.unit_id
       WHERE ss.session_id = ?`
  ).bind(sessionId).all();
  const expectedIds = new Set(expected.map((u) => u.id));
  const scannedIds = new Set(scanned.map((u) => u.id));
  const ok2 = expected.filter((u) => scannedIds.has(u.id));
  const notObserved = expected.filter((u) => !scannedIds.has(u.id));
  const unexpected = scanned.filter((u) => !expectedIds.has(u.id));
  return {
    id: session.id,
    batchId: session.batch_id,
    locationId: session.location_id,
    status: session.status,
    startedAt: session.started_at,
    closedAt: session.closed_at,
    expectedCount: expected.length,
    ok: ok2.map((u) => u.human_code),
    notObserved: notObserved.map((u) => ({ id: u.id, humanCode: u.human_code, missingConfirmed: u.current_disposition === "MISSING" })),
    unexpected: unexpected.map((u) => u.human_code)
  };
}
__name(getStocktakeSession, "getStocktakeSession");
async function scanStocktakeUnit(db, sessionId, { code, actor }) {
  const session = await db.prepare("SELECT * FROM stocktake_sessions WHERE id = ?").bind(sessionId).first();
  if (!session) return { notFound: true };
  if (session.status !== "OPEN") throw new ValidationError("Stocktake session is not open.");
  if (!code) throw new ValidationError("code is required.");
  const { results: matches } = await db.prepare("SELECT * FROM units WHERE human_code = ?1 OR internal_token = ?1 OR public_token = ?1").bind(code).all();
  if (!matches.length) return { notFound: true, reason: "unit" };
  let unit = matches[0];
  if (matches.length > 1) {
    const { results: expectedHere } = await db.prepare("SELECT unit_id FROM stocktake_expected_units WHERE session_id = ? AND unit_id IN (" + matches.map(() => "?").join(",") + ")").bind(sessionId, ...matches.map((m) => m.id)).all();
    const expectedMatches = matches.filter((m) => expectedHere.some((e) => e.unit_id === m.id));
    if (expectedMatches.length === 1) {
      unit = expectedMatches[0];
    } else {
      throw new ValidationError(
        `Code "${code}" matches more than one unit and isn't uniquely identifiable here -- scan the QR instead of typing the code.`
      );
    }
  }
  const expectedRow = await db.prepare("SELECT 1 AS present FROM stocktake_expected_units WHERE session_id = ? AND unit_id = ?").bind(sessionId, unit.id).first();
  const alreadyExpected = Boolean(expectedRow);
  const scanId = newInternalId();
  const eventId = newInternalId();
  const insertScan = await db.prepare("INSERT OR IGNORE INTO stocktake_scans (id, session_id, unit_id, actor) VALUES (?, ?, ?, ?) RETURNING id").bind(scanId, sessionId, unit.id, actor ?? null).run();
  const inserted = insertScan.results.length > 0;
  if (inserted) {
    const eventStatements = buildEventBatch(db, {
      eventId,
      unitId: unit.id,
      eventType: "STOCKTAKE_OBSERVED",
      payload: { sessionId },
      actor
    });
    await db.batch(eventStatements);
  }
  return {
    unitId: unit.id,
    humanCode: unit.human_code,
    alreadyScanned: !inserted,
    unexpected: !alreadyExpected
  };
}
__name(scanStocktakeUnit, "scanStocktakeUnit");
async function closeStocktakeSession(db, sessionId, actor) {
  const session = await db.prepare("SELECT * FROM stocktake_sessions WHERE id = ?").bind(sessionId).first();
  if (!session) return { notFound: true };
  if (session.status !== "OPEN") throw new ValidationError("Stocktake session is not open.");
  await db.prepare("UPDATE stocktake_sessions SET status = 'CLOSED', closed_at = datetime('now'), closed_by = ? WHERE id = ?").bind(actor ?? null, sessionId).run();
  return { id: sessionId, status: "CLOSED" };
}
__name(closeStocktakeSession, "closeStocktakeSession");

// src/services/importManifest.js
init_checked_fetch();
init_modules_watch_stub();

// src/services/orders.js
init_checked_fetch();
init_modules_watch_stub();
async function createCustomer(db, { name, contactInfo }) {
  if (!name) throw new ValidationError("Customer name is required.");
  const id = newInternalId();
  await db.prepare("INSERT INTO customers (id, name, contact_info) VALUES (?, ?, ?)").bind(id, name, contactInfo ?? null).run();
  return { id, name, contactInfo: contactInfo ?? null };
}
__name(createCustomer, "createCustomer");
async function listCustomers(db) {
  const { results } = await db.prepare("SELECT * FROM customers ORDER BY name").all();
  return results;
}
__name(listCustomers, "listCustomers");
async function createOrder(db, { customerId, orderReference, orderDate, dueDate, notes }) {
  if (!customerId || !orderReference) {
    throw new ValidationError("customerId and orderReference are required.");
  }
  const id = newInternalId();
  await db.prepare(
    `INSERT INTO orders (id, customer_id, order_reference, order_date, due_date, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, customerId, orderReference, orderDate ?? null, dueDate ?? null, notes ?? null).run();
  return { id, customerId, orderReference, orderDate: orderDate ?? null, dueDate: dueDate ?? null };
}
__name(createOrder, "createOrder");
async function listOrders(db) {
  const { results: orders } = await db.prepare(
    `SELECT o.id, o.customer_id, o.order_reference, o.order_date, o.due_date, o.notes, c.name AS customer_name
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       ORDER BY o.created_at DESC`
  ).all();
  const { results: lines } = await db.prepare(
    `SELECT ol.id, ol.order_id, ol.quantity_ordered, ol.description, ol.variant_id, ol.notes,
              v.variant_label, p.name AS product_name
       FROM order_lines ol
       LEFT JOIN variants v ON v.id = ol.variant_id
       LEFT JOIN products p ON p.id = v.product_id
       ORDER BY ol.created_at`
  ).all();
  const linesByOrder = /* @__PURE__ */ new Map();
  for (const l of lines) {
    if (!linesByOrder.has(l.order_id)) linesByOrder.set(l.order_id, []);
    linesByOrder.get(l.order_id).push(l);
  }
  return orders.map((o) => ({ ...o, lines: linesByOrder.get(o.id) ?? [] }));
}
__name(listOrders, "listOrders");
async function createOrderLine(db, { orderId, variantId, description, quantityOrdered, unitNames, notes }) {
  if (!orderId) throw new ValidationError("orderId is required.");
  if (!Number.isInteger(quantityOrdered) || quantityOrdered < 1) {
    throw new ValidationError("quantityOrdered must be a whole number >= 1.");
  }
  if (!variantId && !description) {
    throw new ValidationError("An order line needs either a variantId or a plain description.");
  }
  const id = newInternalId();
  await db.prepare(
    `INSERT INTO order_lines (id, order_id, variant_id, description, quantity_ordered, unit_names, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    orderId,
    variantId ?? null,
    description ?? null,
    quantityOrdered,
    unitNames && unitNames.length ? JSON.stringify(unitNames) : null,
    notes ?? null
  ).run();
  return { id, orderId, variantId: variantId ?? null, quantityOrdered };
}
__name(createOrderLine, "createOrderLine");
async function updateOrderLineNotes(db, id, notes) {
  const line = await db.prepare("SELECT id FROM order_lines WHERE id = ?").bind(id).first();
  if (!line) return { notFound: true };
  await db.prepare("UPDATE order_lines SET notes = ? WHERE id = ?").bind(notes ?? null, id).run();
  return { id, notes: notes ?? null };
}
__name(updateOrderLineNotes, "updateOrderLineNotes");
async function getOrderReconciliation(db, orderId) {
  const order = await db.prepare(
    `SELECT o.id, o.order_reference, c.name AS customer_name
       FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`
  ).bind(orderId).first();
  if (!order) return null;
  const { results: lines } = await db.prepare(
    `SELECT
         ol.id AS order_line_id, ol.quantity_ordered, ol.description,
         v.variant_label, p.name AS product_name,
         (SELECT COUNT(*) FROM units u JOIN production_batches pb ON pb.id = u.batch_id
            WHERE pb.order_line_id = ol.id) AS units_generated,
         (SELECT COUNT(*) FROM units u JOIN production_batches pb ON pb.id = u.batch_id
            WHERE pb.order_line_id = ol.id AND u.label_confirmed_at IS NOT NULL) AS units_attached,
         (SELECT COALESCE(SUM(s.planned_quantity), 0)
            FROM shipments s WHERE s.order_line_id = ol.id AND s.status NOT IN ('DISPATCHED','CANCELLED')
         ) AS shipment_planned,
         (SELECT COUNT(*) FROM shipment_units su
            JOIN shipments s ON s.id = su.shipment_id
            JOIN units u ON u.id = su.unit_id
            JOIN production_batches pb ON pb.id = u.batch_id
            WHERE pb.order_line_id = ol.id) AS units_packed,
         (SELECT COUNT(*) FROM units u JOIN production_batches pb ON pb.id = u.batch_id
            WHERE pb.order_line_id = ol.id
              AND EXISTS (
                SELECT 1 FROM shipment_units su JOIN shipments s ON s.id = su.shipment_id
                WHERE su.unit_id = u.id AND s.status = 'DISPATCHED'
              )) AS units_dispatched
       FROM order_lines ol
       LEFT JOIN variants v ON v.id = ol.variant_id
       LEFT JOIN products p ON p.id = v.product_id
       WHERE ol.order_id = ?
       ORDER BY ol.created_at`
  ).bind(orderId).all();
  const totals = lines.reduce(
    (acc, l) => ({
      ordered: acc.ordered + l.quantity_ordered,
      generated: acc.generated + l.units_generated,
      attached: acc.attached + l.units_attached,
      shipment_planned: acc.shipment_planned + l.shipment_planned,
      packed: acc.packed + l.units_packed,
      dispatched: acc.dispatched + l.units_dispatched
    }),
    { ordered: 0, generated: 0, attached: 0, shipment_planned: 0, packed: 0, dispatched: 0 }
  );
  return { order, lines, totals };
}
__name(getOrderReconciliation, "getOrderReconciliation");
async function getOrderLine(db, id) {
  const line = await db.prepare(
    `SELECT ol.*, o.order_reference, o.customer_id, o.notes AS order_notes, c.name AS customer_name
       FROM order_lines ol
       JOIN orders o ON o.id = ol.order_id
       JOIN customers c ON c.id = o.customer_id
       WHERE ol.id = ?`
  ).bind(id).first();
  if (!line) return null;
  const { results: batches } = await db.prepare(
    `SELECT id, batch_number, planned_quantity
       FROM production_batches WHERE order_line_id = ? ORDER BY created_at`
  ).bind(id).all();
  return { ...line, batches };
}
__name(getOrderLine, "getOrderLine");
async function preflightVariant(db, { productName, variantLabel, dimensions, attributes }) {
  const statements = [];
  const trimmedProductName = String(productName).trim();
  const existingProduct = await db.prepare("SELECT id, name FROM products WHERE LOWER(TRIM(name)) = LOWER(?)").bind(trimmedProductName).first();
  let productId;
  if (existingProduct) {
    productId = existingProduct.id;
  } else {
    productId = newInternalId();
    statements.push(
      db.prepare("INSERT INTO products (id, name) VALUES (?, ?)").bind(productId, trimmedProductName)
    );
  }
  if (Array.isArray(dimensions) && dimensions.length > 0) {
    const existingDims = existingProduct ? await db.prepare("SELECT name FROM product_dimensions WHERE product_id = ?").bind(productId).all().then((r) => new Set(r.results.map((d) => d.name.toLowerCase()))) : /* @__PURE__ */ new Set();
    const maxOrderRow = existingProduct ? await db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM product_dimensions WHERE product_id = ?").bind(productId).first() : { maxOrder: -1 };
    let nextOrder = maxOrderRow.maxOrder + 1;
    for (const rawName of dimensions) {
      const name = String(rawName).trim();
      if (!name || existingDims.has(name.toLowerCase())) continue;
      statements.push(
        db.prepare("INSERT OR IGNORE INTO product_dimensions (id, product_id, name, sort_order) VALUES (?, ?, ?, ?)").bind(newInternalId(), productId, name, nextOrder++)
      );
    }
  }
  const existingVariant = await db.prepare("SELECT id FROM variants WHERE product_id = ? AND variant_label = ?").bind(productId, variantLabel).first();
  let variantId;
  if (existingVariant) {
    variantId = existingVariant.id;
  } else {
    variantId = newInternalId();
    statements.push(
      db.prepare("INSERT INTO variants (id, product_id, variant_label) VALUES (?, ?, ?)").bind(variantId, productId, variantLabel)
    );
    if (attributes && typeof attributes === "object") {
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== void 0 && value !== null && String(value).trim() !== "") {
          statements.push(
            db.prepare("INSERT INTO variant_attributes (variant_id, key, value) VALUES (?, ?, ?)").bind(variantId, key, String(value))
          );
        }
      }
    }
  }
  return { variantId, statements };
}
__name(preflightVariant, "preflightVariant");
async function nextBatchNumbers(db, variantId, count, inFlightCount = 0) {
  if (count <= 0) return [];
  const { results: existing } = await db.prepare("SELECT batch_number FROM production_batches WHERE variant_id = ?").bind(variantId).all();
  const usedNumbers = new Set(existing.map((r) => String(r.batch_number)));
  const numbers = [];
  let candidate = 1;
  const totalNeeded = count + inFlightCount;
  const allReserved = new Set(usedNumbers);
  const allFree = [];
  while (allFree.length < totalNeeded) {
    if (!allReserved.has(String(candidate))) {
      allFree.push(String(candidate));
      allReserved.add(String(candidate));
    }
    candidate++;
  }
  return allFree.slice(inFlightCount, inFlightCount + count);
}
__name(nextBatchNumbers, "nextBatchNumbers");
async function createOrderWithLabels(db, { customerId, customerName, orderReference, orderDate, dueDate, notes, items, actor }) {
  if (!orderReference || !String(orderReference).trim()) {
    throw new ValidationError("orderReference is required.");
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError("At least one item is required in the order.");
  }
  for (const [iIdx, item] of items.entries()) {
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new ValidationError(
        `items[${iIdx}]: quantity must be a whole number >= 1, got: ${JSON.stringify(item.quantity)}.`
      );
    }
    if (!item.productName || !String(item.productName).trim()) {
      throw new ValidationError(`items[${iIdx}]: productName is required.`);
    }
    if (!item.variantLabel && !item.variantId && !item.description) {
      throw new ValidationError(`items[${iIdx}]: variantLabel or variantId or description is required.`);
    }
    if (Array.isArray(item.batches) && item.batches.length > 0) {
      let batchSum = 0;
      for (const [bIdx, b] of item.batches.entries()) {
        const bqty = Number(b.quantity ?? b.plannedQuantity);
        if (!Number.isInteger(bqty) || bqty < 1) {
          throw new ValidationError(
            `items[${iIdx}].batches[${bIdx}]: quantity must be a whole number >= 1, got: ${JSON.stringify(b.quantity ?? b.plannedQuantity)}.`
          );
        }
        if (b.batchNumber !== void 0 && b.batchNumber !== null) {
          const bn = String(b.batchNumber).trim();
          if (!bn) throw new ValidationError(`items[${iIdx}].batches[${bIdx}]: batchNumber must be a non-empty string if provided.`);
        }
        batchSum += bqty;
      }
      if (batchSum > quantity) {
        throw new ValidationError(
          `items[${iIdx}]: sum of batch quantities (${batchSum}) exceeds ordered quantity (${quantity}).`
        );
      }
    }
  }
  let customer;
  let customerStatement = null;
  if (customerId) {
    customer = await db.prepare("SELECT id, name FROM customers WHERE id = ?").bind(customerId).first();
    if (!customer) throw new ValidationError("Selected customer not found.");
  } else if (customerName && String(customerName).trim()) {
    const custId = newInternalId();
    customer = { id: custId, name: String(customerName).trim() };
    customerStatement = db.prepare("INSERT INTO customers (id, name) VALUES (?, ?)").bind(customer.id, customer.name);
  } else {
    throw new ValidationError("Customer selection or name is required.");
  }
  const orderId = newInternalId();
  const allStatements = [];
  if (customerStatement) allStatements.push(customerStatement);
  allStatements.push(
    db.prepare(
      `INSERT INTO orders (id, customer_id, order_reference, order_date, due_date, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(orderId, customer.id, String(orderReference).trim(), orderDate ?? null, dueDate ?? null, notes ?? null)
  );
  const createdLines = [];
  const inFlightBatchCounts = /* @__PURE__ */ new Map();
  for (const item of items) {
    const quantity = Number(item.quantity);
    let variantId = item.variantId;
    let variantPreflight = null;
    if (!variantId && item.productName && item.variantLabel) {
      variantPreflight = await preflightVariant(db, {
        productName: item.productName,
        variantLabel: item.variantLabel,
        dimensions: item.dimensions,
        attributes: item.attributes
      });
      variantId = variantPreflight.variantId;
      allStatements.push(...variantPreflight.statements);
    }
    const lineId = newInternalId();
    const productName = item.productName || "";
    const variantLabel = item.variantLabel || "";
    const description = item.description || (productName ? `${productName} (${variantLabel})` : "Custom Item");
    const unitNamesJson = item.unitNames && item.unitNames.length ? JSON.stringify(item.unitNames) : null;
    allStatements.push(
      db.prepare(
        `INSERT INTO order_lines (id, order_id, variant_id, description, quantity_ordered, unit_names, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(lineId, orderId, variantId ?? null, description, quantity, unitNamesJson, item.notes ?? null)
    );
    const batchesToCreate = Array.isArray(item.batches) && item.batches.length > 0 ? item.batches : [{ quantity }];
    const lineBatches = [];
    let processedUnitsCount = 0;
    const needsAutoNumber = batchesToCreate.filter(
      (b) => !b.batchNumber || !String(b.batchNumber).trim()
    );
    const alreadyInFlight = inFlightBatchCounts.get(variantId) || 0;
    const autoNumbers = variantId ? await nextBatchNumbers(db, variantId, needsAutoNumber.length, alreadyInFlight) : needsAutoNumber.map((_, i) => String(alreadyInFlight + i + 1));
    let autoNumberIdx = 0;
    for (let bIdx = 0; bIdx < batchesToCreate.length; bIdx++) {
      const bSpec = batchesToCreate[bIdx];
      const bQty = Number(bSpec.quantity ?? bSpec.plannedQuantity ?? quantity);
      const hasExplicit = bSpec.batchNumber && String(bSpec.batchNumber).trim();
      const bNum = hasExplicit ? String(bSpec.batchNumber).trim() : autoNumbers[autoNumberIdx++];
      const batchId = newInternalId();
      allStatements.push(
        db.prepare(
          `INSERT INTO production_batches (id, variant_id, batch_number, planned_quantity, order_line_id)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(batchId, variantId, bNum, bQty, lineId)
      );
      const batchUnitNames = Array.isArray(item.unitNames) ? item.unitNames.slice(processedUnitsCount, processedUnitsCount + bQty) : [];
      processedUnitsCount += bQty;
      const { createdUnits, statements: uStmts } = buildUnitStatementsForBatch(db, batchId, bQty, 0, batchUnitNames, actor);
      allStatements.push(...uStmts);
      lineBatches.push({ batchId, batchNumber: bNum, plannedQuantity: bQty, createdUnits: createdUnits.length });
    }
    inFlightBatchCounts.set(variantId, (inFlightBatchCounts.get(variantId) || 0) + batchesToCreate.length);
    createdLines.push({ lineId, description, quantity, batches: lineBatches });
  }
  await db.batch(allStatements);
  return { orderId, orderReference: String(orderReference).trim(), customerName: customer.name, lines: createdLines };
}
__name(createOrderWithLabels, "createOrderWithLabels");
async function addBatchToOrderLine(db, lineId, { quantity, batchNumber, actor }) {
  const line = await getOrderLine(db, lineId);
  if (!line) return { notFound: true };
  if (!line.variant_id) throw new ValidationError("Cannot create a production batch for an order line without an assigned variant.");
  const bQty = Number(quantity);
  if (!Number.isInteger(bQty) || bQty < 1) throw new ValidationError("Batch quantity must be a whole number >= 1.");
  const bNum = batchNumber && String(batchNumber).trim() ? String(batchNumber).trim() : await nextBatchNumberSafe(db, line.variant_id, lineId);
  let names = [];
  if (line.unit_names) {
    try {
      const parsed = JSON.parse(line.unit_names);
      if (Array.isArray(parsed)) {
        const existingSum = line.batches.reduce((s, b) => s + b.planned_quantity, 0);
        names = parsed.slice(existingSum, existingSum + bQty);
      }
    } catch {
    }
  }
  const batchId = newInternalId();
  const guardedInsert = db.prepare(
    `INSERT INTO production_batches (id, variant_id, batch_number, planned_quantity, order_line_id)
     SELECT ?, ?, ?, ?, ?
     WHERE (
       SELECT COALESCE(SUM(planned_quantity), 0)
       FROM production_batches
       WHERE order_line_id = ?
     ) + ? <= (
       SELECT quantity_ordered FROM order_lines WHERE id = ?
     )`
  ).bind(batchId, line.variant_id, bNum, bQty, lineId, lineId, bQty, lineId);
  const { createdUnits, statements: unitStmts } = buildUnitStatementsForBatch(db, batchId, bQty, 0, names, actor);
  const guardResult = await db.batch([guardedInsert]);
  const changes = guardResult[0]?.meta?.changes ?? guardResult[0]?.changes ?? 1;
  if (changes === 0) {
    const sumRow = await db.prepare("SELECT COALESCE(SUM(planned_quantity), 0) AS totalPlanned FROM production_batches WHERE order_line_id = ?").bind(lineId).first();
    const existing = Number(sumRow.totalPlanned);
    const unallocated = line.quantity_ordered - existing;
    throw new ValidationError(
      `Batch quantity (${bQty}) exceeds unallocated order line balance (${unallocated}).`
    );
  }
  if (unitStmts.length > 0) {
    await db.batch(unitStmts);
  }
  return { batchId, batchNumber: bNum, plannedQuantity: bQty, createdUnits: createdUnits.length };
}
__name(addBatchToOrderLine, "addBatchToOrderLine");
async function nextBatchNumberSafe(db, variantId) {
  const { results: existing } = await db.prepare("SELECT batch_number FROM production_batches WHERE variant_id = ?").bind(variantId).all();
  const used = new Set(existing.map((r) => String(r.batch_number)));
  let n = 1;
  while (used.has(String(n))) n++;
  return String(n);
}
__name(nextBatchNumberSafe, "nextBatchNumberSafe");

// src/services/importManifest.js
var SUPPORTED_SCHEMA_VERSION = "1";
function deriveLabel(dimensions, attributes) {
  const order = dimensions.length ? dimensions : Object.keys(attributes);
  const parts = order.filter((d) => attributes[d] !== void 0).map((d) => attributes[d]);
  return parts.join(" / ");
}
__name(deriveLabel, "deriveLabel");
function normalizeManifest(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("Import manifest must be a JSON object.");
  }
  if (raw.schemaVersion !== void 0 && String(raw.schemaVersion) !== SUPPORTED_SCHEMA_VERSION) {
    throw new ValidationError(
      `Unsupported schemaVersion "${raw.schemaVersion}" -- this Labelism only understands Import Manifest v${SUPPORTED_SCHEMA_VERSION}.`
    );
  }
  const customerName = raw.customerName !== void 0 && raw.customerName !== null ? String(raw.customerName).trim() : "";
  if (!customerName) {
    throw new ValidationError('Import manifest requires "customerName" (non-empty string).');
  }
  const orderReference = raw.orderReference !== void 0 && raw.orderReference !== null ? String(raw.orderReference).trim() : "";
  if (!orderReference) {
    throw new ValidationError('Import manifest requires "orderReference" (non-empty string).');
  }
  if (!Array.isArray(raw.products) || raw.products.length === 0) {
    throw new ValidationError('Import manifest must have a non-empty "products" array.');
  }
  const products = raw.products.map((p, pIdx) => {
    const where = `products[${pIdx}]`;
    if (!p || typeof p !== "object" || !p.name || !String(p.name).trim()) {
      throw new ValidationError(`${where}.name is required.`);
    }
    const dimensions = Array.isArray(p.dimensions) ? [...new Set(p.dimensions.map((d) => String(d).trim()).filter(Boolean))] : [];
    if (!Array.isArray(p.variants) || p.variants.length === 0) {
      throw new ValidationError(`${where} ("${p.name}") must have a non-empty "variants" array.`);
    }
    const variants = p.variants.map((v, vIdx) => {
      const vwhere = `${where}.variants[${vIdx}]`;
      if (!v || typeof v !== "object") throw new ValidationError(`${vwhere} must be an object.`);
      const quantity = Number(v.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new ValidationError(`${vwhere}.quantity must be a whole number >= 1.`);
      }
      const attributes = {};
      if (v.attributes !== void 0) {
        if (typeof v.attributes !== "object" || Array.isArray(v.attributes) || v.attributes === null) {
          throw new ValidationError(`${vwhere}.attributes must be an object of dimension name -> value.`);
        }
        for (const [k, val] of Object.entries(v.attributes)) {
          if (val === void 0 || val === null || String(val).trim() === "") continue;
          attributes[String(k).trim()] = String(val).trim();
        }
      }
      const hasAttrs = Object.keys(attributes).length > 0;
      let label = v.label !== void 0 && v.label !== null ? String(v.label).trim() : "";
      if (hasAttrs) label = deriveLabel(dimensions, attributes);
      if (!label) {
        throw new ValidationError(`${vwhere} needs "attributes" (with at least one non-empty value) or a "label".`);
      }
      let unitNames = [];
      if (v.unitNames !== void 0) {
        if (!Array.isArray(v.unitNames)) throw new ValidationError(`${vwhere}.unitNames must be an array of strings.`);
        unitNames = v.unitNames.map((n) => String(n).trim()).filter(Boolean);
        if (unitNames.length > quantity) {
          throw new ValidationError(
            `${vwhere}.unitNames has ${unitNames.length} name(s) but quantity is only ${quantity}.`
          );
        }
      }
      let batches = null;
      if (v.batches !== void 0) {
        if (!Array.isArray(v.batches) || v.batches.length === 0) {
          throw new ValidationError(`${vwhere}.batches must be a non-empty array if provided.`);
        }
        let batchSum = 0;
        batches = v.batches.map((b, bIdx) => {
          const bqty = Number(b.quantity);
          if (!Number.isInteger(bqty) || bqty < 1) {
            throw new ValidationError(`${vwhere}.batches[${bIdx}].quantity must be a whole number >= 1.`);
          }
          batchSum += bqty;
          return { quantity: bqty };
        });
        if (batchSum > quantity) {
          throw new ValidationError(
            `${vwhere}.batches sum (${batchSum}) exceeds variant quantity (${quantity}).`
          );
        }
      }
      return { attributes, label, quantity, unitNames, batches };
    });
    return { name: String(p.name).trim(), dimensions, variants };
  });
  const context = raw.context !== void 0 && raw.context !== null ? String(raw.context).trim() : "";
  return { customerName, orderReference, context, products };
}
__name(normalizeManifest, "normalizeManifest");
async function previewManifest(db, manifest) {
  const productPreviews = [];
  const totals = {
    newProducts: 0,
    existingProducts: 0,
    newVariants: 0,
    existingVariants: 0,
    productionBatches: 0,
    plannedUnits: 0,
    namedUnits: 0
  };
  for (const p of manifest.products) {
    const existingProduct = await db.prepare("SELECT id FROM products WHERE LOWER(TRIM(name)) = LOWER(?)").bind(p.name).first();
    existingProduct ? totals.existingProducts++ : totals.newProducts++;
    const variantPreviews = [];
    for (const v of p.variants) {
      let existingVariant = null;
      if (existingProduct) {
        existingVariant = await db.prepare("SELECT id FROM variants WHERE product_id = ? AND variant_label = ?").bind(existingProduct.id, v.label).first();
      }
      existingVariant ? totals.existingVariants++ : totals.newVariants++;
      const numBatches = v.batches ? v.batches.length : 1;
      totals.productionBatches += numBatches;
      totals.plannedUnits += v.quantity;
      totals.namedUnits += v.unitNames.length;
      variantPreviews.push({
        label: v.label,
        attributes: v.attributes,
        quantity: v.quantity,
        batches: v.batches ?? null,
        namedCount: v.unitNames.length,
        isNewVariant: !existingVariant
      });
    }
    productPreviews.push({
      name: p.name,
      isNewProduct: !existingProduct,
      newDimensions: p.dimensions,
      variants: variantPreviews
    });
  }
  return {
    customerName: manifest.customerName,
    orderReference: manifest.orderReference,
    context: manifest.context,
    products: productPreviews,
    totals
  };
}
__name(previewManifest, "previewManifest");
async function applyManifest(db, manifest, actor) {
  const items = [];
  for (const p of manifest.products) {
    for (const v of p.variants) {
      items.push({
        productName: p.name,
        variantLabel: v.label,
        dimensions: p.dimensions,
        attributes: v.attributes,
        quantity: v.quantity,
        unitNames: v.unitNames || [],
        // Pass phased batches if present; otherwise createOrderWithLabels
        // will generate the full quantity in a single batch.
        batches: v.batches || null
      });
    }
  }
  const result = await createOrderWithLabels(db, {
    customerName: manifest.customerName,
    orderReference: manifest.orderReference,
    items,
    actor: actor ?? "system"
  });
  return { ...result, actor: actor ?? "system" };
}
__name(applyManifest, "applyManifest");

// src/services/shipments.js
init_checked_fetch();
init_modules_watch_stub();
async function createShipment(db, { orderLineId, reference, plannedQuantity }) {
  if (!orderLineId || !reference) throw new ValidationError("orderLineId and reference are required.");
  if (!Number.isInteger(plannedQuantity) || plannedQuantity < 1) {
    throw new ValidationError("plannedQuantity must be a whole number >= 1.");
  }
  const line = await db.prepare("SELECT id FROM order_lines WHERE id = ?").bind(orderLineId).first();
  if (!line) return { notFound: true };
  const id = newInternalId();
  await db.prepare("INSERT INTO shipments (id, order_line_id, reference, planned_quantity) VALUES (?, ?, ?, ?)").bind(id, orderLineId, reference, plannedQuantity).run();
  return { id, orderLineId, reference, plannedQuantity, status: "OPEN" };
}
__name(createShipment, "createShipment");
async function canUnitFulfillShipment(db, unit, shipment) {
  const batch = await db.prepare(
    `SELECT pb.order_line_id, ol.order_id, o.order_reference, o.customer_id, c.name AS customer_name
       FROM production_batches pb
       LEFT JOIN order_lines ol ON ol.id = pb.order_line_id
       LEFT JOIN orders o ON o.id = ol.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE pb.id = ?`
  ).bind(unit.batch_id).first();
  if (!batch || batch.order_line_id !== shipment.order_line_id) {
    return {
      ok: false,
      reason: batch && batch.order_reference ? `This unit belongs to order "${batch.order_reference}" (${batch.customer_name}), not this shipment's order line.` : "This unit is not linked to any order line, so it cannot fulfill this shipment."
    };
  }
  if (!unit.label_confirmed_at) {
    return {
      ok: false,
      reason: `Unit ${unit.human_code}'s label has not been confirmed attached yet -- attach and confirm it on Print Labels before packing.`
    };
  }
  return { ok: true };
}
__name(canUnitFulfillShipment, "canUnitFulfillShipment");
async function scanUnitIntoShipment(db, shipmentId, { code, actor }) {
  const shipment = await db.prepare("SELECT * FROM shipments WHERE id = ?").bind(shipmentId).first();
  if (!shipment) return { notFound: true };
  if (shipment.status !== "OPEN") throw new ValidationError("This shipment is not open.");
  if (!code) throw new ValidationError("code is required.");
  const { results: matches } = await db.prepare(
    `SELECT u.*, v.variant_label, p.name AS product_name
       FROM units u
       JOIN production_batches pb ON pb.id = u.batch_id
       JOIN variants v ON v.id = pb.variant_id
       JOIN products p ON p.id = v.product_id
       WHERE u.human_code = ?1 OR u.internal_token = ?1 OR u.public_token = ?1`
  ).bind(code).all();
  if (!matches.length) return { notFound: true, reason: "unit" };
  let unit = matches[0];
  if (matches.length > 1) {
    const checks = await Promise.all(matches.map((m) => canUnitFulfillShipment(db, m, shipment)));
    const fulfilling = matches.filter((_, i) => checks[i].ok);
    if (fulfilling.length === 1) {
      unit = fulfilling[0];
    } else {
      throw new ValidationError(
        `Code "${code}" matches more than one unit and isn't uniquely identifiable here -- scan the QR instead of typing the code.`
      );
    }
  }
  const fulfillCheck = await canUnitFulfillShipment(db, unit, shipment);
  if (!fulfillCheck.ok) {
    throw new ValidationError(fulfillCheck.reason);
  }
  const { results: memberships } = await db.prepare(
    `SELECT su.shipment_id, s.reference FROM shipment_units su
       JOIN shipments s ON s.id = su.shipment_id
       WHERE su.unit_id = ? AND s.status != 'DISPATCHED'`
  ).bind(unit.id).all();
  const sameShipment = memberships.find((m) => m.shipment_id === shipmentId);
  const otherShipment = memberships.find((m) => m.shipment_id !== shipmentId);
  if (otherShipment) {
    throw new ValidationError(`This unit is already packed in Shipment "${otherShipment.reference}" -- a unit can only belong to one shipment.`);
  }
  const productLabel = `${unit.product_name} \xB7 ${unit.variant_label}`;
  if (sameShipment) {
    return { unitId: unit.id, humanCode: unit.human_code, product: productLabel, alreadyScanned: true };
  }
  const countRow = await db.prepare("SELECT COUNT(*) AS n FROM shipment_units WHERE shipment_id = ?").bind(shipmentId).first();
  const currentScanned = Number(countRow.n);
  if (currentScanned >= shipment.planned_quantity) {
    throw new ValidationError(`Cannot pack unit: shipment planned capacity of ${shipment.planned_quantity} has already been reached.`);
  }
  await db.prepare("INSERT INTO shipment_units (shipment_id, unit_id, actor) VALUES (?, ?, ?)").bind(shipmentId, unit.id, actor ?? null).run();
  return { unitId: unit.id, humanCode: unit.human_code, product: productLabel, alreadyScanned: false };
}
__name(scanUnitIntoShipment, "scanUnitIntoShipment");
async function getShipment(db, id) {
  const shipment = await db.prepare(
    `SELECT s.*, ol.description, ol.quantity_ordered, o.order_reference, c.name AS customer_name,
              l.name AS destination_name
       FROM shipments s
       JOIN order_lines ol ON ol.id = s.order_line_id
       JOIN orders o ON o.id = ol.order_id
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN locations l ON l.id = s.destination_location_id
       WHERE s.id = ?`
  ).bind(id).first();
  if (!shipment) return null;
  const { results: scanned } = await db.prepare(
    `SELECT u.id, u.human_code FROM shipment_units su
       JOIN units u ON u.id = su.unit_id WHERE su.shipment_id = ?`
  ).bind(id).all();
  return { ...shipment, scannedCount: scanned.length, scanned };
}
__name(getShipment, "getShipment");
async function closeShipment(db, id, actor) {
  const shipment = await db.prepare("SELECT * FROM shipments WHERE id = ?").bind(id).first();
  if (!shipment) return { notFound: true };
  if (shipment.status !== "OPEN") throw new ValidationError("This shipment is not open.");
  const countRow = await db.prepare("SELECT COUNT(*) AS n FROM shipment_units WHERE shipment_id = ?").bind(id).first();
  const packedCount = Number(countRow.n);
  const missing = Math.max(0, shipment.planned_quantity - packedCount);
  let missingUnits = [];
  let missingUnitsUncertain = false;
  if (missing > 0) {
    const { results } = await db.prepare(
      `SELECT u.human_code FROM units u
         JOIN production_batches pb ON pb.id = u.batch_id
         WHERE pb.order_line_id = ?
           AND u.label_confirmed_at IS NOT NULL
           AND u.id NOT IN (SELECT unit_id FROM shipment_units WHERE shipment_id = ?)
           AND u.id NOT IN (
             SELECT su.unit_id FROM shipment_units su
             JOIN shipments s ON s.id = su.shipment_id
             WHERE s.order_line_id = ? AND s.id != ?
           )
         ORDER BY u.human_code`
    ).bind(shipment.order_line_id, id, shipment.order_line_id, id).all();
    if (results.length === missing) {
      missingUnits = results.map((r) => r.human_code);
    } else {
      missingUnitsUncertain = true;
    }
  }
  await db.prepare("UPDATE shipments SET status = 'CLOSED', closed_at = datetime('now') WHERE id = ?").bind(id).run();
  return {
    id,
    status: "CLOSED",
    plannedQuantity: shipment.planned_quantity,
    packedCount,
    missing,
    missingUnits,
    missingUnitsUncertain
  };
}
__name(closeShipment, "closeShipment");
async function dispatchShipment(db, shipmentId, { locationName, actor }) {
  const shipment = await db.prepare("SELECT * FROM shipments WHERE id = ?").bind(shipmentId).first();
  if (!shipment) return { notFound: true };
  if (shipment.status !== "CLOSED") {
    throw new ValidationError("Only a closed shipment can be dispatched -- close it first once packing is complete.");
  }
  if (!locationName) throw new ValidationError("A destination location is required.");
  const location = await getOrCreateLocation(db, locationName);
  const { results: units } = await db.prepare("SELECT unit_id FROM shipment_units WHERE shipment_id = ?").bind(shipmentId).all();
  const statements = [];
  for (const { unit_id } of units) {
    statements.push(
      ...buildEventBatch(db, {
        eventId: newInternalId(),
        unitId: unit_id,
        eventType: "UNIT_DISPATCHED",
        payload: { shipmentId, reference: shipment.reference },
        actor: actor ?? "izzat",
        locationId: location.id
      })
    );
  }
  statements.push(
    db.prepare("UPDATE shipments SET status = 'DISPATCHED', destination_location_id = ? WHERE id = ?").bind(location.id, shipmentId)
  );
  await db.batch(statements);
  return { id: shipmentId, status: "DISPATCHED", locationName: location.name, dispatchedCount: units.length };
}
__name(dispatchShipment, "dispatchShipment");
async function listShipmentsForOrderLine(db, orderLineId) {
  const { results } = await db.prepare(
    `SELECT s.id, s.reference, s.planned_quantity, s.status, l.name AS destination_name,
              (SELECT COUNT(*) FROM shipment_units su WHERE su.shipment_id = s.id) AS scanned_count
       FROM shipments s
       LEFT JOIN locations l ON l.id = s.destination_location_id
       WHERE s.order_line_id = ? ORDER BY s.created_at`
  ).bind(orderLineId).all();
  return results;
}
__name(listShipmentsForOrderLine, "listShipmentsForOrderLine");

// src/services/returns.js
init_checked_fetch();
init_modules_watch_stub();
var QC_OUTCOMES = {
  AVAILABLE: { disposition: "AVAILABLE" },
  DAMAGED: { condition: "DAMAGED" },
  REJECTED: { disposition: "REJECTED" }
};
async function createReturnIntake(db, { customerId, reference, locationName }) {
  if (!reference) throw new ValidationError("reference is required.");
  const id = newInternalId();
  await db.prepare("INSERT INTO return_intakes (id, customer_id, reference) VALUES (?, ?, ?)").bind(id, customerId ?? null, reference).run();
  return { id, customerId: customerId ?? null, reference, status: "OPEN", locationName: locationName || "Returns Area" };
}
__name(createReturnIntake, "createReturnIntake");
async function scanUnitIntoReturnIntake(db, returnIntakeId, { code, actor, locationName }) {
  const intake = await db.prepare("SELECT * FROM return_intakes WHERE id = ?").bind(returnIntakeId).first();
  if (!intake) return { notFound: true };
  if (intake.status !== "OPEN") throw new ValidationError("This return intake is not open.");
  if (!code) throw new ValidationError("code is required.");
  const { results: matches } = await db.prepare(
    `SELECT u.*, v.variant_label, p.name AS product_name,
              o.order_reference, c.id AS customer_id, c.name AS customer_name
       FROM units u
       JOIN production_batches pb ON pb.id = u.batch_id
       JOIN variants v ON v.id = pb.variant_id
       JOIN products p ON p.id = v.product_id
       LEFT JOIN order_lines ol ON ol.id = pb.order_line_id
       LEFT JOIN orders o ON o.id = ol.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE u.human_code = ?1 OR u.internal_token = ?1 OR u.public_token = ?1`
  ).bind(code).all();
  if (!matches.length) return { notFound: true, reason: "unit" };
  if (matches.length > 1) {
    throw new ValidationError(
      `Code "${code}" matches more than one unit and isn't uniquely identifiable here -- scan the QR instead of typing the code.`
    );
  }
  const unit = matches[0];
  const already = await db.prepare("SELECT 1 FROM return_intake_units WHERE return_intake_id = ? AND unit_id = ?").bind(returnIntakeId, unit.id).first();
  if (already) {
    return { unitId: unit.id, humanCode: unit.human_code, alreadyScanned: true };
  }
  const dispatched = await db.prepare("SELECT 1 FROM unit_events WHERE unit_id = ? AND event_type = 'UNIT_DISPATCHED' LIMIT 1").bind(unit.id).first();
  const expected = !!dispatched;
  const customerMismatch = !!(intake.customer_id && unit.customer_id && unit.customer_id !== intake.customer_id);
  const { results: activeShipments } = await db.prepare(
    `SELECT s.reference FROM shipment_units su
       JOIN shipments s ON s.id = su.shipment_id
       WHERE su.unit_id = ? AND s.status != 'DISPATCHED'`
  ).bind(unit.id).all();
  const activeShipmentConflict = activeShipments.length ? activeShipments[0].reference : null;
  const location = await getOrCreateLocation(db, locationName || "Returns Area");
  const eventId = newInternalId();
  const statements = buildEventBatch(db, {
    eventId,
    unitId: unit.id,
    eventType: "RETURN_RECEIVED",
    payload: { returnIntakeId, reference: intake.reference, expected, customerMismatch, activeShipmentConflict },
    actor: actor ?? "izzat",
    locationId: location.id
  });
  statements.push(
    db.prepare(
      "INSERT INTO return_intake_units (return_intake_id, unit_id, actor, expected, customer_mismatch, active_shipment_conflict) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(returnIntakeId, unit.id, actor ?? null, expected ? 1 : 0, customerMismatch ? 1 : 0, activeShipmentConflict)
  );
  await db.batch(statements);
  return {
    unitId: unit.id,
    humanCode: unit.human_code,
    product: `${unit.product_name} \xB7 ${unit.variant_label}`,
    orderReference: unit.order_reference,
    customerName: unit.customer_name,
    expected,
    customerMismatch,
    activeShipmentConflict,
    locationName: location.name,
    alreadyScanned: false
  };
}
__name(scanUnitIntoReturnIntake, "scanUnitIntoReturnIntake");
async function decideReturnQc(db, returnIntakeId, unitId, { outcome, actor }) {
  const row = await db.prepare("SELECT * FROM return_intake_units WHERE return_intake_id = ? AND unit_id = ?").bind(returnIntakeId, unitId).first();
  if (!row) return { notFound: true };
  const change = QC_OUTCOMES[outcome];
  if (!change) throw new ValidationError(`outcome must be one of: ${Object.keys(QC_OUTCOMES).join(", ")}.`);
  const eventId = newInternalId();
  const statements = buildEventBatch(db, {
    eventId,
    unitId,
    eventType: "RETURN_QC_DECIDED",
    payload: { returnIntakeId, outcome },
    actor: actor ?? "izzat",
    disposition: change.disposition,
    condition: change.condition
  });
  statements.push(
    db.prepare(
      "UPDATE return_intake_units SET qc_outcome = ?, qc_decided_at = datetime('now') WHERE return_intake_id = ? AND unit_id = ?"
    ).bind(outcome, returnIntakeId, unitId)
  );
  await db.batch(statements);
  return { unitId, outcome };
}
__name(decideReturnQc, "decideReturnQc");
async function getReturnIntake(db, id) {
  const intake = await db.prepare(
    `SELECT ri.*, c.name AS customer_name
       FROM return_intakes ri
       LEFT JOIN customers c ON c.id = ri.customer_id
       WHERE ri.id = ?`
  ).bind(id).first();
  if (!intake) return null;
  const { results: units } = await db.prepare(
    `SELECT riu.unit_id, riu.expected, riu.customer_mismatch, riu.active_shipment_conflict, riu.qc_outcome, u.human_code
       FROM return_intake_units riu
       JOIN units u ON u.id = riu.unit_id
       WHERE riu.return_intake_id = ?
       ORDER BY riu.scanned_at`
  ).bind(id).all();
  return { ...intake, units };
}
__name(getReturnIntake, "getReturnIntake");
async function listReturnIntakes(db) {
  const { results } = await db.prepare(
    `SELECT ri.id, ri.reference, ri.status, ri.created_at, c.name AS customer_name,
              (SELECT COUNT(*) FROM return_intake_units riu WHERE riu.return_intake_id = ri.id) AS scanned_count,
              (SELECT COUNT(*) FROM return_intake_units riu WHERE riu.return_intake_id = ri.id AND riu.qc_outcome IS NULL) AS pending_qc_count
       FROM return_intakes ri
       LEFT JOIN customers c ON c.id = ri.customer_id
       ORDER BY ri.created_at DESC`
  ).all();
  return results;
}
__name(listReturnIntakes, "listReturnIntakes");
async function closeReturnIntake(db, id) {
  const intake = await db.prepare("SELECT * FROM return_intakes WHERE id = ?").bind(id).first();
  if (!intake) return { notFound: true };
  if (intake.status !== "OPEN") throw new ValidationError("This return intake is not open.");
  await db.prepare("UPDATE return_intakes SET status = 'CLOSED', closed_at = datetime('now') WHERE id = ?").bind(id).run();
  return { id, status: "CLOSED" };
}
__name(closeReturnIntake, "closeReturnIntake");

// src/domain/errors.js
init_checked_fetch();
init_modules_watch_stub();
var D1_ERROR_PATTERNS = [
  { test: /FOREIGN KEY constraint failed/i, status: 400, message: "Referenced resource does not exist." },
  { test: /UNIQUE constraint failed/i, status: 409, message: "This resource already exists or conflicts with an existing one." }
];
function toErrorResponse(err) {
  if (err instanceof ValidationError) {
    return Response.json({ error: err.message }, { status: 400 });
  }
  const message = String(err && err.message ? err.message : err);
  for (const pattern of D1_ERROR_PATTERNS) {
    if (pattern.test.test(message)) {
      return Response.json({ error: pattern.message }, { status: pattern.status });
    }
  }
  console.error("Unhandled error:", err);
  return Response.json({ error: "Internal server error." }, { status: 500 });
}
__name(toErrorResponse, "toErrorResponse");

// src/routes/index.js
function ok(body2, status = 200) {
  return Response.json(body2, { status });
}
__name(ok, "ok");
function notFound(message) {
  return Response.json({ error: message }, { status: 404 });
}
__name(notFound, "notFound");
async function body(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
__name(body, "body");
async function routeApi(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  let m;
  try {
    if (pathname === "/api/login" && method === "POST") {
      const { password } = await body(request);
      if (!password || !await verifyPassword(password, env)) {
        return Response.json({ error: "Incorrect password." }, { status: 401 });
      }
      const cookie = await setSessionCookieHeader(env);
      return Response.json(
        { ok: true, user: env.LABELISM_ADMIN_USER || "izzat" },
        { headers: { "Set-Cookie": cookie } }
      );
    }
    if (pathname === "/api/logout" && method === "POST") {
      return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookieHeader() } });
    }
    if (pathname === "/api/health" && method === "GET") {
      return ok({ ok: true, project: "Labelism", phase: "Phase 1 -- receiving & unit registration", dbMode: "d1" });
    }
    if (pathname === "/api/products" && method === "POST") {
      return ok(await createProduct(env.DB, await body(request)), 201);
    }
    if (pathname === "/api/products" && method === "GET") {
      return ok(await listProducts(env.DB));
    }
    if (pathname === "/api/variants" && method === "POST") {
      return ok(await createVariant(env.DB, await body(request)), 201);
    }
    if ((m = pathname.match(/^\/api\/products\/([^/]+)\/dimensions$/)) && method === "POST") {
      const b = await body(request);
      const result = await addProductDimensions(env.DB, m[1], Array.isArray(b.names) ? b.names : []);
      if (result.notFound) return notFound("Product not found.");
      return ok(result, 201);
    }
    if (pathname === "/api/production-batches" && method === "POST") {
      return ok(await createProductionBatch(env.DB, await body(request)), 201);
    }
    if (pathname === "/api/production-batches" && method === "GET") {
      return ok(await listProductionBatches(env.DB));
    }
    if ((m = pathname.match(/^\/api\/production-batches\/([^/]+)$/)) && method === "GET") {
      const batch = await getProductionBatch(env.DB, m[1]);
      if (!batch) return notFound("Production batch not found.");
      return ok(batch);
    }
    if ((m = pathname.match(/^\/api\/production-batches\/([^/]+)\/receipts$/)) && method === "POST") {
      const result = await createReceipt(env.DB, m[1], await body(request));
      if (result.notFound) return notFound("Production batch not found.");
      return ok(result, 201);
    }
    if ((m = pathname.match(/^\/api\/production-batches\/([^/]+)\/units$/)) && method === "GET") {
      return ok(await listUnitsForBatch(env.DB, m[1]));
    }
    if ((m = pathname.match(/^\/api\/production-batches\/([^/]+)\/generate-units$/)) && method === "POST") {
      const b = await body(request);
      const result = await generateUnitsForBatch(env.DB, m[1], b.actor);
      if (result.notFound) return notFound("Production batch not found.");
      return ok(result, result.created ? 201 : 200);
    }
    if ((m = pathname.match(/^\/api\/receipts\/([^/]+)\/register-units$/)) && method === "POST") {
      const b = await body(request);
      const result = await registerUnits(env.DB, m[1], b.actor);
      if (result.notFound) return notFound("Receipt not found.");
      return ok(result, result.created ? 201 : 200);
    }
    if (pathname === "/api/import/preview" && method === "POST") {
      const b = await body(request);
      const manifest = normalizeManifest(b.manifest);
      return ok(await previewManifest(env.DB, manifest));
    }
    if (pathname === "/api/import/apply" && method === "POST") {
      const b = await body(request);
      const manifest = normalizeManifest(b.manifest);
      return ok(await applyManifest(env.DB, manifest, b.actor), 201);
    }
    if (pathname === "/api/stats" && method === "GET") {
      return ok(await getDashboardStats(env.DB));
    }
    if (pathname === "/api/customers" && method === "GET") {
      return ok(await listCustomers(env.DB));
    }
    if (pathname === "/api/customers" && method === "POST") {
      return ok(await createCustomer(env.DB, await body(request)), 201);
    }
    if (pathname === "/api/orders" && method === "GET") {
      return ok(await listOrders(env.DB));
    }
    if (pathname === "/api/orders" && method === "POST") {
      return ok(await createOrder(env.DB, await body(request)), 201);
    }
    if (pathname === "/api/orders/create-with-labels" && method === "POST") {
      return ok(await createOrderWithLabels(env.DB, await body(request)), 201);
    }
    if ((m = pathname.match(/^\/api\/orders\/([^/]+)\/reconciliation$/)) && method === "GET") {
      const result = await getOrderReconciliation(env.DB, m[1]);
      if (!result) return notFound("Order not found.");
      return ok(result);
    }
    if (pathname === "/api/order-lines" && method === "POST") {
      return ok(await createOrderLine(env.DB, await body(request)), 201);
    }
    if ((m = pathname.match(/^\/api\/order-lines\/([^/]+)$/)) && method === "GET") {
      const result = await getOrderLine(env.DB, m[1]);
      if (!result) return notFound("Order line not found.");
      return ok(result);
    }
    if ((m = pathname.match(/^\/api\/order-lines\/([^/]+)\/batches$/)) && method === "POST") {
      const result = await addBatchToOrderLine(env.DB, m[1], await body(request));
      if (result.notFound) return notFound("Order line not found.");
      return ok(result, 201);
    }
    if ((m = pathname.match(/^\/api\/order-lines\/([^/]+)\/notes$/)) && method === "POST") {
      const b = await body(request);
      const result = await updateOrderLineNotes(env.DB, m[1], b.notes);
      if (result.notFound) return notFound("Order line not found.");
      return ok(result);
    }
    if (pathname === "/api/shipments" && method === "POST") {
      const result = await createShipment(env.DB, await body(request));
      if (result.notFound) return notFound("Order line not found.");
      return ok(result, 201);
    }
    if ((m = pathname.match(/^\/api\/shipments\/([^/]+)$/)) && method === "GET") {
      const result = await getShipment(env.DB, m[1]);
      if (!result) return notFound("Shipment not found.");
      return ok(result);
    }
    if ((m = pathname.match(/^\/api\/shipments\/([^/]+)\/scans$/)) && method === "POST") {
      const result = await scanUnitIntoShipment(env.DB, m[1], await body(request));
      if (result.notFound && result.reason === "unit") return notFound("Unit not found.");
      if (result.notFound) return notFound("Shipment not found.");
      return ok(result, result.alreadyScanned ? 200 : 201);
    }
    if ((m = pathname.match(/^\/api\/shipments\/([^/]+)\/close$/)) && method === "POST") {
      const b = await body(request);
      const result = await closeShipment(env.DB, m[1], b.actor);
      if (result.notFound) return notFound("Shipment not found.");
      return ok(result);
    }
    if ((m = pathname.match(/^\/api\/shipments\/([^/]+)\/dispatch$/)) && method === "POST") {
      const b = await body(request);
      const result = await dispatchShipment(env.DB, m[1], { locationName: b.locationName, actor: b.actor });
      if (result.notFound) return notFound("Shipment not found.");
      return ok(result);
    }
    if ((m = pathname.match(/^\/api\/order-lines\/([^/]+)\/shipments$/)) && method === "GET") {
      return ok(await listShipmentsForOrderLine(env.DB, m[1]));
    }
    if (pathname === "/api/return-intakes" && method === "GET") {
      return ok(await listReturnIntakes(env.DB));
    }
    if (pathname === "/api/return-intakes" && method === "POST") {
      return ok(await createReturnIntake(env.DB, await body(request)), 201);
    }
    if ((m = pathname.match(/^\/api\/return-intakes\/([^/]+)$/)) && method === "GET") {
      const result = await getReturnIntake(env.DB, m[1]);
      if (!result) return notFound("Return intake not found.");
      return ok(result);
    }
    if ((m = pathname.match(/^\/api\/return-intakes\/([^/]+)\/scans$/)) && method === "POST") {
      const b = await body(request);
      const result = await scanUnitIntoReturnIntake(env.DB, m[1], b);
      if (result.notFound && result.reason === "unit") return notFound("Unit not found.");
      if (result.notFound) return notFound("Return intake not found.");
      return ok(result, result.alreadyScanned ? 200 : 201);
    }
    if ((m = pathname.match(/^\/api\/return-intakes\/([^/]+)\/units\/([^/]+)\/qc$/)) && method === "POST") {
      const b = await body(request);
      const result = await decideReturnQc(env.DB, m[1], m[2], b);
      if (result.notFound) return notFound("That unit is not part of this return intake.");
      return ok(result);
    }
    if ((m = pathname.match(/^\/api\/return-intakes\/([^/]+)\/close$/)) && method === "POST") {
      const result = await closeReturnIntake(env.DB, m[1]);
      if (result.notFound) return notFound("Return intake not found.");
      return ok(result);
    }
    if (pathname === "/api/locations" && method === "GET") {
      return ok(await listLocations(env.DB));
    }
    if (pathname === "/api/locations" && method === "POST") {
      return ok(await createLocation(env.DB, await body(request)), 201);
    }
    if ((m = pathname.match(/^\/api\/units\/([^/]+)\/confirm-label$/)) && method === "POST") {
      const b = await body(request);
      const result = await confirmLabel(env.DB, m[1], b.actor);
      if (result.notFound) return notFound("Unit not found.");
      return ok(result, 201);
    }
    if ((m = pathname.match(/^\/api\/units\/([^/]+)\/verify-label-scan$/)) && method === "POST") {
      const b = await body(request);
      const result = await verifyLabelScan(env.DB, m[1], b.code, b.actor);
      if (result.notFound) return notFound("Unit not found.");
      return ok(result, result.verified ? 201 : 200);
    }
    if ((m = pathname.match(/^\/api\/units\/([^/]+)\/reissue-label$/)) && method === "POST") {
      const b = await body(request);
      const result = await reissueLabel(env.DB, m[1], b.actor);
      if (result.notFound) return notFound("Unit not found.");
      return ok(result, 201);
    }
    if ((m = pathname.match(/^\/api\/units\/([^/]+)\/reissue-label-after-attachment$/)) && method === "POST") {
      const b = await body(request);
      const result = await reissueLabelAfterAttachment(env.DB, m[1], b.actor);
      if (result.notFound) return notFound("Unit not found.");
      return ok(result, 201);
    }
    if ((m = pathname.match(/^\/api\/units\/lookup\/([^/]+)$/)) && method === "GET") {
      const result = await lookupUnit(env.DB, m[1]);
      if (!result) return notFound("Unit not found.");
      return ok(result);
    }
    if ((m = pathname.match(/^\/api\/units\/([^/]+)\/events$/)) && method === "POST") {
      const result = await recordUnitEvent(env.DB, m[1], await body(request));
      if (result.notFound) return notFound("Unit not found.");
      return ok(result, 201);
    }
    if (pathname === "/api/stocktake-sessions" && method === "GET") {
      return ok(await listStocktakeSessions(env.DB));
    }
    if (pathname === "/api/stocktake-sessions" && method === "POST") {
      const result = await openStocktakeSession(env.DB, await body(request));
      if (result.notFound) return notFound("Production batch not found.");
      return ok(result, 201);
    }
    if ((m = pathname.match(/^\/api\/stocktake-sessions\/([^/]+)$/)) && method === "GET") {
      const result = await getStocktakeSession(env.DB, m[1]);
      if (!result) return notFound("Stocktake session not found.");
      return ok(result);
    }
    if ((m = pathname.match(/^\/api\/stocktake-sessions\/([^/]+)\/scans$/)) && method === "POST") {
      const result = await scanStocktakeUnit(env.DB, m[1], await body(request));
      if (result.notFound && result.reason === "unit") return notFound("Unit not found.");
      if (result.notFound) return notFound("Stocktake session not found.");
      return ok(result, result.alreadyScanned ? 200 : 201);
    }
    if ((m = pathname.match(/^\/api\/stocktake-sessions\/([^/]+)\/close$/)) && method === "POST") {
      const b = await body(request);
      const result = await closeStocktakeSession(env.DB, m[1], b.actor);
      if (result.notFound) return notFound("Stocktake session not found.");
      return ok(result);
    }
    return null;
  } catch (err) {
    return toErrorResponse(err);
  }
}
__name(routeApi, "routeApi");

// src/worker.js
var bootChecked = false;
var worker_default = {
  async fetch(request, env, ctx) {
    if (!bootChecked) {
      assertAuthSafeToBoot(env);
      bootChecked = true;
    }
    const gateResponse = await authGate(request, env);
    if (gateResponse) return gateResponse;
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const apiResponse = await routeApi(request, env);
      if (apiResponse) return apiResponse;
      return Response.json({ error: "Not found." }, { status: 404 });
    }
    if (url.pathname === "/") {
      return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
    }
    return env.ASSETS.fetch(request);
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
init_checked_fetch();
init_modules_watch_stub();
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
init_checked_fetch();
init_modules_watch_stub();
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-obLms4/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
init_checked_fetch();
init_modules_watch_stub();
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-obLms4/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
/*! Bundled license information:

bcryptjs/dist/bcrypt.js:
  (**
   * @license bcrypt.js (c) 2013 Daniel Wirtz <dcode@dcode.io>
   * Released under the Apache License, Version 2.0
   * see: https://github.com/dcodeIO/bcrypt.js for details
   *)
*/
//# sourceMappingURL=worker.js.map
